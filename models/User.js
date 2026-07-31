const mongoose = require('mongoose');

// const addressSchema = new mongoose.Schema({
//   type: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
//   addressLine1: { type: String, required: true },
//   addressLine2: String,
//   city: { type: String, required: true },
//   state: { type: String, required: true },
//   pincode: { type: String, required: true },
//   landmark: String,
//   latitude: Number,
//   longitude: Number
// });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, lowercase: true },
  phone: { type: String, required: true, unique: true },
  profilePicture: String,
  // addresses: [addressSchema],
  role: { 
    type: String, 
    enum: ['customer', 'rider', 'restaurant'], 
    default: 'customer' 
  },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastLogin: Date
}, { 
  timestamps: true,
  strictPopulate: false 
});

module.exports = mongoose.model('User', userSchema);