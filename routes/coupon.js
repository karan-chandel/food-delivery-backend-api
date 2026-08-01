const express = require("express");
const router = express.Router();
const couponController = require("../controllers/couponController");
const { auth, requireRole } = require("../middlewares/auth");

// @route   POST /api/v1/coupons
// @desc    Create coupon
// @access  Private (Restaurant)
router.post(
  "/",
  auth,
  requireRole(["restaurant"]),
  couponController.createCoupon
);

// @route   GET /api/v1/coupons/my-coupons
// @desc    Get my coupons
// @access  Private (Restaurant)
router.get(
  "/my-coupons",
  auth,
  requireRole(["restaurant"]),
  couponController.getMyCoupons
);

// @route   PATCH /api/v1/coupons/:couponId
// @desc    Update coupon details
// @access  Private (Restaurant)
router.patch(
  "/:couponId",
  auth,
  requireRole(["restaurant"]),
  couponController.updateCoupon
);

// @route   PATCH /api/v1/coupons/:couponId/toggle
// @desc    Toggle coupon active status
// @access  Private (Restaurant)
router.patch(
  "/:couponId/toggle",
  auth,
  requireRole(["restaurant"]),
  couponController.toggleCouponActive
);

// @route   DELETE /api/v1/coupons/:couponId
// @desc    Delete coupon
// @access  Private (Restaurant)
router.delete(
  "/:couponId",
  auth,
  requireRole(["restaurant"]),
  couponController.deleteCoupon
);

// @route   POST /api/v1/coupons/apply-coupon
// @desc    Apply coupon (Customer)
// @access  Private (Customer)
router.post(
  "/apply-coupon",
  auth,
  requireRole(["customer"]),
  couponController.applyCoupon
);

module.exports = router;