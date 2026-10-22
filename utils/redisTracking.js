const Redis = require("ioredis");
const { REDIS_URL } = require("../config/config");

// In-Memory Fallback State (operates seamlessly when Redis is offline or not configured)
const inMemoryRiders = new Map();
const inMemoryOrders = new Map();
const lastPersistedDbMap = new Map();
const lastNotificationMap = new Map();

let redisClient = null;
let pubClient = null;
let subClient = null;
let isRedisReady = false;
let hasLoggedOffline = false;

if (REDIS_URL && REDIS_URL.trim() !== "") {
  try {
    const redisOptions = {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 3000,
      retryStrategy: (times) => {
        if (times > 2) {
          if (!hasLoggedOffline) {
            hasLoggedOffline = true;
            console.warn("ℹ️ [Core Tracking Redis] Server offline. Operating in high-speed in-memory mode.");
          }
          return null; // Stop infinite reconnect loop
        }
        return 1000;
      },
    };

    redisClient = new Redis(REDIS_URL, redisOptions);
    pubClient = redisClient.duplicate();
    subClient = redisClient.duplicate();

    redisClient.on("ready", () => {
      isRedisReady = true;
      console.log("✅ [Core Tracking Redis] Client ready for real-time tracking operations");
    });

    redisClient.on("error", (err) => {
      isRedisReady = false;
      if (!hasLoggedOffline) {
        hasLoggedOffline = true;
        console.warn("ℹ️ [Core Tracking Redis] Notice:", err.message || "Offline");
      }
    });

    pubClient.on("error", () => {});
    subClient.on("error", () => {});

    Promise.all([
      redisClient.connect(),
      pubClient.connect(),
      subClient.connect(),
    ]).catch(() => {
      isRedisReady = false;
    });
  } catch (err) {
    console.warn("ℹ️ [Core Tracking] In-memory mode active:", err.message);
  }
} else {
  console.log("ℹ️ [Core Tracking] REDIS_URL not configured. Operating in high-speed in-memory mode.");
}

/**
 * Record High-Frequency Rider Geoping
 * Updates Redis GEO + Hash cache, publishes event on Redis Pub/Sub channel
 */
async function recordRiderLocation(data) {
  const {
    riderId,
    lat,
    lng,
    address = "",
    orderId = "",
    riderName = "",
    speed = 0,
    heading = 0,
  } = data;

  if (!riderId || lat === undefined || lng === undefined) {
    return { success: false, error: "riderId, lat, and lng are required" };
  }

  const numericLat = parseFloat(lat);
  const numericLng = parseFloat(lng);

  if (
    isNaN(numericLat) ||
    isNaN(numericLng) ||
    numericLat < -90 ||
    numericLat > 90 ||
    numericLng < -180 ||
    numericLng > 180
  ) {
    return { success: false, error: "Invalid geographic coordinates: lat must be -90..90, lng must be -180..180" };
  }

  const timestamp = new Date().toISOString();

  const record = {
    riderId: String(riderId),
    lat: numericLat,
    lng: numericLng,
    address,
    orderId: orderId ? String(orderId) : "",
    riderName,
    speed: parseFloat(speed) || 0,
    heading: parseFloat(heading) || 0,
    updatedAt: timestamp,
  };

  // 1. Fast in-memory state
  inMemoryRiders.set(String(riderId), record);
  if (orderId) {
    inMemoryOrders.set(String(orderId), record);
  }

  // 2. Redis Operations (if available)
  if (isRedisReady && redisClient) {
    try {
      const pipeline = redisClient.pipeline();
      // Geospatial indexing (longitude first in Redis)
      pipeline.geoadd("riders:locations", numericLng, numericLat, String(riderId));

      const hashKey = `rider:pos:${riderId}`;
      pipeline.hset(hashKey, {
        lat: String(numericLat),
        lng: String(numericLng),
        address,
        orderId: record.orderId,
        riderName,
        speed: String(record.speed),
        heading: String(record.heading),
        updatedAt: timestamp,
      });
      pipeline.expire(hashKey, 3600); // 1 hour TTL

      if (orderId) {
        const orderKey = `order:tracking:${orderId}`;
        pipeline.hset(orderKey, {
          riderId: String(riderId),
          lat: String(numericLat),
          lng: String(numericLng),
          address,
          riderName,
          updatedAt: timestamp,
        });
        pipeline.expire(orderKey, 7200); // 2 hours TTL
      }

      await pipeline.exec();

      if (pubClient) {
        pubClient.publish(
          "zewito:tracking:events",
          JSON.stringify({
            event: "rider_location_changed",
            ...record,
          })
        ).catch(() => {});
      }
    } catch (err) {
      console.warn("⚠️ [Redis Core Geoping Failed]:", err.message);
    }
  }

  return { success: true, timestamp, record };
}

/**
 * Throttled MongoDB Write-Behind Check
 * Returns true only if intervalMs has elapsed since last DB persist for this rider.
 * Default interval: 15 seconds (cuts DB writes by 80-90% during 3s geoping bursts)
 */
function shouldPersistToDb(riderId, intervalMs = 15000) {
  if (!riderId) return true;
  const key = String(riderId);
  const now = Date.now();
  const lastPersist = lastPersistedDbMap.get(key) || 0;

  if (now - lastPersist >= intervalMs) {
    lastPersistedDbMap.set(key, now);
    return true;
  }
  return false;
}

/**
 * Force clear persist timer so milestone events (picked_up, delivered) immediately write to DB
 */
function forcePersistDb(riderId) {
  if (riderId) {
    lastPersistedDbMap.set(String(riderId), Date.now());
  }
}

/**
 * Throttled Customer Notification Check
 * Prevents spamming customer with dozens of location push notifications
 * Default interval: 60 seconds
 */
function shouldNotifyCustomer(orderId, intervalMs = 60000) {
  if (!orderId) return false;
  const key = String(orderId);
  const now = Date.now();
  const lastNotify = lastNotificationMap.get(key) || 0;

  if (now - lastNotify >= intervalMs) {
    lastNotificationMap.set(key, now);
    return true;
  }
  return false;
}

/**
 * Get Instant Cached Location of a Rider (< 1ms)
 */
async function getCachedRiderPosition(riderId) {
  if (!riderId) return null;

  if (isRedisReady && redisClient) {
    try {
      const data = await redisClient.hgetall(`rider:pos:${riderId}`);
      if (data && data.lat && data.lng) {
        return {
          riderId,
          lat: parseFloat(data.lat),
          lng: parseFloat(data.lng),
          address: data.address || "",
          orderId: data.orderId || null,
          riderName: data.riderName || "",
          speed: parseFloat(data.speed) || 0,
          heading: parseFloat(data.heading) || 0,
          updatedAt: data.updatedAt,
        };
      }
    } catch (e) {}
  }

  return inMemoryRiders.get(String(riderId)) || null;
}

/**
 * Get Instant Cached Order Tracking Position
 */
async function getCachedOrderTracking(orderId) {
  if (!orderId) return null;

  if (isRedisReady && redisClient) {
    try {
      const data = await redisClient.hgetall(`order:tracking:${orderId}`);
      if (data && data.lat && data.lng) {
        return {
          orderId,
          riderId: data.riderId,
          lat: parseFloat(data.lat),
          lng: parseFloat(data.lng),
          address: data.address || "",
          riderName: data.riderName || "",
          updatedAt: data.updatedAt,
        };
      }
    } catch (e) {}
  }

  return inMemoryOrders.get(String(orderId)) || null;
}

/**
 * Setup Cross-Service Redis Tracking Subscriber
 * Bridges tracking geoping published by zewito-logistics-service directly to local Socket.io rooms!
 */
function setupTrackingSubscriber(io) {
  if (!subClient) return;

  const subscribe = () => {
    subClient.subscribe("zewito:tracking:events", (err) => {
      if (err) {
        console.warn("⚠️ [Redis Tracking Sub] Subscription notice:", err.message);
      } else {
        console.log("📡 [Redis Tracking Sub] Subscribed to zewito:tracking:events for cross-service tracking");
      }
    });
  };

  if (subClient.status === "ready") {
    subscribe();
  } else {
    subClient.once("ready", subscribe);
  }

  subClient.on("message", (channel, message) => {
    if (channel === "zewito:tracking:events" && io) {
      try {
        const payload = JSON.parse(message);
        if (payload.event === "rider_location_changed" && payload.orderId) {
          const lat = parseFloat(payload.lat);
          const lng = parseFloat(payload.lng);
          const fullPayload = {
            orderId: payload.orderId,
            riderId: payload.riderId,
            riderName: payload.riderName || "Delivery Partner",
            lat,
            lng,
            location: { lat, lng },
            currentLocation: { lat, lng, address: payload.address || "" },
            address: payload.address || "",
            timestamp: payload.updatedAt || new Date(),
          };

          io.to(`order_${payload.orderId}`).emit("rider_location_changed", fullPayload);
        }
      } catch (e) {
        // Safe catch for malformed Pub/Sub payload
      }
    }
  });
}

module.exports = {
  recordRiderLocation,
  shouldPersistToDb,
  forcePersistDb,
  shouldNotifyCustomer,
  getCachedRiderPosition,
  getCachedOrderTracking,
  setupTrackingSubscriber,
};
