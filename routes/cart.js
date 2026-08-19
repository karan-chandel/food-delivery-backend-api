const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { auth, requireRole } = require("../middlewares/auth");

// All routes require authentication and customer role
router.use(auth);
router.use(requireRole(['customer']));

router.get("/", cartController.getCart);
router.post("/", cartController.addToCart);
router.put("/item/:menuItemId", cartController.updateCartItem);
router.delete("/item/:menuItemId", cartController.removeCartItem);
router.delete("/", cartController.clearCart);
router.post("/apply-coupon", cartController.applyCoupon);
router.delete("/coupon", cartController.removeCoupon);

module.exports = router;