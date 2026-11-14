const express = require("express");
const router = express.Router();
const orderController = require("../../controllers/orderController");
const { auth, requireRole } = require("../../middlewares/auth");

router.use(auth);
router.use(requireRole(["restaurant"]));

// Orders management for restaurants
router.get("/", orderController.getMyOrders);
router.get("/my-orders", orderController.getMyOrders);
router.get("/:orderId", orderController.getOrderById);
router.route("/:orderId/status")
  .patch(orderController.updateOrderStatus)
  .put(orderController.updateOrderStatus);

router.route("/:orderId/assign-rider")
  .patch(orderController.assignRider)
  .put(orderController.assignRider);

module.exports = router;
