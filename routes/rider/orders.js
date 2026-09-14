const express = require('express');
const router = express.Router();
const riderController = require('../../controllers/riderController');
const { auth, requireRole } = require('../../middlewares/auth');

router.use(auth);
router.use(requireRole(['rider', 'admin', 'super_admin']));

router.get('/available', riderController.getAvailableOrders);
router.put('/:orderId/accept', riderController.acceptOrder);
router.get('/accepted', riderController.getAcceptedOrders);
router.get('/current', riderController.getCurrentOrders);
router.put('/:orderId/status', riderController.updateOrderStatusByRider);

module.exports = router;
