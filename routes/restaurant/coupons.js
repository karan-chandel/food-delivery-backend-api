const express = require("express");
const router = express.Router();
const couponController = require("../../controllers/couponController");
const { auth, requireRole } = require("../../middlewares/auth");

router.use(auth);
router.use(requireRole(["restaurant"]));

// Coupons management for restaurants
router.post("/", couponController.createCoupon);
router.get("/", couponController.getMyCoupons);
router.get("/my-coupons", couponController.getMyCoupons);
router.patch("/:couponId", couponController.updateCoupon);
router.patch("/:couponId/toggle", couponController.toggleCouponActive);
router.delete("/:couponId", couponController.deleteCoupon);

module.exports = router;
