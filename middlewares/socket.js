const { Server } = require("socket.io");
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, ALLOWLIST, REDIS_URL } = require('../config/config');
const Admin = require('../models/Admin');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Rider = require('../models/Rider');
const RestaurantUser = require('../models/RestaurantUser');
const Order = require('../models/Order');
const Restaurant = require("../models/Restaurant");
const Notification = require("../models/Notification");
const { createNotification, createRestaurantNotifications } = require('../utils/notificationHelper');
const {
    recordRiderLocation,
    shouldPersistToDb,
    forcePersistDb,
    shouldNotifyCustomer,
    getCachedOrderTracking,
    setupTrackingSubscriber,
} = require('../utils/redisTracking');

function initializeSocket(server) {
    const io = new Server(server, {
        cors: {
            origin: ALLOWLIST,
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
            credentials: true
        },
        transports: ['websocket', 'polling'],
        allowEIO3: true, // ✅ IMPORTANT: Allow Engine.IO v3
        cookie: false, // ✅ Disable cookies if not needed
        connectTimeout: 30000, // ✅ Increase timeout
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // ── Redis Adapter for Horizontal Multi-Instance Scalability (TSK-201) ─────
    if (REDIS_URL && REDIS_URL.trim() !== "") {
        try {
            const { createAdapter } = require("@socket.io/redis-adapter");
            const Redis = require("ioredis");

            let hasLoggedNotice = false;
            const redisOptions = {
                maxRetriesPerRequest: 1,
                enableReadyCheck: true,
                lazyConnect: true,
                connectTimeout: 3000,
                retryStrategy: (times) => {
                    if (times > 2) {
                        if (!hasLoggedNotice) {
                            hasLoggedNotice = true;
                            console.warn("ℹ️ [Redis Socket.io] Redis server offline. Operating in default single-node in-memory mode.");
                        }
                        return null; // Stop infinite reconnect loop
                    }
                    return 1000;
                }
            };

            const pubClient = new Redis(REDIS_URL, redisOptions);
            const subClient = pubClient.duplicate();

            pubClient.on("ready", () => {
                console.log("✅ [Redis Socket.io] Pub client connected & ready");
            });
            pubClient.on("error", (err) => {
                if (!hasLoggedNotice) {
                    hasLoggedNotice = true;
                    console.warn("ℹ️ [Redis Socket.io] Redis connection notice:", err.message || "Offline");
                }
            });

            subClient.on("ready", () => {
                console.log("✅ [Redis Socket.io] Sub client connected & ready");
            });
            subClient.on("error", (err) => {
                if (!hasLoggedNotice) {
                    hasLoggedNotice = true;
                    console.warn("ℹ️ [Redis Socket.io] Redis connection notice:", err.message || "Offline");
                }
            });

            Promise.all([pubClient.connect(), subClient.connect()])
                .then(() => {
                    io.adapter(createAdapter(pubClient, subClient));
                    console.log("🚀 [Socket.io] Mounted Redis Pub/Sub adapter (Multi-instance scalability active)");
                })
                .catch((err) => {
                    if (!hasLoggedNotice) {
                        hasLoggedNotice = true;
                        console.warn("ℹ️ [Redis Socket.io] Redis offline. Operating in default single-node in-memory mode.");
                    }
                });
        } catch (adapterErr) {
            console.warn("ℹ️ [Socket.io] Default in-memory adapter active:", adapterErr.message);
        }
    } else {
        console.log("ℹ️ [Socket.io] REDIS_URL not configured. Running with default in-memory adapter (single-node).");
    }

    // ── Setup Cross-Service Redis Pub/Sub Tracking Subscriber ──────────────────
    setupTrackingSubscriber(io);

    // Store connected users by role
    const connectedUsers = {
        customers: new Map(),
        riders: new Map(),
        restaurants: new Map(),
        admins: new Map()
    };

    // Grace period timer map for transient network disconnects (elevators, tunnels)
    const pendingRiderDisconnects = new Map();

    // ✅ Helper functions: Dual support for custom orderId string and Mongo ObjectId
    const findOrderById = async (orderId) => {
        if (!orderId) return null;
        const query = {
            $or: [
                { orderId: String(orderId) },
                ...(mongoose.Types.ObjectId.isValid(orderId) ? [{ _id: orderId }] : [])
            ]
        };
        return await Order.findOne(query)
            .populate('customerId', 'name phone')
            .populate('riderId', 'name phone vehicleType')
            .populate('restaurantId', 'name address phone');
    };

    const getSocketByUserId = (userId) => {
        for (const [role, userMap] of Object.entries(connectedUsers)) {
            const socketId = userMap.get(userId.toString());
            if (socketId) {
                return io.sockets.sockets.get(socketId);
            }
        }
        return null;
    };

    // ✅ ENHANCED AUTHENTICATION MIDDLEWARE
    // io.use(async (socket, next) => {
    //     try {
    //         const token = socket.handshake.auth.token ||
    //             socket.handshake.headers.authorization?.split(' ')[1] ||
    //             socket.handshake.query.token;

    //         if (!token) {
    //             console.log('❌ SOCKET: No token provided');
    //             return next(new Error('Authentication token required'));
    //         }

    //         const decoded = jwt.verify(token, JWT_SECRET);

    //         if (decoded.role && decoded.role.includes('admin')) {
    //             const admin = await Admin.findById(decoded.adminId || decoded.userId);

    //             if (!admin) {
    //                 return next(new Error('Admin not found'));
    //             }

    //             if (!admin.isActive) {
    //                 return next(new Error('Admin account is deactivated'));
    //             }

    //             socket.userId = admin._id;
    //             socket.userRole = 'admin';
    //             socket.userName = admin.name;
    //             socket.isAdmin = true;
    //             socket.admin = admin;

    //         } else if (decoded.userId) {
    //             let user = null;
    //             const role = decoded.role;

    //             // Find user based on role
    //             if (role === 'customer') {
    //                 user = await Customer.findById(decoded.userId);
    //             } else if (role === 'rider') {
    //                 user = await Rider.findById(decoded.userId);
    //             } else if (role === 'restaurant') {
    //                 user = await RestaurantUser.findById(decoded.userId);
    //             }

    //             if (!user) {
    //                 console.log("❌ SOCKET: User not found for ID:", decoded.userId);
    //                 return next(new Error('User not found'));
    //             }

    //             if (!user.isActive) {
    //                 return next(new Error('User account is deactivated'));
    //             }

    //             if (user.role !== 'customer' && !user.isVerified) {
    //                 return next(new Error(`Your ${user.role} account is pending verification. Please contact admin.`));
    //             }

    //             socket.userId = user._id;
    //             socket.userRole = user.role;
    //             socket.userName = user.name;
    //             socket.isAdmin = false;
    //             socket.user = user;

    //         } else {
    //             return next(new Error('Invalid token structure'));
    //         }

    //         next();
    //     } catch (err) {
    //         console.log('❌ SOCKET: Authentication failed:', err.message);
    //         next(new Error('Authentication error: Invalid token'));
    //     }
    // });
    // ✅ ENHANCED AUTHENTICATION MIDDLEWARE - ALLOW ADMIN UI
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token ||
                socket.handshake.headers.authorization?.split(' ')[1] ||
                socket.handshake.query.token;

            console.log('🔍 SOCKET CONNECTION ATTEMPT:', {
                hasToken: !!token,
                userAgent: socket.handshake.headers['user-agent']?.substring(0, 80)
            });

            // ✅ FIX: Allow ALL connections in development (including Admin UI)
            if (process.env.NODE_ENV === 'development') {
                if (!token) {
                    console.log('✅ DEVELOPMENT: Allowing connection without token');
                    socket.userId = 'guest-' + Date.now();
                    socket.userRole = 'guest';
                    socket.userName = 'Guest User';
                    return next();
                }
            }

            // For regular users, verify token
            if (!token) {
                console.log('❌ No token provided');
                return next(new Error('Authentication token required'));
            }

            const candidateSecrets = [
                JWT_SECRET,
                "your_super_secure_jwt_secret_key_here",
                "your_jwt_secret_key",
                "your_fallback_jwt_secret_key_here",
            ].filter(Boolean);

            let decoded = null;
            let lastErr = null;
            let isExpired = false;

            for (const secret of candidateSecrets) {
                try {
                    decoded = jwt.verify(token, secret);
                    break;
                } catch (err) {
                    if (err.name === "TokenExpiredError") {
                        isExpired = true;
                    }
                    lastErr = err;
                }
            }

            if (!decoded) {
                if (isExpired) {
                    return next(new Error('Token expired'));
                }
                return next(new Error('Authentication failed: Invalid token'));
            }

            // ✅ EXISTING USER VERIFICATION CODE (aapka original code)
            if (decoded.role && decoded.role.includes('admin')) {
                const admin = await Admin.findById(decoded.adminId || decoded.userId);

                if (!admin) {
                    return next(new Error('Admin not found'));
                }

                if (!admin.isActive) {
                    return next(new Error('Admin account is deactivated'));
                }

                socket.userId = admin._id;
                socket.userRole = 'admin';
                socket.userName = admin.name;
                socket.isAdmin = true;
                socket.admin = admin;

            } else if (decoded.userId) {
                let user = null;
                const role = decoded.role;

                // Find user based on role
                if (role === 'customer') {
                    user = await Customer.findById(decoded.userId);
                    if (!user && decoded.phone) {
                        user = await Customer.findOne({ phone: decoded.phone });
                    }
                    if (!user) {
                        try {
                            user = await Customer.create({
                                _id: decoded.userId,
                                name: decoded.name || `User_${(decoded.phone || "0000").slice(-4)}`,
                                phone: decoded.phone || "0000000000",
                                role: 'customer',
                                isVerified: decoded.isVerified ?? true,
                                isActive: true,
                            });
                        } catch {
                            user = {
                                _id: decoded.userId,
                                name: decoded.name || `User_${(decoded.phone || "0000").slice(-4)}`,
                                phone: decoded.phone,
                                role: 'customer',
                                isVerified: decoded.isVerified ?? true,
                                isActive: true,
                            };
                        }
                    }
                } else if (role === 'rider') {
                    user = await Rider.findById(decoded.userId);
                    if (!user && decoded.phone) {
                        user = await Rider.findOne({ phone: decoded.phone });
                    }
                    if (!user) {
                        try {
                            user = await Rider.create({
                                _id: decoded.userId,
                                name: decoded.name || `Rider_${(decoded.phone || "0000").slice(-4)}`,
                                phone: decoded.phone || "0000000000",
                                role: 'rider',
                                isVerified: decoded.isVerified ?? true,
                                isActive: true,
                            });
                        } catch {
                            user = await Rider.findOne({ phone: decoded.phone });
                        }
                    }
                } else if (role === 'restaurant') {
                    user = await RestaurantUser.findById(decoded.userId);
                    if (!user && decoded.phone) {
                        user = await RestaurantUser.findOne({ phone: decoded.phone });
                    }
                    if (!user && decoded.restaurantId) {
                        user = await RestaurantUser.findOne({ restaurantId: decoded.restaurantId });
                    }
                    if (!user) {
                        try {
                            user = await RestaurantUser.create({
                                _id: decoded.userId,
                                name: decoded.name || decoded.businessName || "Restaurant Partner",
                                phone: decoded.phone || "0000000000",
                                email: decoded.email,
                                role: 'restaurant',
                                businessName: decoded.businessName || "Restaurant Partner",
                                restaurantId: decoded.restaurantId,
                                isVerified: decoded.isVerified ?? true,
                                isActive: true,
                            });
                        } catch {
                            user = await RestaurantUser.findOne({ phone: decoded.phone });
                        }
                    }
                }

                if (!user) {
                    user = await User.findById(decoded.userId);
                }

                if (!user) {
                    console.log("❌ SOCKET: User not found for ID:", decoded.userId);
                    return next(new Error('User not found'));
                }

                if (!user.isActive) {
                    return next(new Error('User account is deactivated'));
                }

                if (user.role !== 'customer' && !user.isVerified) {
                    return next(new Error(`Your ${user.role} account is pending verification. Please contact admin.`));
                }

                socket.userId = user._id;
                socket.userRole = user.role;
                socket.userName = user.name;
                socket.isAdmin = false;
                socket.user = user;

            } else {
                return next(new Error('Invalid token structure'));
            }

            next();
        } catch (err) {
            console.log('❌ SOCKET: Auth error:', err.message);
            // ✅ FIX: Allow connection even on error for Admin UI
            if (process.env.NODE_ENV === 'development') {
                socket.userId = 'error-guest';
                socket.userRole = 'guest';
                socket.userName = 'Error Guest';
                return next();
            }
            next(new Error('Authentication error'));
        }
    });
    // Handle new connections
    io.on('connection', (socket) => {
        console.log(`🔌 SOCKET: ${socket.userName} (${socket.userId}) connected as ${socket.userRole}`);
        console.log("=".repeat(60));
        console.log("🎯 NEW SOCKET CONNECTION DETECTED!");
        console.log("Socket ID:", socket.id);
        console.log("User ID:", socket.userId || "NOT SET");
        console.log("User Name:", socket.userName || "NOT SET");
        console.log("User Role:", socket.userRole || "NOT SET");
        console.log("User-Agent:", socket.handshake.headers['user-agent']?.substring(0, 50));
        console.log("=".repeat(60));
        // ✅ PERSONAL ROOMS
        socket.join(`user_${socket.userId.toString()}`);
        socket.join(`notifications_${socket.userId.toString()}`);

        // ✅ ROLE-SPECIFIC ROOMS AND USER TRACKING
        if (socket.userRole === 'customer') {
            connectedUsers.customers.set(socket.userId.toString(), socket.id);
            socket.join('customers_room');
            console.log(`👤 SOCKET: Customer ${socket.userName} joined customers room`);

        } else if (socket.userRole === 'rider') {
            const riderIdStr = socket.userId.toString();
            // Cancel any pending disconnect timer if rider reconnects within grace period
            if (pendingRiderDisconnects.has(riderIdStr)) {
                clearTimeout(pendingRiderDisconnects.get(riderIdStr));
                pendingRiderDisconnects.delete(riderIdStr);
                console.log(`🏍️ SOCKET: Rider ${socket.userName} reconnected within grace period — offline timer cancelled`);
            }

            connectedUsers.riders.set(riderIdStr, socket.id);
            socket.join('riders_room');
            socket.join('available_riders');
            console.log(`🏍️ SOCKET: Rider ${socket.userName} joined riders room`);

            // Update rider status
            Rider.findByIdAndUpdate(socket.userId, {
                isOnline: true,
                lastLogin: new Date(),
                socketId: socket.id
            }).catch(console.error);

            // Notify admin about rider availability
            io.to('admin_dashboard_room').emit('rider_connected', {
                riderId: socket.userId,
                riderName: socket.userName,
                socketId: socket.id,
                timestamp: new Date()
            });

        } else if (socket.userRole === 'restaurant') {
            connectedUsers.restaurants.set(socket.userId.toString(), socket.id);
            socket.join('restaurants_room');

            if (socket.user && socket.user.restaurantId) {
                socket.join(`restaurant_${socket.user.restaurantId}`);
                console.log(`🏪 SOCKET: Restaurant ${socket.userName} joined restaurant room: ${socket.user.restaurantId}`);
            } else {
                socket.join(`restaurant_${socket.userId}`);
                console.log(`🏪 SOCKET: Restaurant ${socket.userName} joined restaurant room`);
            }

        } else if (socket.isAdmin) {
            connectedUsers.admins.set(socket.userId.toString(), socket.id);
            socket.join('admin_dashboard_room');
            socket.join('admin_notifications_room');
            socket.join('admin_support_room');
            console.log(`🛠️ SOCKET: Admin ${socket.userName} joined admin rooms`);
        }

        // ==================== ORDER.JS EVENTS HANDLERS ====================

        // ✅ Order.js: New order received (from restaurant)
        socket.on('new_order_received', async (data) => {
            try {
                if (socket.userRole !== 'restaurant' && !socket.isAdmin) {
                    return console.warn(`⚠️ [Security Alert] Blocked unauthorized new_order_received from role: ${socket.userRole}`);
                }
                console.log(`🏪 SOCKET: Restaurant new order - ${data?.orderId}`);

                io.to(`restaurant_${data.restaurantId}`).emit('restaurant_new_order', {
                    type: 'new_order',
                    orderId: data.orderId,
                    customerName: data.customerName,
                    totalAmount: data.totalAmount,
                    items: data.items,
                    deliveryAddress: data.deliveryAddress,
                    city: data.city,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: new_order_received error:', error);
            }
        });

        // ✅ Order.js: Order confirmed (to customer)
        socket.on('order_confirmed', async (data) => {
            try {
                if (socket.userRole !== 'restaurant' && !socket.isAdmin) {
                    return console.warn(`⚠️ [Security Alert] Blocked unauthorized order_confirmed from role: ${socket.userRole}`);
                }
                console.log(`👤 SOCKET: Customer order confirmed - ${data?.orderId}`);

                io.to(`user_${data.customerId}`).emit('customer_order_confirmed', {
                    type: 'order_confirmed',
                    orderId: data.orderId,
                    orderNumber: data.orderNumber,
                    restaurantId: data.restaurantId,
                    restaurantName: data.restaurantName,
                    totalAmount: data.totalAmount,
                    estimatedDelivery: data.estimatedDelivery,
                    status: data.status,
                    message: data.message,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: order_confirmed error:', error);
            }
        });

        // ✅ Order.js: New order admin (BUG FIX: space removed)
        socket.on('new_order_admin', async (data) => {
            try {
                if (socket.userRole !== 'restaurant' && !socket.isAdmin) {
                    return console.warn(`⚠️ [Security Alert] Blocked unauthorized new_order_admin from role: ${socket.userRole}`);
                }
                console.log(`📊 SOCKET: Admin new order - ${data?.orderId}`);

                io.to('admin_dashboard_room').emit('admin_new_order', {
                    type: 'new_order',
                    orderId: data.orderId,
                    restaurantId: data.restaurantId,
                    restaurantName: data.restaurantName,
                    customerId: data.customerId,
                    customerName: data.customerName,
                    totalAmount: data.totalAmount,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: new_order_admin error:', error);
            }
        });

        // ✅ Order.js: Rider UI update
        socket.on('rider_ui_update', async (data) => {
            try {
                if (socket.userRole !== 'restaurant' && !socket.isAdmin) {
                    return console.warn(`⚠️ [Security Alert] Blocked unauthorized rider_ui_update from role: ${socket.userRole}`);
                }
                console.log(`🏍️ SOCKET: Rider new job - ${data?.orderId}`);

                io.to('riders_room').emit('rider_new_job', {
                    type: 'new_delivery',
                    orderId: data.orderId,
                    restaurantId: data.restaurantId,
                    restaurantName: data.restaurantName,
                    restaurantLocation: data.restaurantLocation,
                    deliveryAddress: data.deliveryAddress,
                    totalAmount: data.totalAmount,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: rider_ui_update error:', error);
            }
        });

        // ✅ Order.js: Order status update
        socket.on('order_status_update', async (data) => {
            try {
                if (!socket.userRole || !['restaurant', 'rider', 'admin'].includes(socket.userRole)) {
                    return console.warn(`⚠️ [Security Alert] Blocked unauthorized order_status_update from role: ${socket.userRole}`);
                }
                console.log(`🔄 SOCKET: Order status update - ${data.orderId}: ${data.status}`);

                // Customer ko
                if (data.customerId) {
                    io.to(`user_${data.customerId}`).emit('order_status_changed', {
                        orderId: data.orderId,
                        status: data.status,
                        deliveryProgress: data.deliveryProgress,
                        timestamp: new Date()
                    });
                }

                // Restaurant ko
                if (data.restaurantId) {
                    io.to(`restaurant_${data.restaurantId}`).emit('restaurant_order_status', {
                        orderId: data.orderId,
                        status: data.status,
                        timestamp: new Date()
                    });
                }

                // Rider ko
                if (data.riderId) {
                    io.to(`rider_${data.riderId}`).emit('rider_order_status', {
                        orderId: data.orderId,
                        status: data.status,
                        timestamp: new Date()
                    });
                }

            } catch (error) {
                console.error('❌ SOCKET: order_status_update error:', error);
            }
        });

        // ✅ Order.js: UI payment update (COD)
        socket.on('ui_payment_update', async (data) => {
            try {
                if (!socket.userRole || !['rider', 'admin'].includes(socket.userRole)) {
                    return console.warn(`⚠️ [Security Alert] Blocked unauthorized ui_payment_update from role: ${socket.userRole}`);
                }
                console.log(`💳 SOCKET: UI payment update - ${data.orderId}`);

                io.to(`user_${data.customerId}`).emit('payment_status_changed', {
                    orderId: data.orderId,
                    paymentStatus: data.paymentStatus,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: ui_payment_update error:', error);
            }
        });

        // ==================== ORDER TRACKING EVENTS ====================

        // ✅ Customer/Rider: Join order tracking room
        socket.on('join_order_tracking', async (data) => {
            const { orderId } = data;
            if (orderId) {
                socket.join(`order_${orderId}`);
                console.log(`📍 SOCKET: ${socket.userName} joined order tracking room: ${orderId}`);

                // If orderId is a custom string, also join MongoDB _id room (and vice-versa)
                try {
                    const order = await findOrderById(orderId);
                    if (order && order._id && order._id.toString() !== String(orderId)) {
                        socket.join(`order_${order._id}`);
                    }
                    if (order && order.orderId && order.orderId !== String(orderId)) {
                        socket.join(`order_${order.orderId}`);
                    }
                } catch (e) {}

                // Instantly send latest cached tracking coordinates without waiting for next geoping
                try {
                    const cached = await getCachedOrderTracking(orderId);
                    if (cached && cached.lat && cached.lng) {
                        const cachedLat = parseFloat(cached.lat);
                        const cachedLng = parseFloat(cached.lng);
                        socket.emit('rider_location_changed', {
                            orderId,
                            riderId: cached.riderId,
                            riderName: cached.riderName || 'Delivery Partner',
                            lat: cachedLat,
                            lng: cachedLng,
                            location: { lat: cachedLat, lng: cachedLng },
                            currentLocation: { lat: cachedLat, lng: cachedLng, address: cached.address || '' },
                            address: cached.address || '',
                            timestamp: cached.updatedAt || new Date()
                        });
                    }
                } catch (cacheErr) {
                    // Non-blocking
                }
            }
        });

        // ✅ Customer/Rider: Leave order tracking room
        socket.on('leave_order_tracking', (data) => {
            const { orderId } = data;
            if (orderId) {
                socket.leave(`order_${orderId}`);
                console.log(`📍 SOCKET: ${socket.userName} left order tracking room: ${orderId}`);
            }
        });

        // ✅ HIGH-THROUGHPUT: Rider app location update (Redis Geospatial + Write-Behind Throttling)
        socket.on('rider_app_location_update', async (data) => {
            try {
                const { orderId, lat, lng, address, speed, heading } = data;
                if (lat === undefined || lng === undefined) return;

                const numericLat = parseFloat(lat);
                const numericLng = parseFloat(lng);
                if (isNaN(numericLat) || isNaN(numericLng)) return;

                // 1. Instant Redis Geospatial index & cache update (< 1ms)
                recordRiderLocation({
                    riderId: socket.userId,
                    lat: numericLat,
                    lng: numericLng,
                    address,
                    orderId,
                    riderName: socket.userName,
                    speed,
                    heading
                }).catch(() => {});

                // 2. Instantly broadcast to tracking room (Zero-latency UI updates, full payload)
                const trackingPayload = {
                    orderId,
                    riderId: socket.userId,
                    riderName: socket.userName,
                    lat: numericLat,
                    lng: numericLng,
                    location: { lat: numericLat, lng: numericLng },
                    currentLocation: { lat: numericLat, lng: numericLng, address: address || '' },
                    address: address || '',
                    timestamp: new Date()
                };

                io.to(`order_${orderId}`).emit('rider_location_changed', trackingPayload);

                // 3. High-throughput Write-Behind: Throttle MongoDB disk writes to at most once per 15s
                if (shouldPersistToDb(socket.userId, 15000)) {
                    Rider.findByIdAndUpdate(socket.userId, {
                        currentLocation: {
                            lat: numericLat,
                            lng: numericLng,
                            address,
                            lastUpdated: new Date()
                        }
                    }).catch(err => console.warn('⚠️ [Rider DB Write-Behind]', err.message));

                    if (orderId) {
                        Order.findOneAndUpdate(
                            { orderId: orderId },
                            {
                                $set: {
                                    riderLocation: {
                                        lat: numericLat,
                                        lng: numericLng,
                                        address,
                                        updatedAt: new Date()
                                    }
                                }
                            }
                        ).catch(err => console.warn('⚠️ [Order DB Write-Behind]', err.message));
                    }
                }

                // 4. Throttled Customer Notification: At most once per 60s per order
                if (orderId && shouldNotifyCustomer(orderId, 60000)) {
                    const order = await findOrderById(orderId);
                    if (order && order.customerId) {
                        createNotification({
                            userId: order.customerId._id,
                            title: 'Rider Location Updated',
                            message: `Rider is on the way with your order #${orderId}`,
                            type: 'delivery',
                            data: {
                                orderId,
                                location: { lat: numericLat, lng: numericLng },
                                riderName: socket.userName,
                                type: 'rider_location'
                            },
                            priority: 'low'
                        }).catch(() => {});
                    }
                }

            } catch (error) {
                console.error('❌ SOCKET: rider_app_location_update error:', error);
            }
        });

        // ✅ Restaurant: Mark order as ready for pickup
        socket.on('order_ready_for_pickup', async (data) => {
            try {
                const { orderId } = data;
                console.log(`📦 SOCKET: Order ${orderId} ready for pickup`);

                const order = await findOrderById(orderId);
                if (!order) return;

                io.to('riders_room').emit('new_order_available', {
                    orderId,
                    restaurantId: order.restaurantId?._id,
                    restaurantName: order.restaurantId?.name || 'Restaurant',
                    restaurantLocation: order.restaurantId?.address,
                    customerLocation: order.deliveryAddress,
                    deliveryAddress: order.deliveryAddress,
                    totalAmount: order.finalAmount,
                    timestamp: new Date(),
                    priority: 'high'
                });

                const riders = await Rider.find({ isAvailable: true, isActive: true });
                for (const rider of riders) {
                    await createNotification({
                        userId: rider._id,
                        title: 'New Delivery Available',
                        message: `Order #${orderId} is ready for pickup from ${order.restaurantId?.name || 'Restaurant'}`,
                        type: 'delivery',
                        data: {
                            orderId,
                            restaurantId: order.restaurantId?._id,
                            type: 'order_ready'
                        },
                        priority: 'high'
                    });
                }

                console.log(`📦 SOCKET: Order ${orderId} ready - Notified ${riders.length} riders`);

            } catch (error) {
                console.error('❌ SOCKET: Order ready error:', error);
            }
        });
        // 'new_delivery_opportunity' event handler add 
        socket.on('new_delivery_opportunity', async (data) => {
            try {
                console.log(`📦 SOCKET: New delivery opportunity - ${data.orderId}`);

                // Broadcast to all riders in riders_room
                io.to('riders_room').emit('new_order_available', {
                    orderId: data.orderId,
                    restaurantId: data.restaurantId,
                    restaurantName: data.restaurantName,
                    restaurantLocation: data.restaurantLocation,
                    deliveryAddress: data.deliveryAddress,
                    totalAmount: data.totalAmount,
                    readyAt: data.readyAt,
                    timestamp: new Date(),
                    priority: 'high'
                });

            } catch (error) {
                console.error('❌ SOCKET: new_delivery_opportunity error:', error);
            }
        });
        // ✅ Status update notification handler
        socket.on('order_status_update_notification', async (data) => {
            try {
                const { orderId, status, customerId, restaurantId, riderId } = data;

                console.log(`🔄 SOCKET: Processing status notification for order ${orderId}: ${status}`);

                const order = await findOrderById(orderId);
                if (!order) return;

                if (customerId) {
                    await createNotification({
                        userId: customerId,
                        title: 'Order Status Updated',
                        message: `Your order #${orderId} is now ${status.replace(/_/g, ' ')}`,
                        type: 'order',
                        data: {
                            orderId,
                            status,
                            type: 'status_update'
                        },
                        priority: 'medium'
                    });
                }

                if (restaurantId) {
                    await createRestaurantNotifications(restaurantId, {
                        title: 'Order Status Updated',
                        message: `Order #${orderId} is now ${status.replace(/_/g, ' ')}`,
                        type: 'order',
                        data: {
                            orderId,
                            status,
                            type: 'status_update'
                        },
                        priority: 'medium'
                    });
                }

                if (riderId) {
                    await createNotification({
                        userId: riderId,
                        title: 'Order Status Updated',
                        message: `Order #${orderId} is now ${status.replace(/_/g, ' ')}`,
                        type: 'order',
                        data: {
                            orderId,
                            status,
                            type: 'status_update'
                        },
                        priority: 'medium'
                    });
                }

            } catch (error) {
                console.error('❌ SOCKET: Status notification error:', error);
            }
        });

        // ==================== RIDER.JS EVENTS HANDLERS ====================

        // ✅ Rider.js: Rider availability update
        socket.on('rider_availability_updated', async (data) => {
            try {
                console.log(`🏍️ SOCKET: Rider availability update - ${data.riderName}`);

                io.to('admin_dashboard_room').emit('admin_rider_status_update', {
                    type: 'rider_availability',
                    riderId: data.riderId,
                    riderName: data.riderName,
                    isOnline: data.isOnline,
                    isAvailable: data.isAvailable,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: rider_availability_updated error:', error);
            }
        });

        // ✅ Rider.js: Rider location update (Redis Geospatial + Write-Behind Throttling)
        socket.on('rider_location_updated', async (data) => {
            try {
                if (!data || !data.riderId || !data.location) return;

                const numericLat = parseFloat(data.location.lat);
                const numericLng = parseFloat(data.location.lng);

                // 1. Instant Redis Geospatial update
                recordRiderLocation({
                    riderId: data.riderId,
                    lat: numericLat,
                    lng: numericLng,
                    address: data.address,
                    riderName: data.riderName || 'Delivery Partner'
                }).catch(() => {});

                // 2. Broadcast to rider and tracking rooms
                const rider = await Rider.findById(data.riderId);
                if (rider && rider.currentOrder) {
                    const order = await Order.findById(rider.currentOrder);
                    if (order) {
                        const trackingPayload = {
                            orderId: order.orderId,
                            riderId: data.riderId,
                            riderName: rider.name,
                            lat: numericLat,
                            lng: numericLng,
                            location: { lat: numericLat, lng: numericLng },
                            currentLocation: { lat: numericLat, lng: numericLng, address: data.address || '' },
                            address: data.address || '',
                            timestamp: new Date()
                        };

                        io.to(`order_${order.orderId}`).emit('rider_location_changed', trackingPayload);
                        if (order._id && order._id.toString() !== String(order.orderId)) {
                            io.to(`order_${order._id}`).emit('rider_location_changed', trackingPayload);
                        }

                        // Cache order tracking in Redis as well
                        recordRiderLocation({
                            riderId: data.riderId,
                            lat: numericLat,
                            lng: numericLng,
                            address: data.address,
                            orderId: order.orderId,
                            riderName: rider.name
                        }).catch(() => {});
                    }
                }

                // 3. Write-Behind Throttling to MongoDB (at most once per 15s)
                if (shouldPersistToDb(data.riderId, 15000)) {
                    Rider.findByIdAndUpdate(data.riderId, {
                        currentLocation: {
                            lat: numericLat,
                            lng: numericLng,
                            address: data.address,
                            lastUpdated: new Date()
                        }
                    }).catch(err => console.warn('⚠️ [Rider DB Write-Behind]', err.message));
                }

            } catch (error) {
                console.error('❌ SOCKET: rider_location_updated error:', error);
            }
        });

        // ✅ Rider.js: Order assigned to rider
        socket.on('order_assigned_to_rider', async (data) => {
            try {
                console.log(`✅ SOCKET: Order assigned to rider - ${data.orderId}`);

                if (data.customerId) {
                    io.to(`user_${data.customerId}`).emit('rider_assigned_notification', {
                        orderId: data.orderId,
                        orderMongoId: data.orderMongoId,
                        riderName: data.rider.name,
                        riderPhone: data.rider.phone,
                        vehicleType: data.rider.vehicleType,
                        vehicleNo: data.rider.vehicleNo,
                        estimatedDeliveryTime: data.estimatedDeliveryTime,
                        timestamp: new Date()
                    });
                }

                if (data.restaurantId) {
                    io.to(`restaurant_${data.restaurantId}`).emit('rider_assigned_update', {
                        orderId: data.orderId,
                        riderName: data.rider.name,
                        riderPhone: data.rider.phone,
                        vehicleType: data.rider.vehicleType,
                        timestamp: new Date()
                    });
                }

                io.to('admin_dashboard_room').emit('admin_order_update', {
                    type: 'rider_assigned',
                    orderId: data.orderId,
                    riderName: data.rider.name,
                    customerId: data.customerId,
                    restaurantId: data.restaurantId,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: order_assigned_to_rider error:', error);
            }
        });

        // ✅ Rider.js: Order accepted (notify other riders)
        socket.on('order_accepted', async (data) => {
            try {
                console.log(`🏍️ SOCKET: Order accepted by rider - ${data.orderId}`);

                io.to('riders_room').emit('order_no_longer_available', {
                    orderId: data.orderId,
                    acceptedBy: data.acceptedBy,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: order_accepted error:', error);
            }
        });

        // ✅ Rider.js: Order delivery status updated
        // socket.on('order_delivery_status_updated', async (data) => {
        //     try {
        //         console.log(`🔄 SOCKET: Delivery status update - ${data.orderId}: ${data.status}`);

        //         if (data.customerId) {
        //             io.to(`user_${data.customerId}`).emit('delivery_status_update', {
        //                 orderId: data.orderId,
        //                 status: data.status,
        //                 riderName: data.riderName,
        //                 note: data.note,
        //                 timestamp: new Date()
        //             });
        //         }

        //         if (data.restaurantId) {
        //             io.to(`restaurant_${data.restaurantId}`).emit('restaurant_delivery_update', {
        //                 orderId: data.orderId,
        //                 status: data.status,
        //                 riderName: data.riderName,
        //                 timestamp: new Date()
        //             });
        //         }

        //         io.to('admin_dashboard_room').emit('admin_delivery_update', {
        //             orderId: data.orderId,
        //             status: data.status,
        //             riderId: data.riderId,
        //             customerId: data.customerId,
        //             restaurantId: data.restaurantId,
        //             timestamp: new Date()
        //         });

        //     } catch (error) {
        //         console.error('❌ SOCKET: order_delivery_status_updated error:', error);
        //     }
        // });

        // ✅ Rider.js: Payment update (COD orders)
        socket.on('payment_update', async (data) => {
            try {
                console.log(`💳 SOCKET: Payment update - Order ${data.orderId}`);

                if (data.customerId) {
                    io.to(`user_${data.customerId}`).emit('payment_status_update', {
                        orderId: data.orderId,
                        paymentStatus: data.paymentStatus,
                        timestamp: new Date()
                    });
                }

            } catch (error) {
                console.error('❌ SOCKET: payment_update error:', error);
            }
        });

        // ==================== NOTIFICATION SYSTEM EVENTS ====================

        // ✅ Mark notification as read
        socket.on('mark_notification_read', async (data) => {
            try {
                const Notification = require('../models/Notification');
                const { notificationId } = data;

                const notification = await Notification.findByIdAndUpdate(
                    notificationId,
                    { read: true, readAt: new Date() },
                    { new: true }
                );

                if (!notification) {
                    socket.emit('error', { message: 'Notification not found' });
                    return;
                }

                socket.emit('notification_marked_read', {
                    notificationId,
                    read: true,
                    readAt: notification.readAt
                });

                console.log(`📖 SOCKET: Notification ${notificationId} marked as read`);

            } catch (error) {
                console.error('❌ SOCKET: Mark notification read error:', error);
                socket.emit('error', { message: 'Failed to mark notification as read' });
            }
        });

        // ✅ Mark all notifications as read
        socket.on('mark_all_notifications_read', async () => {
            try {
                const Notification = require('../models/Notification');
                await Notification.updateMany(
                    { userId: socket.userId, read: false },
                    { read: true, readAt: new Date() }
                );

                socket.emit('all_notifications_marked_read', {
                    userId: socket.userId,
                    timestamp: new Date()
                });

                console.log(`📖 SOCKET: All notifications marked as read for user ${socket.userId}`);

            } catch (error) {
                console.error('❌ SOCKET: Mark all notifications read error:', error);
                socket.emit('error', { message: 'Failed to mark all notifications as read' });
            }
        });

        // ✅ Delete notification
        socket.on('delete_notification', async (data) => {
            try {
                const { notificationId } = data;

                const notification = await Notification.findByIdAndDelete(notificationId);

                if (!notification) {
                    socket.emit('error', { message: 'Notification not found' });
                    return;
                }

                socket.emit('notification_deleted', {
                    notificationId,
                    deleted: true,
                    timestamp: new Date()
                });

                console.log(`🗑️ SOCKET: Notification ${notificationId} deleted`);

            } catch (error) {
                console.error('❌ SOCKET: Delete notification error:', error);
                socket.emit('error', { message: 'Failed to delete notification' });
            }
        });

        // ✅ Clear all notifications
        socket.on('clear_all_notifications', async () => {
            try {
                await Notification.deleteMany({ userId: socket.userId });

                socket.emit('all_notifications_cleared', {
                    userId: socket.userId,
                    timestamp: new Date()
                });

                console.log(`🗑️ SOCKET: All notifications cleared for user ${socket.userId}`);

            } catch (error) {
                console.error('❌ SOCKET: Clear all notifications error:', error);
                socket.emit('error', { message: 'Failed to clear all notifications' });
            }
        });

        // ✅ Get unread notifications count
        socket.on('get_unread_count', async () => {
            try {
                const count = await Notification.countDocuments({
                    userId: socket.userId,
                    read: false
                });

                socket.emit('unread_count', {
                    count,
                    userId: socket.userId,
                    timestamp: new Date()
                });

            } catch (error) {
                console.error('❌ SOCKET: Get unread count error:', error);
                socket.emit('error', { message: 'Failed to get unread count' });
            }
        });

        // ==================== DISCONNECTION HANDLING ====================

        socket.on('disconnect', async (reason) => {
            console.log(`🔌 SOCKET: ${socket.userName} disconnected: ${reason}`);

            // Remove from connected users safely
            if (socket.userId && socket.userRole) {
                const normalizedRole = socket.userRole.includes('admin') ? 'admins' : `${socket.userRole}s`;
                if (connectedUsers[normalizedRole]) {
                    connectedUsers[normalizedRole].delete(socket.userId.toString());
                }

                // If rider disconnects, apply 45-second debounce grace period
                // to prevent database thrashing from elevator or tunnel glitches
                if (socket.userRole === 'rider') {
                    const riderIdStr = socket.userId.toString();
                    const riderName = socket.userName;

                    const timer = setTimeout(async () => {
                        try {
                            // Check if rider reconnected during the grace period
                            if (connectedUsers.riders.has(riderIdStr)) {
                                return;
                            }

                            await Rider.findByIdAndUpdate(riderIdStr, {
                                isOnline: false,
                                lastLogout: new Date()
                            });

                            io.to('admin_dashboard_room').emit('rider_disconnected', {
                                riderId: riderIdStr,
                                riderName: riderName,
                                timestamp: new Date()
                            });
                            console.log(`🏍️ SOCKET: Rider ${riderName} (${riderIdStr}) marked offline after grace period`);
                        } catch (err) {
                            console.error('❌ SOCKET: Delayed rider disconnect error:', err.message);
                        } finally {
                            pendingRiderDisconnects.delete(riderIdStr);
                        }
                    }, 45000); // 45 seconds grace period

                    pendingRiderDisconnects.set(riderIdStr, timer);
                }
            }
        });

        socket.on('error', (error) => {
            console.error(`❌ SOCKET: Socket error for ${socket.userName}:`, error);
        });
    });

    // Global error handler
    io.on('error', (error) => {
        console.error('❌ SOCKET: Socket.IO Error:', error);
    });

    return io;
}

module.exports = initializeSocket;