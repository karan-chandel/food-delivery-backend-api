const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const MenuItem = require("../../models/MenuItem");
const Restaurant = require("../../models/Restaurant");
const { auth, requireRole } = require("../../middlewares/auth");
const { uploadBufferToCloudinary } = require("../../config/cloudinary");

// Multer storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images (JPG, PNG, WEBP) are allowed.'), false);
    }
  }
});

const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'File too large. Max 10MB.' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ success: false, message: 'Too many files. Max 5 images.' });
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) return res.status(400).json({ success: false, message: err.message });
  next();
};

router.use(auth);
router.use(requireRole(["restaurant"]));

// ✅ Add menu item (file upload OR image URLs)
const addMenuItemHandler = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: "Restaurant not found" });
    }

    const isOwner = restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString();
    const isCreator = restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString();
    if (!isOwner && !isCreator) {
      return res.status(403).json({ success: false, error: "Not authorized to add menu items to this restaurant" });
    }

    let images = [];
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(async file => {
        if (file.buffer) {
          const result = await uploadBufferToCloudinary(file.buffer, "hungry-hub/menu-items");
          return {
            url: result.secure_url,
            filename: result.public_id,
            path: result.secure_url
          };
        }
        return {
          url: file.path,
          filename: file.filename || null,
          path: file.path
        };
      });
      images = await Promise.all(uploadPromises);
    } else if (req.body.images) {
      try {
        const imgArray = typeof req.body.images === "string" ? JSON.parse(req.body.images) : req.body.images;
        if (Array.isArray(imgArray)) {
          images = imgArray.map(url => ({ url, filename: null, path: null }));
        }
      } catch (e) {
        console.warn("Invalid images data", e.message);
      }
    }

    const menuItemData = {
      ...req.body,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      createdBy: req.user._id,
      images
    };

    if (menuItemData.variants && typeof menuItemData.variants === "string") {
      menuItemData.variants = JSON.parse(menuItemData.variants);
    }
    if (menuItemData.addonGroups && typeof menuItemData.addonGroups === "string") {
      menuItemData.addonGroups = JSON.parse(menuItemData.addonGroups);
    }
    if (menuItemData.price) menuItemData.price = parseFloat(menuItemData.price);
    if (menuItemData.discountedPrice) menuItemData.discountedPrice = parseFloat(menuItemData.discountedPrice);
    if (menuItemData.preparationTime) menuItemData.preparationTime = parseInt(menuItemData.preparationTime);
    if (menuItemData.isVeg !== undefined) {
      menuItemData.isVeg = menuItemData.isVeg === "true" || menuItemData.isVeg === true;
    }
    if (menuItemData.isAvailable !== undefined) {
      menuItemData.isAvailable = menuItemData.isAvailable === "true" || menuItemData.isAvailable === true;
    }
    if (menuItemData.ingredients && typeof menuItemData.ingredients === "string") {
      menuItemData.ingredients = menuItemData.ingredients.split(",").map(i => i.trim());
    }

    const menuItem = await MenuItem.create(menuItemData);

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`restaurant-${restaurantId}`).emit("menu-item-added", {
          message: "New menu item added",
          menuItem
        });
      }
    } catch {}

    res.status(201).json({
      success: true,
      message: "Menu item added successfully",
      data: menuItem
    });
  } catch (err) {
    next(err);
  }
};

router.post("/:restaurantId", upload.array("images", 5), handleUploadErrors, addMenuItemHandler);
router.post("/restaurant/:restaurantId", upload.array("images", 5), handleUploadErrors, addMenuItemHandler);

// ✅ Update menu item
router.put("/:id", upload.array("images", 5), handleUploadErrors, async (req, res, next) => {
  try {
    const { id } = req.params;
    const menuItem = await MenuItem.findById(id);
    if (!menuItem) {
      return res.status(404).json({ success: false, error: "Menu item not found" });
    }

    const restaurant = await Restaurant.findById(menuItem.restaurantId);
    const isOwner = restaurant && ((restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString()) || (restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString()));
    if (!isOwner) {
      return res.status(403).json({ success: false, error: "Not authorized to update this menu item" });
    }

    const updateData = { ...req.body };
    if (updateData.variants && typeof updateData.variants === "string") {
      updateData.variants = JSON.parse(updateData.variants);
    }
    if (updateData.addonGroups && typeof updateData.addonGroups === "string") {
      updateData.addonGroups = JSON.parse(updateData.addonGroups);
    }

    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(async file => {
        if (file.buffer) {
          const result = await uploadBufferToCloudinary(file.buffer, "hungry-hub/menu-items");
          return { url: result.secure_url, filename: result.public_id, path: result.secure_url };
        }
        return { url: file.path, filename: file.filename, path: file.path };
      });
      const newImages = await Promise.all(uploadPromises);

      let keptImages = [];
      if (req.body.existingImages) {
        try {
          const parsed = typeof req.body.existingImages === "string" ? JSON.parse(req.body.existingImages) : req.body.existingImages;
          if (Array.isArray(parsed)) {
            keptImages = parsed.map(img => typeof img === "string" ? { url: img, filename: null, path: null } : img);
          }
        } catch (e) {
          console.warn("Invalid existingImages data", e.message);
        }
        updateData.images = [...keptImages, ...newImages];
      } else if (req.body.replaceImages === "true") {
        updateData.images = newImages;
      } else {
        updateData.images = [...(menuItem.images || []), ...newImages];
      }
    } else if (req.body.images) {
      try {
        const urls = typeof req.body.images === "string" ? JSON.parse(req.body.images) : req.body.images;
        if (Array.isArray(urls)) {
          updateData.images = urls.map(img => typeof img === "string" ? { url: img, filename: null, path: null } : img);
        }
      } catch (e) {
        console.warn("Invalid images array", e.message);
      }
    }

    if (updateData.price) updateData.price = parseFloat(updateData.price);
    if (updateData.discountedPrice) updateData.discountedPrice = parseFloat(updateData.discountedPrice);
    if (updateData.preparationTime) updateData.preparationTime = parseInt(updateData.preparationTime);
    if (updateData.isVeg !== undefined) updateData.isVeg = updateData.isVeg === "true" || updateData.isVeg === true;
    if (updateData.isAvailable !== undefined) updateData.isAvailable = updateData.isAvailable === "true" || updateData.isAvailable === true;

    if (updateData.ingredients && typeof updateData.ingredients === "string") {
      updateData.ingredients = updateData.ingredients.split(",").map(i => i.trim());
    }

    const updatedMenu = await MenuItem.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true
    });

    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`restaurant-${menuItem.restaurantId}`).emit("menu-item-updated", {
          message: "Menu item updated",
          menuItem: updatedMenu
        });
      }
    } catch {}

    return res.json({
      success: true,
      message: "Menu item updated successfully",
      data: updatedMenu
    });
  } catch (err) {
    next(err);
  }
});

// ✅ Delete specific image from menu item
router.delete("/:id/image", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { imagePath, imageUrl } = req.body;

    const menuItem = await MenuItem.findById(id);
    if (!menuItem) {
      return res.status(404).json({ success: false, error: "Menu item not found" });
    }

    const restaurant = await Restaurant.findById(menuItem.restaurantId);
    const isOwner = restaurant && ((restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString()) || (restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString()));
    if (!isOwner) {
      return res.status(403).json({ success: false, error: "Not authorized to modify this menu item" });
    }

    menuItem.images = menuItem.images.filter(img => img.path !== imagePath && img.url !== imageUrl);
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
const bulkAvailabilityHandler = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { itemIds, isAvailable } = req.body;

    const restaurant = await Restaurant.findById(restaurantId);
    const isOwner = restaurant && ((restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString()) || (restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString()));
    if (!isOwner) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    await MenuItem.updateMany(
      { _id: { $in: itemIds }, restaurantId },
      { isAvailable }
    );

    res.json({
      success: true,
      message: `Updated availability for ${itemIds.length} items`
    });
  } catch (err) {
    next(err);
  }
};

router.patch("/:restaurantId/availability", bulkAvailabilityHandler);
router.patch("/restaurant/:restaurantId/availability", bulkAvailabilityHandler);

// ✅ Delete menu item
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const menuItem = await MenuItem.findById(id);
    if (!menuItem) {
      return res.status(404).json({ success: false, error: "Menu item not found" });
    }

    const restaurant = await Restaurant.findById(menuItem.restaurantId);
    const isOwner = restaurant && ((restaurant.ownerId && restaurant.ownerId.toString() === req.user._id.toString()) || (restaurant.createdBy && restaurant.createdBy.toString() === req.user._id.toString()));
    if (!isOwner) {
      return res.status(403).json({ success: false, error: "Not authorized to delete this menu item" });
    }

    await MenuItem.findByIdAndDelete(id);

    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`restaurant-${menuItem.restaurantId}`).emit('menu-item-deleted', {
          message: 'Menu item deleted',
          menuItemId: id
        });
      }
    } catch {}

    res.json({
      success: true,
      message: "Menu item deleted successfully"
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
