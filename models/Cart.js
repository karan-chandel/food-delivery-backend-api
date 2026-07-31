const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  menuItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    required: true
  },
  variant: {
    name: String,
    price: Number
  },
  addons: [
    {
      name: String,
      price: Number
    }
  ],
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  price: {
    type: Number,
    required: true
  },
  specialInstructions: String
});

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant'
  },
  items: [cartItemSchema],
  totalAmount: {
    type: Number,
    default: 0
  },
  coupon: {
    code: { type: String },
    discount: { type: Number },
    type: { type: String },
    discountAmount: { type: Number },
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' } // ✅ ADD THIS
  },
  finalAmount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// ✅ ENHANCED calculateTotal with variant and addons support
cartSchema.methods.calculateTotal = async function () {
  let total = 0;

  for (let item of this.items) {
    const menuItem = await mongoose.model('MenuItem').findById(item.menuItemId);

    if (menuItem) {
      let price = menuItem.discountedPrice || menuItem.price;

      if (item.variant?.price) {
        price = item.variant.price;
      }

      if (item.addons?.length) {
        item.addons.forEach(a => {
          price += (a.price || 0);
        });
      }

      item.price = price;
    }

    total += item.price * item.quantity;
  }

  this.totalAmount = total;

  // ✅ Fixed coupon handling
  if (this.coupon && this.coupon.code) {
    let discountAmount = this.coupon.discountAmount || 0;
    
    // Recalculate if needed (when cart total changes)
    if (this.coupon.type === 'percentage') {
      discountAmount = (total * this.coupon.discount) / 100;
    } else if (this.coupon.type === 'fixed') {
      discountAmount = Math.min(this.coupon.discount, total);
    }
    
    this.coupon.discountAmount = discountAmount;
    this.finalAmount = total - discountAmount;
  } else {
    this.coupon = null;
    this.finalAmount = total;
  }
};

// Pre-save middleware
cartSchema.pre('save', async function(next) {
  if (this.isModified('items') || this.isModified('coupon')) {
    await this.calculateTotal();
  }
  next();
});

module.exports = mongoose.model('Cart', cartSchema);


// const mongoose = require('mongoose');

// const cartItemSchema = new mongoose.Schema({
//   menuItemId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'MenuItem',
//     required: true
//   },
//    variant: {
//     name: String,
//     price: Number
//   },
//   addons: [
//     {
//       name: String,
//       price: Number
//     }
//   ],
//   quantity: {
//     type: Number,
//     required: true,
//     min: 1,
//     default: 1
//   },
//   price: {
//     type: Number,
//     required: true
//   },
//   specialInstructions: String
// }, { _id: false });

// const cartSchema = new mongoose.Schema({
//   userId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true,
//     unique: true
//   },
//   restaurantId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Restaurant'
//   },
//   items: [cartItemSchema],
//   totalAmount: {
//     type: Number,
//     default: 0
//   },
//  coupon: {
//   code: { type: String },
//   discount: { type: Number },
//   type: { type: String },
//   discountAmount: { type: Number }
// },
//   finalAmount: {
//     type: Number,
//     default: 0
//   }
// }, {
//   timestamps: true
// });

// // // Calculate total amount
// // cartSchema.methods.calculateTotal = async function() {
// //   let total = 0;
  
// //   for (let item of this.items) {
// //     // Always get latest price from database
// //     const menuItem = await mongoose.model('MenuItem').findById(item.menuItemId);
// //     if (menuItem) {
// //       item.price = menuItem.discountedPrice || menuItem.price;
// //     }
// //     total += item.price * item.quantity;
// //   }
  
// //   this.totalAmount = total;
// //   this.finalAmount = total - (this.coupon?.discountAmount || 0);
// // };

//  // ✅ ENHANCED calculateTotal with variant and addons support
// cartSchema.methods.calculateTotal = async function () {
//   let total = 0;

//   for (let item of this.items) {
//     const menuItem = await mongoose.model('MenuItem').findById(item.menuItemId);

//     if (menuItem) {
//       let price = menuItem.discountedPrice || menuItem.price;

//       if (item.variant?.price) {
//         price = item.variant.price;
//       }

//       if (item.addons?.length) {
//         item.addons.forEach(a => {
//           price += (a.price || 0);
//         });
//       }

//       item.price = price;
//     }

//     total += item.price * item.quantity;
//   }

//   this.totalAmount = total;

//   // ✅ FIXED: Proper coupon handling
//   if (this.coupon && this.coupon.code) {
//     let discountAmount = 0;

//     if (this.coupon.type === 'percentage') {
//       discountAmount = (total * this.coupon.discount) / 100;
//     } else if (this.coupon.type === 'fixed') {
//       discountAmount = Math.min(this.coupon.discount, total);
//     }

//     this.coupon.discountAmount = discountAmount;
//     this.finalAmount = total - discountAmount;
//   } else {
//     this.coupon = null;
//     this.finalAmount = total;
//   }
// };



// // Pre-save middleware
// cartSchema.pre('save', async function(next) {
//   if (this.isModified('items') || this.isModified('coupon')) {
//     await this.calculateTotal();
//   }
//   next();
// });

// module.exports = mongoose.model('Cart', cartSchema);