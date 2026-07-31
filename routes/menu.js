const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const { auth, requireRole } = require("../middlewares/auth");
const { upload, handleUploadErrors } = require("../middlewares/upload");
const fs = require("fs");
const path = require("path");

// ✅ Get menu for a restaurant with filtering, sorting, and metadata
router.get("/restaurant/:restaurantId", async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { category, isVeg, minPrice, maxPrice, sortBy = 'name', sortOrder = 'asc' } = req.query;

    // ✅ Validate restaurant
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || !restaurant.isActive) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found or inactive"
      });
    }

    // ✅ Build filter
    const filter = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isAvailable: true
    };

    if (category && category !== 'all') filter.category = new RegExp(category, 'i');
    if (isVeg !== undefined) filter.isVeg = isVeg === 'true';
    if (minPrice !== undefined) filter.price = { ...filter.price, $gte: parseFloat(minPrice) };
    if (maxPrice !== undefined) filter.price = { ...filter.price, $lte: parseFloat(maxPrice) };

    // ✅ Sort
    const sortOptions = {};
    if (sortBy === 'price') sortOptions.price = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'name') sortOptions.name = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'category') sortOptions.category = sortOrder === 'asc' ? 1 : -1;

    const menuItems = await MenuItem.find(filter).sort(sortOptions).lean();

    // ✅ Fix image logic (Handles both string URLs and uploaded image objects)
    const menuItemsWithImageUrls = menuItems.map(item => ({
      ...item,
      images: item.images
        ? item.images.map(img => {
          if (typeof img === 'string') {
            // if image is just a URL string
            return { url: img };
          }
          // if image is an object (like uploaded file)
          return {
            path: img.path,
            url: img.path
              ? `${req.protocol}://${req.get('host')}/${img.path.replace(/\\/g, '/')}`
              : img.url
          };
        })
        : []
    }));

    // ✅ Group items by category
    const menuByCategory = {};
    const categories = new Set();

    menuItemsWithImageUrls.forEach(item => {
      const categoryName = item.category || 'Other';
      categories.add(categoryName);

      if (!menuByCategory[categoryName]) {
        menuByCategory[categoryName] = [];
      }

      menuByCategory[categoryName].push({
        _id: item._id,
        name: item.name,
        description: item.description,
        price: item.price,
        discountedPrice: item.discountedPrice,
        variants: item.variants || [],
        addonGroups: item.addonGroups || [],
        category: item.category,
        isVeg: item.isVeg,
        isAvailable: item.isAvailable,
        images: item.images || [],
        ingredients: item.ingredients || [],
        preparationTime: item.preparationTime,
        createdAt: item.createdAt
      });
    });

    // ✅ Calculate metadata
    const prices = menuItems.map(item => item.price);
    const priceRange = {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0
    };
    const vegCount = menuItems.filter(item => item.isVeg).length;
    const nonVegCount = menuItems.length - vegCount;

    res.json({
      success: true,
      data: menuByCategory,
      metadata: {
        totalItems: menuItems.length,
        categories: Array.from(categories),
        priceRange,
        vegCount,
        nonVegCount,
        restaurant: {
          name: restaurant.name,
          isOpen: restaurant.isOpen,
          deliveryTime: restaurant.deliveryTime
        }
      }
    });
  } catch (err) {
    console.error('❌ Error fetching menu:', err);
    next(err);
  }
});

// ✅ Add menu item (file upload OR image URLs)
router.post("/restaurant/:restaurantId", auth, requireRole(["restaurant"]), upload.array("images", 5), handleUploadErrors, async (req, res, next) => {
  try {
    const { restaurantId } = req.params;

    // ✅ Check restaurant exists
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      if (req.files && req.files.length > 0) {
        req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      }
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }

    // ✅ Prepare images array
    let images = [];

    // 1️⃣ If files uploaded
    if (req.files && req.files.length > 0) {
      images = req.files.map(file => ({
        url: `${req.protocol}://${req.get("host")}/${file.path.replace(/\\/g, "/")}`,
        filename: file.filename,
        path: file.path
      }));
    }
    // 2️⃣ If JSON URLs provided
    else if (req.body.images) {
      try {
        const imgArray = typeof req.body.images === "string" ? JSON.parse(req.body.images) : req.body.images;
        if (Array.isArray(imgArray)) {
          images = imgArray.map(url => ({ url, filename: null, path: null }));
        }
      } catch (e) {
        console.warn("⚠️ Invalid images data, skipping", e.message);
      }
    }

    // ✅ Prepare menu item data
    const menuItemData = {
      ...req.body,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      createdBy: req.user._id,
      images
    };
    // ✅ parse variants & addons (IMPORTANT)
    if (menuItemData.variants && typeof menuItemData.variants === "string") {
      menuItemData.variants = JSON.parse(menuItemData.variants);
    }

    if (menuItemData.addonGroups && typeof menuItemData.addonGroups === "string") {
      menuItemData.addonGroups = JSON.parse(menuItemData.addonGroups);
    }

    // ✅ Type conversions
    if (menuItemData.price) menuItemData.price = parseFloat(menuItemData.price);
    if (menuItemData.discountedPrice) menuItemData.discountedPrice = parseFloat(menuItemData.discountedPrice);
    if (menuItemData.preparationTime) menuItemData.preparationTime = parseInt(menuItemData.preparationTime);

    // ✅ Boolean fix (accept string or boolean)
    if (menuItemData.isVeg !== undefined)
      menuItemData.isVeg = menuItemData.isVeg === "true" || menuItemData.isVeg === true;
    if (menuItemData.isAvailable !== undefined)
      menuItemData.isAvailable = menuItemData.isAvailable === "true" || menuItemData.isAvailable === true;

    // ✅ Ingredients CSV → array
    if (menuItemData.ingredients && typeof menuItemData.ingredients === "string") {
      menuItemData.ingredients = menuItemData.ingredients
        .split(",")
        .map(i => i.trim())
        .filter(Boolean);
    }

    // ✅ Create menu item
    const menuItem = await MenuItem.create(menuItemData);

    // ✅ Emit Socket.io event (optional)
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`restaurant-${restaurantId}`).emit("menu-item-added", {
          message: "New menu item added",
          menuItem
        });
      }
    } catch { }

    res.status(201).json({
      success: true,
      message: "Menu item added successfully",
      data: menuItem
    });
  } catch (err) {
    // ✅ Cleanup uploaded files on error
    if (req.files && req.files.length > 0) {
      req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
    }
    console.error("❌ Error creating menu item:", err);
    next(err);
  }
}
);

// ✅ Update menu item with image upload
router.put(
  "/:id",
  auth,
  requireRole(["restaurant"]),
  upload.array("images", 5),
  handleUploadErrors,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Find menu item
      const menuItem = await MenuItem.findById(id);
      if (!menuItem) {
        if (req.files?.length) {
          req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
        }
        return res.status(404).json({ success: false, error: "Menu item not found" });
      }

      // Find restaurant
      const restaurant = await Restaurant.findById(menuItem.restaurantId);
      if (!restaurant || restaurant.createdBy.toString() !== req.user._id.toString()) {
        if (req.files?.length) {
          req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
        }
        return res.status(403).json({ success: false, error: "Not authorized to update this menu item" });
      }

      const updateData = { ...req.body };
      if (updateData.variants && typeof updateData.variants === "string") {
        updateData.variants = JSON.parse(updateData.variants);
      }

      if (updateData.addonGroups && typeof updateData.addonGroups === "string") {
        updateData.addonGroups = JSON.parse(updateData.addonGroups);
      }

      // Prepare new images
      let newImages = [];

      // 1️⃣ Using uploaded files
      if (req.files && req.files.length > 0) {
        newImages = req.files.map(file => ({
          url: `${req.protocol}://${req.get("host")}/${file.path.replace(/\\/g, "/")}`,
          filename: file.filename,
          path: file.path
        }));

        // If frontend sends replaceImages = true → delete old images
        if (req.body.replaceImages === "true") {
          if (menuItem.images?.length) {
            menuItem.images.forEach(img => {
              if (img.path && fs.existsSync(img.path)) {
                fs.unlinkSync(img.path);
              }
            });
          }
          updateData.images = newImages;
        } else {
          updateData.images = [...menuItem.images, ...newImages];
        }
      }

      // 2️⃣ JSON URLs (external images)
      if (req.body.images && !req.files?.length) {
        try {
          const urls = typeof req.body.images === "string"
            ? JSON.parse(req.body.images)
            : req.body.images;

          if (Array.isArray(urls)) {
            updateData.images = urls.map(url => ({
              url,
              filename: null,
              path: null
            }));
          }
        } catch (e) {
          console.warn("⚠ Invalid image URL array:", e.message);
        }
      }

      // Type conversions
      if (updateData.price) updateData.price = parseFloat(updateData.price);
      if (updateData.discountedPrice) updateData.discountedPrice = parseFloat(updateData.discountedPrice);
      if (updateData.preparationTime) updateData.preparationTime = parseInt(updateData.preparationTime);

      updateData.isVeg = updateData.isVeg === "true" || updateData.isVeg === true;
      updateData.isAvailable = updateData.isAvailable === "true" || updateData.isAvailable === true;

      // Ingredients CSV → Array
      if (updateData.ingredients && typeof updateData.ingredients === "string") {
        updateData.ingredients = updateData.ingredients
          .split(",")
          .map(i => i.trim());
      }

      // Update DB
      const updatedMenu = await MenuItem.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true
      });

      // Emit socket update
      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`restaurant-${menuItem.restaurantId}`).emit("menu-item-updated", {
            message: "Menu item updated",
            menuItem: updatedMenu
          });
        }
      } catch { }

      return res.json({
        success: true,
        message: "Menu item updated successfully",
        data: updatedMenu
      });

    } catch (err) {
      if (req.files?.length) {
        req.files.forEach(f => fs.existsSync(f.path) && fs.unlinkSync(f.path));
      }
      next(err);
    }
  }
);
// ✅ Delete specific image from menu item
router.delete("/:id/image", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { imagePath } = req.body;

    const menuItem = await MenuItem.findById(id);
    if (!menuItem) {
      return res.status(404).json({
        success: false,
        error: "Menu item not found"
      });
    }

    // Verify restaurant ownership
    const restaurant = await Restaurant.findById(menuItem.restaurantId);
    if (!restaurant || restaurant.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to modify this menu item"
      });
    }

    // Convert full URL → relative path
    const cleanedPath = imagePath.replace(`${req.protocol}://${req.get("host")}/`, "");

    // Find image
    const imageToDelete = menuItem.images.find(img => img.path === cleanedPath);
    if (!imageToDelete) {
      return res.status(404).json({
        success: false,
        error: "Image not found"
      });
    }

    // Delete file from server
    if (fs.existsSync(imageToDelete.path)) {
      fs.unlinkSync(imageToDelete.path);
    }

    // Remove from images array
    menuItem.images = menuItem.images.filter(img => img.path !== cleanedPath);
    await menuItem.save();

    return res.json({
      success: true,
      message: "Image deleted successfully",
      data: menuItem
    });

  } catch (err) {
    next(err);
  }
});

// ✅ Bulk update menu items availability
router.patch("/restaurant/:restaurantId/availability", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { itemIds, isAvailable } = req.body;

    // Verify restaurant ownership
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || restaurant.createdBy.toString() !== req.user._id) {
      return res.status(403).json({
        success: false,
        error: "Not authorized"
      });
    }

    await MenuItem.updateMany(
      {
        _id: { $in: itemIds },
        restaurantId: restaurantId
      },
      { isAvailable }
    );

    // Emit real-time update
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`restaurant-${restaurantId}`).emit('menu-items-availability-updated', {
          message: `Menu items ${isAvailable ? 'activated' : 'deactivated'}`,
          itemIds,
          isAvailable
        });
      }
    } catch (socketError) {
      console.log('Socket.io not available for real-time update');
    }

    res.json({
      success: true,
      message: `Menu items ${isAvailable ? 'activated' : 'deactivated'} successfully`
    });

  } catch (err) {
    next(err);
  }
});

// ✅ Get menu item by ID
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

    // Process images to include full URLs
    const menuItemWithImageUrls = {
      ...menuItem.toObject(),
      images: menuItem.images ? menuItem.images.map(img => ({
        ...img,
        url: img.path ? `${req.protocol}://${req.get('host')}/${img.path.replace(/\\/g, '/')}` : img.url
      })) : []
    };

    res.json({
      success: true,
      data: menuItemWithImageUrls
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

    const skip = (page - 1) * limit;

    const searchFilter = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } }
      ],
      isAvailable: true
    };

    const menuItems = await MenuItem.find(searchFilter)
      .populate('restaurantId', 'name address isOpen deliveryTime')
      .sort({ price: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Process images to include full URLs
    const menuItemsWithImageUrls = menuItems.map(item => ({
      ...item.toObject(),
      images: item.images ? item.images.map(img => ({
        ...img,
        url: img.path ? `${req.protocol}://${req.get('host')}/${img.path.replace(/\\/g, '/')}` : img.url
      })) : []
    }));

    const total = await MenuItem.countDocuments(searchFilter);

    res.json({
      success: true,
      data: menuItemsWithImageUrls,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (err) {
    next(err);
  }
});

// ✅ Delete menu item (Protected - owner only)
router.delete("/:id", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    const { id } = req.params;

    const menuItem = await MenuItem.findById(id);

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        error: "Menu item not found"
      });
    }

    // Verify user owns the restaurant
    const restaurant = await Restaurant.findById(menuItem.restaurantId);
    if (!restaurant || restaurant.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to delete this menu item"
      });
    }

    // Delete associated image files
    if (menuItem.images && menuItem.images.length > 0) {
      menuItem.images.forEach(image => {
        if (image.path && fs.existsSync(image.path)) {
          fs.unlinkSync(image.path);
        }
      });
    }

    await MenuItem.findByIdAndDelete(id);

    // Emit real-time update
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`restaurant-${menuItem.restaurantId}`).emit('menu-item-deleted', {
          message: 'Menu item deleted',
          menuItemId: id
        });
      }
    } catch (socketError) {
      console.log('Socket.io not available for real-time update');
    }

    res.json({
      success: true,
      message: "Menu item deleted successfully"
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
