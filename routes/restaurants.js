const express = require("express");
const router = express.Router();
const Restaurant = require("../models/Restaurant");
const RestaurantUser = require("../models/RestaurantUser");
const MenuItem = require("../models/MenuItem");
const { auth, requireRole } = require("../middlewares/auth");

// ✅ Get all restaurants with advanced filters
router.get("/", async (req, res, next) => {
  try {
    const { 
      cuisine, 
      city, 
      area,
      minRating = 0, 
      maxDeliveryTime,
      minOrderAmount,
      isOpen = true,
      page = 1, 
      limit = 10,
      sortBy = 'rating',
      sortOrder = 'desc',
      search
    } = req.query;
// Build filter object

  const filter = { isActive: true };

if (typeof isOpen !== 'undefined') {
  filter.isOpen = (isOpen === true || isOpen === 'true');
}

if (cuisine) {
  filter.cuisine = { $in: cuisine.split(',').map(c => new RegExp(c, 'i')) };
}

if (city) {
  filter['address.city'] = new RegExp(city, 'i');
}

if (area) {
  filter['address.area'] = new RegExp(area, 'i');
}

if (minRating) {
  filter['rating.average'] = { $gte: parseFloat(minRating) };
}

if (maxDeliveryTime) {
  filter.deliveryTime = { $lte: parseInt(maxDeliveryTime) };
}

if (minOrderAmount) {
  filter.minOrderAmount = { $gte: parseFloat(minOrderAmount) };
}


    // Search across multiple fields
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { cuisine: { $in: [new RegExp(search, 'i')] } },
        { 'address.area': { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Sort options
    const sortOptions = {};
   // if (sortBy === 'rating') sortOptions.rating = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'rating') sortOptions['rating.average'] = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'deliveryTime') sortOptions.deliveryTime = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'minOrderAmount') sortOptions.minOrderAmount = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'name') sortOptions.name = sortOrder === 'asc' ? 1 : -1;

    // Pagination
    const skip = (page - 1) * limit;

    // Get restaurants and total count in parallel with lean queries
    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select('name images rating deliveryTime minOrderAmount cuisine address isOpen deliveryFee openingHours')
        .lean(),
      Restaurant.countDocuments(filter)
    ]);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: restaurants,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRestaurants: total,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        limit: parseInt(limit)
      },
      filters: {
        applied: Object.keys(filter).length > 1,
        totalResults: total
      }
    });

  } catch (err) {
    next(err);
  }
});



// router.get("/", async (req, res, next) => {
//   try {
//     const restaurants = await Restaurant.find()
//       .select('name images rating deliveryTime minOrderAmount cuisine address isOpen deliveryFee totalRatings openingHours');

//     res.json({
//       success: true,
//       count: restaurants.length,
//       data: restaurants
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// ✅ Get restaurant by ID with complete details and menu  jjjj
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get restaurant details and active menu items in parallel with lean queries
    const [restaurant, menuItems] = await Promise.all([
      Restaurant.findById(id).lean(),
      MenuItem.find({ 
        restaurantId: id,
        isAvailable: true 
      }).sort({ category: 1, price: 1 }).lean()
    ]);
    
    if (!restaurant || !restaurant.isActive) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found"
      });
    }

    // Group menu items by category
    const menuByCategory = menuItems.reduce((acc, item) => {
      const category = item.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {});

    // Calculate if restaurant is currently open
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes();
    const [openHour, openMinute] = restaurant.openingHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = restaurant.openingHours.close.split(':').map(Number);
    
    const openTime = openHour * 100 + openMinute;
    const closeTime = closeHour * 100 + closeMinute;
    
    const isCurrentlyOpen = currentTime >= openTime && currentTime <= closeTime && restaurant.isOpen;

    res.json({
      success: true,
      data: {
        ...restaurant.toObject(),
        isCurrentlyOpen,
        menu: menuByCategory,
        menuCategories: Object.keys(menuByCategory)
      }
    });

  } catch (err) {
    next(err);
  }
});

router.get("/res/owner/:ownerId", async (req, res, next) => {
  try {
    const { ownerId } = req.params;

    // 🟢 Find restaurant by ownerId
    const restaurant = await Restaurant.findOne({ ownerId });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found for this owner"
      });
    }

    // 🟢 Get menu items for this restaurant
    const menuItems = await MenuItem.find({
      restaurantId: restaurant._id,
      isAvailable: true
    }).sort({ category: 1, price: 1 });

    // 🟢 Group menu items by category
    const menuByCategory = menuItems.reduce((acc, item) => {
      const category = item.category || "Other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});

    // 🟢 Check if currently open (optional: only if restaurant has openingHours)
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

    // 🟢 Final structured response (same as your schema)
    const responseData = {
      _id: restaurant._id,
      name: restaurant.name,
      description: restaurant.description,
      cuisine: restaurant.cuisine,
      address: restaurant.address,
      contact: restaurant.contact,
      images: restaurant.images,
      rating: restaurant.rating,
      deliveryTime: restaurant.deliveryTime,
      minOrderAmount: restaurant.minOrderAmount,
      deliveryFee: restaurant.deliveryFee,
      isActive: restaurant.isActive,
      isOpen: restaurant.isOpen,
      isCurrentlyOpen,
      ownerId: restaurant.ownerId,
      createdBy: restaurant.createdBy,
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
      __v: restaurant.__v,
      // ✅ optional extra info
      menuCategories: Object.keys(menuByCategory),
      menu: menuByCategory
    };

    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (err) {
    console.error("❌ Error fetching restaurant by owner:", err);
    next(err);
  }
});



// ✅ Create new restaurant (Protected - for restaurant owners)
router.post("/", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    console.log('🔧 Creating restaurant for user:', req.user._id);
    
    const restaurantData = {
      ...req.body,
      ownerId: req.user._id, // ✅ Set ownerId from authenticated user
      createdBy: req.user._id // ✅ Also set createdBy if needed
    };

    console.log('📝 Restaurant data:', restaurantData);

    const restaurant = await Restaurant.create(restaurantData);

    // ✅ Update RestaurantUser with restaurantId
    const RestaurantUser = require("../models/RestaurantUser");
    await RestaurantUser.findByIdAndUpdate(req.user._id, {
      restaurantId: restaurant._id
    });

    console.log('✅ Restaurant created:', restaurant._id);

    res.status(201).json({
      success: true,
      message: "Restaurant created successfully",
      data: restaurant
    });

  } catch (err) {
    console.error('❌ Restaurant creation error:', err);
    next(err);
  }
});

// ✅ FLEXIBLE: Update restaurant (checks both ownerId and createdBy)
router.put("/:id", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    const { id } = req.params;

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found"
      });
    }

    const isOwner   = restaurant.ownerId   && restaurant.ownerId.toString()   === req.user._id.toString();
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
    console.error('❌ Restaurant update error:', err);
    next(err);
  }
});

// ✅ Update restaurant status (open/close) - 
// ✅ FLEXIBLE: Update restaurant status (checks both ownerId and createdBy)
router.patch("/:id/status", auth, requireRole(['restaurant']), async (req, res, next) => {
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

    // ✅ Check both ownerId AND createdBy
    const isOwner = restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString();
    const isCreator = restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString();

    // ✅ Fallback: allow restaurant owner if the authenticated RestaurantUser is linked to this restaurant
    const restaurantUser = await RestaurantUser.findById(req.user._id);
    const isLinkedRestaurant = restaurantUser && restaurantUser.restaurantId && restaurantUser.restaurantId.toString() === id;

    if (!isOwner && !isCreator && !isLinkedRestaurant) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this restaurant"
      });
    }

    // ✅ Ensure both fields are set for future
    if (!restaurant.ownerId) {
      restaurant.ownerId = req.user._id;
    }
    if (!restaurant.createdBy) {
      restaurant.createdBy = req.user._id;
    }

    // ✅ Update both isOpen and isActive (if provided)
    if (isOpen !== undefined) {
      restaurant.isOpen = isOpen;
    }
    if (isActive !== undefined) {
      restaurant.isActive = isActive;
    }
    
    await restaurant.save();

    // ✅ Dynamic message based on what was updated
    let message = "";
    if (isOpen !== undefined && isActive !== undefined) {
      message = `Restaurant ${isOpen ? 'opened' : 'closed'} and ${isActive ? 'activated' : 'deactivated'} successfully`;
    } else if (isOpen !== undefined) {
      message = `Restaurant ${isOpen ? 'opened' : 'closed'} successfully`;
    } else if (isActive !== undefined) {
      message = `Restaurant ${isActive ? 'activated' : 'deactivated'} successfully`;
    }

    res.json({
      success: true,
      message: message,
      data: restaurant
    });

  } catch (err) {
    console.error('❌ Error updating restaurant status:', err);
    next(err);
  }
});
// ✅ Get restaurant analytics (Protected - owner only)
// router.get("/:id/analytics", auth, requireRole(['restaurant']), async (req, res, next) => {
//   try {
//     const { id } = req.params;

//     const restaurant = await Restaurant.findById(id);
    
//     if (!restaurant) {
//       return res.status(404).json({
//         success: false,
//         error: "Restaurant not found"
//       });
//     }

//     if (restaurant.createdBy.toString() !== req.user._id) {
//       return res.status(403).json({
//         success: false,
//         error: "Not authorized to view analytics"
//       });
//     }

//     // Import Order model for analytics
//     const Order = require("../models/Order");
    
//     // Basic analytics
//     const totalOrders = await Order.countDocuments({ restaurantId: id });
//     const completedOrders = await Order.countDocuments({ 
//       restaurantId: id, 
//       status: 'delivered' 
//     });
    
//     // const earningsResult = await Order.aggregate([
//     //   { $match: { restaurantId: restaurant._id, status: 'delivered' } },
//     //   { $group: { _id: null, total: { $sum: '$totalAmount' } } }
//     // ]);

// const mongoose = require("mongoose");

// const earningsResult = await Order.aggregate([
//   { 
//     $match: { 
//       restaurantId: new mongoose.Types.ObjectId(restaurant._id), 
//       status: 'delivered' 
//     } 
//   },
//   { $unwind: '$items' },
//   { 
//     $group: { 
//       _id: null, 
//       total: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } 
//     } 
//   }
// ]);


//     const today = new Date();
//     const startOfDay = new Date(today.setHours(0, 0, 0, 0));
//     const todaysOrders = await Order.countDocuments({
//       restaurantId: id,
//       createdAt: { $gte: startOfDay }
//     });

//     // Popular items (simplified)
//     const popularItems = await MenuItem.find({ restaurantId: id })
//       .sort({ createdAt: -1 })
//       .limit(5)
//       .select('name price isAvailable');

//     res.json({
//       success: true,
//       data: {
//         totalOrders,
//         completedOrders,
//         pendingOrders: totalOrders - completedOrders,
//         totalEarnings: earningsResult[0]?.total || 0,
//         todaysOrders,
//         rating: restaurant.rating,
//         totalRatings: restaurant.totalRatings,
//         popularItems
//       }
//     });

//   } catch (err) {
//     next(err);
//   }
// });
// ✅ FLEXIBLE: Analytics route (checks both ownerId and createdBy)
// ✅ FIXED & MERGED: Analytics route with proper earnings calculation and enhanced features
router.get("/:id/analytics", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    const { id } = req.params;

    const restaurant = await Restaurant.findById(id);
    
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found"
      });
    }

    // ✅ FIX: Check both ownerId AND createdBy
    const isOwner = restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString();
    const isCreator = restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString();
    
    if (!isOwner && !isCreator) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to view analytics"
      });
    }

    const Order = require("../models/Order");
    const mongoose = require("mongoose");

    // Get basic order counts
    const totalOrders = await Order.countDocuments({ 
      restaurantId: restaurant._id 
    });
    
    const completedOrders = await Order.countDocuments({ 
      restaurantId: restaurant._id, 
      status: 'delivered' 
    });

    // ✅ FIXED: Enhanced earnings calculation with multiple approaches
    let totalEarnings = 0;

    // Approach 1: Check if totalAmount field exists
    const earningsByTotalAmount = await Order.aggregate([
      { 
        $match: { 
          restaurantId: restaurant._id, 
          status: 'delivered' 
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: '$totalAmount' } 
        } 
      }
    ]);

    if (earningsByTotalAmount.length > 0 && earningsByTotalAmount[0].total) {
      totalEarnings = earningsByTotalAmount[0].total;
    } else {
      // Approach 2: Calculate from items array if totalAmount doesn't exist
      const earningsFromItems = await Order.aggregate([
        { 
          $match: { 
            restaurantId: restaurant._id, 
            status: 'delivered' 
          } 
        },
        { $unwind: '$items' },
        { 
          $group: { 
            _id: null, 
            total: { 
              $sum: { 
                $multiply: [
                  { $toDouble: '$items.price' }, 
                  { $toDouble: '$items.quantity' }
                ] 
              } 
            } 
          } 
        }
      ]);

      if (earningsFromItems.length > 0 && earningsFromItems[0].total) {
        totalEarnings = earningsFromItems[0].total;
      } else {
        // Approach 3: Try alternative field names
        const earningsAlternative = await Order.aggregate([
          { 
            $match: { 
              restaurantId: restaurant._id, 
              status: 'delivered' 
            } 
          },
          { 
            $group: { 
              _id: null, 
              total: { $sum: '$amount' } 
            } 
          }
        ]);

        if (earningsAlternative.length > 0 && earningsAlternative[0].total) {
          totalEarnings = earningsAlternative[0].total;
        }
      }
    }

    // Get today's orders
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const todaysOrders = await Order.countDocuments({
      restaurantId: restaurant._id,
      createdAt: { $gte: startOfDay }
    });

    // Get orders by status for detailed analytics
    const ordersByStatus = await Order.aggregate([
      { 
        $match: { 
          restaurantId: restaurant._id 
        } 
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Convert to object for easier access
    const statusCounts = ordersByStatus.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    // Get popular items (based on order frequency)
    const popularItemsAgg = await Order.aggregate([
      { 
        $match: { 
          restaurantId: restaurant._id 
        } 
      },
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

    // If we have menu item IDs from aggregation, get full menu item details
    let popularItems = [];
    if (popularItemsAgg.length > 0) {
      const menuItemIds = popularItemsAgg.map(item => item._id);
      popularItems = await MenuItem.find({ 
        _id: { $in: menuItemIds } 
      }).select('name price isAvailable category');
    } else {
      // Fallback: just get recent menu items
      popularItems = await MenuItem.find({ restaurantId: restaurant._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name price isAvailable category');
    }

    // Calculate completion rate and average order value
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
    const averageOrderValue = completedOrders > 0 ? totalEarnings / completedOrders : 0;

    res.json({
      success: true,
      data: {
        // Basic counts
        totalOrders,
        completedOrders,
        pendingOrders: totalOrders - completedOrders - (statusCounts.cancelled || 0),
        cancelledOrders: statusCounts.cancelled || 0,
        
        // Financials
        totalEarnings,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        
        // Time-based
        todaysOrders,
        
        // Ratings
        rating: restaurant.rating?.average || 0,
        totalRatings: restaurant.rating?.count || 0,
        
        // Popular items
        popularItems,
        
        // Additional analytics
        completionRate: Math.round(completionRate * 100) / 100,
        ordersByStatus: statusCounts,
        
        // Restaurant status
        isOpen: restaurant.isOpen,
        isActive: restaurant.isActive
      }
    });

  } catch (err) {
    console.error('❌ Analytics error:', err);
    next(err);
  }
});
//
// ✅ Get restaurants by cuisine type
// ✅ FIXED: Get restaurants by cuisine type
router.get("/cuisine/:type", async (req, res, next) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    const restaurants = await Restaurant.find({
      cuisine: { $in: [new RegExp(type, 'i')] },
      isActive: true,
      isOpen: true
    })
      .sort({ 'rating.average': -1 }) // ✅ FIXED: Use rating.average
      .skip(skip)
      .limit(parseInt(limit))
      .select('name images rating deliveryTime minOrderAmount cuisine address isOpen deliveryFee openingHours'); // ✅ Added missing fields

    const total = await Restaurant.countDocuments({
      cuisine: { $in: [new RegExp(type, 'i')] },
      isActive: true,
      isOpen: true
    });

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: restaurants,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRestaurants: total,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        limit: parseInt(limit)
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ FIXED: Get featured restaurants (high rated, popular)
router.get("/featured/featured", async (req, res, next) => {
  try {
    const { limit = 8 } = req.query;

    const restaurants = await Restaurant.find({
      isActive: true,
      isOpen: true,
      'rating.average': { $gte: 4.0 } // ✅ FIXED: Use rating.average
    })
      .sort({ 'rating.average': -1, 'rating.count': -1 }) // ✅ FIXED: Use rating.count instead of totalRatings
      .limit(parseInt(limit))
      .select('name images rating deliveryTime minOrderAmount cuisine address deliveryFee isOpen openingHours'); // ✅ Added missing fields

    res.json({
      success: true,
      data: restaurants,
      count: restaurants.length
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;