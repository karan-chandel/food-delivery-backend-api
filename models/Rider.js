const mongoose = require('mongoose');

const riderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, lowercase: true },
  phone: { type: String, required: true, unique: true },
  profilePicture: String,
  role: { type: String, default: 'rider' },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  
  // Enhanced Rider-specific fields
  vehicleNo: { type: String},
  vehicleType: { type: String, enum: ['bike', 'scooter', 'cycle'], default: 'bike' },
  licenseNumber: { type: String},
  licensePhoto: String, // URL to license image
  vehiclePhoto: String, // URL to vehicle image
  aadharNumber: String,
  bankAccountNumber: String,
  bankIFSC: String,
  
  // Enhanced location tracking
  currentLocation: {
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 },
    address: String,
    lastUpdated: { type: Date, default: Date.now }
  },
  
  // Availability & Status
  isOnline: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: false },
  
  // Performance metrics
  totalDeliveries: { type: Number, default: 0 },
  completedDeliveries: { type: Number, default: 0 },
  cancelledDeliveries: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  
  // Earnings tracking
  earnings: {
    weekly: { type: Number, default: 0 },
    monthly: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  ratings: [
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: String },
    rating: Number,
    feedback: String,
    createdAt: { type: Date, default: Date.now }
  }
],

  
  // Current assignment
  currentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }

}, { 
  timestamps: true 
});

// Index for location-based queries
riderSchema.index({ "currentLocation.lat": 1, "currentLocation.lng": 1 });

module.exports = mongoose.model('Rider', riderSchema);