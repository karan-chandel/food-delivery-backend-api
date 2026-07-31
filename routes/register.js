const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Rider = require('../models/Rider');
const RestaurantUser = require('../models/RestaurantUser');
const Restaurant = require('../models/Restaurant');
const OTP = require('../models/OTP');
const { auth } = require('../middlewares/auth');
const { upload, handleUploadErrors } = require('../middlewares/upload');
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

const handleRiderUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        message: 'File too large. Max 5MB.' 
      });
    }
    return res.status(400).json({ 
      success: false, 
      message: err.message 
    });
  }
  if (err) {
    return res.status(400).json({ 
      success: false, 
      message: err.message 
    });
  }
  next();
};

// ============================================
// RIDER REGISTRATION FLOW (Consistent with Restaurant)
// ============================================

// STEP 1: Initial rider registration
router.post('/rider/initial', async (req, res, next) => {
  try {
    const { phone, name, email } = req.body;

    if (!phone || !name) {
      return res.status(400).json({
        success: false,
        error: 'Phone and name are required'
      });
    }

    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number'
      });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Phone number already registered'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Initial registration data received. Please complete rider details.',
      data: { phone, name, email, role: 'rider' }
    });

  } catch (err) {
    next(err);
  }
});

// STEP 2: Complete rider registration (with token)

 router.post('/rider/complete', 
  auth,
  riderUpload.fields([
    { name: 'licensePhoto', maxCount: 1 },
    { name: 'vehiclePhoto', maxCount: 1 }
  ]), 
  handleUploadErrors, 
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const user = await User.findById(userId);
      const phone = user.phone;
      
      const {
        name, email, vehicleType, vehicleNo, licenseNumber,
        bankAccountNumber, bankIFSC, aadharNumber
      } = req.body;

      // Validation
      if (!vehicleType || !vehicleNo || !licenseNumber) {
        if (req.files?.licensePhoto?.[0]) fs.unlinkSync(req.files.licensePhoto[0].path);
        if (req.files?.vehiclePhoto?.[0]) fs.unlinkSync(req.files.vehiclePhoto[0].path);
        
        return res.status(400).json({
          success: false,
          error: 'Vehicle type, vehicle number, and license number are required'
        });
      }
  let userUpdated = false;
      if (name && name !== '') {
        user.name = name;
        userUpdated = true;
      }
      if (email && email !== '') {
        user.email = email;
        userUpdated = true;
      }
      
      if (userUpdated) {
        await user.save();
        console.log(`✅ User model updated: name=${user.name}, email=${user.email}`);
      }
      // Check if rider already exists
      const existingRider = await Rider.findOne({ _id: userId });
      
      // Update base user
      // const userUpdate = {};
      // if (name && name !== '') userUpdate.name = name;
      // if (email && email !== '') userUpdate.email = email;
      
      // if (Object.keys(userUpdate).length > 0) {
      //   await User.findByIdAndUpdate(userId, userUpdate);
      // }

      // Prepare rider data
      const riderData = {
        _id: userId,
        phone: phone,
        name: name || user.name,
        email: email || user.email || null,
        role: 'rider',
        isVerified: user.isVerified || false, // Keep existing verification status
        vehicleType,
        vehicleNo,
        licenseNumber,
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

      let newRider;
      let message;
      let isUpdate = false;

      if (existingRider) {
        // ✅ UPDATE EXISTING RIDER
        const updateData = {};
        if (riderData.name) updateData.name = riderData.name;
        if (riderData.email) updateData.email = riderData.email;
        if (riderData.vehicleType) updateData.vehicleType = riderData.vehicleType;
        if (riderData.vehicleNo) updateData.vehicleNo = riderData.vehicleNo;
        if (riderData.licenseNumber) updateData.licenseNumber = riderData.licenseNumber;
        if (riderData.bankAccountNumber) updateData.bankAccountNumber = riderData.bankAccountNumber;
        if (riderData.bankIFSC) updateData.bankIFSC = riderData.bankIFSC;
        if (riderData.aadharNumber) updateData.aadharNumber = riderData.aadharNumber;
        if (riderData.licensePhoto) updateData.licensePhoto = riderData.licensePhoto;
        if (riderData.vehiclePhoto) updateData.vehiclePhoto = riderData.vehiclePhoto;
        
        newRider = await Rider.findByIdAndUpdate(
          userId,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        message = existingRider.isVerified 
          ? 'Profile updated successfully!' 
          : 'Rider registration updated. Waiting for admin approval.';
        isUpdate = true;
      } else {
        // ✅ CREATE NEW RIDER
        newRider = await Rider.create(riderData);
        message = 'Rider registration completed successfully. Waiting for admin approval.';
        isUpdate = false;
      }
const freshUser = await User.findById(userId);
      res.status(isUpdate ? 200 : 201).json({
        success: true,
        message: message,
        isUpdate: isUpdate,
        isVerified: newRider.isVerified,
        user: {
          id: freshUser._id,
          name: newRider.name,
          phone: freshUser.phone,
          email: newRider.email,
          role: freshUser.role,
          isVerified: newRider.isVerified,
          vehicleType: newRider.vehicleType,
          vehicleNo: newRider.vehicleNo,
          licenseNumber: newRider.licenseNumber,
          hasLicensePhoto: !!newRider.licensePhoto,
          hasVehiclePhoto: !!newRider.vehiclePhoto
        },
        data: {
          riderId: newRider._id,
          name: newRider.name,
          phone: phone,
          verificationStatus: newRider.isVerified ? 'verified' : 'pending',
          vehicleType: newRider.vehicleType,
          vehicleNo: newRider.vehicleNo
        }
      });

    } catch (err) {
      console.error('❌ Rider registration error:', err);
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
// ============================================
// RESTAURANT REGISTRATION - FIXED VERSION
// ============================================

// STEP 1: Initial restaurant registration
router.post('/restaurant/initial', async (req, res, next) => {
  try {
    const { businessName, ownerName, phone, email, cuisines, city, minOrderAmount } = req.body;

    // Validation
    if (!businessName || !ownerName || !phone || !city) {
      return res.status(400).json({
        success: false,
        error: 'Business name, owner name, phone, and city are required'
      });
    }

    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number'
      });
    }

    // Check if phone already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Phone number already registered'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Initial registration data received. Please complete restaurant details.',
      data: { phone, businessName, role: 'restaurant' }
    });

  } catch (err) {
    next(err);
  }
});

// ✅✅✅ CORRECT VERSION - Sirf Token Se Phone ✅✅✅
router.post('/restaurant/complete', 
  auth,  // ✅ Auth laga do (token verify karega)
  upload.single('gstCertificate'), 
  handleUploadErrors, 
  async (req, res, next) => {
    try {
      // ========================================
      // TOKEN SE SAB KUCH MIL JAYEGA
      // ========================================
      const userId = req.user._id;     // ✅ Token se user ID
      const user = await User.findById(userId);
      
      // ❌ Body se phone MAT lo
      // ✅ Token wala phone use karo
      const phone = user.phone;        // ✅ Token se phone number
      
      // ========================================
      // BODY SE SIRF YEH FIELDS LO
      // ========================================
      const {
        businessName,
        ownerName,
        email,
        cuisines,
        addressLine1,
        addressLine2,
        city,
        state,
        pincode,
        latitude,
        longitude,
        gstNumber,
        fssaiNumber,
        minOrderAmount,
        deliveryFee,
        deliveryTime,
        bankAccountNumber,
        bankIFSC,
        upiId
      } = req.body;

      // ========================================
      // VALIDATION
      // ========================================
      if (!businessName || !addressLine1 || !city || !state || !pincode) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          success: false,
          error: 'Business name, address line1, city, state, and pincode are required'
        });
      }

      // ========================================
      // CHECK DUPLICATE RESTAURANT
      // ========================================
      const existingRestaurant = await Restaurant.findOne({ ownerId: userId });
      if (existingRestaurant) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          success: false,
          error: 'You have already registered a restaurant'
        });
      }

      // ========================================
      // CREATE RESTAURANT (TOKEN WALA PHONE USE KARO)
      // ========================================
      const restaurantData = {
        name: businessName,
        description: '',
        cuisine: cuisines ? cuisines.split(',').map(c => c.trim()) : [],
        address: {
          addressLine1,
          addressLine2: addressLine2 || null,
          city,
          state,
          pincode,
          geolocation: {
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null
          }
        },
        contact: {
          phone: phone,  // ✅ Token se aaya phone (body se nahi)
          email: email || user.email || null
        },
        minOrderAmount: minOrderAmount ? parseFloat(minOrderAmount) : 0,
        deliveryFee: deliveryFee ? parseFloat(deliveryFee) : 0,
        deliveryTime: deliveryTime || '30-45 mins',
        isActive: false,
        isOpen: false,
        gstNumber: gstNumber || null,
        fssaiNumber: fssaiNumber || null,
        ownerId: userId,
        createdBy: userId
      };

      const restaurant = await Restaurant.create(restaurantData);

      // ========================================
      // UPDATE RESTAURANT USER
      // ========================================
      let restaurantUser = await RestaurantUser.findById(userId);
      
      if (!restaurantUser) {
        restaurantUser = await RestaurantUser.create({
          _id: userId,
          phone: phone,  // ✅ Token se
          name: ownerName || user.name,
          email: email || user.email,
          role: 'restaurant',
          isVerified: false,
          businessName: businessName,
          gstNumber: gstNumber || null,
          restaurantId: restaurant._id,
          bankAccountNumber: bankAccountNumber || null,
          bankIFSC: bankIFSC || null,
          upiId: upiId || null
        });
      } else {
        restaurantUser.businessName = businessName;
        restaurantUser.gstNumber = gstNumber || null;
        restaurantUser.restaurantId = restaurant._id;
        restaurantUser.bankAccountNumber = bankAccountNumber || null;
        restaurantUser.bankIFSC = bankIFSC || null;
        restaurantUser.upiId = upiId || null;
        if (ownerName) restaurantUser.name = ownerName;
        if (email) restaurantUser.email = email;
        await restaurantUser.save();
      }

      // ========================================
      // HANDLE GST CERTIFICATE
      // ========================================
      if (req.file) {
        restaurantUser.gstCertificate = `/uploads/menu-items/${req.file.filename}`;
        await restaurantUser.save();
      }

      // ========================================
      // UPDATE BASE USER
      // ========================================
      if (ownerName) user.name = ownerName;
      if (email) user.email = email;
      await user.save();

      // ========================================
      // SEND RESPONSE (NO NEED TO GENERATE NEW TOKEN)
      // ========================================
      res.status(201).json({
        success: true,
        message: 'Restaurant registration completed successfully. Waiting for admin approval.',
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,  // ✅ Token wala phone
          email: user.email,
          role: user.role,
          isVerified: user.isVerified,
          restaurantId: restaurant._id,
          businessName: businessName
        },
        data: {
          restaurantId: restaurant._id,
          restaurantUserId: restaurantUser._id,
          businessName: restaurant.name,
          phone: phone,
          verificationStatus: 'pending',
          city: restaurant.address.city
        }
      });

    } catch (err) {
      console.error('❌ Restaurant registration error:', err);
      if (req.file) fs.unlinkSync(req.file.path);
      next(err);
    }
  }
);

// ============================================
// CHECK REGISTRATION STATUS
// ============================================

router.get('/registration-status/:phone', async (req, res, next) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No registration found'
      });
    }

    const statusData = {
      phone,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive
    };

    if (user.role === 'rider') {
      const rider = await Rider.findById(user._id);
      if (rider) {
        statusData.details = {
          name: rider.name,
          vehicleNo: rider.vehicleNo,
          documents: {
            licensePhoto: !!rider.licensePhoto,
            vehiclePhoto: !!rider.vehiclePhoto
          }
        };
      }
    } else if (user.role === 'restaurant') {
      const restaurantUser = await RestaurantUser.findById(user._id);
      if (restaurantUser && restaurantUser.restaurantId) {
        const restaurant = await Restaurant.findById(restaurantUser.restaurantId);
        statusData.details = {
          businessName: restaurant ? restaurant.name : restaurantUser.businessName,
          city: restaurant ? restaurant.address.city : 'N/A',
          isProfileComplete: !!restaurantUser.restaurantId
        };
      } else {
        statusData.details = {
          businessName: 'Profile incomplete',
          city: 'N/A',
          isProfileComplete: false
        };
      }
    }

    res.json({
      success: true,
      data: statusData
    });

  } catch (err) {
    next(err);
  }
});

// ============================================
// RESEND OTP
// ============================================

router.post('/resend-otp', async (req, res, next) => {
  try {
    const { phone, role } = req.body;

    if (!phone || !role) {
      return res.status(400).json({
        success: false,
        error: 'Phone and role are required'
      });
    }

    if (!['customer', 'rider', 'restaurant'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role'
      });
    }

    // Generate OTP
    const generateOTP = () => {
      return Math.floor(100000 + Math.random() * 900000).toString();
    };

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete old OTP and create new one
    await OTP.deleteMany({ phone });
    await OTP.create({
      phone,
      otp,
      expiresAt,
      role,
      isUsed: false
    });

    console.log(`📱 OTP for ${phone} (${role}): ${otp}`);

    res.json({
      success: true,
      message: 'OTP resent successfully',
      debug_otp: otp  // Remove this in production
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;