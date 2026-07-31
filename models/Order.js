const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true,
    default: () => `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rider'
  },

  // Enhanced delivery tracking
  deliveryInfo: {
    assignedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    estimatedDeliveryTime: Date,
    actualDeliveryTime: Date,
    deliveryFee: { type: Number, default: 0 },
    riderEarnings: { type: Number, default: 0 },
    distance: Number, // in km
    trackingUrl: String
  },

  // Real-time location tracking
  riderLocation: {
    lat: Number,
    lng: Number,
    address: String,
    updatedAt: Date
  },

  // Delivery route
  route: {
    restaurantLocation: {
      lat: Number,
      lng: Number,
      geolocation: Number,
      address: String
    },
    customerLocation: {
      lat: Number,
      lng: Number,
      address: String
    },
    polyline: String // For map rendering
  },

  items: [{
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    name: String,
    price: Number,
     quantity: Number,
      itemTotal: Number, 
    variant: Object,
    addons: [Object],
    specialInstructions: String,
    isVeg: Boolean
  }],

  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
   coupon: {
    code: String,
    discountAmount: Number
  },
  finalAmount: { type: Number, required: true },

  deliveryAddress: {
    type: { type: String, default: 'home' },
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    landmark: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },

  paymentMethod: {
    type: String,
    enum: ['cod', 'online', 'upi', 'card'],
    default: 'cod'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },

  // Enhanced status with delivery stages
  status: {
    type: String,
    enum: [
      'pending',
      'confirmed',
      'preparing',
      'ready_for_pickup',
      'assigned_to_rider',
      'picked_up',
      'out_for_delivery',
      'arrived_at_location',
      'delivered',
      'cancelled',
      'failed'
    ],
    default: 'pending'
  },

  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: mongoose.Schema.Types.ObjectId,
    note: String,
    location: {
      lat: Number,
      lng: Number
    }
  }],

  specialInstructions: String,
  estimatedDelivery: Date,
  deliveredAt: Date,
  cancelledAt: Date,

  // Ratings & Reviews
  customerRating: { type: Number, min: 1, max: 5 },
  customerReview: String,
  riderRating: { type: Number, min: 1, max: 5 },
  riderReview: String,
  restaurantRating: { type: Number, min: 1, max: 5 },
  restaurantReview: String

}, {
  timestamps: true
});

// Pre-save hook
orderSchema.pre('save', function (next) {

  // ✅ Generate orderId only once
  if (this.isNew && !this.orderId) {
    this.orderId = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  // ✅ Auto calculate item totals (safety)
  this.items.forEach(item => {
    item.itemTotal = item.price * item.quantity;
  });

  // ✅ Add to status history
  if (this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      updatedBy: this.riderId || this.customerId
    });
  }

  next();
});

// Index for delivery queries
orderSchema.index({ status: 1 });
orderSchema.index({ riderId: 1 });
orderSchema.index({ "deliveryAddress.coordinates.lat": 1, "deliveryAddress.coordinates.lng": 1 });

module.exports = mongoose.model('Order', orderSchema);