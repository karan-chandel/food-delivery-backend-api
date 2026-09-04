const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  role: {
    type: String,
    required: true,
    enum: ['customer', 'rider', 'restaurant'],
    default: 'customer'
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // Auto delete exactly at expiration timestamp
  },
  attempts: {
    type: Number,
    default: 0
  },
  isUsed: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for faster queries
otpSchema.index({ phone: 1, createdAt: 1 });
otpSchema.index({ phone: 1, role: 1 });

module.exports = mongoose.model('OTP', otpSchema);