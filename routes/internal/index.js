const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
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

/**
 * POST /api/v1/internal/restaurant-sync
 * Syncs restaurantId & metadata from zewito-catalog-service when a partner creates/updates a restaurant.
 */
router.post("/restaurant-sync", async (req, res, next) => {
  try {
    const { userId, ownerId, restaurantId, businessName, name, phone, email, isVerified } = req.body;
    const partnerId = userId || ownerId;

    if (!partnerId || !restaurantId) {
      return res.status(400).json({ success: false, error: "userId/ownerId and restaurantId are required" });
    }

    const updateSet = {
      restaurantId,
      ...(businessName ? { businessName } : {}),
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(typeof isVerified === "boolean" ? { isVerified } : {}),
    };
    const setOnInsert = {
      role: "restaurant",
      isActive: true,
      ...(phone ? { phone } : {}),
    };

    const restUser = await RestaurantUser.findByIdAndUpdate(
      partnerId,
      { $set: updateSet, $setOnInsert: setOnInsert },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: restUser });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/internal/restaurants/:restaurantId/analytics
 * Computes live order & revenue analytics from Order collection for Catalog / Logistics services.
 */
router.get("/restaurants/:restaurantId/analytics", async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res.status(400).json({ success: false, error: "Invalid restaurantId" });
    }

    const restObjId = new mongoose.Types.ObjectId(restaurantId);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalOrders,
      completedOrders,
      todaysOrders,
      statusGroups,
      salesBuckets,
      popularItemsAgg,
    ] = await Promise.all([
      Order.countDocuments({ restaurantId: restObjId }),
      Order.countDocuments({ restaurantId: restObjId, status: "delivered" }),
      Order.countDocuments({ restaurantId: restObjId, createdAt: { $gte: startOfToday } }),
      Order.aggregate([
        { $match: { restaurantId: restObjId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { restaurantId: restObjId, status: "delivered" } },
        {
          $addFields: {
            effectiveDate: { $ifNull: ["$deliveredAt", "$createdAt"] },
            revenueAmount: { $ifNull: ["$finalAmount", "$subtotal"] },
          },
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: "$revenueAmount" },
            todaySales: {
              $sum: { $cond: [{ $gte: ["$effectiveDate", startOfToday] }, "$revenueAmount", 0] },
            },
            weeklySales: {
              $sum: { $cond: [{ $gte: ["$effectiveDate", startOfWeek] }, "$revenueAmount", 0] },
            },
            monthlySales: {
              $sum: { $cond: [{ $gte: ["$effectiveDate", startOfMonth] }, "$revenueAmount", 0] },
            },
          },
        },
      ]),
      Order.aggregate([
        { $match: { restaurantId: restObjId } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.menuItemId",
            name: { $first: "$items.name" },
            totalQuantity: { $sum: "$items.quantity" },
            totalRevenue: { $sum: { $ifNull: ["$items.itemTotal", "$items.price"] } },
          },
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const ordersByStatus = {
      pending: 0,
      confirmed: 0,
      preparing: 0,
      ready_for_pickup: 0,
      assigned_to_rider: 0,
      picked_up: 0,
      out_for_delivery: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const row of statusGroups) {
      if (row._id) ordersByStatus[row._id] = row.count;
    }

    const sales = salesBuckets[0] || {
      totalSales: 0,
      todaySales: 0,
      weeklySales: 0,
      monthlySales: 0,
    };

    res.json({
      success: true,
      data: {
        restaurantId,
        totalOrders,
        completedOrders,
        todaysOrders,
        totalEarnings: Math.round((sales.totalSales || 0) * 100) / 100,
        totalSales: Math.round((sales.totalSales || 0) * 100) / 100,
        todaySales: Math.round((sales.todaySales || 0) * 100) / 100,
        weeklySales: Math.round((sales.weeklySales || 0) * 100) / 100,
        monthlySales: Math.round((sales.monthlySales || 0) * 100) / 100,
        ordersByStatus,
        popularItems: popularItemsAgg,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

