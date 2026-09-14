const express = require("express");
const router = express.Router();
const couponController = require("../../controllers/couponController");
const Coupon = require("../../models/Coupon");
const { auth, requireRole } = require("../../middlewares/auth");

// @route   GET /api/v1/customer/coupons/restaurant/:restaurantId
// @desc    Get active coupons for a restaurant
router.get("/restaurant/:restaurantId", async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const coupons = await Coupon.find({
      restaurantId,
      isActive: true,
      expiryDate: { $gte: new Date() }
    }).select('code discountType discountValue minOrderAmount maxDiscount expiryDate');

    res.json({
      success: true,
      data: coupons
    });
  } catch (err) {
    next(err);
  }
});

// @route   POST /api/v1/customer/coupons/apply-coupon
// @desc    Apply coupon (Customer)
router.post("/apply-coupon", auth, requireRole(["customer"]), couponController.applyCoupon);

module.exports = router;
