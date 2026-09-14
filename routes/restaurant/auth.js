const express = require("express");
const router = express.Router();
const authController = require("../../controllers/authController");
const User = require("../../models/User");
const RestaurantUser = require("../../models/RestaurantUser");
const Restaurant = require("../../models/Restaurant");
const OTP = require("../../models/OTP");
const { auth, requireRole } = require("../../middlewares/auth");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, JPEG, PNG, WEBP, PDF are allowed.'), false);
    }
  }
});

const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Max 10MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: 'Too many files' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

// STEP 1: Initial restaurant registration
router.post('/initial', async (req, res, next) => {
  try {
    const { businessName, ownerName, phone, email, cuisines, city, minOrderAmount } = req.body;

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

// STEP 2: Complete Restaurant onboarding & document upload
router.post(
  "/complete",
  auth,
  requireRole(["restaurant"]),
  upload.fields([
    { name: "gstCertificate", maxCount: 1 },
    { name: "restaurantImages", maxCount: 5 }
  ]),
  handleUploadErrors,
  authController.completeRestaurant
);

// Check registration status
router.get('/registration-status/:phone', async (req, res, next) => {
  try {
    const { phone } = req.params;
    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No registration found'
      });
    }

    const restaurantUser = await RestaurantUser.findById(user._id);
    let details = {
      businessName: 'Profile incomplete',
      city: 'N/A',
      isProfileComplete: false
    };

    if (restaurantUser && restaurantUser.restaurantId) {
      const restaurant = await Restaurant.findById(restaurantUser.restaurantId);
      details = {
        businessName: restaurant ? restaurant.name : restaurantUser.businessName,
        city: restaurant ? restaurant.address?.city : 'N/A',
        isProfileComplete: true
      };
    }

    res.json({
      success: true,
      data: {
        phone,
        role: user.role,
        isVerified: user.isVerified,
        isActive: user.isActive,
        details
      }
    });
  } catch (err) {
    next(err);
  }
});

// Resend OTP for restaurant
router.post('/resend-otp', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.deleteMany({ phone });
    await OTP.create({
      phone,
      otp,
      expiresAt,
      role: 'restaurant',
      isUsed: false
    });

    console.log(`📱 Restaurant OTP for ${phone}: ${otp}`);

    res.json({
      success: true,
      message: 'OTP resent successfully',
      debug_otp: otp
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
