const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/restaurants', require('./restaurants'));
router.use('/menu', require('./menu'));
router.use('/cart', require('./cart'));
router.use('/orders', require('./orders'));
router.use('/coupons', require('./coupons'));
router.use('/contact-us', require('./contactUs'));
router.use('/notifications', require('./notifications'));
router.use('/tickets', require('./tickets'));

module.exports = router;
