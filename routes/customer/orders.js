const express = require("express");
const router = express.Router();
const orderController = require("../../controllers/orderController");
const { auth, requireRole } = require("../../middlewares/auth");
const idempotency = require("../../middlewares/idempotency");

router.use(auth);

// 🛡️ TSK-203: Checkout Idempotency & In-Flight Lock (120s TTL)
router.post("/", requireRole(['customer']), idempotency({ ttlSeconds: 120 }), orderController.createOrder);
router.patch("/:orderId/cancel", requireRole(['customer']), orderController.cancelOrder);
router.patch("/:orderId/review", requireRole(['customer']), orderController.addOrderReview);

// Polymorphic order endpoints (delegates role filtering to orderController)
router.get("/my-orders", orderController.getMyOrders);
router.get("/:orderId", orderController.getOrderById);
router.get("/track/:orderId", orderController.trackOrder);

module.exports = router;
