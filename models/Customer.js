const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  type: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
  customLabel: { type: String, default: null }, // e.g. "Gym", "Friend's Place"
  flatNumber: { type: String, default: "" }, // e.g. "Flat 402, Tower B"
  addressLine1: { type: String, required: true },
  addressLine2: { type: String, default: "" },
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  landmark: { type: String, default: "" },
  latitude: { type: Number },
  longitude: { type: Number },
  isDefault: { type: Boolean, default: false },
  receiverName: { type: String, default: null },
  receiverPhone: { type: String, default: null },
  deliveryInstructions: { type: String, default: null }
}, { _id: true, timestamps: true });

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, lowercase: true },
  phone: { type: String, required: true, unique: true },
  profilePicture: String,
  role: { type: String, default: 'customer' },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,

  // ✅ Multiple addresses (instead of deliveryAddress)
  addresses: [addressSchema],

  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' }],
  orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
  loyaltyPoints: { type: Number, default: 0 },
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },

  reviews: [{
    orderId: { type: String },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant' },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rider' },
    rating: { type: Number, min: 1, max: 5 },
    review: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);
