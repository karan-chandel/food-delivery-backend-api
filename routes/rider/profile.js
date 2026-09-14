const express = require('express');
const router = express.Router();
const riderController = require('../../controllers/riderController');
const { auth, requireRole } = require('../../middlewares/auth');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const riderDocsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const riderDir = path.join(__dirname, '../../uploads/riders');
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

router.use(auth);
router.use(requireRole(['rider', 'admin', 'super_admin']));

router.get('/', riderController.getRiderProfile);
router.get('/profile', riderController.getRiderProfile);

router.put('/', riderUpload.fields([{ name: 'licensePhoto', maxCount: 1 }, { name: 'vehiclePhoto', maxCount: 1 }]), handleUploadErrors, riderController.updateRiderProfile);
router.put('/profile', riderUpload.fields([{ name: 'licensePhoto', maxCount: 1 }, { name: 'vehiclePhoto', maxCount: 1 }]), handleUploadErrors, riderController.updateRiderProfile);

router.put('/availability', riderController.updateRiderAvailability);
router.get('/earnings', riderController.getRiderEarnings);
router.get('/history', riderController.getRiderHistory);

module.exports = router;
