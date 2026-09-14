const express = require("express");
const router = express.Router();
const authController = require("../../controllers/authController");
const { auth, requireRole } = require("../../middlewares/auth");
const { otpLimiter } = require("../../middlewares/security");

// Customer Authentication & Profile
router.post("/send-otp", otpLimiter, authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);

router.get("/profile", auth, requireRole(['customer']), authController.getProfile);
router.put("/profile", auth, requireRole(['customer']), authController.updateProfile);

router.post("/favorites", auth, requireRole(['customer']), authController.addFavorite);
router.post("/rate/restaurant", auth, requireRole(['customer']), authController.rateRestaurant);
router.post("/rate/rider", auth, requireRole(['customer']), authController.rateRider);
router.post("/address", auth, requireRole(['customer']), authController.addAddress);

module.exports = router;
