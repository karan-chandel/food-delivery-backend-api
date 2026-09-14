const express = require("express");
const router = express.Router();
const orderController = require("../../controllers/orderController");
const { auth, requireRole } = require("../../middlewares/auth");

router.use(auth);
router.use(requireRole(['customer']));

router.post("/", orderController.createOrder);
router.get("/my-orders", orderController.getMyOrders);
router.get("/:orderId", orderController.getOrderById);
router.patch("/:orderId/cancel", orderController.cancelOrder);
router.get("/track/:orderId", orderController.trackOrder);
router.patch("/:orderId/review", orderController.addOrderReview);

module.exports = router;
