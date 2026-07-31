const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middlewares/auth');
// const { riderUpload, handleUploadErrors } = require('../middlewares/upload');
const User = require('../models/User');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const { calculateDistance, calculateDeliveryEarnings } = require('../utils/deliveryUtils');
const path = require('path'); 
const fs = require('fs');  
const multer = require('multer');  

// ============================================
// RIDER DOCUMENTS STORAGE CONFIGURATION
// ============================================

const riderDocsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const riderDir = path.join(__dirname, '../uploads/riders');
    if (!fs.existsSync(riderDir)) {
      fs.mkdirSync(riderDir, { recursive: true });
    }
    cb(null, riderDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "rider-" + uniqueSuffix + path.extname(file.originalname));
  }
});

const riderUpload = multer({
  storage: riderDocsStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, JPEG, PNG, PDF are allowed.'), false);
    }
  }
});

const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Max 5MB.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

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
// Apply rider role check to all routes
router.use(auth);
router.use(requireRole(['rider', 'admin']));

// @route   GET /api/v1/rider/profile
// @desc    Get rider profile
// @access  Private (Rider)
router.get('/profile', async (req, res) => {
  try {
    const rider = await Rider.findOne({ _id: req.user._id });
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.json({
      success: true,
      data: rider
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});
// ============================================
//  Complete Registration + Profile Update
// ============================================

router.put('/profile', 
  auth,  // ✅ Token required (already logged in)
  riderUpload.fields([
    { name: 'licensePhoto', maxCount: 1 },
    { name: 'vehiclePhoto', maxCount: 1 }
  ]), 
  handleUploadErrors, 
  async (req, res, next) => {
    try {
      const userId = req.user._id;  // ✅ Token se user ID
      const user = await User.findById(userId);
      
      if (!user) {
        // Clean up uploaded files
        if (req.files?.licensePhoto?.[0]) fs.unlinkSync(req.files.licensePhoto[0].path);
        if (req.files?.vehiclePhoto?.[0]) fs.unlinkSync(req.files.vehiclePhoto[0].path);
        
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is rider
      if (user.role !== 'rider') {
        // Clean up uploaded files
        if (req.files?.licensePhoto?.[0]) fs.unlinkSync(req.files.licensePhoto[0].path);
        if (req.files?.vehiclePhoto?.[0]) fs.unlinkSync(req.files.vehiclePhoto[0].path);
        
        return res.status(403).json({
          success: false,
          message: 'This API is only for riders'
        });
      }

      // Get existing rider
      let rider = await Rider.findById(userId);
      
      // ========================================
      // CASE 1: NEW REGISTRATION (rider doesn't exist)
      // ========================================
      if (!rider) {
        const {
          name, email, vehicleType, vehicleNo, licenseNumber,
          bankAccountNumber, bankIFSC, aadharNumber
        } = req.body;

        // Validation for new registration
        if (!name || !vehicleType || !vehicleNo || !licenseNumber) {
          // Clean up uploaded files
          if (req.files?.licensePhoto?.[0]) fs.unlinkSync(req.files.licensePhoto[0].path);
          if (req.files?.vehiclePhoto?.[0]) fs.unlinkSync(req.files.vehiclePhoto[0].path);
          
          return res.status(400).json({
            success: false,
            message: 'Name, vehicle type, vehicle number, and license number are required for registration'
          });
        }

        // Update base user
        const userUpdate = {};
        if (name) userUpdate.name = name;
        if (email) userUpdate.email = email;
        
        if (Object.keys(userUpdate).length > 0) {
          await User.findByIdAndUpdate(userId, userUpdate);
        }

        // Create rider record
        const riderData = {
          _id: userId,
          phone: user.phone,
          name: name,
          email: email || user.email || null,
          role: 'rider',
          isVerified: false,
          vehicleType: vehicleType,
          vehicleNo: vehicleNo,
          licenseNumber: licenseNumber,
          bankAccountNumber: bankAccountNumber || null,
          bankIFSC: bankIFSC || null,
          aadharNumber: aadharNumber || null,
          isOnline: false,
          isAvailable: false,
          currentLocation: null,
          totalDeliveries: 0,
          completedDeliveries: 0,
          cancelledDeliveries: 0,
          earnings: { total: 0, weekly: 0, monthly: 0 },
          rating: 0,
          totalRatings: 0,
          ratings: []
        };

        // Add file paths if uploaded
        if (req.files?.licensePhoto?.[0]) {
          riderData.licensePhoto = `/uploads/riders/${req.files.licensePhoto[0].filename}`;
        }
        if (req.files?.vehiclePhoto?.[0]) {
          riderData.vehiclePhoto = `/uploads/riders/${req.files.vehiclePhoto[0].filename}`;
        }

        rider = await Rider.create(riderData);

        return res.status(201).json({
          success: true,
          message: 'Rider registration completed. Waiting for admin approval.',
          data: {
            riderId: rider._id,
            name: rider.name,
            phone: rider.phone,
            email: rider.email,
            vehicleType: rider.vehicleType,
            vehicleNo: rider.vehicleNo,
            licenseNumber: rider.licenseNumber,
            hasLicensePhoto: !!rider.licensePhoto,
            hasVehiclePhoto: !!rider.vehiclePhoto,
            verificationStatus: 'pending',
            isNewRegistration: true
          }
        });
      }

      // ========================================
      // CASE 2: PROFILE UPDATE (rider already exists)
      // ========================================
      else {
        const {
          name, email, vehicleType, vehicleNo, licenseNumber,
          bankAccountNumber, bankIFSC, aadharNumber
        } = req.body;

        // Update base user
        const userUpdate = {};
        if (name !== undefined && name !== '') userUpdate.name = name;
        if (email !== undefined && email !== '') userUpdate.email = email;
        
        if (Object.keys(userUpdate).length > 0) {
          await User.findByIdAndUpdate(userId, userUpdate);
        }

        // Update rider fields (only provided ones)
        const riderUpdate = {};
        if (name !== undefined && name !== '') riderUpdate.name = name;
        if (email !== undefined && email !== '') riderUpdate.email = email;
        if (vehicleType !== undefined && vehicleType !== '') riderUpdate.vehicleType = vehicleType;
        if (vehicleNo !== undefined && vehicleNo !== '') riderUpdate.vehicleNo = vehicleNo;
        if (licenseNumber !== undefined && licenseNumber !== '') riderUpdate.licenseNumber = licenseNumber;
        if (bankAccountNumber !== undefined && bankAccountNumber !== '') riderUpdate.bankAccountNumber = bankAccountNumber;
        if (bankIFSC !== undefined && bankIFSC !== '') riderUpdate.bankIFSC = bankIFSC;
        if (aadharNumber !== undefined && aadharNumber !== '') riderUpdate.aadharNumber = aadharNumber;

        // Handle file updates (delete old files if needed)
        if (req.files?.licensePhoto?.[0]) {
          // Delete old file if exists
          if (rider.licensePhoto) {
            const oldPath = path.join(__dirname, '../', rider.licensePhoto);
            if (fs.existsSync(oldPath)) {
              fs.unlinkSync(oldPath);
            }
          }
          riderUpdate.licensePhoto = `/uploads/riders/${req.files.licensePhoto[0].filename}`;
        }
        
        if (req.files?.vehiclePhoto?.[0]) {
          // Delete old file if exists
          if (rider.vehiclePhoto) {
            const oldPath = path.join(__dirname, '../', rider.vehiclePhoto);
            if (fs.existsSync(oldPath)) {
              fs.unlinkSync(oldPath);
            }
          }
          riderUpdate.vehiclePhoto = `/uploads/riders/${req.files.vehiclePhoto[0].filename}`;
        }

        // Check if any updates to perform
        if (Object.keys(riderUpdate).length === 0 && !req.files) {
          return res.status(400).json({
            success: false,
            message: 'No fields to update'
          });
        }

        // Update rider
        rider = await Rider.findByIdAndUpdate(
          userId,
          { $set: riderUpdate },
          { new: true, runValidators: true }
        );

        // Fetch updated rider with all fields
        const updatedRider = await Rider.findById(userId);

        return res.status(200).json({
          success: true,
          message: 'Profile updated successfully',
          data: {
            rider: {
              _id: updatedRider._id,
              name: updatedRider.name,
              phone: updatedRider.phone,
              email: updatedRider.email,
              vehicleType: updatedRider.vehicleType,
              vehicleNo: updatedRider.vehicleNo,
              licenseNumber: updatedRider.licenseNumber,
              bankAccountNumber: updatedRider.bankAccountNumber,
              bankIFSC: updatedRider.bankIFSC,
              aadharNumber: updatedRider.aadharNumber,
              licensePhoto: updatedRider.licensePhoto,
              vehiclePhoto: updatedRider.vehiclePhoto,
              isOnline: updatedRider.isOnline,
              isAvailable: updatedRider.isAvailable,
              isVerified: updatedRider.isVerified,
              totalDeliveries: updatedRider.totalDeliveries,
              completedDeliveries: updatedRider.completedDeliveries,
              earnings: updatedRider.earnings
            },
            isNewRegistration: false
          }
        });
      }

    } catch (err) {
      console.error('❌ Rider profile operation error:', err);
      // Clean up uploaded files on error
      if (req.files?.licensePhoto?.[0]) {
        try { fs.unlinkSync(req.files.licensePhoto[0].path); } catch(e) {}
      }
      if (req.files?.vehiclePhoto?.[0]) {
        try { fs.unlinkSync(req.files.vehiclePhoto[0].path); } catch(e) {}
      }
      next(err);
    }
  }
);
// @route   PUT /api/v1/rider/availability
// @desc    Update rider availability status
// @access  Private (Rider)
router.put('/availability', async (req, res) => {
  try {
    const { isOnline, isAvailable } = req.body;

    const rider = await Rider.findById(req.user._id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    if (isOnline !== undefined) rider.isOnline = isOnline;
    if (isAvailable !== undefined) rider.isAvailable = isAvailable;

    await rider.save();

    // ✅ SOCKET EMIT FOR UI UPDATE
    const io = req.app.get('io');
    if (io) {
      console.log("🏍️ RIDER.JS: Emitting availability update");

      // Notify admin dashboard
      io.to('admin_dashboard_room').emit('rider_availability_updated', {
        riderId: rider._id,
        riderName: rider.name,
        isOnline: rider.isOnline,
        isAvailable: rider.isAvailable,
        timestamp: new Date()
      });

      console.log("✅ RIDER.JS: Availability update emitted to admin");
    }

    res.json({
      success: true,
      message: 'Availability updated successfully',
      data: {
        isOnline: rider.isOnline,
        isAvailable: rider.isAvailable
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/v1/rider/location
// @desc    Update rider current location
// @access  Private (Rider)
router.put('/location', async (req, res) => {
  try {
    const { lat, lng, address } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const rider = await Rider.findById(req.user._id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    rider.currentLocation = {
      lat,
      lng,
      address: address || rider.currentLocation?.address,
      lastUpdated: new Date()
    };

    await rider.save();

    // ✅ SOCKET EMIT FOR UI UPDATE
    const io = req.app.get('io');
    if (io) {
      console.log("📍 RIDER.JS: Emitting location update");

      // Emit to rider tracking room
      io.to(`rider_${rider._id}`).emit('rider_location_updated', {
        riderId: rider._id,
        location: { lat, lng },
        address: rider.currentLocation.address,
        timestamp: new Date()
      });

      // If rider has current order, notify that order room
      if (rider.currentOrder) {
        const order = await Order.findById(rider.currentOrder);
        if (order) {
          io.to(`order_${order.orderId}`).emit('rider_location_changed', {
            orderId: order.orderId,
            riderId: rider._id,
            riderName: rider.name,
            location: { lat, lng },
            address: rider.currentLocation.address,
            timestamp: new Date()
          });

          console.log(`✅ RIDER.JS: Location update emitted for order ${order.orderId}`);
        }
      }

      console.log("✅ RIDER.JS: Location update emitted");
    }

    res.json({
      success: true,
      message: 'Location updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/v1/rider/orders/available
// @desc    Get available orders for rider
// @access  Private (Rider)
router.get('/orders/available', async (req, res) => {
  try {
    const rider = await Rider.findById(req.user._id);
    if (!rider || !rider.isOnline || !rider.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Rider is not available for orders'
      });
    }

    const availableOrders = await Order.find({
      status: 'ready_for_pickup',
      riderId: { $exists: false }
    })
      .populate('restaurantId', 'name address coordinates')
      .populate('customerId', 'name phone')
      .limit(20);

    const ordersWithDistance = availableOrders.map(order => {
      const restCoords = order.restaurantId?.coordinates;
      const custCoords = order.deliveryAddress?.coordinates;

      const restLat = restCoords?.lat;
      const restLng = restCoords?.lng;
      const custLat = custCoords?.lat;
      const custLng = custCoords?.lng;

      let deliveryDistance = 0;
      if (restLat && restLng && custLat && custLng) {
        deliveryDistance = calculateDistance(restLat, restLng, custLat, custLng);
      }

      const estimatedEarnings = calculateDeliveryEarnings(deliveryDistance, order.finalAmount);

      return {
        ...order.toObject(),
        deliveryDistance: Math.round(deliveryDistance * 100) / 100,
        estimatedEarnings
      };
    });

    // Sort by distance (nearest first)
    ordersWithDistance.sort((a, b) => a.deliveryDistance - b.deliveryDistance);

    res.json({
      success: true,
      data: ordersWithDistance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/v1/rider/orders/:orderId/accept
// @desc    Accept an order for delivery
// @access  Private (Rider)
router.put('/orders/:orderId/accept', async (req, res) => {
  try {
    const rider = await Rider.findById(req.user._id);
    if (!rider || !rider.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Rider is not available'
      });
    }

    const order = await Order.findOne({ orderId: req.params.orderId })
      .populate('restaurantId', 'name coordinates')
      .populate('customerId', 'name phone');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.status !== 'ready_for_pickup') {
      return res.status(400).json({
        success: false,
        message: 'Order is not ready for pickup'
      });
    }

    if (order.riderId) {
      return res.status(400).json({
        success: false,
        message: 'Order already assigned to another rider'
      });
    }

    // ✅ PEHLE EARNINGS CALCULATE KARO
    const restCoords = order.restaurantId?.coordinates;
    const custCoords = order.deliveryAddress?.coordinates;

    const restLat = restCoords?.lat;
    const restLng = restCoords?.lng;
    const custLat = custCoords?.lat;
    const custLng = custCoords?.lng;

    let deliveryDistance = 0;
    if (restLat && restLng && custLat && custLng) {
      deliveryDistance = calculateDistance(restLat, restLng, custLat, custLng);
    }

    const estimatedEarnings = calculateDeliveryEarnings(deliveryDistance, order.finalAmount);

    // Assign order to rider
    order.riderId = rider._id;
    order.status = 'assigned_to_rider';
    order.deliveryInfo = order.deliveryInfo || {};
    order.deliveryInfo.assignedAt = new Date();
    order.deliveryInfo.estimatedDeliveryTime = new Date(Date.now() + 30 * 60 * 1000);
    order.deliveryInfo.riderEarnings = estimatedEarnings;  // ✅ AB SAHI HOGA
    order.deliveryInfo.distance = deliveryDistance;

    // Update rider status
    rider.isAvailable = false;
    rider.currentOrder = order._id;
    rider.totalDeliveries = (rider.totalDeliveries || 0) + 1;

    await Promise.all([order.save(), rider.save()]);

    // ✅ SOCKET EMIT FOR UI UPDATE
    const io = req.app.get('io');
    if (io) {
      console.log("✅ RIDER.JS: Emitting order acceptance updates");

      const rooms = [
        `restaurant_${order.restaurantId._id}`,
        `user_${order.customerId._id}`,
        `order_${order.orderId}`
      ];

      emitSocket(io, rooms, 'order_assigned_to_rider', {
        orderId: order.orderId,
        orderMongoId: order._id,
        rider: {
          id: rider._id,
          name: rider.name,
          phone: rider.phone,
          vehicleType: rider.vehicleType,
          vehicleNo: rider.vehicleNo
        },
        customerId: order.customerId._id,
        restaurantId: order.restaurantId._id,
        estimatedDeliveryTime: order.deliveryInfo.estimatedDeliveryTime,
        timestamp: new Date()
      });

      io.to('riders_room').emit('order_accepted', {
        orderId: order.orderId,
        acceptedBy: rider.name,
        timestamp: new Date()
      });
    }

    // ✅ EARNINGS KE SAATH RESPONSE BHEJO
    const orderWithEarnings = {
      ...order.toObject(),
      deliveryDistance: Math.round(deliveryDistance * 100) / 100,
      estimatedEarnings: estimatedEarnings
    };

    res.json({
      success: true,
      message: 'Order accepted successfully',
      data: {
        order: orderWithEarnings,
        estimatedDeliveryTime: order.deliveryInfo.estimatedDeliveryTime
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/v1/rider/orders/accepted
// @desc    Get accepted/ongoing orders for rider
// @access  Private (Rider)
router.get('/orders/accepted', async (req, res) => {
  try {
    const acceptedOrders = await Order.find({
      riderId: req.user._id,
      status: { 
        $in: ['assigned_to_rider', 'picked_up', 'out_for_delivery'] 
      }
    })
    .populate('restaurantId', 'name address')
    .populate('customerId', 'name phone')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: acceptedOrders
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/v1/rider/orders/:orderId/status
// @desc    Update order delivery status
// @access  Private (Rider)
router.put('/orders/:orderId/status', async (req, res) => {
  try {
    const { status, note, lat, lng } = req.body;
    const validStatuses = ['picked_up', 'out_for_delivery', 'arrived_at_location', 'delivered', 'failed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const rider = await Rider.findById(req.user._id);
    const order = await Order.findOne({
      orderId: req.params.orderId,
      riderId: rider._id
    })
      .populate('restaurantId', 'name')
      .populate('customerId', 'name');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const previousStatus = order.status;
    order.status = status;

    // Update status history
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status,
      updatedBy: rider._id,
      note,
      timestamp: new Date(),
      ...(lat && lng && { location: { lat, lng } })
    });

    // Handle specific status updates
    if (status === 'picked_up') {
      order.deliveryInfo.pickedUpAt = new Date();
    } else if (status === 'delivered') {
      order.deliveredAt = new Date();
      order.deliveryInfo.deliveredAt = new Date();
      order.deliveryInfo.actualDeliveryTime = new Date();

      // COD payment auto-completion
      if (order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
      }

      // Update rider stats and make available
      rider.totalDeliveries += 1;
      rider.completedDeliveries += 1;
      rider.isAvailable = true;
      rider.currentOrder = null;

      // Calculate and assign earnings
      const distance = isNaN(order.deliveryInfo.distance) ? 0 : order.deliveryInfo.distance || 5;
      const earnings = calculateDeliveryEarnings(distance, order.finalAmount);
      rider.earnings = rider.earnings || {};
      rider.earnings.total = (rider.earnings.total || 0) + earnings;
      rider.earnings.weekly = (rider.earnings.weekly || 0) + earnings;
      rider.earnings.monthly = (rider.earnings.monthly || 0) + earnings;
      order.deliveryInfo.riderEarnings = earnings;
    } else if (status === 'failed') {
      rider.cancelledDeliveries = (rider.cancelledDeliveries || 0) + 1;
      rider.isAvailable = true;
      rider.currentOrder = null;
    }

    await Promise.all([order.save(), rider.save()]);

    // ✅ SOCKET EMIT FOR UI UPDATE
    const io = req.app.get('io');
    if (io) {
      console.log("🔄 RIDER.JS: Emitting order status update");

      const rooms = [
        `user_${order.customerId._id}`,
        `restaurant_${order.restaurantId._id}`,
        `order_${order.orderId}`
      ];

      emitSocket(io, rooms, 'order_delivery_status_updated', {
        orderId: order.orderId,
        orderMongoId: order._id,
        status,
        previousStatus,
        riderId: rider._id,
        riderName: rider.name,
        customerId: order.customerId._id,
        restaurantId: order.restaurantId._id,
        note,
        timestamp: new Date()
      });

      // Emit payment update for COD orders
      if (status === 'delivered' && order.paymentMethod === 'cod') {
        io.to(`user_${order.customerId._id}`).emit('payment_update', {
          orderId: order.orderId,
          paymentStatus: 'paid'
        });
      }

      console.log("✅ RIDER.JS: Socket events emitted for status update");
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: {
        order,
        ...(status === 'delivered' && { earnings: order.deliveryInfo.riderEarnings })
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/v1/rider/orders/current
// @desc    Get current assigned orders
// @access  Private (Rider)
router.get('/orders/current', async (req, res) => {
  try {
    const rider = await Rider.findById(req.user._id);
    const currentOrders = await Order.find({
      riderId: rider._id,
      status: { $in: ['assigned_to_rider', 'picked_up', 'out_for_delivery', 'arrived_at_location'] }
    })
      .populate('restaurantId', 'name address coordinates')
      .populate('customerId', 'name phone deliveryAddress')
      .sort({ 'deliveryInfo.assignedAt': -1 });

    res.json({
      success: true,
      data: currentOrders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/v1/rider/earnings
// @desc    Get rider earnings and analytics
// @access  Private (Rider)
router.get('/earnings', async (req, res) => {
  try {
    const rider = await Rider.findById(req.user._id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    // Get recent completed orders for detailed analytics
    const recentDeliveries = await Order.find({
      riderId: rider._id,
      status: 'delivered'
    })
      .sort({ deliveredAt: -1 })
      .limit(50)
      .select('deliveryInfo.riderEarnings deliveredAt');

    const analytics = {
      totalEarnings: rider.earnings?.total || 0,
      weeklyEarnings: rider.earnings?.weekly || 0,
      monthlyEarnings: rider.earnings?.monthly || 0,
      totalDeliveries: rider.totalDeliveries || 0,
      completedDeliveries: rider.completedDeliveries || 0,
      cancellationRate: ((rider.cancelledDeliveries || 0) / (rider.totalDeliveries || 1)) * 100,
      averageRating: rider.averageRating || 0,
      recentDeliveries: recentDeliveries.map(d => ({
        earnings: d.deliveryInfo?.riderEarnings || 0,
        deliveredAt: d.deliveredAt
      }))
    };

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/v1/rider/history
// @desc    Get rider delivery history
// @access  Private (Rider)
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (page - 1) * limit;

    const filter = { riderId: req.user._id };
    if (status) filter.status = status;

    const deliveries = await Order.find(filter)
      .populate('restaurantId', 'name address')
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: deliveries,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalDeliveries: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;


// @route   PUT /api/v1/rider/profile
// @desc    Update rider profile
// @access  Private (Rider)
// router.put('/profile', async (req, res) => {
//   try {
//     const {
//       name,
//       email,
//       vehicleType,
//       vehicleNo,
//       licenseNumber,
//       bankAccountNumber,
//       bankIFSC,
//       aadharNumber,
//       profilePicture
//     } = req.body;

//     // Sirf wohi fields update karo jo bheji gayi hain
//     const updateFields = {};
//     if (name !== undefined) updateFields.name = name;
//     if (email !== undefined) updateFields.email = email;
//     if (vehicleType !== undefined) updateFields.vehicleType = vehicleType;
//     if (vehicleNo !== undefined) updateFields.vehicleNo = vehicleNo;
//     if (licenseNumber !== undefined) updateFields.licenseNumber = licenseNumber;
//     if (bankAccountNumber !== undefined) updateFields.bankAccountNumber = bankAccountNumber;
//     if (bankIFSC !== undefined) updateFields.bankIFSC = bankIFSC;
//     if (aadharNumber !== undefined) updateFields.aadharNumber = aadharNumber;
//     if (profilePicture !== undefined) updateFields.profilePicture = profilePicture;

//     if (Object.keys(updateFields).length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No valid fields to update'
//       });
//     }

//     const rider = await Rider.findByIdAndUpdate(
//       req.user._id,
//       { $set: updateFields },
//       { new: true, runValidators: true }
//     );

//     if (!rider) {
//       return res.status(404).json({
//         success: false,
//         message: 'Rider not found'
//       });
//     }

//     res.json({
//       success: true,
//       message: 'Profile updated successfully',
//       data: rider
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// });
// router.put('/profile', async (req, res) => {
//   try {
//     const { name, email, vehicleType, vehicleNo, licenseNumber } = req.body;

//     const rider = await Rider.findByIdAndUpdate(
//       req.user._id,
//       {
//         name,
//         email,
//         vehicleType,
//         vehicleNo,
//         licenseNumber
//       },
//       { new: true, runValidators: true }
//     );

//     res.json({
//       success: true,
//       message: 'Profile updated successfully',
//       data: rider
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Server error',
//       error: error.message
//     });
//   }
// });

