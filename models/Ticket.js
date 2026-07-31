// models/Ticket.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderRole: { type: String, enum: ['customer', 'rider', 'restaurant', 'admin', 'support'], required: true },
  message: { type: String, required: true },
 //  attachments: [String],
attachments: [{
  fileName: String,
  fileUrl: String,
  fileType: String,
  fileSize: Number,
  uploadedAt: { type: Date, default: Date.now }
}],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const ticketSchema = new mongoose.Schema({
  // Basic ticket info
  ticketId: { 
    type: String, 
    unique: true,
    required: true,
    index: true 
  },
  subject: { 
    type: String, 
    required: true,
    trim: true 
  },
  description: { 
    type: String, 
    required: true 
  },
  
  userInfo: {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    profilePicture: String,
    role: { 
      type: String, 
      enum: ['customer', 'rider', 'restaurant'],
      required: true 
    },
    
    // Role-specific data (optional, based on role)
    customerAddresses: [{
      addressLine1: String,
      city: String,
      pincode: String
    }],
    riderVehicle: {
      vehicleNo: String,
      vehicleType: String
    },
    restaurantDetails: {
      restaurantId: mongoose.Schema.Types.ObjectId,
      businessName: String
    }
  },
  
  // Ticket metadata
  category: {
    type: String,
    enum: [
      'order_issue',
      'payment_problem', 
      'delivery_complaint',
      'restaurant_complaint',
      'rider_complaint',
      'technical_issue',
      'account_issue',
      'refund_request',
      'other'
    ],
    required: true
  },
  
  subCategory: String, // e.g., "late_delivery", "wrong_order", "payment_failed"
  
  // Reference to order if applicable
  orderReference: {
    orderId: String, // Order model ka orderId
    orderAmount: Number,
    restaurantName: String,
    orderDate: Date
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['open', 'in_progress', 'on_hold', 'resolved', 'closed'],
    default: 'open'
  },
  
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  // Assignment
  assignedTo: {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    adminName: String,
    assignedAt: Date
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  closedAt: Date,
  
  // SLA Tracking
  firstResponseAt: Date,
  resolutionDueAt: Date,
  
  // Messages/Conversation
  messages: [messageSchema],
  
  // Internal notes (only visible to admin/support)
  internalNotes: [{
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    adminName: String,
    note: String,
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Attachments
  attachments: [String],
  
  // Ratings (after resolution)
  userRating: {
    rating: { type: Number, min: 1, max: 5 },
    feedback: String,
    ratedAt: Date
  },
  
  // NEW: Missing fields that are referenced in your routes
  closedBy: { 
    type: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['customer', 'admin','support'] }
  },
  
  isArchived: { 
    type: Boolean, 
    default: false 
  },
  
  archivedAt: Date,
  
  archivedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Admin' 
  },
  
  archiveReason: String,
  
  // For ticket reopening
  reopenedAt: Date,
  
  reopenedBy: { 
    type: mongoose.Schema.Types.ObjectId 
  },
  
  reopenReason: String,
  
  resolvedByUser: { 
    type: Boolean, 
    default: false 
  },
  
  // For escalation
  isEscalated: { 
    type: Boolean, 
    default: false 
  },
  
  escalationReason: String,
  
  escalatedAt: Date,
  
  escalatedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Admin' 
  },
  

  // Audit log
  auditLog: [{
    action: String,
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    adminName: String,
    details: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
  }],
  default: [],
  // Response tracking
  responses: [{
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    adminName: String,
    response: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// Pre-save hook for ticketId
ticketSchema.pre('save', function(next) {
  if (!this.ticketId) {
    // Generate consistent format: TCKT-XXXXXX
    const prefix = 'TCKT-';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 8; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.ticketId = prefix + suffix;
  }
  this.updatedAt = new Date();
  next();
});

// Indexes for faster queries
ticketSchema.index({ 'userInfo.userId': 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ 'userInfo.role': 1 });
ticketSchema.index({ category: 1 });
ticketSchema.index({ isArchived: 1 });
ticketSchema.index({ isEscalated: 1 });
ticketSchema.index({ 'assignedTo.adminId': 1 });

module.exports = mongoose.model('Ticket', ticketSchema);