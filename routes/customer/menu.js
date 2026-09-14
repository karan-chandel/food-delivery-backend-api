const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const MenuItem = require("../../models/MenuItem");
const Restaurant = require("../../models/Restaurant");

// Helper function for processing image URLs
const formatItemImages = (req, item) => {
  const plainItem = item.toObject ? item.toObject() : item;
  return {
    ...plainItem,
    images: plainItem.images ? plainItem.images.map(img => {
      if (typeof img === 'string') return { url: img };
      let finalUrl = img.url;
      if (!finalUrl || !finalUrl.startsWith('http')) {
        if (img.path && img.path.startsWith('http')) {
          finalUrl = img.path;
        } else if (img.path) {
          finalUrl = `${req.protocol}://${req.get('host')}/${img.path.replace(/\\/g, '/')}`;
        }
      }
      return { ...img, url: finalUrl || img.url };
    }) : []
  };
};

// ✅ Get restaurant menu (Customer Portal)
router.get("/restaurant/:restaurantId", async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { category, isVeg, minPrice, maxPrice, sortBy = 'name', sortOrder = 'asc' } = req.query;

    const restaurant = await Restaurant.findById(restaurantId).lean();
    if (!restaurant || !restaurant.isActive) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found or inactive"
      });
    }

    const filter = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isAvailable: true
    };

    if (category && category !== 'all') filter.category = new RegExp(category, 'i');
    if (isVeg !== undefined) filter.isVeg = isVeg === 'true';
    if (minPrice !== undefined) filter.price = { ...filter.price, $gte: parseFloat(minPrice) };
    if (maxPrice !== undefined) filter.price = { ...filter.price, $lte: parseFloat(maxPrice) };

    const sortOptions = {};
    if (sortBy === 'price') sortOptions.price = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'name') sortOptions.name = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'category') sortOptions.category = sortOrder === 'asc' ? 1 : -1;

    const menuItems = await MenuItem.find(filter).sort(sortOptions).lean();

    const menuItemsWithImageUrls = menuItems.map(item => formatItemImages(req, item));

    const menuByCategory = menuItemsWithImageUrls.reduce((acc, item) => {
      const cat = item.category || 'Other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {});

    res.json({
      success: true,
      data: menuItemsWithImageUrls,
      categories: Object.keys(menuByCategory),
      menuByCategory,
      count: menuItems.length
    });

  } catch (err) {
    next(err);
  }
});

// ✅ Search menu items across restaurants
router.get("/search/:query", async (req, res, next) => {
  try {
    const { query } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const searchFilter = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } }
      ],
      isAvailable: true
    };

    const [menuItems, total] = await Promise.all([
      MenuItem.find(searchFilter)
        .populate('restaurantId', 'name address isOpen deliveryTime')
        .sort({ price: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      MenuItem.countDocuments(searchFilter)
    ]);

    const menuItemsWithImageUrls = menuItems.map(item => formatItemImages(req, item));
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: menuItemsWithImageUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ Get single menu item by ID
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    const menuItem = await MenuItem.findById(id)
      .populate('restaurantId', 'name address contact isOpen');

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        error: "Menu item not found"
      });
    }

    res.json({
      success: true,
      data: formatItemImages(req, menuItem)
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
