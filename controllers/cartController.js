const Cart = require("../models/Cart");
const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const Coupon = require("../models/Coupon");

// ✅ Get user's cart
exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;

    let cart = await Cart.findOne({ userId })
      .populate('items.menuItemId', 'name price images isVeg isAvailable')
      .populate('restaurantId', 'name address deliveryTime minOrderAmount deliveryFee taxRate');

    if (!cart) {
      cart = new Cart({ userId, items: [] });
      await cart.save();
    }

    res.json({
      success: true,
      data: cart
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Add to cart
exports.addToCart = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;

    const {
      menuItemId,
      quantity = 1,
      variant,
      addons = [],
      specialInstructions
    } = req.body;

    if (!menuItemId) {
      return res.status(400).json({
        success: false,
        error: "Menu item ID is required"
      });
    }

    const menuItem = await MenuItem.findById(menuItemId);

    if (!menuItem || !menuItem.isAvailable) {
      return res.status(404).json({
        success: false,
        error: "Menu item not available"
      });
    }

    const restaurant = await Restaurant.findById(menuItem.restaurantId);

    if (!restaurant || !restaurant.isOpen) {
      return res.status(400).json({
        success: false,
        error: "Restaurant is currently closed"
      });
    }

    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({
        userId,
        restaurantId: menuItem.restaurantId,
        items: []
      });
    }
    
    if (!cart.restaurantId) {
      cart.restaurantId = menuItem.restaurantId;
    }
    
    // restaurant check
    if (
      cart.restaurantId &&
      cart.restaurantId.toString() !== menuItem.restaurantId.toString()
    ) {
      return res.status(400).json({
        success: false,
        error: "Cannot add items from different restaurants. Clear cart first."
      });
    }

    const existingItemIndex = cart.items.findIndex(item =>
      item.menuItemId.toString() === menuItemId &&
      JSON.stringify(item.variant) === JSON.stringify(variant) &&
      JSON.stringify(item.addons) === JSON.stringify(addons)
    );

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += quantity;
      cart.items[existingItemIndex].specialInstructions =
        specialInstructions || cart.items[existingItemIndex].specialInstructions;
    } else {
      let price = menuItem.discountedPrice || menuItem.price;

      if (variant?.price) {
        price = variant.price;
      }

      if (addons?.length) {
        addons.forEach(a => {
          price += (a.price || 0);
        });
      }

      cart.items.push({
        menuItemId,
        quantity,
        specialInstructions,
        variant,
        addons,
        price
      });
    }

    await cart.calculateTotal();
    await cart.save();

    await cart.populate('items.menuItemId', 'name price images isVeg');
    await cart.populate('restaurantId', 'name deliveryTime minOrderAmount deliveryFee taxRate');

    const io = req.app.get("io");
    io.to(userId.toString()).emit("cart updated", {
      message: "Item added to cart successfully",
      cart
    });

    res.json({
      success: true,
      message: "Item added to cart",
      data: cart
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Update cart item quantity
exports.updateCartItem = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { menuItemId } = req.params;
    const { quantity } = req.body;

    if (quantity == null || quantity < 0) {
      return res.status(400).json({
        success: false,
        error: "Valid quantity is required"
      });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.status(404).json({ success: false, error: "Cart not found" });

    const itemIndex = cart.items.findIndex(
      item => item.menuItemId.toString() === menuItemId
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Item not found in cart"
      });
    }

    if (quantity === 0) {
      cart.items.splice(itemIndex, 1);
      if (cart.items.length === 0) {
        cart.restaurantId = null;
        cart.coupon = null;
      }
    } else {
      cart.items[itemIndex].quantity = quantity;
    }

    await cart.calculateTotal();
    await cart.save();

    await cart.populate('items.menuItemId', 'name price images isVeg');
    await cart.populate('restaurantId', 'name deliveryTime minOrderAmount deliveryFee taxRate');

    res.json({
      success: true,
      message: quantity === 0 ? "Item removed from cart" : "Cart updated",
      data: cart
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Remove item from cart
exports.removeCartItem = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { menuItemId } = req.params;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: "Cart not found"
      });
    }

    const itemIndex = cart.items.findIndex(
      item => item.menuItemId.toString() === menuItemId
    );
    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        error: "Item not found in cart"
      });
    }

    cart.items.splice(itemIndex, 1);
    if (cart.items.length === 0) {
      cart.restaurantId = null;
      cart.coupon = null;
    }
    await cart.calculateTotal();
    await cart.save();

    await cart.populate('items.menuItemId', 'name price images isVeg');
    await cart.populate('restaurantId', 'name deliveryTime minOrderAmount deliveryFee taxRate');

    res.json({
      success: true,
      message: "Item removed from cart",
      data: cart
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Clear entire cart
exports.clearCart = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: "Cart not found"
      });
    }

    cart.items = [];
    cart.totalAmount = 0;
    cart.restaurantId = null;
    cart.coupon = null;
    cart.finalAmount = 0;
    await cart.save();

    res.json({
      success: true,
      message: "Cart cleared successfully",
      data: cart
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Apply coupon
exports.applyCoupon = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { couponCode } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cart is empty"
      });
    }

    if (!cart.restaurantId) {
      return res.status(400).json({
        success: false,
        error: "No restaurant selected"
      });
    }

    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      restaurantId: cart.restaurantId,
      isActive: true,
      expiryDate: { $gte: new Date() }
    });

    if (!coupon) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired coupon"
      });
    }

    if (cart.totalAmount < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        error: `Minimum order amount is ₹${coupon.minOrderAmount}`
      });
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        error: "Coupon usage limit exceeded"
      });
    }

    let discountAmount = 0;

    if (coupon.discountType === "percentage") {
      discountAmount = (cart.totalAmount * coupon.discountValue) / 100;
      if (coupon.maxDiscount) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    } else {
      discountAmount = Math.min(coupon.discountValue, cart.totalAmount);
    }

    cart.coupon = {
      code: coupon.code,
      discount: coupon.discountValue,
      type: coupon.discountType,
      discountAmount: discountAmount,
      couponId: coupon._id
    };

    cart.finalAmount = cart.totalAmount - discountAmount;
    await cart.save();

    await cart.populate('items.menuItemId', 'name price images isVeg');
    await cart.populate('restaurantId', 'name deliveryTime minOrderAmount deliveryFee taxRate');

    res.json({
      success: true,
      message: "Coupon applied successfully",
      data: cart
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Remove coupon
exports.removeCoupon = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: "Cart not found"
      });
    }

    cart.coupon = null;
    cart.finalAmount = cart.totalAmount;
    await cart.save();

    await cart.populate('items.menuItemId', 'name price images isVeg');
    await cart.populate('restaurantId', 'name deliveryTime minOrderAmount deliveryFee taxRate');

    res.json({
      success: true,
      message: "Coupon removed",
      data: cart
    });
  } catch (err) {
    next(err);
  }
};
