const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Customer = require("../models/Customer");
const RestaurantUser = require("../models/RestaurantUser");
const Admin = require("../models/Admin");
const Coupon = require("../models/Coupon");
const Rider = require("../models/Rider");
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

// Enhanced helper function to build route with proper coordinates
function buildRoute(orderObj) {
  if (!orderObj.restaurantId || !orderObj.deliveryAddress) {
    return null;
  }

  let restLat, restLng, restAddress;

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

  restAddress = orderObj.restaurantId.address?.addressLine1 ||
    `${orderObj.restaurantId.name}, ${orderObj.restaurantId.address?.city || ''}`;

  let custLat, custLng, custAddress;

  if (orderObj.deliveryAddress.coordinates) {
    custLat = orderObj.deliveryAddress.coordinates.lat;
    custLng = orderObj.deliveryAddress.coordinates.lng;
  } else if (orderObj.customerId?.addresses && orderObj.customerId.addresses.length > 0) {
    const primaryAddress = orderObj.customerId.addresses[0];
    custLat = primaryAddress.latitude;
    custLng = primaryAddress.longitude;
  }

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

// ✅ Create Order
exports.createOrder = async (req, res, next) => {
  try {
    let { restaurantId, items, deliveryAddress, paymentMethod, specialInstructions } = req.body;

    if (!restaurantId || !deliveryAddress || !paymentMethod)
      return res.status(400).json({ success: false, error: "Missing required fields: restaurantId, deliveryAddress, paymentMethod" });

    const cart = await Cart.findOne({ userId: req.user._id });
    
    if (!items || items.length === 0) {
      if (!cart || cart.items.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: "Cart is empty. Please add items to cart or provide items array." 
        });
      }
      
      items = cart.items.map(item => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: item.price,
        variant: item.variant,
        addons: item.addons,
        specialInstructions: item.specialInstructions
      }));
    }

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ success: false, error: "Items array cannot be empty" });

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant)
      return res.status(404).json({ success: false, error: "Restaurant not found" });

    if (!restaurant.isOpen)
      return res.status(400).json({ success: false, error: "Restaurant is closed" });

    // 🔥 PRICE CALCULATION (SECURE)
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

      // Secure price lookup from database
      let dbPrice = menuItem.discountedPrice || menuItem.price;
      let secureVariant = undefined;
      const secureAddons = [];

      // Validate Variant price
      if (item.variant && item.variant.name) {
        const dbVariant = menuItem.variants.find(v => v.name === item.variant.name);
        if (dbVariant) {
          dbPrice = dbVariant.price;
          secureVariant = {
            name: dbVariant.name,
            price: dbVariant.price
          };
        }
      }

      // Validate Addons price
      if (item.addons && item.addons.length) {
        let addonPriceSum = 0;
        for (const a of item.addons) {
          let foundAddonItem = null;
          for (const group of menuItem.addonGroups) {
            const match = group.items.find(groupItem => groupItem.name === a.name);
            if (match) {
              foundAddonItem = match;
              break;
            }
          }
          if (foundAddonItem) {
            addonPriceSum += foundAddonItem.price;
            secureAddons.push({
              name: foundAddonItem.name,
              price: foundAddonItem.price
            });
          }
        }
        dbPrice += addonPriceSum;
      }

      const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
      const itemTotal = dbPrice * quantity;
      subtotal += itemTotal;

      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        price: dbPrice,
        quantity,
        variant: secureVariant,
        addons: secureAddons,
        specialInstructions: item.specialInstructions || "",
        isVeg: menuItem.isVeg,
        itemTotal
      });
    }

    if (subtotal < (restaurant.minOrderAmount || 0))
      return res.status(400).json({
        success: false,
        error: `Minimum order ₹${restaurant.minOrderAmount}. Your subtotal ₹${subtotal}`
      });

    const deliveryFee = restaurant.deliveryFee || 0;
    const taxRate = restaurant.taxRate !== undefined ? restaurant.taxRate : 5;
    const tax = Math.round((subtotal * taxRate) / 100);
    let finalAmount = subtotal + deliveryFee + tax;

    // 🎫 COUPON VALIDATION & APPLY (CRITICAL FIX)
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
        errorMessage = "Coupon is invalid or expired";
      } else if (subtotal < coupon.minOrderAmount) {
        isCouponValid = false;
        errorMessage = `Coupon requires minimum order of ₹${coupon.minOrderAmount}`;
      } else if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
        isCouponValid = false;
        errorMessage = "Coupon usage limit reached";
      }
      
      if (isCouponValid) {
        if (coupon.discountType === "percentage") {
          couponDiscountAmount = (subtotal * coupon.discountValue) / 100;
          if (coupon.maxDiscount) {
            couponDiscountAmount = Math.min(couponDiscountAmount, coupon.maxDiscount);
          }
        } else {
          couponDiscountAmount = Math.min(coupon.discountValue, subtotal);
        }
        
        finalAmount = Math.max(0, finalAmount - couponDiscountAmount);
        appliedCoupon = {
          code: coupon.code,
          discountAmount: couponDiscountAmount
        };
        
        coupon.usedCount += 1;
        await coupon.save();
        console.log(`✅ Coupon applied successfully! Discount: ₹${couponDiscountAmount}`);
      } else {
        console.log(`⚠️ Coupon rejected: ${errorMessage}`);
      }
    }

    const deliveryTime = Number(restaurant.deliveryTime) || 30;
    const estimatedDelivery = new Date(Date.now() + deliveryTime * 60000);

    const route = {
      restaurantLocation: {
        lat: restaurant.address?.geolocation?.latitude || restaurant.coordinates?.lat,
        lng: restaurant.address?.geolocation?.longitude || restaurant.coordinates?.lng,
        address: restaurant.address?.addressLine1 || `${restaurant.name}, ${restaurant.address?.city || ''}`
      },
      customerLocation: {
        lat: deliveryAddress.coordinates?.lat || deliveryAddress.latitude,
        lng: deliveryAddress.coordinates?.lng || deliveryAddress.longitude,
        address: `${deliveryAddress.addressLine1}, ${deliveryAddress.city}`
      },
      polyline: ''
    };

    const order = await Order.create({
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
      statusHistory: [{ status: 'pending', timestamp: new Date(), updatedBy: req.user._id }]
    });

    await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { items: [], totalAmount: 0, finalAmount: 0, restaurantId: null, coupon: null }
    );

    const populatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone')
      .populate('restaurantId', 'name address phone');

    // SOCKET EMIT
    const io = req.app.get('io');
    if (io) {
      const socketPayload = {
        orderId: order.orderId,
        status: order.status,
        restaurantId: order.restaurantId,
        customerId: order.customerId,
        finalAmount: order.finalAmount,
        timestamp: new Date()
      };
      
      io.to(`restaurant_${restaurantId}`).emit("order:new", socketPayload);
      io.to("admins_room").emit("order:new", socketPayload);
    }

    // NOTIFICATIONS
    await createRestaurantNotifications(restaurantId, {
      title: 'New Order Received 📦',
      message: `You have received a new order #${order.orderId} - ₹${finalAmount}`,
      type: 'order',
      data: {
        orderId: order.orderId,
        status: 'pending',
        type: 'new_order'
      },
      priority: 'high'
    });

    await createNotification({
      userId: req.user._id,
      title: 'Order Placed Successfully 🎉',
      message: `Your order #${order.orderId} has been placed at ${restaurant.name}`,
      type: 'order',
      data: {
        orderId: order.orderId,
        status: 'pending',
        type: 'order_placed'
      },
      priority: 'medium'
    });

    const admins = await Admin.find({ isActive: true });
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
};

// ✅ Get My Orders
exports.getMyOrders = async (req, res, next) => {
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

    const ordersWithRoute = orders.map(order => {
      const orderObj = order.toObject();
      const route = buildRoute(orderObj);
      if (route) {
        orderObj.route = route;
      }

      if (orderObj.riderLocation) {
        orderObj.currentRiderLocation = {
          lat: orderObj.riderLocation.lat,
          lng: orderObj.riderLocation.lng,
          address: orderObj.riderLocation.address,
          updatedAt: orderObj.riderLocation.updatedAt
        };
      }

      orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);
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
  } catch (err) {
    next(err);
  }
};

// ✅ Get Single Order
exports.getOrderById = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId })
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates openingHours')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category isVeg');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

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

    const orderObj = order.toObject();
    const route = buildRoute(orderObj);
    if (route) {
      orderObj.route = route;
    }

    if (orderObj.riderLocation) {
      orderObj.currentRiderLocation = {
        lat: orderObj.riderLocation.lat,
        lng: orderObj.riderLocation.lng,
        address: orderObj.riderLocation.address,
        updatedAt: orderObj.riderLocation.updatedAt
      };
    }

    orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);
    res.json({ success: true, data: orderObj });
  } catch (err) {
    next(err);
  }
};

// ✅ Update Order Status
exports.updateOrderStatus = async (req, res, next) => {
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

    order.status = status;

    const statusUpdate = {
      status,
      timestamp: new Date(),
      updatedBy: req.user._id,
      ...(location && { location }),
      ...(note && { note })
    };

    order.statusHistory.push(statusUpdate);
    order.deliveryInfo = order.deliveryInfo || {};

    if (status === 'ready_for_pickup')
      order.deliveryInfo.readyAt = new Date();

    if (status === 'picked_up')
      order.deliveryInfo.pickedUpAt = new Date();

    if (status === 'assigned_to_rider')
      order.deliveryInfo.assignedAt = new Date();

    if (status === 'cancelled')
      order.cancelledAt = new Date();

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

    const updatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category');

    const orderObj = updatedOrder.toObject();
    orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);

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

      io.to(`order_${updatedOrder.orderId}`).emit("order_status_changed", payload);
      io.to(`user_${updatedOrder.customerId._id}`).emit("order_status_changed", payload);
      io.to(`restaurant_${updatedOrder.restaurantId._id}`).emit("order_status_changed", payload);

      if (updatedOrder.riderId) {
        io.to(`rider_${updatedOrder.riderId._id}`).emit("order_status_changed", payload);
      }

      if (status === 'ready_for_pickup') {
        io.to("riders_room").emit("ready_for_pickup", payload);
        io.to("riders_room").emit("order_status_changed", payload);
      }

      if (status === 'delivered') {
        io.to(`order_${updatedOrder.orderId}`).emit("order_status_changed", payload);
        io.to(`user_${updatedOrder.customerId._id}`).emit("order_status_changed", payload);

        if (updatedOrder.paymentMethod === 'cod') {
          io.to(`user_${updatedOrder.customerId._id}`).emit("ui_payment_update", {
            orderId: updatedOrder.orderId,
            paymentStatus: "paid"
          });
        }
      }
    }

    if (status === 'ready_for_pickup') {
      await createNotification({
        userId: updatedOrder.customerId._id,
        title: 'Order Ready for Pickup',
        message: `Order #${updatedOrder.orderId} is ready for pickup`,
        type: 'order',
        data: { orderId: updatedOrder.orderId, event: 'ready_for_pickup' },
        priority: 'high'
      });

      const riders = await Rider.find({ isAvailable: true });
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
};

// ✅ Cancel Order
exports.cancelOrder = async (req, res, next) => {
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

    const io = req.app.get('io');
    if (io) {
      emitSocket(io, [
        `restaurant_${order.restaurantId.toString()}`,
        ...(order.riderId ? [`rider_${order.riderId.toString()}`] : [])
      ], 'order_status_update', {
        orderId: order._id,
        status: 'cancelled',
        deliveryProgress: 0
      });
    }

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
    }

    res.json({
      success: true,
      message: "Order cancelled",
      data: order
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Assign Rider
exports.assignRider = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { riderId } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const restUser = await RestaurantUser.findById(req.user._id);
    if (!restUser || restUser.restaurantId.toString() !== order.restaurantId.toString())
      return res.status(403).json({ success: false, error: "Not allowed" });

    const rider = await Rider.findById(riderId);
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

    const io = req.app.get('io');
    if (io) {
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
    }

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

    res.json({
      success: true,
      message: "Rider assigned",
      data: order
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Track Order
exports.trackOrder = async (req, res, next) => {
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

    const orderObj = order.toObject();
    const route = buildRoute(orderObj);
    if (route) {
      orderObj.route = route;
    }

    if (orderObj.riderLocation) {
      orderObj.currentRiderLocation = {
        lat: orderObj.riderLocation.lat,
        lng: orderObj.riderLocation.lng,
        address: orderObj.riderLocation.address,
        updatedAt: orderObj.riderLocation.updatedAt
      };
    }

    orderObj.deliveryProgress = calculateDeliveryProgress(orderObj.status);

    res.json({
      success: true,
      message: "Order found",
      data: orderObj
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Update Rider Location
exports.updateRiderLocation = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { lat, lng, address } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (!order.riderId || order.riderId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not authorized" });

    order.riderLocation = {
      lat,
      lng,
      address,
      updatedAt: new Date()
    };

    await order.save();

    const io = req.app.get('io');
    if (io) {
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
    }

    await createNotification({
      userId: order.customerId,
      title: 'Rider Location Updated',
      message: `Rider is on the way with your order #${order.orderId}`,
      type: 'delivery',
      data: { orderId: order.orderId, location: { lat, lng }, type: 'rider_location' },
      priority: 'low'
    });

    res.json({
      success: true,
      message: "Rider location updated",
      data: order.riderLocation
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Add Order Review
exports.addOrderReview = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { restaurantRating, restaurantReview, riderRating, riderReview } = req.body;

    const order = await Order.findOne({ orderId }).populate('customerId');
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (order.customerId._id.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, error: "Not authorized" });

    if (order.status !== 'delivered')
      return res.status(400).json({ success: false, error: "Can only review delivered orders" });

    if (restaurantRating !== undefined) {
      order.restaurantRating = restaurantRating;
      order.restaurantReview = restaurantReview;
    }

    if (riderRating !== undefined && order.riderId) {
      order.riderRating = riderRating;
      order.riderReview = riderReview;
    }

    await order.save();

    if (restaurantRating) {
      await Restaurant.findByIdAndUpdate(order.restaurantId, {
        $inc: {
          'rating.totalRatings': 1,
          'rating.totalScore': restaurantRating
        }
      });
    }

    if (riderRating && order.riderId) {
      await Rider.findByIdAndUpdate(order.riderId, {
        $inc: {
          totalRatings: 1,
          averageRating: riderRating
        }
      });
    }

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
    }

    res.json({
      success: true,
      message: "Review submitted successfully",
      data: order
    });
  } catch (err) {
    next(err);
  }
};
