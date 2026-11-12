const express = require('express');
const router = express.Router();
const riderController = require('../../controllers/riderController');
const { auth, requireRole } = require('../../middlewares/auth');

router.use('/auth', require('./auth'));
router.use('/profile', require('./profile'));
router.use('/orders', require('./orders'));
router.use('/location', require('./location'));

// Direct aliases for Rider Portal compatibility
router.put('/availability', auth, requireRole(['rider', 'admin', 'super_admin']), riderController.updateRiderAvailability);
router.get('/earnings', auth, requireRole(['rider', 'admin', 'super_admin']), riderController.getRiderEarnings);
router.get('/history', auth, requireRole(['rider', 'admin', 'super_admin']), riderController.getRiderHistory);

module.exports = router;
