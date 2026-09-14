const express = require('express');
const router = express.Router();
const contactUsController = require('../../controllers/contactUsController');
const { auth, requireRole } = require('../../middlewares/auth');

router.use(auth);
router.use(requireRole(['admin', 'super_admin']));

// @route   GET /api/v1/admin/contact-us
// @desc    Get all contact us messages
router.get('/', contactUsController.getAllContactUs);

// @route   GET /api/v1/admin/contact-us/:id
// @desc    Get specific contact us message
router.get('/:id', contactUsController.getContactUsById);

// @route   PUT /api/v1/admin/contact-us/:id/reply
// @desc    Reply to a contact us message
router.put('/:id/reply', contactUsController.replyToContactUs);

// @route   PUT /api/v1/admin/contact-us/:id/status
// @desc    Update contact us message status
router.put('/:id/status', contactUsController.updateStatus);

// @route   DELETE /api/v1/admin/contact-us/:id
// @desc    Delete a contact us message
router.delete('/:id', contactUsController.deleteContactUs);

module.exports = router;
