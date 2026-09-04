const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { auth, requireRole } = require("../middlewares/auth");
const { otpLimiter } = require("../middlewares/security");
const multer = require('multer');

// Storage configuration using memory storage (Buffer streams to Cloudinary)
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

const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Max 5MB.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files'
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

// Endpoints
router.post("/send-otp", otpLimiter, authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);

router.get("/profile", auth, authController.getProfile);
router.put("/profile", auth, authController.updateProfile);

router.post("/favorites", auth, requireRole(['customer']), authController.addFavorite);
router.post("/rate/restaurant", auth, requireRole(["customer"]), authController.rateRestaurant);
router.post("/rate/rider", auth, requireRole(["customer"]), authController.rateRider);
router.post("/address", auth, requireRole(['customer']), authController.addAddress);

router.post('/rider/complete',
  auth,
  riderUpload.fields([
    { name: 'licensePhoto', maxCount: 1 },
    { name: 'vehiclePhoto', maxCount: 1 }
  ]),
  handleRiderUploadErrors,
  authController.completeRider
);

router.post('/restaurant/complete',
  auth,
  upload.fields([
    { name: 'gstCertificate', maxCount: 1 },
    { name: 'restaurantImages', maxCount: 5 }
  ]),
  handleUploadErrors,
  authController.completeRestaurant
);

module.exports = router;
