const mongoose = require('mongoose');

const contactUsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['general', 'complaint', 'suggestion', 'partnership', 'support', 'other'],
    default: 'general'
  },
  status: {
    type: String,
    enum: ['new', 'read', 'replied', 'closed'],
    default: 'new'
  },
  attachment: String, // File path if any attachment
  adminReply: {
    reply: String,
    repliedAt: Date,
    repliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    }
  },
  ipAddress: String,
  userAgent: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true 
});

// Index for faster queries
contactUsSchema.index({ email: 1 });
contactUsSchema.index({ status: 1 });
contactUsSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ContactUs', contactUsSchema);
