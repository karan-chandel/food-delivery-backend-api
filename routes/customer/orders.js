const express = require("express");
const router = express.Router();
const orderController = require("../../controllers/orderController");
const { auth, requireRole } = require("../../middlewares/auth");
const idempotency = require("../../middlewares/idempotency");

router.use(auth);
router.use(requireRole(['customer']));

// 🛡️ TSK-203: Checkout Idempotency & In-Flight Lock (120s TTL)
router.post("/", idempotency({ ttlSeconds: 120 }), orderController.createOrder);
router.get("/my-orders", orderController.getMyOrders);
router.get("/:orderId", orderController.getOrderById);
router.patch("/:orderId/cancel", orderController.cancelOrder);
router.get("/track/:orderId", orderController.trackOrder);
router.patch("/:orderId/review", orderController.addOrderReview);

module.exports = router;
