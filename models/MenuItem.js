const mongoose = require('mongoose');
const variantSchema = new mongoose.Schema({
  name: String,
  price: Number,
  isDefault: { type: Boolean, default: false }
}, { _id: false });

const addonItemSchema = new mongoose.Schema({
  name: String,
  price: Number
}, { _id: false });

const addonGroupSchema = new mongoose.Schema({
  title: String,
  multiple: { type: Boolean, default: true },
  isRequired: { type: Boolean, default: false },
  items: [addonItemSchema]
}, { _id: false });

const menuItemSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  description: String,
  price: { 
    type: Number, 
    required: true
  },
  category: String,
  images: [
  {
     _id: false,
    url: { type: String },
    filename: { type: String, default: null },
    path: { type: String, default: null }
  }
],
  isVeg: { 
    type: Boolean, 
    default: true 
  },
  isAvailable: { 
    type: Boolean, 
    default: true 
  },
  ingredients: [String],
  restaurantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Restaurant', 
    required: true 
  }, 
   variants: [variantSchema],
  addonGroups: [addonGroupSchema]
  
},
 { 
  timestamps: true 
});

module.exports = mongoose.model('MenuItem', menuItemSchema);