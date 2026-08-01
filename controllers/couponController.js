const Coupon = require("../models/Coupon");
const Restaurant = require("../models/Restaurant");
const Cart = require("../models/Cart");

// @desc    Create coupon
// @route   POST /api/v1/coupons
exports.createCoupon = async (req, res, next) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscount,
      expiryDate,
      usageLimit,
    } = req.body;

    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found for this owner",
      });
    }

    const existingCoupon = await Coupon.findOne({
      code: code.toUpperCase(),
      restaurantId: restaurant._id,
    });

    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        error: "Coupon code already exists",
      });
    }

    const coupon = await Coupon.create({
      code: code.toUpperCase(),
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscount,
      expiryDate,
      usageLimit,
      restaurantId: restaurant._id,
    });

    res.status(201).json({
      success: true,
      message: "Coupon created successfully",
      data: coupon,
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get my coupons (Restaurant owner only)
// @route   GET /api/v1/coupons/my-coupons
exports.getMyCoupons = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found",
      });
    }

    const coupons = await Coupon.find({
      restaurantId: restaurant._id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: coupons.length,
      data: coupons,
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update coupon details
// @route   PATCH /api/v1/coupons/:couponId
exports.updateCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.params;
    const updateData = req.body;

    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found",
      });
    }

    const coupon = await Coupon.findOne({
      _id: couponId,
      restaurantId: restaurant._id,
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: "Coupon not found",
      });
    }

    // Prevent changing restaurantId
    delete updateData.restaurantId;

    if (updateData.code) {
      updateData.code = updateData.code.toUpperCase();
    }

    const updatedCoupon = await Coupon.findByIdAndUpdate(
      couponId,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: "Coupon updated successfully",
      data: updatedCoupon,
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Toggle coupon active status
// @route   PATCH /api/v1/coupons/:couponId/toggle
exports.toggleCouponActive = async (req, res, next) => {
  try {
    const { couponId } = req.params;
    const { isActive } = req.body;

    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found",
      });
    }

    const coupon = await Coupon.findOne({
      _id: couponId,
      restaurantId: restaurant._id,
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: "Coupon not found",
      });
    }

    coupon.isActive = isActive;
    await coupon.save();

    res.json({
      success: true,
      message: `Coupon ${isActive ? "activated" : "deactivated"} successfully`,
      data: coupon,
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete coupon
// @route   DELETE /api/v1/coupons/:couponId
exports.deleteCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.params;

    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        error: "Restaurant not found",
      });
    }

    const coupon = await Coupon.findOne({
      _id: couponId,
      restaurantId: restaurant._id,
    });

    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: "Coupon not found",
      });
    }

    await Coupon.findByIdAndDelete(couponId);

    res.json({
      success: true,
      message: "Coupon deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Apply coupon (Customer)
// @route   POST /api/v1/coupons/apply-coupon
exports.applyCoupon = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { couponCode } = req.body;

    const cart = await Cart.findOne({ userId });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Cart is empty",
      });
    }

    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      restaurantId: cart.restaurantId,
      isActive: true,
      expiryDate: { $gte: new Date() },
    });

    if (!coupon) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired coupon",
      });
    }

    if (cart.totalAmount < coupon.minOrderAmount) {
      return res.status(400).json({
        success: false,
        error: `Minimum order amount is ₹${coupon.minOrderAmount}`,
      });
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({
        success: false,
        error: "Coupon usage limit exceeded",
      });
    }

    let discountAmount = 0;

    if (coupon.discountType === "percentage") {
      discountAmount =
        (cart.totalAmount * coupon.discountValue) / 100;

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
      discountAmount,
    };

    cart.finalAmount = cart.totalAmount - discountAmount;

    await cart.save();

    res.json({
      success: true,
      message: "Coupon applied successfully",
      data: cart,
    });

  } catch (err) {
    next(err);
  }
};
