const express = require("express");
const router = express.Router();
const Restaurant = require("../../models/Restaurant");
const MenuItem = require("../../models/MenuItem");

// ✅ Get all restaurants with advanced filters (Customer Portal)
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

    const filter = { isActive: true };

    if (typeof isOpen !== 'undefined') {
      filter.isOpen = (isOpen === true || isOpen === 'true');
    }

    if (cuisine) {
      filter.cuisine = { $in: cuisine.split(',').map(c => new RegExp(c.trim(), 'i')) };
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

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { cuisine: { $in: [new RegExp(search, 'i')] } },
        { 'address.area': { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    if (sortBy === 'rating') sortOptions['rating.average'] = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'deliveryTime') sortOptions.deliveryTime = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'minOrderAmount') sortOptions.minOrderAmount = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'name') sortOptions.name = sortOrder === 'asc' ? 1 : -1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select('name images rating deliveryTime minOrderAmount cuisine address isOpen deliveryFee openingHours')
        .lean(),
      Restaurant.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: restaurants,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRestaurants: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
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

// ✅ Get featured restaurants
const getFeaturedRestaurants = async (req, res, next) => {
  try {
    const { limit = 8 } = req.query;

    const restaurants = await Restaurant.find({
      isActive: true,
      isOpen: true,
      'rating.average': { $gte: 4.0 }
    })
      .sort({ 'rating.average': -1, 'rating.count': -1 })
      .limit(parseInt(limit))
      .select('name images rating deliveryTime minOrderAmount cuisine address deliveryFee isOpen openingHours')
      .lean();

    res.json({
      success: true,
      data: restaurants,
      count: restaurants.length
    });

  } catch (err) {
    next(err);
  }
};

router.get("/featured", getFeaturedRestaurants);
router.get("/featured/featured", getFeaturedRestaurants);

// ✅ Get restaurants by cuisine type
router.get("/cuisine/:type", async (req, res, next) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const restaurants = await Restaurant.find({
      cuisine: { $in: [new RegExp(type, 'i')] },
      isActive: true,
      isOpen: true
    })
      .sort({ 'rating.average': -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('name images rating deliveryTime minOrderAmount cuisine address isOpen deliveryFee openingHours')
      .lean();

    const total = await Restaurant.countDocuments({
      cuisine: { $in: [new RegExp(type, 'i')] },
      isActive: true,
      isOpen: true
    });

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: restaurants,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRestaurants: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
        limit: parseInt(limit)
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ Get restaurant by ID with complete details and menu
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

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

    const menuByCategory = menuItems.reduce((acc, item) => {
      const category = item.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {});

    let isCurrentlyOpen = restaurant.isOpen;
    if (restaurant.openingHours && restaurant.openingHours.open && restaurant.openingHours.close) {
      const now = new Date();
      const currentTime = now.getHours() * 100 + now.getMinutes();
      const [openHour, openMinute] = restaurant.openingHours.open.split(':').map(Number);
      const [closeHour, closeMinute] = restaurant.openingHours.close.split(':').map(Number);
      
      const openTime = openHour * 100 + openMinute;
      const closeTime = closeHour * 100 + closeMinute;
      
      isCurrentlyOpen = currentTime >= openTime && currentTime <= closeTime && restaurant.isOpen;
    }

    res.json({
      success: true,
      data: {
        ...restaurant,
        isCurrentlyOpen,
        menu: menuByCategory,
        menuCategories: Object.keys(menuByCategory)
      }
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
