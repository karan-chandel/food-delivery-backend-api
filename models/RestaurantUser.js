const mongoose = require('mongoose');

const restaurantUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, lowercase: true },
  phone: { type: String, required: true, unique: true },
  profilePicture: String,
  role: { type: String, default: 'restaurant' },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  // Restaurant-specific fields
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
  businessName: { type: String, required: true },
  gstNumber: String,
  gstCertificate: String, // File path
  bankAccountNumber: String,
  bankIFSC: String,
  upiId: String,
  totalEarnings: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('RestaurantUser', restaurantUserSchema);