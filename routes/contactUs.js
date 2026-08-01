const express = require('express');
const router = express.Router();
const contactUsController = require('../controllers/contactUsController');
const { auth, requireRole } = require('../middlewares/auth');
const { upload, handleUploadErrors } = require('../middlewares/upload');

// @route   POST /api/v1/contact-us
// @desc    Submit a contact us form (Public route - no auth required)
// @access  Public
router.post('/', contactUsController.submitContactUs);

// @route   POST /api/v1/contact-us/with-attachment
// @desc    Submit contact us form with file attachment
// @access  Public
router.post(
  '/with-attachment',
  upload.single('attachment'),
  handleUploadErrors,
  contactUsController.submitContactUsWithAttachment
);

// @route   GET /api/v1/contact-us/:id
// @desc    Get specific contact us message (Admin/Super-Admin only)
// @access  Private (Admin/Super-Admin)
router.get('/:id', auth, requireRole(['admin', 'super-admin']), contactUsController.getContactUsById);

// @route   GET /api/v1/contact-us
// @desc    Get all contact us messages (Admin/Super-Admin only)
// @access  Private (Admin/Super-Admin)
router.get('/', auth, requireRole(['admin', 'super-admin']), contactUsController.getAllContactUs);

// @route   PUT /api/v1/contact-us/:id/reply
// @desc    Reply to a contact us message
// @access  Private (Admin/Super-Admin)
router.put('/:id/reply', auth, requireRole(['admin', 'super-admin']), contactUsController.replyToContactUs);

// @route   PUT /api/v1/contact-us/:id/status
// @desc    Update contact us message status
// @access  Private (Admin/Super-Admin)
router.put('/:id/status', auth, requireRole(['admin', 'super-admin']), contactUsController.updateStatus);

// @route   DELETE /api/v1/contact-us/:id
// @desc    Delete a contact us message (Admin/Super-Admin only)
// @access  Private (Admin/Super-Admin)
router.delete('/:id', auth, requireRole(['admin', 'super-admin']), contactUsController.deleteContactUs);

module.exports = router;
