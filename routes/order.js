const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Customer = require("../models/Customer");
const RestaurantUser = require("../models/RestaurantUser");
const Admin = require("../models/Admin");
const Coupon = require("../models/Coupon");  
const Notification = require("../models/Notification");
const { auth, requireRole } = require("../middlewares/auth");
const { createNotification, createRestaurantNotifications } = require('../utils/notificationHelper');
// Helper to emit socket events safely
function emitSocket(io, rooms = [], event, data) {
  try {
    if (!io) return;
    rooms.forEach(room => {
      if (room) io.to(room).emit(event, data);
    });
  } catch (err) {
    console.warn(`Socket emit error [${event}]:`, err.message);
  }
}

// Helper function to calculate delivery progress
function calculateDeliveryProgress(status) {
  const progressMap = {
    'pending': 10,
    'confirmed': 20,
    'preparing': 40,
    'ready_for_pickup': 60,
    'assigned_to_rider': 70,
    'picked_up': 80,
    'out_for_delivery': 90,
    'arrived_at_location': 95,
    'delivered': 100,
    'cancelled': 0
  };
  return progressMap[status] || 0;
}

// ✅ FIXED: Enhanced helper function to build route with proper coordinates
function buildRoute(orderObj) {
  if (!orderObj.restaurantId || !orderObj.deliveryAddress) {
    return null;
  }

  // Extract restaurant coordinates correctly
  let restLat, restLng, restAddress;

  // Check different possible locations for restaurant coordinates
  if (orderObj.restaurantId.address?.geolocation) {
    restLat = orderObj.restaurantId.address.geolocation.latitude;
    restLng = orderObj.restaurantId.address.geolocation.longitude;
  } else if (orderObj.restaurantId.coordinates) {
    restLat = orderObj.restaurantId.coordinates.lat;
    restLng = orderObj.restaurantId.coordinates.lng;
  } else if (orderObj.restaurantId.address?.coordinates) {
    restLat = orderObj.restaurantId.address.coordinates.lat;
    restLng = orderObj.restaurantId.address.coordinates.lng;
  }

  // Restaurant address
  restAddress = orderObj.restaurantId.address?.addressLine1 ||
    `${orderObj.restaurantId.name}, ${orderObj.restaurantId.address?.city || ''}`;

  // Extract customer coordinates correctly
  let custLat, custLng, custAddress;

  // Check deliveryAddress coordinates first
  if (orderObj.deliveryAddress.coordinates) {
    custLat = orderObj.deliveryAddress.coordinates.lat;
    custLng = orderObj.deliveryAddress.coordinates.lng;
  }
  // Fallback to customer's addresses array
  else if (orderObj.customerId?.addresses && orderObj.customerId.addresses.length > 0) {
    const primaryAddress = orderObj.customerId.addresses[0];
    custLat = primaryAddress.latitude;
    custLng = primaryAddress.longitude;
  }

  // Customer address
  custAddress = `${orderObj.deliveryAddress.addressLine1}, ${orderObj.deliveryAddress.city}`;

  return {
    restaurantLocation: {
      lat: restLat,
      lng: restLng,
      address: restAddress
    },
    customerLocation: {
      lat: custLat,
      lng: custLng,
      address: custAddress
    },
    polyline: orderObj.route?.polyline || '',
    distance: orderObj.deliveryInfo?.distance || null
  };
}

// // ------------------------- CREATE ORDER hheheh -------------------------
// router.post("/", auth, requireRole(['customer']), async (req, res, next) => {
//   try {

//     const { restaurantId, items, deliveryAddress, paymentMethod, specialInstructions } = req.body;

//     if (!restaurantId || !items || !deliveryAddress || !paymentMethod)
//       return res.status(400).json({ success: false, error: "Missing required fields" });
//     if (!Array.isArray(items) || items.length === 0)
//       return res.status(400).json({ success: false, error: "Items array cannot be empty" });

//     const restaurant = await Restaurant.findById(restaurantId);
//     if (!restaurant) return res.status(404).json({ success: false, error: "Restaurant not found" });
//     if (!restaurant.isOpen) return res.status(400).json({ success: false, error: "Restaurant is closed" });

//     let subtotal = 0;
//     const orderItems = [];

//     for (const item of items) {
//       const menuItem = await MenuItem.findById(item.menuItemId);
//       if (!menuItem) return res.status(400).json({ success: false, error: `Menu item not found: ${item.menuItemId}` });
//       if (!menuItem.isAvailable) return res.status(400).json({ success: false, error: `${menuItem.name} unavailable` });
//       if (menuItem.restaurantId.toString() !== restaurantId)
//         return res.status(400).json({ success: false, error: `${menuItem.name} does not belong to this restaurant` });

//       const itemPrice = menuItem.discountedPrice || menuItem.price;
//       const itemTotal = itemPrice * item.quantity;
//       subtotal += itemTotal;

//       orderItems.push({
//         menuItemId: menuItem._id,
//         name: menuItem.name,
//         price: itemPrice,
//         quantity: item.quantity,
//         itemTotal,
//         specialInstructions: item.specialInstructions || "",
//         isVeg: menuItem.isVeg
//       });
//     }

//     if (subtotal < (restaurant.minOrderAmount || 0))
//       return res.status(400).json({
//         success: false,
//         error: `Minimum order ₹${restaurant.minOrderAmount}. Your subtotal ₹${subtotal}`
//       });

//     const deliveryFee = restaurant.deliveryFee || 0;
//     const tax = Math.round(subtotal * 0.05);
//     const finalAmount = subtotal + deliveryFee + tax;

//     const deliveryTime = Number(restaurant.deliveryTime) || 30;
//     const estimatedDelivery = new Date(Date.now() + deliveryTime * 60000);

//     const orderId = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;

//     // ✅ FIXED: Create route with proper coordinates
//     const route = {
//       restaurantLocation: {
//         lat: restaurant.address?.geolocation?.latitude || restaurant.coordinates?.lat,
//         lng: restaurant.address?.geolocation?.longitude || restaurant.coordinates?.lng,
//         address: restaurant.address?.addressLine1 || `${restaurant.name}, ${restaurant.address?.city || ''}`
//       },
//       customerLocation: {
//         lat: deliveryAddress.coordinates?.lat || deliveryAddress.latitude,
//         lng: deliveryAddress.coordinates?.lng || deliveryAddress.longitude,
//         address: `${deliveryAddress.addressLine1}, ${deliveryAddress.city}`
//       },
//       polyline: ''
//     };

//     const order = await Order.create({
//       orderId,
//       customerId: req.user._id,
//       restaurantId,
//       items: orderItems,
//       subtotal,
//       deliveryFee,
//       tax,
//       finalAmount,
//       deliveryAddress: {
//         ...deliveryAddress,
//         coordinates: deliveryAddress.coordinates || {
//           lat: deliveryAddress.latitude,
//           lng: deliveryAddress.longitude
//         }
//       },
//       route, // ✅ Add route information with coordinates
//       paymentMethod,
//       paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
//       specialInstructions,
//       status: 'pending',
//       estimatedDelivery,
//       statusHistory: [{ status: 'pending', timestamp: new Date(), updatedBy: req.user._id }]
//     });

//     // ✅ CLEAR CART
//     await Cart.findOneAndUpdate(
//       { userId: req.user._id },
//       { items: [], totalAmount: 0, finalAmount: 0, restaurantId: null, coupon: null }
//     );

//     // ✅ UPDATE CUSTOMER
//     await Customer.findByIdAndUpdate(req.user._id, {
//       $push: { orders: order._id },
//       $inc: { totalOrders: 1, totalSpent: finalAmount, loyaltyPoints: Math.floor(finalAmount / 10) }
//     });

//     // ✅ POPULATE ORDER FOR RESPONSE
//     const populatedOrder = await Order.findById(order._id)
//       .populate('customerId', 'name phone addresses')
//       .populate('restaurantId', 'name address contact images deliveryTime coordinates')
//       .populate('items.menuItemId', 'name images category');

//     // ✅ GET SOCKET.IO INSTANCE
//     const io = req.app.get('io');

//     // ✅ DEBUG LOGS START
//     console.log("=".repeat(70));
//     console.log("🚀 ORDER.JS: Order Creation Started");
//     console.log("📦 Order ID:", order.orderId);
//     console.log("🏪 Restaurant ID:", restaurantId);
//     console.log("👤 Customer:", req.user.name);
//     console.log("💵 Amount:", finalAmount);
//     console.log("🔌 Socket.io available:", !!io);
//     console.log("=".repeat(70));

//     if (io) {
//       console.log("📡 ORDER.JS: Emitting socket events for UI updates...");

//       // 1. NOTIFY RESTAURANT FOR UI UPDATE
//       io.to(`restaurant_${restaurantId}`).emit('new_order_received', {
//         action: 'new_order',
//         orderId: order.orderId,
//         customerName: req.user.name,
//         totalAmount: finalAmount,
//         items: orderItems.length,
//         deliveryAddress: deliveryAddress.addressLine1,
//         city: deliveryAddress.city,
//         timestamp: new Date(),
//         status: 'pending'
//       });
//       console.log("✅ ORDER.JS: Emitted 'new_order_received' to room: restaurant_" + restaurantId);

//       // 2. NOTIFY CUSTOMER FOR UI UPDATE
//       io.to(`user_${req.user._id}`).emit('order_confirmed', {
//         action: 'order_confirmed',
//         orderId: order.orderId,
//         orderNumber: order.orderId,
//         restaurantId: restaurantId,
//         restaurantName: restaurant.name,
//         totalAmount: finalAmount,
//         estimatedDelivery: estimatedDelivery,
//         status: 'pending',
//         message: `Order placed successfully at ${restaurant.name}`
//       });
//       console.log("✅ ORDER.JS: Emitted 'order_confirmed' to room: user_" + req.user._id);

//       // 3. NOTIFY ADMIN DASHBOARD
//       io.to('admin_dashboard_room').emit('new_order_admin', {
//         action: 'new_order',
//         orderId: order.orderId,
//         restaurantId: restaurantId,
//         restaurantName: restaurant.name,
//         customerId: req.user._id,
//         customerName: req.user.name,
//         totalAmount: finalAmount,
//         timestamp: new Date()
//       });
//       console.log("✅ ORDER.JS: Emitted 'new_order_admin' to room: admin_dashboard_room");

//       // 4. NOTIFY RIDERS FOR UI UPDATE
//       io.to('riders_room').emit('rider_ui_update', {
//         action: 'new_job',
//         orderId: order.orderId,
//         restaurantId: restaurantId,
//         restaurantName: restaurant.name,
//         restaurantLocation: restaurant.address?.addressLine1,
//         deliveryAddress: deliveryAddress.addressLine1,
//         totalAmount: finalAmount,
//         timestamp: new Date()
//       });
//       console.log("✅ ORDER.JS: Emitted 'rider_ui_update' to room: riders_room");

//       console.log("✅ ORDER.JS: All socket UI events emitted successfully");
//     } else {
//       console.log("❌ ORDER.JS: Socket.io not available - skipping real-time UI updates");
//     }
//     console.log("=".repeat(70));

//     // ✅ CREATE NOTIFICATIONS DIRECTLY IN DATABASE
//     console.log("🔔 ORDER.JS: Creating notifications in database...");

//     // 1. Restaurant notification
//     const restaurantNotifyResult = await createRestaurantNotifications(restaurantId, {
//       title: '🎉 New Order Received',
//       message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
//       type: 'order',
//       data: {
//         orderId: order.orderId,
//         orderMongoId: order._id,
//         type: 'new_order',
//         amount: finalAmount,
//         restaurantId: restaurantId
//       },
//       priority: 'high'
//     });
//     console.log("✅ ORDER.JS: Restaurant notification created for", restaurantNotifyResult.length, "users");

//     // 2. Customer notification
//     const customerNotifyResult = await createNotification({
//       userId: req.user._id,
//       title: '✅ Order Confirmed',
//       message: `Your order #${order.orderId} at ${restaurant.name} is confirmed`,
//       type: 'order',
//       data: {
//         orderId: order.orderId,
//         restaurantId: restaurantId,
//         type: 'order_confirmed'
//       },
//       priority: 'high'
//     });
//     console.log("✅ ORDER.JS: Customer notification created:", customerNotifyResult ? "Success" : "Failed");

//     // 3. Admin notifications
//     const admins = await Admin.find({ isActive: true });
//     console.log("👑 ORDER.JS: Creating notifications for", admins.length, "admins");

//     for (const admin of admins) {
//       await createNotification({
//         userId: admin._id,
//         title: '📦 New Order Placed',
//         message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
//         type: 'order',
//         data: {
//           orderId: order.orderId,
//           customerId: req.user._id,
//           restaurantId: restaurantId,
//           type: 'new_order_admin'
//         },
//         priority: 'medium'
//       });
//     }
//     console.log("✅ ORDER.JS: All admin notifications created");

//     console.log("🎉 ORDER.JS: Order creation completed successfully!");
//     console.log("=".repeat(70));

//     res.status(201).json({
//       success: true,
//       message: `Order placed successfully at ${restaurant.name}`,
//       data: populatedOrder,
//       summary: {
//         subtotal,
//         deliveryFee,
//         tax,
//         finalAmount,
//         estimatedDelivery,
//         orderId: order.orderId
//       }
//     });

//   } catch (err) {
//     console.error('❌ ORDER.JS: Order creation error:', err);
//     next(err);
//   }
// });
// router.post("/", auth, requireRole(['customer']), async (req, res, next) => {
//   try {

//     // ======================================================
//     // REQUEST DATA
//     // ======================================================

//     const { restaurantId, items, deliveryAddress, paymentMethod, specialInstructions } = req.body;

//     if (!restaurantId || !items || !deliveryAddress || !paymentMethod)
//       return res.status(400).json({ success: false, error: "Missing required fields" });

//     if (!Array.isArray(items) || items.length === 0)
//       return res.status(400).json({ success: false, error: "Items array cannot be empty" });


//     // ======================================================
//     // RESTAURANT VALIDATION
//     // ======================================================

//     const restaurant = await Restaurant.findById(restaurantId);

//     if (!restaurant)
//       return res.status(404).json({ success: false, error: "Restaurant not found" });

//     if (!restaurant.isOpen)
//       return res.status(400).json({ success: false, error: "Restaurant is closed" });

//  // 🔥 FETCH CART FOR COUPON (FIXED)
//     // ======================================================
    
//     // ✅ Cart sirf coupon ke liye fetch karo
//     const cart = await Cart.findOne({ userId: req.user._id });
    
//     let appliedCoupon = null;
//     let couponDiscountAmount = 0;


//     // ======================================================
//     // 🔥 PRICE CALCULATION

//     let subtotal = 0;
//     const orderItems = [];

//     for (const item of items) {

//       const menuItem = await MenuItem.findById(item.menuItemId);

//       if (!menuItem)
//         return res.status(400).json({ success: false, error: `Menu item not found: ${item.menuItemId}` });

//       if (!menuItem.isAvailable)
//         return res.status(400).json({ success: false, error: `${menuItem.name} unavailable` });

//       if (menuItem.restaurantId.toString() !== restaurantId)
//         return res.status(400).json({ success: false, error: `${menuItem.name} does not belong to this restaurant` });


//       // ✅ USE PRICE FROM CART (variant/addon already included)
//       const itemPrice = item.price;

// if (itemPrice == null)
//   return res.status(400).json({ success: false, error: "Item price missing" });

// const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;


//       subtotal += itemPrice * quantity;

//       orderItems.push({
//         menuItemId: menuItem._id,
//         name: menuItem.name,
//         price: itemPrice,
//         quantity,
//         variant: item.variant,
//         addons: item.addons,
//         specialInstructions: item.specialInstructions || "",
//         isVeg: menuItem.isVeg
//         // itemTotal auto-calc in model
//       });
//     }


//     // ======================================================
//     //  BILLING (WITHOUT COUPON)
//     // ======================================================

//     if (subtotal < (restaurant.minOrderAmount || 0))
//       return res.status(400).json({
//         success: false,
//         error: `Minimum order ₹${restaurant.minOrderAmount}. Your subtotal ₹${subtotal}`
//       });

//     const deliveryFee = restaurant.deliveryFee || 0;
//     const tax = Math.round(subtotal * 0.05);
//     let finalAmount = subtotal + deliveryFee + tax;
//     const deliveryTime = Number(restaurant.deliveryTime) || 30;
//     const estimatedDelivery = new Date(Date.now() + deliveryTime * 60000);

//     const orderId = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;


//     // ======================================================
//     // ROUTE GEO INFO
//     // ======================================================

//     const route = {
//       restaurantLocation: {
//         lat: restaurant.address?.geolocation?.latitude || restaurant.coordinates?.lat,
//         lng: restaurant.address?.geolocation?.longitude || restaurant.coordinates?.lng,
//         address: restaurant.address?.addressLine1 || `${restaurant.name}`
//       },
//       customerLocation: {
//         lat: deliveryAddress.coordinates?.lat || deliveryAddress.latitude,
//         lng: deliveryAddress.coordinates?.lng || deliveryAddress.longitude,
//         address: `${deliveryAddress.addressLine1}, ${deliveryAddress.city}`
//       },
//       polyline: ''
//     };


//     // ======================================================
//     // CREATE ORDER
//     // ======================================================

//     const order = await Order.create({
//       orderId,
//       customerId: req.user._id,
//       restaurantId,
//       items: orderItems,
//       subtotal,
//       deliveryFee,
//       tax,
//       finalAmount,
//       deliveryAddress: {
//         ...deliveryAddress,
//         coordinates: deliveryAddress.coordinates || {
//           lat: deliveryAddress.latitude,
//           lng: deliveryAddress.longitude
//         }
//       },
//       route,
//       paymentMethod,
//       paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
//       specialInstructions,
//       status: 'pending',
//       estimatedDelivery,
//       statusHistory: [{
//         status: 'pending',
//         timestamp: new Date(),
//         updatedBy: req.user._id
//       }]
//     });


//     // ======================================================
//     // CLEAR CART
//     // ======================================================

//     await Cart.findOneAndUpdate(
//       { userId: req.user._id },
//       { items: [], totalAmount: 0, finalAmount: 0, restaurantId: null, coupon: null }
//     );


//     // ======================================================
//     // UPDATE CUSTOMER STATS
//     // ======================================================

//     await Customer.findByIdAndUpdate(req.user._id, {
//       $push: { orders: order._id },
//       $inc: {
//         totalOrders: 1,
//         totalSpent: finalAmount,
//         loyaltyPoints: Math.floor(finalAmount / 10)
//       }
//     });


//     // ======================================================
//     // POPULATE ORDER
//     // ======================================================

//     const populatedOrder = await Order.findById(order._id)
//       .populate('customerId', 'name phone addresses')
//       .populate('restaurantId', 'name address contact images deliveryTime coordinates')
//       .populate('items.menuItemId', 'name images category');
//   //✅ GET SOCKET.IO INSTANCE
//     const io = req.app.get('io');

//     // ✅ DEBUG LOGS START
//     console.log("=".repeat(70));
//     console.log("🚀 ORDER.JS: Order Creation Started");
//     console.log("📦 Order ID:", order.orderId);
//     console.log("🏪 Restaurant ID:", restaurantId);
//     console.log("👤 Customer:", req.user.name);
//     console.log("💵 Amount:", finalAmount);
//     console.log("🔌 Socket.io available:", !!io);
//     console.log("=".repeat(70));

//     if (io) {
//       console.log("📡 ORDER.JS: Emitting socket events for UI updates...");

//       // 1. NOTIFY RESTAURANT FOR UI UPDATE
//       io.to(`restaurant_${restaurantId}`).emit('new_order_received', {
//         action: 'new_order',
//         orderId: order.orderId,
//         customerName: req.user.name,
//         totalAmount: finalAmount,
//         items: orderItems.length,
//         deliveryAddress: deliveryAddress.addressLine1,
//         city: deliveryAddress.city,
//         timestamp: new Date(),
//         status: 'pending'
//       });
//       console.log("✅ ORDER.JS: Emitted 'new_order_received' to room: restaurant_" + restaurantId);

//       // 2. NOTIFY CUSTOMER FOR UI UPDATE
//       io.to(`user_${req.user._id}`).emit('order_confirmed', {
//         action: 'order_confirmed',
//         orderId: order.orderId,
//         orderNumber: order.orderId,
//         restaurantId: restaurantId,
//         restaurantName: restaurant.name,
//         totalAmount: finalAmount,
//         estimatedDelivery: estimatedDelivery,
//         status: 'pending',
//         message: `Order placed successfully at ${restaurant.name}`
//       });
//       console.log("✅ ORDER.JS: Emitted 'order_confirmed' to room: user_" + req.user._id);

//       // 3. NOTIFY ADMIN DASHBOARD
//       io.to('admin_dashboard_room').emit('new_order_admin', {
//         action: 'new_order',
//         orderId: order.orderId,
//         restaurantId: restaurantId,
//         restaurantName: restaurant.name,
//         customerId: req.user._id,
//         customerName: req.user.name,
//         totalAmount: finalAmount,
//         timestamp: new Date()
//       });
//       console.log("✅ ORDER.JS: Emitted 'new_order_admin' to room: admin_dashboard_room");

//       // 4. NOTIFY RIDERS FOR UI UPDATE
//       io.to('riders_room').emit('rider_ui_update', {
//         action: 'new_job',
//         orderId: order.orderId,
//         restaurantId: restaurantId,
//         restaurantName: restaurant.name,
//         restaurantLocation: restaurant.address?.addressLine1,
//         deliveryAddress: deliveryAddress.addressLine1,
//         totalAmount: finalAmount,
//         timestamp: new Date()
//       });
//       console.log("✅ ORDER.JS: Emitted 'rider_ui_update' to room: riders_room");

//       console.log("✅ ORDER.JS: All socket UI events emitted successfully");
//     } else {
//       console.log("❌ ORDER.JS: Socket.io not available - skipping real-time UI updates");
//     }
//     console.log("=".repeat(70));

//     // ✅ CREATE NOTIFICATIONS DIRECTLY IN DATABASE
//     console.log("🔔 ORDER.JS: Creating notifications in database...");

//     // 1. Restaurant notification
//     const restaurantNotifyResult = await createRestaurantNotifications(restaurantId, {
//       title: '🎉 New Order Received',
//       message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
//       type: 'order',
//       data: {
//         orderId: order.orderId,
//         orderMongoId: order._id,
//         type: 'new_order',
//         amount: finalAmount,
//         restaurantId: restaurantId
//       },
//       priority: 'high'
//     });
//     console.log("✅ ORDER.JS: Restaurant notification created for", restaurantNotifyResult.length, "users");

//     // 2. Customer notification
//     const customerNotifyResult = await createNotification({
//       userId: req.user._id,
//       title: '✅ Order Confirmed',
//       message: `Your order #${order.orderId} at ${restaurant.name} is confirmed`,
//       type: 'order',
//       data: {
//         orderId: order.orderId,
//         restaurantId: restaurantId,
//         type: 'order_confirmed'
//       },
//       priority: 'high'
//     });
//     console.log("✅ ORDER.JS: Customer notification created:", customerNotifyResult ? "Success" : "Failed");

//     // 3. Admin notifications
//     const admins = await Admin.find({ isActive: true });
//     console.log("👑 ORDER.JS: Creating notifications for", admins.length, "admins");

//     for (const admin of admins) {
//       await createNotification({
//         userId: admin._id,
//         title: '📦 New Order Placed',
//         message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
//         type: 'order',
//         data: {
//           orderId: order.orderId,
//           customerId: req.user._id,
//           restaurantId: restaurantId,
//           type: 'new_order_admin'
//         },
//         priority: 'medium'
//       });
//     }
//  console.log("✅ ORDER.JS: All admin notifications created");

//     console.log("🎉 ORDER.JS: Order creation completed successfully!");
//     console.log("=".repeat(70));
    
//     // ======================================================
//     // RESPONSE
//     // ======================================================

//     res.status(201).json({
//       success: true,
//       message: `Order placed successfully at ${restaurant.name}`,
//       data: populatedOrder,
//       summary: {
//         subtotal,
//         deliveryFee,
//         tax,
//         finalAmount,
//         estimatedDelivery,
//                 orderId: order.orderId

//       }
//     });

//   } catch (err) {
//     console.error("❌ Order error:", err);
//     next(err);
//   }
// });


// ------------------------- GET USER ORDERS -------------------------

router.post("/", auth, requireRole(['customer']), async (req, res, next) => {
  try {

    // ======================================================
    // REQUEST DATA
    // ======================================================

    let { restaurantId, items, deliveryAddress, paymentMethod, specialInstructions } = req.body;

    if (!restaurantId || !deliveryAddress || !paymentMethod)
      return res.status(400).json({ success: false, error: "Missing required fields: restaurantId, deliveryAddress, paymentMethod" });

    // ======================================================
    // 🔥 FETCH CART (Always fetch for coupon)
    // ======================================================
    
    const cart = await Cart.findOne({ userId: req.user._id });
    
    // ✅ FIX: If items not provided, take from cart
    if (!items || items.length === 0) {
      if (!cart || cart.items.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: "Cart is empty. Please add items to cart or provide items array." 
        });
      }
      
      // Use cart items
      items = cart.items.map(item => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: item.price,
        variant: item.variant,
        addons: item.addons,
        specialInstructions: item.specialInstructions
      }));
      
      console.log("📦 Using cart items:", items.length, "items");
    }

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ success: false, error: "Items array cannot be empty" });


    // ======================================================
    // RESTAURANT VALIDATION
    // ======================================================

    const restaurant = await Restaurant.findById(restaurantId);

    if (!restaurant)
      return res.status(404).json({ success: false, error: "Restaurant not found" });

    if (!restaurant.isOpen)
      return res.status(400).json({ success: false, error: "Restaurant is closed" });


    // ======================================================
    // 🔥 PRICE CALCULATION
    // ======================================================

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {

      const menuItem = await MenuItem.findById(item.menuItemId);

      if (!menuItem)
        return res.status(400).json({ success: false, error: `Menu item not found: ${item.menuItemId}` });

      if (!menuItem.isAvailable)
        return res.status(400).json({ success: false, error: `${menuItem.name} unavailable` });

      if (menuItem.restaurantId.toString() !== restaurantId)
        return res.status(400).json({ success: false, error: `${menuItem.name} does not belong to this restaurant` });

      const itemPrice = item.price;
      if (itemPrice == null)
        return res.status(400).json({ success: false, error: "Item price missing" });

      const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;

      subtotal += itemPrice * quantity;

      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        price: itemPrice,
        quantity,
        variant: item.variant,
        addons: item.addons,
        specialInstructions: item.specialInstructions || "",
        isVeg: menuItem.isVeg
      });
    }


    // ======================================================
    // BILLING (WITHOUT COUPON)
    // ======================================================

    if (subtotal < (restaurant.minOrderAmount || 0))
      return res.status(400).json({
        success: false,
        error: `Minimum order ₹${restaurant.minOrderAmount}. Your subtotal ₹${subtotal}`
      });

    const deliveryFee = restaurant.deliveryFee || 0;
    const taxRate = restaurant.taxRate !== undefined ? restaurant.taxRate : 5;
    const tax = Math.round((subtotal * taxRate) / 100);
    let finalAmount = subtotal + deliveryFee + tax;


    // ======================================================
    // 🎫 COUPON VALIDATION & APPLY (CRITICAL FIX)
    // ======================================================
    
    let appliedCoupon = null;
    let couponDiscountAmount = 0;
    
    if (cart && cart.coupon && cart.coupon.code) {
      console.log("🔍 Validating coupon:", cart.coupon.code);
      
      const coupon = await Coupon.findOne({
        code: cart.coupon.code,
        restaurantId: restaurantId,
        isActive: true,
        expiryDate: { $gte: new Date() }
      });
      
      let isCouponValid = true;
      let errorMessage = "";
      
      if (!coupon) {
        isCouponValid = false;
        errorMessage = "Coupon no longer exists";
      }
      else if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
        isCouponValid = false;
        errorMessage = "Coupon usage limit exceeded";
      }
      else if (subtotal < coupon.minOrderAmount) {
        isCouponValid = false;
        errorMessage = `Minimum order amount ₹${coupon.minOrderAmount} required`;
      }
      
      if (!isCouponValid) {
        console.log(`❌ Coupon invalid: ${errorMessage}`);
        // Clear invalid coupon from cart
        await Cart.findOneAndUpdate(
          { userId: req.user._id },
          { coupon: null, finalAmount: subtotal + deliveryFee + tax }
        );
      } 
      else {
        // ✅ Calculate discount
        let discountAmount = 0;
        
        if (coupon.discountType === "percentage") {
          discountAmount = (subtotal * coupon.discountValue) / 100;
          if (coupon.maxDiscount) {
            discountAmount = Math.min(discountAmount, coupon.maxDiscount);
          }
        } else {
          discountAmount = Math.min(coupon.discountValue, subtotal);
        }
        
        couponDiscountAmount = discountAmount;
        finalAmount = subtotal + deliveryFee + tax - discountAmount;
        
        appliedCoupon = {
          code: coupon.code,
          discountAmount: discountAmount,
          discountValue: coupon.discountValue,
          discountType: coupon.discountType
        };
        
        // ✅✅✅ CRITICAL: Increment usedCount ATOMICALY (only on order confirmation)
        const updatedCoupon = await Coupon.findOneAndUpdate(
          {
            _id: coupon._id,
            usedCount: { $lt: coupon.usageLimit }
          },
          { $inc: { usedCount: 1 } },
          { new: true }
        );
        
        if (!updatedCoupon) {
          // Race condition - coupon got used by someone else
          console.log("⚠️ Coupon race condition - usage limit reached");
          finalAmount = subtotal + deliveryFee + tax;
          appliedCoupon = null;
          couponDiscountAmount = 0;
          
          await Cart.findOneAndUpdate(
            { userId: req.user._id },
            { coupon: null, finalAmount: subtotal + deliveryFee + tax }
          );
        } else {
          console.log(`✅ Coupon applied! Discount: ₹${discountAmount}, Final: ₹${finalAmount}`);
          console.log(`📊 Coupon usage: ${updatedCoupon.usedCount}/${updatedCoupon.usageLimit}`);
        }
      }
    }


    // ======================================================
    // DELIVERY TIME & ORDER ID
    // ======================================================

    const deliveryTime = Number(restaurant.deliveryTime) || 30;
    const estimatedDelivery = new Date(Date.now() + deliveryTime * 60000);
    const orderId = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;


    // ======================================================
    // ROUTE GEO INFO
    // ======================================================

    const route = {
      restaurantLocation: {
        lat: restaurant.address?.geolocation?.latitude || restaurant.coordinates?.lat,
        lng: restaurant.address?.geolocation?.longitude || restaurant.coordinates?.lng,
        address: restaurant.address?.addressLine1 || `${restaurant.name}`
      },
      customerLocation: {
        lat: deliveryAddress.coordinates?.lat || deliveryAddress.latitude,
        lng: deliveryAddress.coordinates?.lng || deliveryAddress.longitude,
        address: `${deliveryAddress.addressLine1}, ${deliveryAddress.city}`
      },
      polyline: ''
    };


    // ======================================================
    // CREATE ORDER (WITH COUPON INFO)
    // ======================================================

    const order = await Order.create({
      orderId,
      customerId: req.user._id,
      restaurantId,
      items: orderItems,
      subtotal,
      deliveryFee,
      tax,
      finalAmount,
      coupon: appliedCoupon,
      deliveryAddress: {
        ...deliveryAddress,
        coordinates: deliveryAddress.coordinates || {
          lat: deliveryAddress.latitude,
          lng: deliveryAddress.longitude
        }
      },
      route,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
      specialInstructions,
      status: 'pending',
      estimatedDelivery,
      statusHistory: [{
        status: 'pending',
        timestamp: new Date(),
        updatedBy: req.user._id
      }]
    });


    // ======================================================
    // CLEAR CART (Remove coupon as well)
    // ======================================================

    await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { items: [], totalAmount: 0, finalAmount: 0, restaurantId: null, coupon: null }
    );


    // ======================================================
    // UPDATE CUSTOMER STATS
    // ======================================================

    await Customer.findByIdAndUpdate(req.user._id, {
      $push: { orders: order._id },
      $inc: {
        totalOrders: 1,
        totalSpent: finalAmount,
        loyaltyPoints: Math.floor(finalAmount / 10)
      }
    });


    // ======================================================
    // POPULATE ORDER
    // ======================================================

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images deliveryTime coordinates')
      .populate('items.menuItemId', 'name images category');
      
    // ✅ GET SOCKET.IO INSTANCE
    const io = req.app.get('io');

    // ✅ DEBUG LOGS START
    console.log("=".repeat(70));
    console.log("🚀 ORDER.JS: Order Creation Started");
    console.log("📦 Order ID:", order.orderId);
    console.log("🏪 Restaurant ID:", restaurantId);
    console.log("👤 Customer:", req.user.name);
    console.log("💰 Subtotal:", subtotal);
    console.log("🏷️ Coupon Discount:", couponDiscountAmount);
    console.log("💵 Final Amount:", finalAmount);
    console.log("🔌 Socket.io available:", !!io);
    console.log("=".repeat(70));

    if (io) {
      console.log("📡 ORDER.JS: Emitting socket events for UI updates...");

      io.to(`restaurant_${restaurantId}`).emit('new_order_received', {
        action: 'new_order',
        orderId: order.orderId,
        customerName: req.user.name,
        totalAmount: finalAmount,
        items: orderItems.length,
        deliveryAddress: deliveryAddress.addressLine1,
        city: deliveryAddress.city,
        timestamp: new Date(),
        status: 'pending'
      });
      console.log("✅ Emitted 'new_order_received' to restaurant_" + restaurantId);

      io.to(`user_${req.user._id}`).emit('order_confirmed', {
        action: 'order_confirmed',
        orderId: order.orderId,
        orderNumber: order.orderId,
        restaurantId: restaurantId,
        restaurantName: restaurant.name,
        totalAmount: finalAmount,
        estimatedDelivery: estimatedDelivery,
        status: 'pending',
        message: `Order placed successfully at ${restaurant.name}`
      });
      console.log("✅ Emitted 'order_confirmed' to user_" + req.user._id);

      io.to('admin_dashboard_room').emit('new_order_admin', {
        action: 'new_order',
        orderId: order.orderId,
        restaurantId: restaurantId,
        restaurantName: restaurant.name,
        customerId: req.user._id,
        customerName: req.user.name,
        totalAmount: finalAmount,
        timestamp: new Date()
      });
      console.log("✅ Emitted 'new_order_admin' to admin_dashboard_room");

      io.to('riders_room').emit('rider_ui_update', {
        action: 'new_job',
        orderId: order.orderId,
        restaurantId: restaurantId,
        restaurantName: restaurant.name,
        restaurantLocation: restaurant.address?.addressLine1,
        deliveryAddress: deliveryAddress.addressLine1,
        totalAmount: finalAmount,
        timestamp: new Date()
      });
      console.log("✅ Emitted 'rider_ui_update' to riders_room");

      console.log("✅ All socket UI events emitted successfully");
    } else {
      console.log("❌ Socket.io not available - skipping real-time UI updates");
    }
    console.log("=".repeat(70));

    // ✅ CREATE NOTIFICATIONS
    console.log("🔔 ORDER.JS: Creating notifications in database...");

    const restaurantNotifyResult = await createRestaurantNotifications(restaurantId, {
      title: '🎉 New Order Received',
      message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
      type: 'order',
      data: {
        orderId: order.orderId,
        orderMongoId: order._id,
        type: 'new_order',
        amount: finalAmount,
        restaurantId: restaurantId
      },
      priority: 'high'
    });
    console.log("✅ Restaurant notification created for", restaurantNotifyResult.length, "users");

    const customerNotifyResult = await createNotification({
      userId: req.user._id,
      title: '✅ Order Confirmed',
      message: `Your order #${order.orderId} at ${restaurant.name} is confirmed${appliedCoupon ? ` with ₹${couponDiscountAmount} discount` : ''}`,
      type: 'order',
      data: {
        orderId: order.orderId,
        restaurantId: restaurantId,
        type: 'order_confirmed'
      },
      priority: 'high'
    });
    console.log("✅ Customer notification created:", customerNotifyResult ? "Success" : "Failed");

    const admins = await Admin.find({ isActive: true });
    console.log("👑 Creating notifications for", admins.length, "admins");

    for (const admin of admins) {
      await createNotification({
        userId: admin._id,
        title: '📦 New Order Placed',
        message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
        type: 'order',
        data: {
          orderId: order.orderId,
          customerId: req.user._id,
          restaurantId: restaurantId,
          type: 'new_order_admin'
        },
        priority: 'medium'
      });
    }
    console.log("✅ All admin notifications created");

    console.log("🎉 ORDER.JS: Order creation completed successfully!");
    console.log("=".repeat(70));
    
    // ======================================================
    // RESPONSE
    // ======================================================

    res.status(201).json({
      success: true,
      message: `Order placed successfully at ${restaurant.name}`,
      data: populatedOrder,
      summary: {
        subtotal,
        deliveryFee,
        tax,
        couponDiscount: couponDiscountAmount,
        finalAmount,
        estimatedDelivery,
        orderId: order.orderId
      }
    });

  } catch (err) {
    console.error("❌ Order error:", err);
    next(err);
  }
});

router.get("/my-orders", auth, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;
    let filter = {};

    if (req.user.role === 'customer') filter.customerId = req.user._id;
    else if (req.user.role === 'restaurant') {
      const restUser = await RestaurantUser.findById(req.user._id);
      if (!restUser || !restUser.restaurantId) return res.status(404).json({ success: false, error: "Restaurant not found" });
      filter.restaurantId = restUser.restaurantId;
    } else if (req.user.role === 'rider') filter.riderId = req.user._id;

    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name images address contact coordinates')
      .populate('riderId', 'name phone vehicleNo currentLocation')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filter);

    // ✅ FIXED: Enhanced route building with proper coordinates
    const ordersWithRoute = orders.map(order => {
      const orderObj = order.toObject();

      // Build route with proper coordinates
      const route = buildRoute(orderObj);
      if (route) {
        orderObj.route = route;
      }

      // Add real-time tracking data if available
      if (orderObj.riderLocation) {
        orderObj.currentRiderLocation = {
          lat: orderObj.riderLocation.lat,
          lng: orderObj.riderLocation.lng,
          address: orderObj.riderLocation.address,
          updatedAt: orderObj.riderLocation.updatedAt
        };
      }

      // Add delivery progress
      orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);
 // ✅ ADD EARNINGS FOR RIDER
      // if (req.user.role === 'rider') {
      //   // Get restaurant and customer coordinates
      //   const restCoords = order.restaurantId?.coordinates;
      //   const custCoords = order.deliveryAddress?.coordinates;
        
      //   let deliveryDistance = 0;
      //   if (restCoords?.lat && restCoords?.lng && custCoords?.lat && custCoords?.lng) {
      //     deliveryDistance = calculateDistance(
      //       restCoords.lat, restCoords.lng,
      //       custCoords.lat, custCoords.lng
      //     );
      //   }
        
      //   // If delivery is completed, use stored earnings
      //   if (order.deliveryInfo?.riderEarnings) {
      //     orderObj.earnings = order.deliveryInfo.riderEarnings;
      //     orderObj.estimatedEarnings = order.deliveryInfo.riderEarnings;
      //   } else {
      //     // Calculate estimated earnings
      //     orderObj.estimatedEarnings = calculateDeliveryEarnings(deliveryDistance, order.finalAmount);
      //     orderObj.deliveryDistance = Math.round(deliveryDistance * 100) / 100;
      //   }
      // }
      return orderObj;
    });

    res.json({
      success: true,
      data: ordersWithRoute,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalOrders: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (err) { next(err); }
});

// ------------------------- GET SINGLE ORDER -------------------------
router.get("/:orderId", auth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId })
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates openingHours')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category isVeg');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    // Authorization checks
    if (req.user.role === 'customer' && order.customerId._id.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not authorized" });

    if (req.user.role === 'restaurant') {
      const restUser = await RestaurantUser.findById(req.user._id);
      if (!restUser || order.restaurantId._id.toString() !== restUser.restaurantId.toString())
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (req.user.role === 'rider') {
      if (!order.riderId || order.riderId._id.toString() !== req.user._id.toString())
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    // ✅ FIXED: Enhanced route building
    const orderObj = order.toObject();

    const route = buildRoute(orderObj);
    if (route) {
      orderObj.route = route;
    }

    // Add real-time tracking info
    if (orderObj.riderLocation) {
      orderObj.currentRiderLocation = {
        lat: orderObj.riderLocation.lat,
        lng: orderObj.riderLocation.lng,
        address: orderObj.riderLocation.address,
        updatedAt: orderObj.riderLocation.updatedAt
      };
    }

    // Add delivery progress
    orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);

    res.json({ success: true, data: orderObj });

  } catch (err) { next(err); }
});

// ------------------------- UPDATE ORDER STATUS -------------------------
router.patch("/:orderId/status", auth, requireRole(['restaurant', 'rider']), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, location, note } = req.body;

    const validStatuses = [
      'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery',
      'delivered', 'cancelled', 'picked_up', 'assigned_to_rider'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    const order = await Order.findOne({ orderId })
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation');

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

                                                      // ================= ROLE AUTH =================
    if (req.user.role === 'restaurant') {
      const restUser = await RestaurantUser.findById(req.user._id);
      if (!restUser || order.restaurantId._id.toString() !== restUser.restaurantId.toString()) {
        return res.status(403).json({ success: false, error: "Not allowed" });
      }
    }

    if (req.user.role === 'rider') {
      if (!order.riderId || order.riderId._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, error: "Not allowed" });
      }
    }

    // ================= UPDATE =================
    order.status = status;

    const statusUpdate = {
      status,
      timestamp: new Date(),
      updatedBy: req.user._id,
      ...(location && { location }),
      ...(note && { note })
    };

    order.statusHistory.push(statusUpdate);

    // ====== SPECIAL TIMESTAMPS ======
    order.deliveryInfo = order.deliveryInfo || {};

    if (status === 'ready_for_pickup')
      order.deliveryInfo.readyAt = new Date();

    if (status === 'picked_up')
      order.deliveryInfo.pickedUpAt = new Date();

    if (status === 'assigned_to_rider')
      order.deliveryInfo.assignedAt = new Date();

    if (status === 'cancelled')
      order.cancelledAt = new Date();

    // ================= PAYMENT CHECK FOR DELIVERED =================
    if (status === 'delivered') {

      if (order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
      }

      if (['online', 'upi', 'card'].includes(order.paymentMethod)) {
        if (order.paymentStatus !== 'paid') {
          return res.status(400).json({
            success: false,
            error: "Cannot mark as delivered. Payment not completed yet."
          });
        }
      }

      order.deliveryInfo.deliveredAt = new Date();
      order.deliveryInfo.actualDeliveryTime = new Date();
      order.deliveredAt = new Date();
    }

    await order.save();

    // ============ RELOAD ORDER ============
    const updatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category');

    const orderObj = updatedOrder.toObject();
    orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);

    // ================= SOCKET =================
    // ================= SOCKET EMIT =================
const io = req.app.get('io');

if (io) {
  const payload = {
    orderId: updatedOrder.orderId,
    status: updatedOrder.status,
    deliveryProgress: orderObj.deliveryProgress,

    customerId: updatedOrder.customerId?._id,
    restaurantId: updatedOrder.restaurantId?._id,
    riderId: updatedOrder.riderId?._id,

    paymentStatus: updatedOrder.paymentStatus,
    paymentMethod: updatedOrder.paymentMethod,

    timestamp: new Date()
  };

  console.log("📡 EMITTING GLOBAL STATUS EVENT:", payload);

  // ===== MAIN EVENT (FRONTEND WILL LISTEN THIS ONLY) =====
  io.to(`order_${updatedOrder.orderId}`).emit(
    "order_status_changed",
    payload
  );

  io.to(`user_${updatedOrder.customerId._id}`).emit(
    "order_status_changed",
    payload
  );

  io.to(`restaurant_${updatedOrder.restaurantId._id}`).emit(
    "order_status_changed",
    payload
  );

  if (updatedOrder.riderId) {
    io.to(`rider_${updatedOrder.riderId._id}`).emit(
      "order_status_changed",
      payload
    );
  }

  // ===== READY FOR PICKUP EXTRA =====
  if (status === 'ready_for_pickup') {
    io.to("riders_room").emit("ready_for_pickup", payload);
    io.to("riders_room").emit("order_status_changed", payload);
  }

  // ===== DELIVERED MUST ALSO EMIT SAME EVENT =====
  if (status === 'delivered') {

    console.log("🚚 ORDER DELIVERED → emitting order_status_changed");

    io.to(`order_${updatedOrder.orderId}`).emit(
      "order_status_changed",
      payload
    );

    io.to(`user_${updatedOrder.customerId._id}`).emit(
      "order_status_changed",
      payload
    );

    // COD extra
    if (updatedOrder.paymentMethod === 'cod') {
      io.to(`user_${updatedOrder.customerId._id}`).emit(
        "ui_payment_update",
        {
          orderId: updatedOrder.orderId,
          paymentStatus: "paid"
        }
      );
    }
  }
}


    // ================= NOTIFICATIONS (STATUS BASED) =================

    if (status === 'ready_for_pickup') {
      await createNotification({
        userId: updatedOrder.customerId._id,
        title: 'Order Ready for Pickup',
        message: `Order #${updatedOrder.orderId} is ready for pickup`,
        type: 'order',
        data: { orderId: updatedOrder.orderId, event: 'ready_for_pickup' },
        priority: 'high'
      });

      const riders = await require("../models/Rider").find({ isAvailable: true });

      for (const rider of riders) {
        await createNotification({
          userId: rider._id,
          title: 'New Pickup Available',
          message: `Order #${updatedOrder.orderId} is ready for pickup`,
          type: 'order',
          data: { orderId: updatedOrder.orderId },
          priority: 'high'
        });
      }
    }

    if (status === 'delivered') {
      await createNotification({
        userId: updatedOrder.customerId._id,
        title: 'Order Delivered 🎉',
        message: `Order #${updatedOrder.orderId} delivered successfully`,
        type: 'order',
        data: { orderId: updatedOrder.orderId, event: 'delivered' },
        priority: 'high'
      });
    }

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      data: orderObj,
      socketEmitted: true
    });

  } catch (err) {
    console.error("❌ ORDER STATUS ERROR:", err);
    next(err);
  }
});
// ------------------------- CANCEL ORDER -------------------------
router.patch("/:orderId/cancel", auth, requireRole(['customer']), async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ orderId }).populate('customerId');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (order.customerId._id.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not allowed" });

    const nonCancellable = ['out_for_delivery', 'delivered', 'cancelled'];
    if (nonCancellable.includes(order.status))
      return res.status(400).json({ success: false, error: "Order cannot be cancelled now" });

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.statusHistory.push({
      status: 'cancelled',
      timestamp: new Date(),
      updatedBy: req.user._id
    });

    await order.save();

    // ✅ SOCKET EMIT FOR UI UPDATE
    const io = req.app.get('io');
    if (io) {
      console.log("❌ ORDER.JS: Emitting order cancelled UI updates");

      emitSocket(io, [
        `restaurant_${order.restaurantId.toString()}`,
        ...(order.riderId ? [`rider_${order.riderId.toString()}`] : [])
      ], 'order_status_update', {
        orderId: order._id,
        status: 'cancelled',
        deliveryProgress: 0
      });
      console.log("✅ ORDER.JS: Emitted order cancelled UI updates");
    }

    // ✅ CREATE NOTIFICATIONS
    console.log("🔔 ORDER.JS: Creating order cancellation notifications...");

    // Notify restaurant users
    await createRestaurantNotifications(order.restaurantId, {
      title: 'Order Cancelled',
      message: `Order #${order.orderId} has been cancelled by customer`,
      type: 'order',
      data: {
        orderId: order.orderId,
        status: 'cancelled',
        type: 'order_cancelled'
      },
      priority: 'high'
    });
    console.log("✅ ORDER.JS: Restaurant notifications created");

    // Notify rider if assigned
    if (order.riderId) {
      await createNotification({
        userId: order.riderId,
        title: 'Order Cancelled',
        message: `Order #${order.orderId} has been cancelled`,
        type: 'order',
        data: {
          orderId: order.orderId,
          status: 'cancelled',
          type: 'order_cancelled'
        },
        priority: 'high'
      });
      console.log("✅ ORDER.JS: Rider notification created");
    }

    res.json({
      success: true,
      message: "Order cancelled",
      data: order
    });

  } catch (err) { next(err); }
});

// ------------------------- ASSIGN RIDER -------------------------
router.patch("/:orderId/assign-rider", auth, requireRole(['restaurant']), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { riderId } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const restUser = await RestaurantUser.findById(req.user._id);
    if (!restUser || restUser.restaurantId.toString() !== order.restaurantId.toString())
      return res.status(403).json({ success: false, error: "Not allowed" });

    const RiderModel = require("../models/Rider");
    const rider = await RiderModel.findById(riderId);
    if (!rider || !rider.isAvailable)
      return res.status(400).json({ success: false, error: "Rider not available" });

    order.riderId = riderId;
    order.status = 'assigned_to_rider';
    order.statusHistory.push({
      status: 'assigned_to_rider',
      timestamp: new Date(),
      updatedBy: req.user._id
    });

    order.deliveryInfo = order.deliveryInfo || {};
    order.deliveryInfo.assignedAt = new Date();

    await order.save();

    // ✅ SOCKET EMIT FOR UI UPDATE
    const io = req.app.get('io');
    if (io) {
      console.log("🏍️ ORDER.JS: Emitting rider assignment UI updates");

      emitSocket(io,
        [`rider_${riderId}`, `user_${order.customerId}`],
        'ui_order_status_update',
        {
          orderId: order._id,
          riderId,
          status: 'assigned_to_rider',
          deliveryProgress: calculateDeliveryProgress('assigned_to_rider')
        }
      );

      
      console.log("✅ ORDER.JS: Emitted rider assignment UI updates");
    }

    // ✅ CREATE NOTIFICATIONS
    console.log("🔔 ORDER.JS: Creating rider assignment notifications...");

    // Notify rider
    await createNotification({
      userId: riderId,
      title: 'New Delivery Assigned',
      message: `You have been assigned to deliver order #${order.orderId}`,
      type: 'delivery',
      data: {
        orderId: order.orderId,
        restaurantId: order.restaurantId,
        customerId: order.customerId,
        type: 'rider_assigned'
      },
      priority: 'high'
    });
    console.log("✅ ORDER.JS: Rider notification created");

    // Notify customer
    await createNotification({
      userId: order.customerId,
      title: 'Rider Assigned',
      message: `A rider has been assigned to deliver your order #${order.orderId}`,
      type: 'order',
      data: {
        orderId: order.orderId,
        riderId: riderId,
        type: 'rider_assigned'
      },
      priority: 'medium'
    });
    console.log("✅ ORDER.JS: Customer notification created");

    res.json({
      success: true,
      message: "Rider assigned",
      data: order
    });

  } catch (err) { next(err); }
});

// ------------------------- TRACK ORDER -------------------------
router.get("/track/:orderId", auth, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId })
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category isVeg');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (req.user.role === 'customer' && order.customerId._id.toString() !== req.user._id)
      return res.status(403).json({ success: false, error: "Not authorized" });

    if (req.user.role === 'restaurant') {
      const restUser = await RestaurantUser.findById(req.user._id);
      if (!restUser || order.restaurantId._id.toString() !== restUser.restaurantId.toString())
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (req.user.role === 'rider' && (!order.riderId || order.riderId._id.toString() !== req.user._id))
      return res.status(403).json({ success: false, error: "Not authorized" });

    // ✅ FIXED: Enhanced route building for tracking
    const orderObj = order.toObject();

    const route = buildRoute(orderObj);
    if (route) {
      orderObj.route = route;
    }

    // Add real-time tracking info
    if (orderObj.riderLocation) {
      orderObj.currentRiderLocation = {
        lat: orderObj.riderLocation.lat,
        lng: orderObj.riderLocation.lng,
        address: orderObj.riderLocation.address,
        updatedAt: orderObj.riderLocation.updatedAt
      };
    }

    // Add delivery progress
    orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);

    res.json({
      success: true,
      message: "Order found",
      data: orderObj
    });
  } catch (err) { next(err); }
});

// ------------------------- UPDATE RIDER LOCATION -------------------------
router.patch("/:orderId/rider-location", auth, requireRole(['rider']), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { lat, lng, address } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (!order.riderId || order.riderId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not authorized" });

    // Update rider location
    order.riderLocation = {
      lat,
      lng,
      address,
      updatedAt: new Date()
    };

    await order.save();

    // ✅ SOCKET EMIT FOR REAL-TIME TRACKING
    const io = req.app.get('io');
    if (io) {
      console.log("📍 ORDER.JS: Emitting rider location update");

      emitSocket(io,
        [`user_${order.customerId}`, `restaurant_${order.restaurantId}`],
        'rider_location_update',
        {
          orderId: order.orderId,
          location: { lat, lng, address },
          riderId: req.user._id,
          timestamp: new Date()
        }
      );
      console.log("✅ ORDER.JS: Emitted rider location UI update");
    }

    // ✅ CREATE NOTIFICATION FOR CUSTOMER
    console.log("🔔 ORDER.JS: Creating rider location notification");

    await createNotification({
      userId: order.customerId,
      title: 'Rider Location Updated',
      message: `Rider is on the way with your order #${order.orderId}`,
      type: 'delivery',
      data: { orderId: order.orderId, location: { lat, lng }, type: 'rider_location' },
      priority: 'low'
    });
    console.log("✅ ORDER.JS: Rider location notification created");

    res.json({
      success: true,
      message: "Rider location updated",
      data: order.riderLocation
    });

  } catch (err) { next(err); }
});

// ------------------------- ADD ORDER REVIEW -------------------------
router.patch("/:orderId/review", auth, requireRole(['customer']), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { restaurantRating, restaurantReview, riderRating, riderReview } = req.body;

    const order = await Order.findOne({ orderId }).populate('customerId');
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (order.customerId._id.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not authorized" });

    if (order.status !== 'delivered')
      return res.status(400).json({ success: false, error: "Can only review delivered orders" });

    // Update restaurant rating and review
    if (restaurantRating !== undefined) {
      order.restaurantRating = restaurantRating;
      order.restaurantReview = restaurantReview;
    }

    // Update rider rating and review
    if (riderRating !== undefined && order.riderId) {
      order.riderRating = riderRating;
      order.riderReview = riderReview;
    }

    await order.save();

    // Update restaurant average rating
    if (restaurantRating) {
      await Restaurant.findByIdAndUpdate(order.restaurantId, {
        $inc: {
          'rating.totalRatings': 1,
          'rating.totalScore': restaurantRating
        }
      });
    }

    // Update rider average rating
    if (riderRating && order.riderId) {
      const Rider = require("../models/Rider");
      await Rider.findByIdAndUpdate(order.riderId, {
        $inc: {
          totalRatings: 1,
          averageRating: riderRating
        }
      });
    }

    // ✅ CREATE NOTIFICATIONS
    console.log("🔔 ORDER.JS: Creating review notifications...");

    if (restaurantRating) {
      await createRestaurantNotifications(order.restaurantId, {
        title: 'New Review Received',
        message: `You received a ${restaurantRating} star review for order #${order.orderId}`,
        type: 'rating',
        data: {
          orderId: order.orderId,
          rating: restaurantRating,
          review: restaurantReview,
          type: 'restaurant_review'
        },
        priority: 'medium'
      });
      console.log("✅ ORDER.JS: Restaurant review notification created");
    }

    if (riderRating && order.riderId) {
      await createNotification({
        userId: order.riderId,
        title: 'New Review Received',
        message: `You received a ${riderRating} star review for order #${order.orderId}`,
        type: 'rating',
        data: {
          orderId: order.orderId,
          rating: riderRating,
          review: riderReview,
          type: 'rider_review'
        },
        priority: 'medium'
      });
      console.log("✅ ORDER.JS: Rider review notification created");
    }

    res.json({
      success: true,
      message: "Review submitted successfully",
      data: order
    });

  } catch (err) { next(err); }
});

module.exports = router;

// ------------------------- READY FOR PICKUP -------------------------
// router.patch("/:orderId/ready-for-pickup", auth, requireRole(['restaurant']), async (req, res, next) => {
//   try {
//     const { orderId } = req.params;
//     const order = await Order.findOne({ orderId });
//     if (!order) return res.status(404).json({ success: false, error: "Order not found" });

//     const restUser = await RestaurantUser.findById(req.user._id);
//     if (!restUser || restUser.restaurantId.toString() !== order.restaurantId.toString())
//       return res.status(403).json({ success: false, error: "Not allowed" });

//     order.status = 'ready_for_pickup';
//     order.statusHistory.push({
//       status: 'ready_for_pickup',
//       timestamp: new Date(),
//       updatedBy: req.user._id
//     });

//     order.deliveryInfo = order.deliveryInfo || {};
//     order.deliveryInfo.readyAt = new Date();

//     await order.save();

//     // ✅ SOCKET EMIT FOR UI UPDATE
//     const io = req.app.get('io');
//     if (io) {
//       console.log("📦 ORDER.JS: Emitting ready for pickup UI updates");
      
//       emitSocket(io,
//         [`rider_${order.riderId}`, `user_${order.customerId}`],
//         'order_status_update',
//         { 
//           orderId: order._id,
//           status: 'ready_for_pickup',
//           deliveryProgress: calculateDeliveryProgress('ready_for_pickup')
//         }
//       );
//       console.log("✅ ORDER.JS: Emitted ready for pickup UI updates");
//     }

//     // ✅ CREATE NOTIFICATIONS
//     console.log("🔔 ORDER.JS: Creating ready for pickup notifications...");
    
//     // Notify customer
//     await createNotification({
//       userId: order.customerId,
//       title: 'Order Ready for Pickup',
//       message: `Your order #${order.orderId} is ready for pickup`,
//       type: 'order',
//       data: {
//         orderId: order.orderId,
//         status: ' ',
//         type: 'status_update'
//       },
//       priority: 'high'
//     });
//     console.log("✅ ORDER.JS: Customer notification created");

//     // Notify riders
//     const riders = await require("../models/Rider").find({ isAvailable: true });
//     console.log("🏍️ ORDER.JS: Notifying", riders.length, "riders");
    
//     for (const rider of riders) {
//       await createNotification({
//         userId: rider._id,
//         title: 'Order Ready for Pickup',
//         message: `Order #${order.orderId} is ready for pickup at restaurant`,
//         type: 'delivery',
//         data: {
//           orderId: order.orderId,
//           restaurantId: order.restaurantId,
//           type: 'order_ready'
//         },
//         priority: 'high'
//       });
//     }
//     console.log("✅ ORDER.JS: All rider notifications created");

//     res.json({
//       success: true,
//       message: "Order marked ready for pickup",
//       data: order
//     });

//   } catch (err) { next(err); }
// });