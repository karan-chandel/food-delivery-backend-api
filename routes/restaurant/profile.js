const express = require("express");
const router = express.Router();
const Restaurant = require("../../models/Restaurant");
const RestaurantUser = require("../../models/RestaurantUser");
const MenuItem = require("../../models/MenuItem");
const Order = require("../../models/Order");
const { auth, requireRole } = require("../../middlewares/auth");

// All profile management routes require restaurant authentication
router.use(auth);
router.use(requireRole(["restaurant"]));

// ✅ Get authenticated owner's restaurant
router.get("/my-restaurant", async (req, res, next) => {
  try {
    let restaurant = await Restaurant.findOne({
      $or: [{ ownerId: req.user._id }, { createdBy: req.user._id }]
    });

    if (!restaurant) {
      const restaurantUser = await RestaurantUser.findById(req.user._id);
      if (restaurantUser && restaurantUser.restaurantId) {
        restaurant = await Restaurant.findById(restaurantUser.restaurantId);
      }
    }

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found for this user"
      });
    }

    res.json({
      success: true,
      data: restaurant
    });
  } catch (err) {
    next(err);
  }
});

// ✅ Get restaurant by ownerId
router.get("/owner/:ownerId", async (req, res, next) => {
  try {
    const { ownerId } = req.params;
    const restaurant = await Restaurant.findOne({ ownerId });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found for this owner"
      });
    }

    const menuItems = await MenuItem.find({
      restaurantId: restaurant._id,
      isAvailable: true
    }).sort({ category: 1, price: 1 });

    const menuByCategory = menuItems.reduce((acc, item) => {
      const category = item.category || "Other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});

    let isCurrentlyOpen = false;
    if (restaurant.openingHours?.open && restaurant.openingHours?.close) {
      const now = new Date();
      const currentTime = now.getHours() * 100 + now.getMinutes();
      const [openHour, openMinute] = restaurant.openingHours.open.split(":").map(Number);
      const [closeHour, closeMinute] = restaurant.openingHours.close.split(":").map(Number);
      const openTime = openHour * 100 + openMinute;
      const closeTime = closeHour * 100 + closeMinute;

      isCurrentlyOpen = currentTime >= openTime && currentTime <= closeTime && restaurant.isOpen;
    }

    res.status(200).json({
      success: true,
      data: {
        ...restaurant.toObject(),
        isCurrentlyOpen,
        menuCategories: Object.keys(menuByCategory),
        menu: menuByCategory
      }
    });
  } catch (err) {
    next(err);
  }
});

// ✅ Create restaurant
router.post("/", async (req, res, next) => {
  try {
    const restaurantData = {
      ...req.body,
      ownerId: req.user._id,
      createdBy: req.user._id
    };

    const restaurant = await Restaurant.create(restaurantData);

    await RestaurantUser.findByIdAndUpdate(req.user._id, {
      restaurantId: restaurant._id
    });

    res.status(201).json({
      success: true,
      message: "Restaurant created successfully",
      data: restaurant
    });
  } catch (err) {
    next(err);
  }
});

// ✅ Update restaurant details
router.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found"
      });
    }

    const isOwner = restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString();
    const isCreator = restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString();

    if (!isOwner && !isCreator) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this restaurant"
      });
    }

    const updatedRestaurant = await Restaurant.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Restaurant updated successfully",
      data: updatedRestaurant
    });
  } catch (err) {
    next(err);
  }
});

// ✅ Toggle / update status (open/close)
router.patch("/:id/status", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isOpen, isActive } = req.body;

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found"
      });
    }

    const isOwner = restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString();
    const isCreator = restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString();

    const restaurantUser = await RestaurantUser.findById(req.user._id);
    const isLinked = restaurantUser && restaurantUser.restaurantId && restaurantUser.restaurantId.toString() === id;

    if (!isOwner && !isCreator && !isLinked) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this restaurant"
      });
    }

    if (isOpen !== undefined) restaurant.isOpen = isOpen;
    if (isActive !== undefined) restaurant.isActive = isActive;
    await restaurant.save();

    res.json({
      success: true,
      message: "Restaurant status updated successfully",
      data: restaurant
    });
  } catch (err) {
    next(err);
  }
});

// ✅ Analytics route
router.get("/:id/analytics", async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found"
      });
    }

    const isOwner = restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString();
    const isCreator = restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString();
    if (!isOwner && !isCreator) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to view analytics"
      });
    }

    const totalOrders = await Order.countDocuments({ restaurantId: restaurant._id });
    const completedOrders = await Order.countDocuments({ restaurantId: restaurant._id, status: 'delivered' });

    let totalEarnings = 0;
    const earningsByTotalAmount = await Order.aggregate([
      { $match: { restaurantId: restaurant._id, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    if (earningsByTotalAmount.length > 0 && earningsByTotalAmount[0].total) {
      totalEarnings = earningsByTotalAmount[0].total;
    }

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const todaysOrders = await Order.countDocuments({
      restaurantId: restaurant._id,
      createdAt: { $gte: startOfDay }
    });

    const ordersByStatus = await Order.aggregate([
      { $match: { restaurantId: restaurant._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const statusCounts = ordersByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const popularItemsAgg = await Order.aggregate([
      { $match: { restaurantId: restaurant._id } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.menuItemId',
          name: { $first: '$items.name' },
          totalOrdered: { $sum: '$items.quantity' },
          price: { $first: '$items.price' }
        }
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 5 }
    ]);

    let popularItems = [];
    if (popularItemsAgg.length > 0) {
      const menuItemIds = popularItemsAgg.map(item => item._id);
      popularItems = await MenuItem.find({ _id: { $in: menuItemIds } }).select('name price isAvailable category');
    }

    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
    const averageOrderValue = completedOrders > 0 ? totalEarnings / completedOrders : 0;

    res.json({
      success: true,
      data: {
        totalOrders,
        completedOrders,
        pendingOrders: totalOrders - completedOrders - (statusCounts.cancelled || 0),
        cancelledOrders: statusCounts.cancelled || 0,
        totalEarnings,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        todaysOrders,
        rating: restaurant.rating?.average || 0,
        totalRatings: restaurant.rating?.count || 0,
        popularItems,
        completionRate: Math.round(completionRate * 100) / 100,
        ordersByStatus: statusCounts,
        isOpen: restaurant.isOpen,
        isActive: restaurant.isActive
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
