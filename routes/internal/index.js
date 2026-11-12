const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { INTERNAL_SERVICE_SECRET } = require("../../config/config");
const Rider = require("../../models/Rider");
const Order = require("../../models/Order");
const User = require("../../models/User");
const RestaurantUser = require("../../models/RestaurantUser");

function safeEqual(a, b) {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const internalAuth = (req, res, next) => {
  if (!INTERNAL_SERVICE_SECRET) {
    return res.status(403).json({ success: false, error: "Internal secret not configured" });
  }

  const secret = req.headers["x-internal-secret"];
  const serviceToken = req.headers["x-internal-service-token"];
  const expectedToken = crypto
    .createHmac("sha256", INTERNAL_SERVICE_SECRET)
    .update("zewito-inter-service-comm")
    .digest("hex");

  if (!safeEqual(secret, INTERNAL_SERVICE_SECRET) && !safeEqual(serviceToken, expectedToken)) {
    return res.status(403).json({ success: false, error: "Forbidden: Invalid internal token" });
  }

  next();
};

router.use(internalAuth);

/**
 * POST /api/v1/internal/rider-sync
 * Receives availability, location, and profile updates from zewito-rider-service
 * to keep local Rider cache & real-time Socket.io rooms synchronized.
 */
router.post("/rider-sync", async (req, res, next) => {
  try {
    const { riderId, riderName, isOnline, isAvailable, location, profile } = req.body;
    if (!riderId) {
      return res.status(400).json({ success: false, error: "riderId is required" });
    }

    const updateSet = {};
    if (typeof isOnline === "boolean") updateSet.isOnline = isOnline;
    if (typeof isAvailable === "boolean") updateSet.isAvailable = isAvailable;
    if (location && location.lat !== undefined && location.lng !== undefined) {
      updateSet.currentLocation = {
        lat: Number(location.lat),
        lng: Number(location.lng),
        address: location.address || "",
        lastUpdated: location.lastUpdated ? new Date(location.lastUpdated) : new Date(),
      };
    }
    if (profile && typeof profile === "object") {
      const allowedFields = [
        "name",
        "email",
        "phone",
        "vehicleType",
        "vehicleNo",
        "licenseNumber",
        "licensePhoto",
        "vehiclePhoto",
        "isVerified",
      ];
      for (const field of allowedFields) {
        if (profile[field] !== undefined) updateSet[field] = profile[field];
      }
    }

    let rider = null;
    if (Object.keys(updateSet).length > 0) {
      rider = await Rider.findByIdAndUpdate(
        riderId,
        { $set: updateSet },
        { new: true }
      );
    }

    const io = req.app.get("io");
    if (io) {
      if (typeof isOnline === "boolean" || typeof isAvailable === "boolean") {
        io.to("admin_dashboard_room").emit("rider_availability_updated", {
          riderId,
          riderName: rider?.name || riderName || "Rider",
          isOnline: typeof isOnline === "boolean" ? isOnline : rider?.isOnline,
          isAvailable: typeof isAvailable === "boolean" ? isAvailable : rider?.isAvailable,
          timestamp: new Date(),
        });
      }

      if (location && location.lat !== undefined && location.lng !== undefined) {
        io.to(`rider_${riderId}`).emit("rider_location_updated", {
          riderId,
          location: { lat: Number(location.lat), lng: Number(location.lng) },
          address: location.address || "",
          timestamp: new Date(),
        });

        if (rider?.currentOrder) {
          const order = await Order.findById(rider.currentOrder);
          if (order) {
            io.to([`user_${order.customerId}`, `restaurant_${order.restaurantId}`]).emit(
              "rider_location_update",
              {
                orderId: order.orderId,
                location: {
                  lat: Number(location.lat),
                  lng: Number(location.lng),
                  address: location.address || "",
                },
                riderId,
                timestamp: new Date(),
              }
            );
          }
        }
      }
    }

    res.json({ success: true, data: rider });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/internal/verify-user
 * Syncs verification status from zewito-admin-service.
 */
router.post("/verify-user", async (req, res, next) => {
  try {
    const { userId, role, isVerified = true } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required" });
    }

    const updates = [];
    updates.push(User.findByIdAndUpdate(userId, { $set: { isVerified: Boolean(isVerified) } }));
    if (role === "rider") {
      updates.push(Rider.findByIdAndUpdate(userId, { $set: { isVerified: Boolean(isVerified) } }));
    } else if (role === "restaurant") {
      updates.push(
        RestaurantUser.findByIdAndUpdate(userId, { $set: { isVerified: Boolean(isVerified) } })
      );
    }

    await Promise.all(updates);
    res.json({ success: true, message: "Verification synced on Core Platform" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

