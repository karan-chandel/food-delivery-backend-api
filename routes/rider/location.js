const express = require('express');
const router = express.Router();
const riderController = require('../../controllers/riderController');
const orderController = require('../../controllers/orderController');
const { auth, requireRole } = require('../../middlewares/auth');

router.use(auth);
router.use(requireRole(['rider', 'admin', 'super_admin']));

// Update general rider live GPS location
router.put('/', riderController.updateRiderLocation);

// Update order-specific live delivery GPS coordinates
router.patch('/order/:orderId', orderController.updateRiderLocation);

module.exports = router;
