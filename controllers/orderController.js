const mongoose = require("mongoose");
const Order = require("../models/Order");
const Cart = require("../models/Cart");

// Helper to query order by either custom orderId string or Mongo _id
const getOrderQuery = (id) => ({
  $or: [
    { orderId: id },
    ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : [])
  ]
});
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Customer = require("../models/Customer");
const RestaurantUser = require("../models/RestaurantUser");
const Admin = require("../models/Admin");
const Coupon = require("../models/Coupon");
const Rider = require("../models/Rider");
const catalogClient = require("../utils/catalogClient");
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

  if (orderObj.deliveryAddress?.coordinates) {
    custLat = orderObj.deliveryAddress.coordinates.lat ?? orderObj.deliveryAddress.coordinates.latitude;
    custLng = orderObj.deliveryAddress.coordinates.lng ?? orderObj.deliveryAddress.coordinates.longitude;
  }
  if (custLat === undefined && orderObj.deliveryAddress?.latitude !== undefined) {
    custLat = orderObj.deliveryAddress.latitude;
    custLng = orderObj.deliveryAddress.longitude;
  }
  if (custLat === undefined && orderObj.customerId?.addresses && orderObj.customerId.addresses.length > 0) {
    const primaryAddress = orderObj.customerId.addresses.find((a) => a.isDefault) || orderObj.customerId.addresses[0];
    custLat = primaryAddress.latitude;
    custLng = primaryAddress.longitude;
  }

  const addrLine = orderObj.deliveryAddress?.addressLine1 || '';
  const cityStr = orderObj.deliveryAddress?.city || '';
  custAddress = `${addrLine}${addrLine && cityStr ? ', ' : ''}${cityStr}` || 'Customer Location';

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

// ✅ Create Order (Decoupled via Catalog Microservice - TSK-104)
exports.createOrder = async (req, res, next) => {
  try {
    let {
      restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      specialInstructions,
      addressId,
      deliveryAddressId,
      transactionId,
      paymentId,
      paymentDetails,
    } = req.body;

    // 🛡️ Resolve deliveryAddress if passed as an ID (common in mobile/Flutter apps)
    if (!deliveryAddress && (addressId || deliveryAddressId)) {
      deliveryAddress = addressId || deliveryAddressId;
    }
    if (typeof deliveryAddress === "string" && mongoose.Types.ObjectId.isValid(deliveryAddress)) {
      let customerDoc = await Customer.findById(req.user._id);
      let matchedAddr = customerDoc?.addresses?.id(deliveryAddress);

      // 🛡️ Cross-DB Fallback: If address not yet in core food-delivery DB, fetch from Auth Service
      if (!matchedAddr) {
        try {
          const authUrl = `${(process.env.AUTH_SERVICE_URL || "https://zewito-auth-service.onrender.com").replace(/\/+$/, "")}/api/v1/auth/address`;
          const authRes = await fetch(authUrl, {
            headers: {
              Authorization: req.headers.authorization,
              "X-Internal-Secret": process.env.INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
            },
            signal: AbortSignal.timeout(4000),
          });
          if (authRes.ok) {
            const authData = await authRes.json();
            if (Array.isArray(authData?.addresses)) {
              matchedAddr = authData.addresses.find((a) => String(a._id) === String(deliveryAddress));
              if (matchedAddr && customerDoc) {
                Customer.findByIdAndUpdate(req.user._id, { $addToSet: { addresses: matchedAddr } }).catch(() => {});
              }
            }
          }
        } catch (e) {
          console.warn("[OrderController] Cross-service address resolution notice:", e.message);
        }
      }

      if (matchedAddr) {
        deliveryAddress = matchedAddr.toObject ? matchedAddr.toObject() : matchedAddr;
      }
    }

    if (!restaurantId || !deliveryAddress || !paymentMethod) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: restaurantId, deliveryAddress, paymentMethod",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid restaurantId format",
      });
    }

    // 🛡️ Normalise paymentMethod (case-insensitivity e.g. COD, Online, Razorpay)
    paymentMethod = String(paymentMethod).trim().toLowerCase();
    if (paymentMethod === "cash_on_delivery" || paymentMethod === "cash") {
      paymentMethod = "cod";
    } else if (paymentMethod === "razorpay") {
      paymentMethod = "online";
    }

    let cart = await Cart.findOne({ userId: req.user._id });
    if ((!cart || !cart.items || cart.items.length === 0) && catalogClient.getUserCart) {
      const remoteCart = await catalogClient.getUserCart(req.user._id).catch(() => null);
      if (remoteCart && Array.isArray(remoteCart.items) && remoteCart.items.length > 0) {
        cart = remoteCart;
      }
    }

    if (!items || items.length === 0) {
      if (!cart || !cart.items || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Cart is empty. Please add items to cart or provide items array.",
        });
      }

      items = cart.items.map((item) => ({
        menuItemId: item.menuItemId?._id || item.menuItemId || item.itemId || item._id,
        quantity: item.quantity,
        price: item.price,
        variant: item.variant,
        addons: item.addons,
        specialInstructions: item.specialInstructions,
      }));
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Items array cannot be empty" });
    }

    // ── 1. Authoritative Validation via Catalog Microservice ───────────────────
    const couponCode = req.body.couponCode || cart?.coupon?.code;
    const validationResult = await catalogClient.validateCart({
      restaurantId,
      items,
      couponCode,
    });

    if (!validationResult || !validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: validationResult?.message || "Cart validation failed",
        reason: validationResult?.reason,
        isRemote: validationResult?.isRemote ?? false,
      });
    }

    const {
      subtotal,
      discountApplied,
      verifiedItems,
      couponSnapshot,
      restaurantSnapshot,
    } = validationResult;

    // ── 2. Build Order Items from Immutable Snapshot ────────────────────────
    const orderItems = verifiedItems.map((v) => ({
      menuItemId: v.itemId,
      name: v.nameSnapshot,
      price: v.finalUnitTotal,
      quantity: v.quantity,
      variant: v.variantSnapshot,
      addons: v.modifierSnapshots,
      specialInstructions: v.specialInstructions || "",
      isVeg: v.isVeg,
      itemTotal: v.itemLineTotal,
    }));

    // ── 3. Calculate Totals ──────────────────────────────────────────────────
    const deliveryFee = restaurantSnapshot.deliveryFee || 0;
    const taxRate = restaurantSnapshot.taxRate !== undefined ? restaurantSnapshot.taxRate : 5;
    const tax = Math.round((subtotal * taxRate) / 100);
    const finalAmount = Math.max(0, subtotal + deliveryFee + tax - (discountApplied || 0));

    // ── 4. Apply Coupon Snapshot ─────────────────────────────────────────────
    let appliedCoupon = null;
    if (couponSnapshot && discountApplied > 0) {
      appliedCoupon = {
        code: couponSnapshot.code,
        discountAmount: discountApplied,
      };

      // Increment coupon usage in background
      if (couponSnapshot.couponId) {
        Coupon.findByIdAndUpdate(couponSnapshot.couponId, { $inc: { usedCount: 1 } }).catch((err) =>
          console.warn("Coupon usage increment notice:", err.message)
        );
      }
    }

    // ── 5. Delivery Route & Estimated Time ───────────────────────────────────
    const restAddress = restaurantSnapshot.address || {};
    const deliveryTime = Number(restaurantSnapshot.deliveryTime) || 30;
    const estimatedDelivery = new Date(Date.now() + deliveryTime * 60000);

    // 🛡️ Robust coordinate resolution for client payload (supports lat/lng, latitude/longitude, or top-level)
    const rawCustLat =
      deliveryAddress.coordinates?.lat ??
      deliveryAddress.coordinates?.latitude ??
      deliveryAddress.latitude;
    const rawCustLng =
      deliveryAddress.coordinates?.lng ??
      deliveryAddress.coordinates?.longitude ??
      deliveryAddress.longitude;

    const parsedCustLat =
      rawCustLat !== undefined && rawCustLat !== null && !isNaN(Number(rawCustLat))
        ? Number(rawCustLat)
        : 0;
    const parsedCustLng =
      rawCustLng !== undefined && rawCustLng !== null && !isNaN(Number(rawCustLng))
        ? Number(rawCustLng)
        : 0;

    const normalizedDeliveryAddress = {
      ...deliveryAddress,
      coordinates: {
        lat: parsedCustLat,
        lng: parsedCustLng,
      },
    };

    const route = {
      restaurantLocation: {
        lat: restAddress.geolocation?.latitude || restAddress.coordinates?.lat || 0,
        lng: restAddress.geolocation?.longitude || restAddress.coordinates?.lng || 0,
        address: restAddress.addressLine1 || `${restaurantSnapshot.nameSnapshot || ""}, ${restAddress.city || ""}`,
      },
      customerLocation: {
        lat: parsedCustLat,
        lng: parsedCustLng,
        address: `${deliveryAddress.addressLine1}, ${deliveryAddress.city || ""}`,
      },
      polyline: "",
    };

    // ── 6. Create Order in DB ────────────────────────────────────────────────
    const idempotencyKey =
      req.headers["x-idempotency-key"] ||
      req.headers["idempotency-key"] ||
      req.body?.idempotencyKey ||
      undefined;

    // 🛡️ Resolve Customer Real Name & Auto-Heal food-delivery.customers
    const resolvedCustName =
      (req.body.customerName && !req.body.customerName.startsWith("User_") ? req.body.customerName.trim() : null) ||
      (deliveryAddress.receiverName && !deliveryAddress.receiverName.startsWith("User_") ? deliveryAddress.receiverName.trim() : null) ||
      (deliveryAddress.name && !deliveryAddress.name.startsWith("User_") ? deliveryAddress.name.trim() : null) ||
      (req.user.name && !req.user.name.startsWith("User_") ? req.user.name.trim() : null);

    if (resolvedCustName) {
      Customer.findByIdAndUpdate(req.user._id, {
        $set: { name: resolvedCustName },
      }).catch(() => {});
    }

    // 🛡️ Block Payment Spoofing: Client-sent 'paid' is strictly rejected for online orders without verified gateway transaction
    let resolvedPaymentStatus = "pending";
    if (paymentMethod === "cod" || paymentMethod === "cash_on_delivery") {
      resolvedPaymentStatus = "pending";
    } else {
      // Online payment remains pending until webhook / gateway capture
      resolvedPaymentStatus = (transactionId || paymentId) ? "pending" : "pending";
    }

    const order = await Order.create({
      customerId: req.user._id,
      restaurantId,
      items: orderItems,
      subtotal,
      deliveryFee,
      tax,
      finalAmount,
      coupon: appliedCoupon,
      idempotencyKey,
      deliveryAddress: normalizedDeliveryAddress,
      route,
      paymentMethod,
      paymentStatus: resolvedPaymentStatus,
      transactionId: transactionId || paymentId || undefined,
      paymentDetails: paymentDetails || undefined,
      specialInstructions,
      status: "pending",
      estimatedDelivery,
      statusHistory: [{ status: "pending", timestamp: new Date(), updatedBy: req.user._id }],
    });

    // ── 7. Update Customer Schema with Order Reference & Spending Metrics ────
    await Customer.findByIdAndUpdate(req.user._id, {
      $push: { orders: order._id },
      $inc: {
        totalOrders: 1,
        totalSpent: finalAmount,
        loyaltyPoints: Math.floor(finalAmount / 100) * 10,
      },
    }).catch((err) => console.warn("Customer schema order update warning:", err.message));

    // ── 8. Clear User Cart (Local Core Platform + Distributed Catalog Service) ──
    await Cart.findOneAndUpdate(
      { userId: req.user._id },
      { items: [], totalAmount: 0, finalAmount: 0, restaurantId: null, coupon: null }
    );
    if (catalogClient.clearUserCart) {
      catalogClient.clearUserCart(req.user._id).catch((err) =>
        console.warn("[OrderController] Distributed Catalog clearCart notice:", err.message)
      );
    }

    const populatedOrder = await Order.findById(order._id)
      .populate("customerId", "name phone")
      .populate("restaurantId", "name address phone");

    const restaurantDisplayName = restaurantSnapshot.nameSnapshot || populatedOrder?.restaurantId?.name || "Restaurant";

    // ── 8. Real-time Socket Dispatch ────────────────────────────────────────
    const io = req.app.get("io");
    if (io) {
      const customerDisplayName =
        resolvedCustName ||
        populatedOrder?.customerId?.name ||
        deliveryAddress.receiverName ||
        deliveryAddress.name ||
        "Customer";

      const socketPayload = {
        orderId: order.orderId,
        _id: order._id,
        status: order.status,
        restaurantId: order.restaurantId,
        customerId: {
          _id: req.user._id,
          name: customerDisplayName,
          phone: req.user.phone || populatedOrder?.customerId?.phone || deliveryAddress.receiverPhone || "",
        },
        customerName: customerDisplayName,
        customerPhone: req.user.phone || populatedOrder?.customerId?.phone || deliveryAddress.receiverPhone || "",
        deliveryAddress: normalizedDeliveryAddress,
        items: orderItems,
        finalAmount: order.finalAmount,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        timestamp: new Date(),
      };

      // Emit BOTH order:new and new_order_received (for Restaurant Portal & KDS live alert)
      io.to(`restaurant_${restaurantId}`).emit("order:new", socketPayload);
      io.to(`restaurant_${restaurantId}`).emit("new_order_received", socketPayload);
      io.to("admins_room").emit("order:new", socketPayload);
      io.to("admins_room").emit("new_order_received", socketPayload);
    }

    // ── 9. Notifications ────────────────────────────────────────────────────
    await createRestaurantNotifications(restaurantId, {
      title: "New Order Received 📦",
      message: `You have received a new order #${order.orderId} - ₹${finalAmount}`,
      type: "order",
      data: {
        orderId: order.orderId,
        status: "pending",
        type: "new_order",
      },
      priority: "high",
    });

    await createNotification({
      userId: req.user._id,
      title: "Order Placed Successfully 🎉",
      message: `Your order #${order.orderId} has been placed at ${restaurantDisplayName}`,
      type: "order",
      data: {
        orderId: order.orderId,
        status: "pending",
        type: "order_placed",
      },
      priority: "medium",
    });

    const admins = await Admin.find({ isActive: true });
    for (const admin of admins) {
      await createNotification({
        userId: admin._id,
        title: "📦 New Order Placed",
        message: `New order #${order.orderId} from ${req.user.name} - ₹${finalAmount}`,
        type: "order",
        data: {
          orderId: order.orderId,
          customerId: req.user._id,
          restaurantId: restaurantId,
          type: "new_order_admin",
        },
        priority: "medium",
      });
    }

    const orderData = populatedOrder ? populatedOrder.toObject() : order.toObject();
    orderData.deliveryProgress = 10;
    const builtRoute = buildRoute(orderData);
    if (builtRoute) {
      orderData.route = builtRoute;
    }

    res.status(201).json({
      success: true,
      message: `Order placed successfully at ${restaurantDisplayName}`,
      data: orderData,
      summary: {
        subtotal,
        deliveryFee,
        tax,
        couponDiscount: discountApplied || 0,
        finalAmount,
        estimatedDelivery,
        orderId: order.orderId,
      },
    });
  } catch (err) {
    console.error("❌ Order error:", err);
    next(err);
  }
};

// Helper to robustly resolve restaurantId for restaurant role across schemas, JWT, and Catalog Service
async function resolveRestaurantIdForUser(user) {
  if (user.restaurantId) return user.restaurantId.toString();
  const restUser = await RestaurantUser.findById(user._id);
  if (restUser?.restaurantId) return restUser.restaurantId.toString();
  
  const restDoc = await Restaurant.findOne({
    $or: [{ ownerId: user._id }, { createdBy: user._id }],
  });
  if (restDoc?._id) return restDoc._id.toString();

  // Local phone matching fallback
  if (user.phone) {
    const rawPhone = String(user.phone).trim();
    const cleanPhone = rawPhone.replace(/^\+91/, '').trim();
    const phoneRest = await Restaurant.findOne({
      $or: [
        { "contact.phone": rawPhone },
        { "contact.phone": cleanPhone },
        { "contact.phone": `+91${cleanPhone}` },
      ],
    });
    if (phoneRest?._id) {
      RestaurantUser.findByIdAndUpdate(user._id, { $set: { restaurantId: phoneRest._id } }).catch(() => {});
      return phoneRest._id.toString();
    }
  }

  // Cross-service fallback: resolve from zewito-catalog-service (by ownerId, phone, or name) and cache locally
  const remoteRest = await catalogClient.getRestaurantByOwnerId(user._id, user.phone, user.businessName || user.name).catch(() => null);
  if (remoteRest?._id) {
    RestaurantUser.findByIdAndUpdate(
      user._id,
      { $set: { restaurantId: remoteRest._id, ...(remoteRest.name ? { businessName: remoteRest.name } : {}) } }
    ).catch(() => {});

    // Self-healing JIT projection: cache Restaurant stub locally so future .populate() works
    Restaurant.findByIdAndUpdate(
      remoteRest._id,
      {
        $set: {
          name: remoteRest.name || "Restaurant",
          ...(remoteRest.contact ? { contact: remoteRest.contact } : {}),
          ...(remoteRest.address ? { address: remoteRest.address } : {}),
          ...(remoteRest.images ? { images: remoteRest.images } : {}),
          ...(remoteRest.cuisine ? { cuisine: remoteRest.cuisine } : {}),
          isOpen: typeof remoteRest.isOpen === "boolean" ? remoteRest.isOpen : true,
          isActive: typeof remoteRest.isActive === "boolean" ? remoteRest.isActive : true,
        },
        $setOnInsert: {
          ownerId: user._id,
          createdBy: user._id,
        },
      },
      { upsert: true, runValidators: false }
    ).catch(() => {});

    return remoteRest._id.toString();
  }
  return null;
}

// ✅ Get My Orders
exports.getMyOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;
    let filter = {};

    if (req.user.role === 'customer') filter.customerId = req.user._id;
    else if (req.user.role === 'restaurant') {
      const resolvedResId = await resolveRestaurantIdForUser(req.user);
      if (!resolvedResId) return res.status(404).json({ success: false, error: "Restaurant not found for this partner account" });
      filter.restaurantId = resolvedResId;
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

      // Defensive fallbacks for cross-database populated fields
      if (!orderObj.restaurantId) {
        const rawResId = order.get ? order.get("restaurantId") : order.restaurantId;
        orderObj.restaurantId = {
          _id: rawResId,
          name: orderObj.route?.restaurantLocation?.address || "Restaurant",
          address: { addressLine1: orderObj.route?.restaurantLocation?.address || "" },
          images: [],
          contact: {},
        };
      }

      const deliveryReceiver =
        orderObj.deliveryAddress?.receiverName ||
        orderObj.deliveryAddress?.name;

      if (!orderObj.customerId) {
        const rawCustId = order.get ? order.get("customerId") : order.customerId;
        orderObj.customerId = {
          _id: rawCustId,
          name: (deliveryReceiver && !deliveryReceiver.startsWith("User_")) ? deliveryReceiver : "Customer",
          phone: orderObj.deliveryAddress?.receiverPhone || "",
        };
      } else if (!orderObj.customerId.name || orderObj.customerId.name.startsWith("User_")) {
        // 🛡️ Auto-Heal: Replace placeholder User_xxxx with customer's real name from deliveryAddress
        if (deliveryReceiver && !deliveryReceiver.startsWith("User_")) {
          orderObj.customerId.name = deliveryReceiver;
        }
      }

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

      // 🛡️ Auto-Heal: Replace placeholder User_xxxx with customer's real name from deliveryAddress
    const singleDeliveryReceiver =
      orderObj.deliveryAddress?.receiverName ||
      orderObj.deliveryAddress?.name;

    if (!orderObj.customerId) {
      orderObj.customerId = {
        _id: order.customerId,
        name: (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) ? singleDeliveryReceiver : "Customer",
        phone: orderObj.deliveryAddress?.receiverPhone || "",
      };
    } else if (!orderObj.customerId.name || orderObj.customerId.name.startsWith("User_")) {
      if (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) {
        orderObj.customerId.name = singleDeliveryReceiver;
      }
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
    const order = await Order.findOne(getOrderQuery(orderId))
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates openingHours')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category isVeg');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (req.user.role === 'customer') {
      const orderCustId = (order.customerId?._id || order.customerId)?.toString();
      if (!orderCustId || orderCustId !== req.user._id.toString())
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (req.user.role === 'restaurant') {
      const resolvedResId = await resolveRestaurantIdForUser(req.user);
      const orderResId = (order.restaurantId?._id || order.restaurantId)?.toString();
      if (!resolvedResId || !orderResId || orderResId !== resolvedResId)
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (req.user.role === 'rider') {
      const orderRiderId = (order.riderId?._id || order.riderId)?.toString();
      if (!orderRiderId || orderRiderId !== req.user._id.toString())
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

    // 🛡️ Auto-Heal: Replace placeholder User_xxxx with customer's real name from deliveryAddress
    const singleDeliveryReceiver =
      orderObj.deliveryAddress?.receiverName ||
      orderObj.deliveryAddress?.name;

    if (!orderObj.customerId) {
      orderObj.customerId = {
        _id: order.customerId,
        name: (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) ? singleDeliveryReceiver : "Customer",
        phone: orderObj.deliveryAddress?.receiverPhone || "",
      };
    } else if (!orderObj.customerId.name || orderObj.customerId.name.startsWith("User_")) {
      if (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) {
        orderObj.customerId.name = singleDeliveryReceiver;
      }
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

    const order = await Order.findOne(getOrderQuery(orderId))
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation');

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    if (req.user.role === 'restaurant') {
      const resolvedResId = await resolveRestaurantIdForUser(req.user);
      const orderResId = (order.restaurantId?._id || order.restaurantId)?.toString();
      if (!resolvedResId || !orderResId || orderResId !== resolvedResId) {
        return res.status(403).json({ success: false, error: "Not allowed" });
      }
    }

    if (req.user.role === 'rider') {
      const orderRiderId = (order.riderId?._id || order.riderId)?.toString();
      if (!orderRiderId || orderRiderId !== req.user._id.toString()) {
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

    // 🛵 Sync rider status when order reaches terminal state (delivered or cancelled)
    if (order.riderId && (status === 'delivered' || status === 'cancelled')) {
      const riderMongoId = (order.riderId?._id || order.riderId);
      await Rider.findByIdAndUpdate(riderMongoId, {
        $set: { isAvailable: true, currentOrder: null },
        $inc: {
          totalDeliveries: 1,
          completedDeliveries: status === 'delivered' ? 1 : 0,
          cancelledDeliveries: status === 'cancelled' ? 1 : 0
        }
      }).catch(err => console.error("Error updating rider status on order complete/cancel:", err));
    }

    const updatedOrder = await Order.findById(order._id)
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category');

    const orderObj = updatedOrder.toObject();
    // 🛡️ Auto-Heal: Replace placeholder User_xxxx with customer's real name from deliveryAddress
    const singleDeliveryReceiver =
      orderObj.deliveryAddress?.receiverName ||
      orderObj.deliveryAddress?.name;

    if (!orderObj.customerId) {
      orderObj.customerId = {
        _id: order.customerId,
        name: (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) ? singleDeliveryReceiver : "Customer",
        phone: orderObj.deliveryAddress?.receiverPhone || "",
      };
    } else if (!orderObj.customerId.name || orderObj.customerId.name.startsWith("User_")) {
      if (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) {
        orderObj.customerId.name = singleDeliveryReceiver;
      }
    }

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

      const custRoomId = (updatedOrder.customerId?._id || updatedOrder.customerId)?.toString();
      const restRoomId = (updatedOrder.restaurantId?._id || updatedOrder.restaurantId)?.toString();
      const riderRoomId = updatedOrder.riderId ? (updatedOrder.riderId?._id || updatedOrder.riderId)?.toString() : null;

      io.to(`order_${updatedOrder.orderId}`).emit("order_status_changed", payload);
      if (custRoomId) io.to(`user_${custRoomId}`).emit("order_status_changed", payload);
      if (restRoomId) io.to(`restaurant_${restRoomId}`).emit("order_status_changed", payload);

      if (riderRoomId) {
        io.to(`rider_${riderRoomId}`).emit("order_status_changed", payload);
      }

      if (status === 'ready_for_pickup') {
        io.to("riders_room").emit("ready_for_pickup", payload);
        io.to("riders_room").emit("order_status_changed", payload);
      }

      if (status === 'delivered') {
        io.to(`order_${updatedOrder.orderId}`).emit("order_status_changed", payload);
        if (custRoomId) {
          io.to(`user_${custRoomId}`).emit("order_status_changed", payload);

          if (updatedOrder.paymentMethod === 'cod') {
            io.to(`user_${custRoomId}`).emit("ui_payment_update", {
              orderId: updatedOrder.orderId,
              paymentStatus: "paid"
            });
          }
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
    const order = await Order.findOne(getOrderQuery(orderId)).populate('customerId');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const custId = (order.customerId?._id || order.customerId)?.toString();
    if (!custId || custId !== req.user._id.toString())
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

    // 🛵 Release assigned rider if order is cancelled
    if (order.riderId) {
      const riderMongoId = (order.riderId?._id || order.riderId);
      await Rider.findByIdAndUpdate(riderMongoId, {
        $set: { isAvailable: true, currentOrder: null },
        $inc: { cancelledDeliveries: 1 }
      }).catch(err => console.error("Error releasing rider on order cancellation:", err));
    }
    if (io) {
      const cancelPayload = {
        orderId: order.orderId,
        _id: order._id,
        status: 'cancelled',
        deliveryProgress: 0,
        timestamp: new Date()
      };

      const cancelRooms = [
        `order_${order.orderId}`,
        `user_${(order.customerId?._id || order.customerId)?.toString()}`,
        `restaurant_${(order.restaurantId?._id || order.restaurantId)?.toString()}`,
        ...(order.riderId ? [`rider_${(order.riderId?._id || order.riderId)?.toString()}`] : [])
      ];

      // Emit global order_status_changed so customer tracking screen updates instantly
      emitSocket(io, cancelRooms, 'order_status_changed', cancelPayload);
      emitSocket(io, cancelRooms, 'order_status_update', cancelPayload);
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

    if (!riderId || !mongoose.Types.ObjectId.isValid(riderId)) {
      return res.status(400).json({ success: false, error: "Valid riderId is required" });
    }

    const order = await Order.findOne(getOrderQuery(orderId));
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const resolvedResId = await resolveRestaurantIdForUser(req.user);
    if (!resolvedResId || order.restaurantId.toString() !== resolvedResId)
      return res.status(403).json({ success: false, error: "Not allowed" });

    if (['delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ success: false, error: "Cannot assign rider to a delivered or cancelled order" });
    }

    // Atomically claim rider availability to prevent double-assignment race conditions
    const rider = await Rider.findOneAndUpdate(
      { _id: riderId, isAvailable: true },
      { $set: { isAvailable: false, currentOrder: order._id } },
      { new: true }
    );
    if (!rider) {
      return res.status(400).json({ success: false, error: "Rider not available or currently on another delivery" });
    }

    // Free previously assigned rider if reassigned
    if (order.riderId && order.riderId.toString() !== riderId.toString()) {
      await Rider.findByIdAndUpdate(order.riderId, {
        $set: { isAvailable: true, currentOrder: null }
      }).catch(() => {});
    }

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
      const payload = {
        orderId: order.orderId,
        orderMongoId: order._id,
        status: 'assigned_to_rider',
        deliveryProgress: calculateDeliveryProgress('assigned_to_rider'),
        rider: {
          id: rider._id,
          name: rider.name,
          phone: rider.phone,
          vehicleType: rider.vehicleType,
          vehicleNo: rider.vehicleNo
        },
        customerId: order.customerId,
        restaurantId: order.restaurantId,
        timestamp: new Date()
      };

      io.to(`order_${order.orderId}`).emit('order_status_changed', payload);
      io.to(`user_${order.customerId}`).emit('order_status_changed', payload);
      io.to(`restaurant_${order.restaurantId}`).emit('order_status_changed', payload);
      io.to(`rider_${riderId}`).emit('order_status_changed', payload);

      emitSocket(io,
        [`rider_${riderId}`, `user_${order.customerId}`],
        'ui_order_status_update',
        payload
      );

      io.to('riders_room').emit('order_accepted', {
        orderId: order.orderId,
        acceptedBy: rider.name,
        timestamp: new Date()
      });
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
    const order = await Order.findOne(getOrderQuery(orderId))
      .populate('customerId', 'name phone addresses')
      .populate('restaurantId', 'name address contact images coordinates')
      .populate('riderId', 'name phone vehicleNo vehicleType currentLocation')
      .populate('items.menuItemId', 'name images category isVeg');

    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    if (req.user.role === 'customer') {
      const orderCustId = (order.customerId?._id || order.customerId)?.toString();
      if (!orderCustId || orderCustId !== req.user._id.toString())
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (req.user.role === 'restaurant') {
      const resolvedResId = await resolveRestaurantIdForUser(req.user);
      const orderResId = (order.restaurantId?._id || order.restaurantId)?.toString();
      if (!resolvedResId || !orderResId || orderResId !== resolvedResId)
        return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (req.user.role === 'rider') {
      const orderRiderId = (order.riderId?._id || order.riderId)?.toString();
      if (!orderRiderId || orderRiderId !== req.user._id.toString())
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

    // 🛡️ Auto-Heal: Replace placeholder User_xxxx with customer's real name from deliveryAddress
    const singleDeliveryReceiver =
      orderObj.deliveryAddress?.receiverName ||
      orderObj.deliveryAddress?.name;

    if (!orderObj.customerId) {
      orderObj.customerId = {
        _id: order.customerId,
        name: (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) ? singleDeliveryReceiver : "Customer",
        phone: orderObj.deliveryAddress?.receiverPhone || "",
      };
    } else if (!orderObj.customerId.name || orderObj.customerId.name.startsWith("User_")) {
      if (singleDeliveryReceiver && !singleDeliveryReceiver.startsWith("User_")) {
        orderObj.customerId.name = singleDeliveryReceiver;
      }
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
      const locationPayload = {
        orderId: order.orderId,
        riderId: req.user._id,
        currentLocation: { lat, lng, address },
        lat,
        lng,
        address,
        location: { lat, lng, address },
        timestamp: new Date()
      };

      const rooms = [
        `order_${order.orderId}`,
        `user_${order.customerId}`,
        `restaurant_${order.restaurantId}`
      ];

      // Broadcast to customer live map tracking room
      emitSocket(io, rooms, 'rider_location_changed', locationPayload);
      emitSocket(io, rooms, 'rider_location_update', locationPayload);
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

    const order = await Order.findOne(getOrderQuery(orderId)).populate('customerId');
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });

    const custId = (order.customerId?._id || order.customerId)?.toString();
    if (!custId || custId !== req.user._id.toString())
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
      catalogClient.syncRestaurantReview(order.restaurantId, {
        customerId: order.customerId._id || order.customerId,
        orderId: order.orderId,
        rating: restaurantRating,
        review: restaurantReview || "",
      }).catch(() => {});

      const restaurant = await Restaurant.findById(order.restaurantId);
      if (restaurant) {
        restaurant.rating = restaurant.rating || { average: 0, count: 0, reviews: [] };
        const currentCount = restaurant.rating.count || 0;
        const currentAvg = restaurant.rating.average || 0;
        const newCount = currentCount + 1;
        const newAvg = (currentAvg * currentCount + restaurantRating) / newCount;
        restaurant.rating.count = newCount;
        restaurant.rating.average = Math.round(newAvg * 10) / 10;
        if (restaurantReview) {
          restaurant.rating.reviews.push({
            customerId: order.customerId._id || order.customerId,
            orderId: order.orderId,
            rating: restaurantRating,
            review: restaurantReview,
            createdAt: new Date()
          });
        }
        await restaurant.save();
      }
    }

    if (riderRating && order.riderId) {
      const rider = await Rider.findById(order.riderId);
      if (rider) {
        const currentCount = rider.totalRatings || 0;
        const currentAvg = rider.averageRating || 0;
        const newCount = currentCount + 1;
        const newAvg = (currentAvg * currentCount + riderRating) / newCount;
        rider.totalRatings = newCount;
        rider.averageRating = Math.round(newAvg * 10) / 10;
        rider.ratings = rider.ratings || [];
        rider.ratings.push({
          customerId: order.customerId._id || order.customerId,
          orderId: order.orderId,
          rating: riderRating,
          feedback: riderReview,
          createdAt: new Date()
        });
        await rider.save();
      }
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

    // 🛡️ Sync review into Customer Schema
    await Customer.findByIdAndUpdate(req.user._id, {
      $push: {
        reviews: {
          orderId: order.orderId,
          restaurantId: order.restaurantId,
          riderId: order.riderId,
          rating: restaurantRating || riderRating || 5,
          review: restaurantReview || riderReview || "",
          createdAt: new Date(),
        },
      },
    }).catch(() => {});

    res.json({
      success: true,
      message: "Review submitted successfully",
      data: order
    });
  } catch (err) {
    next(err);
  }
};
