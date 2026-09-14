const express = require("express");
const router = express.Router();
const authController = require("../../controllers/authController");
const User = require("../../models/User");
const Rider = require("../../models/Rider");
const OTP = require("../../models/OTP");
const { auth, requireRole } = require("../../middlewares/auth");
const multer = require("multer");

const riderUpload = multer({
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

const handleRiderUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Max 10MB.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

// STEP 1: Initial rider registration
router.post('/initial', async (req, res, next) => {
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

// STEP 2: Rider complete onboarding & license/vehicle upload
router.post(
  "/complete",
  auth,
  requireRole(["rider"]),
  riderUpload.fields([
    { name: "licensePhoto", maxCount: 1 },
    { name: "vehiclePhoto", maxCount: 1 }
  ]),
  handleRiderUploadErrors,
  authController.completeRider
);

// Check rider registration status
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

    const rider = await Rider.findById(user._id);
    const details = rider ? {
      name: rider.name,
      vehicleNo: rider.vehicleNo,
      documents: {
        licensePhoto: !!rider.licensePhoto,
        vehiclePhoto: !!rider.vehiclePhoto
      }
    } : null;

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

// Resend OTP for rider
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
      role: 'rider',
      isUsed: false
    });

    console.log(`📱 Rider OTP for ${phone}: ${otp}`);

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
