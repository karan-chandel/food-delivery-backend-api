const express = require("express");
const router = express.Router();
const authController = require("../../controllers/authController");
const { auth, requireRole } = require("../../middlewares/auth");
const { otpLimiter } = require("../../middlewares/security");

// Customer Authentication & Profile
router.post("/send-otp", otpLimiter, authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);

// Token Lifecycle (TSK-202)
router.post("/refresh-token", authController.refreshToken);
router.post("/refresh", authController.refreshToken);
router.post("/logout", authController.logout);

router.get("/profile", auth, requireRole(['customer']), authController.getProfile);
router.put("/profile", auth, requireRole(['customer']), authController.updateProfile);

router.post("/favorites", auth, requireRole(['customer']), authController.addFavorite);
router.post("/rate/restaurant", auth, requireRole(['customer']), authController.rateRestaurant);
router.post("/rate/rider", auth, requireRole(['customer']), authController.rateRider);
router.post("/address", auth, requireRole(['customer']), authController.addAddress);
router.put("/address/:addressId", auth, requireRole(['customer']), authController.updateAddress);
router.delete("/address/:addressId", auth, requireRole(['customer']), authController.deleteAddress);
router.patch("/address/:addressId/default", auth, requireRole(['customer']), authController.setDefaultAddress);

module.exports = router;
