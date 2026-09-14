const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/profile', require('./profile'));
router.use('/orders', require('./orders'));
router.use('/location', require('./location'));

module.exports = router;
