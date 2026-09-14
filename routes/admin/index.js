const express = require('express');
const router = express.Router();

// Super Admin Core, Auth, Permissions & Analytics routes
router.use('/super', require('./superAdmin'));
router.use('/super/tickets', require('./superAdminTickets'));

// Admin & Support Ticket Management
router.use('/tickets', require('./tickets'));

// Contact Us Inquiries Management
router.use('/contact-us', require('./contactUs'));

// Fallback direct mounts for admin operations & compatibility
router.use('/', require('./superAdmin'));
router.use('/', require('./tickets'));

module.exports = router;
