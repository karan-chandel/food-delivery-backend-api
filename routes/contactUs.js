const express = require('express');
const router = express.Router();
const ContactUs = require('../models/ContactUs');
const { auth, requireRole } = require('../middlewares/auth');
const { upload, handleUploadErrors } = require('../middlewares/upload');
const path = require('path');
const fs = require('fs');

// Ensure contact-us upload directory exists
const contactUsUploadDir = path.join(__dirname, '../uploads/contact-us');
if (!fs.existsSync(contactUsUploadDir)) {
  fs.mkdirSync(contactUsUploadDir, { recursive: true });
}

// @route   POST /api/v1/contact-us
// @desc    Submit a contact us form (Public route - no auth required)
// @access  Public
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, subject, message, category } = req.body;

    // Validation
    if (!name || !email || !phone || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, phone, subject, and message are required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Phone validation
    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number'
      });
    }

    // Create contact us record
    const contactUs = await ContactUs.create({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      subject: subject.trim(),
      message: message.trim(),
      category: category || 'general',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
  
    res.status(201).json({
      success: true,
      message: 'Thank you for contacting us. We will get back to you soon.',
      data: {
        contactUsId: contactUs._id,
        status: contactUs.status
      }
    });

  } catch (err) {
    next(err);
  }
});

// @route   POST /api/v1/contact-us/with-attachment
// @desc    Submit contact us form with file attachment
// @access  Public
router.post('/with-attachment', upload.single('attachment'), handleUploadErrors, async (req, res, next) => {
  try {
    const { name, email, phone, subject, message, category } = req.body;

    // Validation
    if (!name || !email || !phone || !subject || !message) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Name, email, phone, subject, and message are required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Create contact us record
    const contactUsData = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      subject: subject.trim(),
      message: message.trim(),
      category: category || 'general',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    };

    if (req.file) {
      contactUsData.attachment = `/uploads/menu-items/${req.file.filename}`;
    }

    const contactUs = await ContactUs.create(contactUsData);

    res.status(201).json({
      success: true,
      message: 'Thank you for contacting us. We will get back to you soon.',
      data: {
        contactUsId: contactUs._id,
        status: contactUs.status,
        attachment: contactUs.attachment || null
      }
    });

  } catch (err) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    next(err);
  }
});

// @route   GET /api/v1/contact-us/:id
// @desc    Get specific contact us message (Admin/Super-Admin only)
// @access  Private (Admin/Super-Admin)
router.get('/:id', auth, requireRole(['admin', 'super-admin']), async (req, res, next) => {
  try {
    const contactUs = await ContactUs.findById(req.params.id);
    
    if (!contactUs) {
      return res.status(404).json({
        success: false,
        error: 'Contact us message not found'
      });
    }

    // Mark as read
    if (contactUs.status === 'new') {
      contactUs.status = 'read';
      await contactUs.save();
    }

    res.json({
      success: true,
      data: contactUs
    });

  } catch (err) {
    next(err);
  }
});

// @route   GET /api/v1/contact-us
// @desc    Get all contact us messages (Admin/Super-Admin only)
// @access  Private (Admin/Super-Admin)
router.get('/', auth, requireRole(['admin', 'super-admin']), async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (category) {
      filter.category = category;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (page - 1) * limit;

    const messages = await ContactUs.find(filter)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ContactUs.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: messages,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalMessages: total,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        limit: parseInt(limit)
      }
    });

  } catch (err) {
    next(err);
  }
});

// @route   PUT /api/v1/contact-us/:id/reply
// @desc    Reply to a contact us message
// @access  Private (Admin/Super-Admin)
router.put('/:id/reply', auth, requireRole(['admin', 'super-admin']), async (req, res, next) => {
  try {
    const { reply } = req.body;

    if (!reply) {
      return res.status(400).json({
        success: false,
        error: 'Reply message is required'
      });
    }

    const contactUs = await ContactUs.findByIdAndUpdate(
      req.params.id,
      {
        'adminReply.reply': reply.trim(),
        'adminReply.repliedAt': new Date(),
        'adminReply.repliedBy': req.user._id || req.admin._id,
        status: 'replied'
      },
      { new: true }
    );

    if (!contactUs) {
      return res.status(404).json({
        success: false,
        error: 'Contact us message not found'
      });
    }

    res.json({
      success: true,
      message: 'Reply sent successfully',
      data: contactUs
    });

  } catch (err) {
    next(err);
  }
});

// @route   PUT /api/v1/contact-us/:id/status
// @desc    Update contact us message status
// @access  Private (Admin/Super-Admin)
router.put('/:id/status', auth, requireRole(['admin', 'super-admin']), async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['new', 'read', 'replied', 'closed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be new, read, replied, or closed'
      });
    }

    const contactUs = await ContactUs.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!contactUs) {
      return res.status(404).json({
        success: false,
        error: 'Contact us message not found'
      });
    }

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: contactUs
    });

  } catch (err) {
    next(err);
  }
});

// @route   DELETE /api/v1/contact-us/:id
// @desc    Delete a contact us message (Admin/Super-Admin only)
// @access  Private (Admin/Super-Admin)
router.delete('/:id', auth, requireRole(['admin', 'super-admin']), async (req, res, next) => {
  try {
    const contactUs = await ContactUs.findByIdAndDelete(req.params.id);

    if (!contactUs) {
      return res.status(404).json({
        success: false,
        error: 'Contact us message not found'
      });
    }

    // Delete attachment if exists
    if (contactUs.attachment) {
      const filePath = path.join(__dirname, '..', contactUs.attachment);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.json({
      success: true,
      message: 'Contact us message deleted successfully'
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
