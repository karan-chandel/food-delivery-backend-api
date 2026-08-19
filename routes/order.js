const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { auth, requireRole } = require("../middlewares/auth");

router.post("/", auth, requireRole(['customer']), orderController.createOrder);
router.get("/my-orders", auth, orderController.getMyOrders);
router.get("/:orderId", auth, orderController.getOrderById);
router.patch("/:orderId/status", auth, requireRole(['restaurant', 'rider']), orderController.updateOrderStatus);
router.patch("/:orderId/cancel", auth, requireRole(['customer']), orderController.cancelOrder);
router.patch("/:orderId/assign-rider", auth, requireRole(['restaurant']), orderController.assignRider);
router.get("/track/:orderId", auth, orderController.trackOrder);
router.patch("/:orderId/rider-location", auth, requireRole(['rider']), orderController.updateRiderLocation);
router.patch("/:orderId/review", auth, requireRole(['customer']), orderController.addOrderReview);

module.exports = router;