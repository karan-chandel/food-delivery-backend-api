const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  cuisine: [{
    type: String
  }],
 address: {
  addressLine1: {
    type: String,
    required: true,
  },
  addressLine2: {
    type: String,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  pincode: {
    type: String,
    required: true,
  },
  geolocation: {
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
  },
},

  contact: {
    phone: {
      type: String,
      required: true
    },
    email: String
  },
  images: [String],
rating: {
  average: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviews: [
    {
      customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
      },
      orderId: {
        type: String, //  FIXED: Custom order IDs like "ORD1762754307141989"
        required: true,
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
        required: true,
      },
      review: {
        type: String,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  count: {
    type: Number,
    default: 0,
  },
},

  deliveryTime: String,
  minOrderAmount: {
    type: Number,
    default: 0
  },
  deliveryFee: {
    type: Number,
    default: 0
  },
  taxRate: {
    type: Number,
    default: 5
  },
  isActive: {
    type: Boolean,
    default: true  // Platform par dikhane ke liye
  },
  isOpen: {
    type: Boolean,
    default: true   // Orders accept karne ke liye
  },
  gstNumber: {
    type: String,
    sparse: true
  },
  fssaiNumber: {
    type: String,
    sparse: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: false
  }
}, {
  timestamps: true
});

restaurantSchema.index({ cuisine: 1 });
restaurantSchema.index({ 'rating.average': -1 });
restaurantSchema.index({ ownerId: 1 });
// High-throughput compound indexes for restaurant listing & search filters
restaurantSchema.index({ isActive: 1, isOpen: 1, 'address.city': 1 });
restaurantSchema.index({ isActive: 1, 'rating.average': -1 });
restaurantSchema.index({ isActive: 1, minOrderAmount: 1 });

module.exports = mongoose.model('Restaurant', restaurantSchema);