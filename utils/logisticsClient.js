const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { LOGISTICS_SERVICE_URL, INTERNAL_SERVICE_SECRET } = require("../config/config");
const { calculateDeliveryEarnings, calculateDistance } = require("./deliveryUtils");

/**
 * Universal HTTP POST helper using built-in Node fetch or http/https
 */
const postJson = async (urlStr, payload, headers = {}, timeoutMs = 4000) => {
  if (typeof globalThis.fetch === "function") {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(urlStr, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json();
      return { status: response.status, data };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const postData = JSON.stringify(payload);

    const req = transport.request(
      parsedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let rawBody = "";
        res.on("data", (chunk) => (rawBody += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(rawBody);
            resolve({ status: res.statusCode, data });
          } catch (e) {
            resolve({ status: res.statusCode, data: rawBody });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request to Logistics service timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => reject(err));
    req.write(postData);
    req.end();
  });
};

/**
 * Process Rider Delivery Payout via zewito-logistics-service
 *
 * 🛡️ Resilient Microservice Client:
 * 1. Calls zewito-logistics-service (/api/v1/payout/calculate)
 * 2. Credits Rider's PartnerWallet on dedicated zewito-logistics DB
 * 3. Records immutable double-entry ledger in WalletTransaction
 * 4. Graceful Fallback: If Logistics service is offline/asleep, uses local official slabs
 */
const processOrderDeliveryPayout = async (order, rider) => {
  try {
    // 1. Calculate aerial delivery distance
    let distanceKm = parseFloat(order.deliveryInfo?.distance);
    if (!distanceKm || isNaN(distanceKm)) {
      const restLat = order.restaurantId?.address?.geolocation?.latitude || 28.6139;
      const restLng = order.restaurantId?.address?.geolocation?.longitude || 77.2090;
      const custLat = order.deliveryAddress?.latitude || 28.6200;
      const custLng = order.deliveryAddress?.longitude || 77.2150;
      distanceKm = calculateDistance(restLat, restLng, custLat, custLng);
    }

    // 2. Calculate waiting minutes at restaurant
    let waitingMinutes = 0;
    if (order.deliveryInfo?.arrivedAt && order.deliveryInfo?.pickedUpAt) {
      const arrivedTime = new Date(order.deliveryInfo.arrivedAt).getTime();
      const pickedUpTime = new Date(order.deliveryInfo.pickedUpAt).getTime();
      waitingMinutes = Math.max(0, Math.floor((pickedUpTime - arrivedTime) / 60000));
    } else if (order.deliveryInfo?.waitingTime) {
      waitingMinutes = parseInt(order.deliveryInfo.waitingTime, 10) || 0;
    }

    // 3. Generate HMAC service authentication token
    const serviceToken = crypto
      .createHmac("sha256", INTERNAL_SERVICE_SECRET)
      .update("zewito-inter-service-comm")
      .digest("hex");

    const payload = {
      orderId: order.orderId || String(order._id),
      partnerId: String(rider._id),
      distanceKm: parseFloat(distanceKm.toFixed(2)),
      waitingMinutes,
      demandCondition: "NORMAL",
      customerTip: parseFloat(order.tip || 0),
      orderIncentive: 0,
      pickupLocation: {
        latitude: order.restaurantId?.address?.geolocation?.latitude,
        longitude: order.restaurantId?.address?.geolocation?.longitude,
      },
      deliveryLocation: {
        latitude: order.deliveryAddress?.latitude,
        longitude: order.deliveryAddress?.longitude,
      },
    };

    const targetUrl = `${LOGISTICS_SERVICE_URL.replace(/\/$/, "")}/api/v1/payout/calculate`;

    console.log(`🏍️ [LogisticsClient] Requesting payout calculation for Order ${order.orderId} at ${targetUrl}...`);

    const response = await postJson(
      targetUrl,
      payload,
      {
        "x-internal-service-token": serviceToken,
        "x-internal-secret": INTERNAL_SERVICE_SECRET,
      },
      4500 // 4.5s timeout
    );

    if (response.status === 200 && response.data && response.data.success) {
      const payoutData = response.data.data;
      console.log(`✅ [LogisticsClient] Payout calculated & wallet credited: ₹${payoutData.totalPayout} for Rider ${rider._id}`);
      return {
        success: true,
        totalPayout: payoutData.totalPayout,
        payoutBreakdown: payoutData,
        source: "zewito-logistics-service",
      };
    }

    console.warn(`⚠️ [LogisticsClient] Unexpected response from logistics (${response.status}):`, response.data);
    throw new Error("Logistics service returned non-200 status");
  } catch (err) {
    console.warn(`⚠️ [LogisticsClient] Microservice call failed (${err.message}). Using resilient local payout engine...`);

    // Resilient Fallback to local official slabs (Never crash order delivery flow!)
    const distanceKm = isNaN(order.deliveryInfo?.distance) ? 3 : order.deliveryInfo?.distance || 3;
    const fallbackEarnings = calculateDeliveryEarnings(distanceKm, order.finalAmount);

    return {
      success: true,
      totalPayout: fallbackEarnings,
      payoutBreakdown: {
        totalPayout: fallbackEarnings,
        baseFare: 25,
        isFallback: true,
      },
      source: "local-fallback",
    };
  }
};

module.exports = {
  processOrderDeliveryPayout,
};
