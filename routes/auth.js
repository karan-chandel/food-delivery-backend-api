const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Customer = require("../models/Customer");
const Rider = require("../models/Rider");
const RestaurantUser = require("../models/RestaurantUser");
const OTP = require("../models/OTP");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/config");
const { auth, requireRole } = require("../middlewares/auth");
const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { uploadBufferToCloudinary } = require('../middlewares/upload');

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
// GLOBAL UPLOAD ERROR HANDLER
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
// Generate random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP API
router.post("/send-otp", async (req, res, next) => {
  try {
    const { phone, role = 'customer' } = req.body;

    // Validation
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required"
      });
    }

    if (!['customer', 'rider', 'restaurant'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role. Must be customer, rider, or restaurant"
      });
    }

    // Validate phone number
    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number"
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await OTP.create({
      phone,
      otp,
      expiresAt,
      role
    });

    console.log(`OTP for ${phone} (${role}): ${otp}`);

    res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      debug_otp: otp
    });

  } catch (err) {
    next(err);
  }
});

// ✅ FIXED: Verify OTP - Proper role handling
router.post("/verify-otp", async (req, res, next) => {
  try {
    const { phone, otp, email, name, address, additionalData } = req.body;

    // Validation
    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        error: "Phone and OTP are required"
      });
    }

    // ✅ Find and mark OTP used
    const otpRecord = await OTP.findOneAndUpdate(
      { phone, otp, isUsed: false, expiresAt: { $gt: new Date() } },
      { $set: { isUsed: true } },
      { new: true }
    );

    if (!otpRecord) {
      return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
    }

    // ✅ DEBUG: Check what role we're getting from OTP
    console.log(`📱 OTP Record - Phone: ${phone}, OTP Role: ${otpRecord.role}`);

    // ✅ Always trust OTP's role
    const otpRole = otpRecord.role;

    // ✅ UPDATED: Role-based verification logic
    const getVerificationStatus = (role) => {
      // Customers are auto-verified, riders/restaurants need manual verification
      return role === 'customer' ? true : false;
    };



    const isVerified = getVerificationStatus(otpRole);
    // ✅ Find existing user
    let baseUser = await User.findOne({ phone });
    let roleSpecificUser = null;
    let isNewUser = false;

    if (!baseUser) {
      // 🆕 NEW USER - Create fresh with OTP role
      isNewUser = true;

      const baseUserData = {
        phone,
        name: name || `User${phone.slice(-4)}`,
        email: email || null,
        role: otpRole, // ✅ Use OTP role here
        isVerified: isVerified, // ✅ Set verification status based on role
        lastLogin: new Date()
      };

      // 1️⃣ Create base user
      baseUser = await User.create(baseUserData);
      console.log(`✅ New ${otpRole} user created: ${baseUser._id}, Role: ${baseUser.role}, Verified: ${baseUser.isVerified}`);

      // 2️⃣ Create role-specific record based on OTP role
      switch (otpRole) {
        case 'customer':
          roleSpecificUser = await Customer.create({
            ...baseUserData,
            _id: baseUser._id,
            favorites: [],
            orders: [],
            loyaltyPoints: 0,
            totalOrders: 0,
            totalSpent: 0
          });
          console.log(`✅ Customer record created (Auto-verified)`);
          break;

        case 'rider':
          roleSpecificUser = await Rider.create({
            ...baseUserData,
            _id: baseUser._id,
            vehicleNo: additionalData?.vehicleNo || 'NOT_SET',
            vehicleType: additionalData?.vehicleType || 'bike',
            licenseNumber: additionalData?.licenseNumber || null,
            currentLocation: additionalData?.currentLocation || null,
            isAvailable: false,
            earnings: 0,
            totalDeliveries: 0,
            rating: 0
          });
          console.log(`✅Rider record created (Pending verification)`);
          break;

        case 'restaurant':
          roleSpecificUser = await RestaurantUser.create({
            ...baseUserData,
            _id: baseUser._id,
            restaurantId: additionalData?.restaurantId || null,
            businessName: additionalData?.businessName || 'NOT_SET',
            gstNumber: additionalData?.gstNumber || null,
            totalEarnings: 0,
            totalOrders: 0
          });
          console.log(`✅ RestaurantUser record created (Pending verification)`);
          break;

        default:
          // Fallback to customer if unknown role
          roleSpecificUser = await Customer.create({
            ...baseUserData,
            _id: baseUser._id
          });
          console.log(`⚠️ Default Customer record created`);
      }

      // Add address if given
      // if (address && baseUser.addresses) {
      if (address && baseUser.role === 'customer') {
        const customer = await Customer.findById(baseUser._id);
        if (customer) {
          customer.addresses.push(address);
          await customer.save();
        }
      }
      // Add address if given (only for customers)

      // if (address && baseUser.role === 'customer' && baseUser.addresses) {
      //   baseUser.addresses.push(address);
      //   await baseUser.save();
      // }

    } else {
      // 🔄 EXISTING USER - Check if OTP role matches existing role
      if (baseUser.role !== otpRole) {
        return res.status(400).json({
          success: false,
          error: `This phone number is already registered as ${baseUser.role}. Please use ${baseUser.role} login or use a different phone number.`
        });
      }
      // ✅ UPDATED: Check verification status for login
      if (!baseUser.isVerified && baseUser.role !== 'customer') {
        console.log(`⚠️ Pending ${baseUser.role} login: ${phone}`);
        // Don't return error - continue with login
      }
      // if (!baseUser.isVerified && baseUser.role !== 'customer') {
      //   return res.status(403).json({
      //     success: false,
      //     error: `Your ${baseUser.role} account is pending verification. Please contact admin or wait for verification.`
      //   });

      // }
      // ✅ SAME ROLE - Update lastLogin and details
      const updateData = { lastLogin: new Date() };
      if (name) updateData.name = name;
      if (email) updateData.email = email;

      baseUser = await User.findByIdAndUpdate(baseUser._id, updateData, { new: true });
      // console.log(`✅ Existing ${baseUser.role} user logged in`);
      console.log(`✅ Existing ${baseUser.role} user logged in, Verified: ${baseUser.isVerified}`);
      // Update role-specific user 
      switch (baseUser.role) {
        case 'customer':
          roleSpecificUser = await Customer.findByIdAndUpdate(
            baseUser._id,
            updateData,
            { new: true }
          );
          break;

        case 'rider':
          roleSpecificUser = await Rider.findByIdAndUpdate(
            baseUser._id,
            updateData,
            { new: true }
          );
          break;

        case 'restaurant':
          roleSpecificUser = await RestaurantUser.findByIdAndUpdate(
            baseUser._id,
            updateData,
            { new: true }
          );
          break;
      }
    }

    // ✅ DEBUG: Check final user role before JWT
    // console.log(`🎯 Final User Role: ${baseUser.role}`);
    console.log(`🎯 Final User Role: ${baseUser.role}, Verified: ${baseUser.isVerified}`);
    // ✅ Generate JWT with correct role
    const token = jwt.sign(
      {
        userId: baseUser._id, phone: baseUser.phone, role: baseUser.role, isVerified: baseUser.isVerified // ✅ Include verification status in JWT
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // ✅ Build response
    let userResponse = {
      id: baseUser._id,
      name: baseUser.name,
      phone: baseUser.phone,
      email: baseUser.email,
      profilePicture: baseUser.profilePicture,
      addresses: baseUser.addresses || [],
      role: baseUser.role, // ✅ Use baseUser.role here
      isVerified: baseUser.isVerified, // ✅ Include verification status in response
      lastLogin: baseUser.lastLogin
    };

    // Add role-specific data based on FINAL user role
    if (baseUser.role === 'customer' && roleSpecificUser) {
      userResponse.favorites = roleSpecificUser.favorites || [];
      userResponse.orders = roleSpecificUser.orders || [];
      userResponse.loyaltyPoints = roleSpecificUser.loyaltyPoints || 0;
      userResponse.totalOrders = roleSpecificUser.totalOrders || 0;
      userResponse.totalSpent = roleSpecificUser.totalSpent || 0;
    } else if (baseUser.role === 'restaurant' && roleSpecificUser) {
      userResponse.restaurantId = roleSpecificUser.restaurantId;
      userResponse.businessName = roleSpecificUser.businessName;
      userResponse.gstNumber = roleSpecificUser.gstNumber;
      userResponse.totalEarnings = roleSpecificUser.totalEarnings || 0;
      userResponse.totalOrders = roleSpecificUser.totalOrders || 0;
    } else if (baseUser.role === 'rider' && roleSpecificUser) {
      userResponse.vehicleNo = roleSpecificUser.vehicleNo;
      userResponse.vehicleType = roleSpecificUser.vehicleType;
      userResponse.isAvailable = roleSpecificUser.isAvailable;
      userResponse.licenseNumber = roleSpecificUser.licenseNumber;
      userResponse.currentLocation = roleSpecificUser.currentLocation;
      userResponse.totalDeliveries = roleSpecificUser.totalDeliveries || 0;
      userResponse.rating = roleSpecificUser.rating;
      userResponse.earnings = roleSpecificUser.earnings || 0;
    }

    //console.log(`📤 Response Role: ${userResponse.role}`);

    console.log(`📤 Response Role: ${userResponse.role}, Verified: ${userResponse.isVerified}`);
    // ✅ UPDATED: Different messages based on verification status

    let message = isNewUser ? "Signup successful" : "Login successful";
    if (isNewUser && !isVerified && baseUser.role !== 'customer') {
      message = "Signup successful! Your account is pending verification. You will be able to login once verified by admin.";
    }
    res.status(200).json({
      success: true,
      //message: isNewUser ? "Signup successful" : "Login successful",
      message: message,
      token,
      user: userResponse
    });

  } catch (err) {
    console.error('❌ Verify OTP Error:', err);
    next(err);
  }
});

// Rest of the code remains same...
// ✅ FIXED: Get Profile API
// ✅ FIXED - Use only auth middleware
router.get("/profile", auth, async (req, res, next) => {
  try {
    // ✅ Use req.user from auth middleware
    const userId = req.user._id || req.user._id; // Auth middleware se user mil gaya hai

    // console.log("📱 Profile Route - User ID:", userId);

    // Find user in base collection
    const baseUser = await User.findById(userId);

    if (!baseUser) {
      console.log("❌ Profile Route - User not found for ID:", userId);
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // console.log("✅ Profile Route - User found:", baseUser.name);

    // Prepare base user response okokokokok
    let userResponse = {
      id: baseUser._id,
      name: baseUser.name,
      phone: baseUser.phone,
      email: baseUser.email,
      profilePicture: baseUser.profilePicture,
      role: baseUser.role,
      isVerified: baseUser.isVerified,
      isActive: baseUser.isActive,
      createdAt: baseUser.createdAt,
      lastLogin: baseUser.lastLogin,
      addresses: [],
    };

    // Add role-specific data from respective collections
    if (baseUser.role === 'customer') {
      const customer = await Customer.findById(userId);
      if (customer) {
        userResponse.addresses = customer.addresses || [];
        userResponse.favorites = customer.favorites || [];
        userResponse.orders = customer.orders || [];
        userResponse.loyaltyPoints = customer.loyaltyPoints || 0;
        userResponse.totalOrders = customer.totalOrders || 0;
        userResponse.totalSpent = customer.totalSpent || 0;
      }
    } else if (baseUser.role === 'restaurant') {
      const restaurantUser = await RestaurantUser.findById(userId);
      if (restaurantUser) {
        userResponse.restaurantId = restaurantUser.restaurantId;
        userResponse.businessName = restaurantUser.businessName;
        userResponse.gstNumber = restaurantUser.gstNumber;
        userResponse.totalEarnings = restaurantUser.totalEarnings || 0;
        userResponse.totalOrders = restaurantUser.totalOrders || 0;
      }
    } else if (baseUser.role === 'rider') {
      const rider = await Rider.findById(userId);
      if (rider) {
        userResponse.vehicleNo = rider.vehicleNo;
        userResponse.vehicleType = rider.vehicleType;
        userResponse.licenseNumber = rider.licenseNumber;
        userResponse.currentLocation = rider.currentLocation;
        userResponse.isAvailable = rider.isAvailable;
        userResponse.totalDeliveries = rider.totalDeliveries || 0;
        userResponse.rating = rider.rating;
        userResponse.earnings = rider.earnings || 0;
      }
    }

    // console.log("✅ Profile Route - Sending response for:", userResponse.name);

    res.json({
      success: true,
      user: userResponse
    });

  } catch (err) {
    console.error("❌ Profile Route Error:", err);
    next(err);
  }
});

// Add to Favorites (Only for Customers)
// router.post("/favorites", auth, async (req, res, next) => {
//   try {
//     // const token = req.headers.authorization?.split(" ")[1];

//     if (!token) {
//       return res.status(401).json({ 
//         success: false,
//         error: "Access token required" 
//       });
//     }

//    // const decoded = jwt.verify(token, JWT_SECRET);
//     const { restaurantId } = req.body;

//     // Check if user is customer
//     const user = await User.findById(decoded.userId);

//     if (user.role !== 'customer') {
//       return res.status(403).json({ 
//         success: false,
//         error: "Only customers can add favorites" 
//       });
//     }

//     if (!restaurantId) {
//       return res.status(400).json({ 
//         success: false,
//         error: "Restaurant ID is required" 
//       });
//     }

//     //const customer = await Customer.findById(decoded.userId);
//         const customer = await Customer.findById(req.user._id);  // ✅ USE req.user._id

//     if (!customer) {
//       return res.status(404).json({ 
//         success: false,
//         error: "Customer not found" 
//       });
//     }

//     if (customer.favorites.includes(restaurantId)) {
//       return res.status(400).json({ 
//         success: false,
//         error: "Restaurant already in favorites" 
//       });
//     }

//     customer.favorites.push(restaurantId);
//     await customer.save();

//     res.json({ 
//       success: true,
//       message: "Restaurant added to favorites",
//       favorites: customer.favorites
//     });

//   } catch (err) {
//     next(err);
//   }
// });

router.post("/favorites", auth, requireRole(['customer']), async (req, res, next) => {
  try {
    const { restaurantId } = req.body;

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        error: "Restaurant ID is required"
      });
    }

    // ✅ FIXED: Use only req.user._id
    const customer = await Customer.findById(req.user._id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found"
      });
    }

    if (customer.favorites.includes(restaurantId)) {
      return res.status(400).json({
        success: false,
        error: "Restaurant already in favorites"
      });
    }

    customer.favorites.push(restaurantId);
    await customer.save();

    res.json({
      success: true,
      message: "Restaurant added to favorites",
      favorites: customer.favorites
    });

  } catch (err) {
    next(err);
  }
});


// POST /api/v1/auth/rate/restaurant
router.post("/rate/restaurant", auth, requireRole(["customer"]), async (req, res, next) => {
  try {
    const { restaurantId, rating, review, orderId } = req.body;
    const userId = req.user._id;

    if (!restaurantId || !rating)
      return res.status(400).json({ success: false, error: "Restaurant ID and rating are required" });

    // 🔍 Validate Customer
    const customer = await Customer.findById(userId);
    if (!customer)
      return res.status(404).json({ success: false, error: "Customer not found" });

    // 🔍 Validate Order (must belong to customer & be delivered)
    const order = await Order.findOne({
      orderId,
      customerId: userId,
      status: "delivered",
    });

    if (!order)
      return res.status(400).json({ success: false, error: "Invalid or undelivered order" });

    // 🔍 Prevent duplicate restaurant rating for same order
    const alreadyRated = customer.reviews.find(
      (r) => r.orderId === orderId && r.restaurantId?.toString() === restaurantId
    );

    if (alreadyRated)
      return res.status(400).json({
        success: false,
        error: "You have already rated this restaurant for this order",
      });

    // ✅ Update Restaurant Rating + push review
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant)
      return res.status(404).json({ success: false, error: "Restaurant not found" });

    restaurant.rating.reviews.push({
      customerId: userId,
      orderId,
      rating,
      review,
      createdAt: new Date(),
    });

    restaurant.rating.count += 1;
    restaurant.rating.average =
      (restaurant.rating.average * (restaurant.rating.count - 1) + rating) /
      restaurant.rating.count;

    await restaurant.save();

    // ✅ Save in Customer Reviews
    customer.reviews.push({
      orderId,
      restaurantId,
      rating,
      review,
    });
    await customer.save();

    // ✅ Update Order
    order.restaurantRating = rating;
    order.restaurantReview = review;
    await order.save();

    res.json({
      success: true,
      message: "Restaurant rating submitted successfully",
      restaurant: {
        _id: restaurant._id,
        averageRating: restaurant.rating.average,
        totalRatings: restaurant.rating.count,
      },
    });
  } catch (err) {
    console.error("Error submitting restaurant rating:", err);
    next(err);
  }
});
// POST /api/v1/auth/rate/rider
router.post("/rate/rider", auth, requireRole(["customer"]), async (req, res, next) => {
  try {
    const { riderId, rating, review, orderId } = req.body;
    const userId = req.user._id;

    if (!riderId || !rating)
      return res.status(400).json({ success: false, error: "Rider ID and rating are required" });

    // 🔍 Validate Customer
    const customer = await Customer.findById(userId);
    if (!customer)
      return res.status(404).json({ success: false, error: "Customer not found" });

    // 🔍 Validate Order (must belong to customer & be delivered)
    const order = await Order.findOne({
      orderId,
      customerId: userId,
      status: "delivered",
    });

    if (!order)
      return res.status(400).json({ success: false, error: "Invalid or undelivered order" });

    // 🔍 Validate Rider
    const rider = await Rider.findById(riderId);
    if (!rider)
      return res.status(404).json({ success: false, error: "Rider not found" });

    // 🔍 Prevent duplicate rider rating for same order
    const riderAlreadyRated = rider.ratings.find(
      (r) => r.orderId === orderId && r.customerId.toString() === userId
    );

    if (riderAlreadyRated)
      return res.status(400).json({
        success: false,
        error: "You have already rated this rider for this order",
      });

    // ✅ Save Rider Rating
    rider.ratings.push({
      customerId: userId,
      orderId,
      rating,
      feedback: review,
      createdAt: new Date(),
    });

    const total = rider.totalRatings + 1;
    rider.averageRating =
      (rider.averageRating * rider.totalRatings + rating) / total;
    rider.totalRatings = total;

    await rider.save();

    // ✅ Save in Customer Reviews
    customer.reviews.push({
      orderId,
      riderId,
      rating,
      review,
    });
    await customer.save();

    // ✅ Update Order
    order.riderRating = rating;
    order.riderReview = review;
    await order.save();

    res.json({
      success: true,
      message: "Rider rating submitted successfully",
      rider: {
        _id: rider._id,
        averageRating: rider.averageRating,
        totalRatings: rider.totalRatings,
      },
    });
  } catch (err) {
    console.error("Error submitting rider rating:", err);
    next(err);
  }
});

router.put("/profile", auth, async (req, res, next) => {
  try {
    const { name, email, profilePicture, ...roleSpecificData } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (profilePicture) updateData.profilePicture = profilePicture;

    // ✅ FIXED: Use only req.user._id
    const baseUser = await User.findByIdAndUpdate(
      req.user._id,  // ✅ Only req.user._id
      updateData,
      { new: true }
    );

    if (!baseUser) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Update role-specific collection
    let roleSpecificUser;
    if (baseUser.role === 'customer') {
      roleSpecificUser = await Customer.findByIdAndUpdate(
        req.user._id,  // ✅ Only req.user._id
        updateData,
        { new: true }
      );
    } else if (baseUser.role === 'rider') {
      const riderUpdate = { ...updateData };
      if (roleSpecificData.hasOwnProperty('isAvailable')) {
        riderUpdate.isAvailable = roleSpecificData.isAvailable;
      }
      roleSpecificUser = await Rider.findByIdAndUpdate(
        req.user._id,  // ✅ Only req.user._id
        riderUpdate,
        { new: true }
      );
    } else if (baseUser.role === 'restaurant') {
      roleSpecificUser = await RestaurantUser.findByIdAndUpdate(
        req.user._id,  // ✅ Only req.user._id
        updateData,
        { new: true }
      );
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: baseUser._id,
        name: baseUser.name,
        phone: baseUser.phone,
        email: baseUser.email,
        profilePicture: baseUser.profilePicture,
        role: baseUser.role
      }
    });

  } catch (err) {
    next(err);
  }
});


// Address routes
router.post("/address", auth, requireRole(['customer']), async (req, res, next) => {
  try {
    const addressData = req.body;

    // ✅ FIXED: Use req.user directly for role check
    if (req.user.role !== "customer") {
      return res.status(403).json({ success: false, error: "Only customers can add addresses" });
    }

    // ✅ FIXED: Use only req.user._id
    let customer = await Customer.findById(req.user._id);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    customer.addresses.push(addressData);
    await customer.save();

    res.status(201).json({
      success: true,
      message: "Address added successfully",
      addresses: customer.addresses,
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
  handleRiderUploadErrors,
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
        if (req.files?.licensePhoto?.[0]?.path) try { fs.unlinkSync(req.files.licensePhoto[0].path); } catch(e) {}
        if (req.files?.vehiclePhoto?.[0]?.path) try { fs.unlinkSync(req.files.vehiclePhoto[0].path); } catch(e) {}

        return res.status(400).json({
          success: false,
          error: 'Vehicle type, vehicle number, and license number are required'
        });
      }

      // Update User model
      if (name && name !== '') user.name = name;
      if (email && email !== '') user.email = email;
      await user.save();

      // Check if rider already exists
      const existingRider = await Rider.findOne({ _id: userId });

      // Prepare rider data
      const riderData = {
        _id: userId,
        phone: phone,
        name: name || user.name,
        email: email || user.email || null,
        role: 'rider',
        isVerified: user.isVerified || false,
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

      // Upload to Cloudinary if files provided
      if (req.files?.licensePhoto?.[0]?.buffer) {
        const result = await uploadBufferToCloudinary(req.files.licensePhoto[0].buffer, "hungry-hub/riders");
        riderData.licensePhoto = result.secure_url;
      }
      if (req.files?.vehiclePhoto?.[0]?.buffer) {
        const result = await uploadBufferToCloudinary(req.files.vehiclePhoto[0].buffer, "hungry-hub/riders");
        riderData.vehiclePhoto = result.secure_url;
      }

      let newRider;
      let message;

      if (existingRider) {
        // UPDATE EXISTING RIDER
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
      } else {
        // CREATE NEW RIDER
        newRider = await Rider.create(riderData);
        message = 'Rider registration completed successfully. Waiting for admin approval.';
      }

      const freshUser = await User.findById(userId);

      res.status(200).json({
        success: true,
        message: message,
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
        try { fs.unlinkSync(req.files.licensePhoto[0].path); } catch (e) { }
      }
      if (req.files?.vehiclePhoto?.[0]) {
        try { fs.unlinkSync(req.files.vehiclePhoto[0].path); } catch (e) { }
      }
      next(err);
    }
  }
);

// auth.js - Complete restaurant registration (FIXED like rider)
router.post('/restaurant/complete',
  auth,
  upload.fields([
    { name: 'gstCertificate', maxCount: 1 },
    { name: 'restaurantImages', maxCount: 5 }  
  ]),
  handleUploadErrors,
  async (req, res, next) => {
    try {
      const userId = req.user._id;
      const user = await User.findById(userId);
      const phone = user.phone;

      const {
        businessName, ownerName, email, cuisines,
        addressLine1, addressLine2, city, state, pincode,
        latitude, longitude, gstNumber, fssaiNumber,
        minOrderAmount, deliveryFee, deliveryTime,
        bankAccountNumber, bankIFSC, upiId
      } = req.body;

      // Validation
      if (!businessName || !addressLine1 || !city || !state || !pincode) {
 if (req.files?.gstCertificate?.[0]) {
    try { fs.unlinkSync(req.files.gstCertificate[0].path); } catch(e) {}
  }
  if (req.files?.restaurantImages) {
    req.files.restaurantImages.forEach(file => {
      try { fs.unlinkSync(file.path); } catch(e) {}
    });
  }        return res.status(400).json({
          success: false,
          error: 'Business name, address line1, city, state, and pincode are required'
        });
      }

      // Update User model (like rider)
      let userUpdated = false;
      if (ownerName && ownerName !== '') {
        user.name = ownerName;
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

      // Check if restaurant already exists in Restaurant model
      let existingRestaurant = await Restaurant.findOne({ ownerId: userId });

      // Prepare Restaurant data (main restaurant document)
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
          phone: phone,
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
        createdBy: userId,
        images: [] 
      };

      let newRestaurant;
      let message;
      let isUpdate = false;

      if (existingRestaurant) {
        // UPDATE existing restaurant
        const updateData = {};
        if (restaurantData.name) updateData.name = restaurantData.name;
        if (restaurantData.description) updateData.description = restaurantData.description;
        if (restaurantData.cuisine) updateData.cuisine = restaurantData.cuisine;
        if (restaurantData.address) updateData.address = restaurantData.address;
        if (restaurantData.contact) updateData.contact = restaurantData.contact;
        if (restaurantData.minOrderAmount) updateData.minOrderAmount = restaurantData.minOrderAmount;
        if (restaurantData.deliveryFee) updateData.deliveryFee = restaurantData.deliveryFee;
        if (restaurantData.deliveryTime) updateData.deliveryTime = restaurantData.deliveryTime;
        if (restaurantData.gstNumber) updateData.gstNumber = restaurantData.gstNumber;
        if (restaurantData.fssaiNumber) updateData.fssaiNumber = restaurantData.fssaiNumber;

        if (req.files?.restaurantImages && req.files.restaurantImages.length > 0) {
          const uploadPromises = req.files.restaurantImages.map(async file => {
            if (file.buffer) {
              const res = await uploadBufferToCloudinary(file.buffer, "hungry-hub/restaurants");
              return res.secure_url;
            }
            return file.path;
          });
          updateData.images = await Promise.all(uploadPromises);
        }
        newRestaurant = await Restaurant.findByIdAndUpdate(
          existingRestaurant._id,
          { $set: updateData },
          { new: true, runValidators: true }
        );
        message = existingRestaurant.isActive
          ? 'Restaurant updated successfully!'
          : 'Restaurant registration updated. Waiting for admin approval.';
        isUpdate = true;
      } else {
        if (req.files?.restaurantImages && req.files.restaurantImages.length > 0) {
          const uploadPromises = req.files.restaurantImages.map(async file => {
            if (file.buffer) {
              const res = await uploadBufferToCloudinary(file.buffer, "hungry-hub/restaurants");
              return res.secure_url;
            }
            return file.path;
          });
          restaurantData.images = await Promise.all(uploadPromises);
        }
        // CREATE new restaurant
        newRestaurant = await Restaurant.create(restaurantData);
        message = 'Restaurant registration completed successfully. Waiting for admin approval.';
        isUpdate = false;
      }

      // Update RestaurantUser model
      let restaurantUser = await RestaurantUser.findById(userId);

      if (!restaurantUser) {
        restaurantUser = await RestaurantUser.create({
          _id: userId,
          phone: phone,
          name: ownerName || user.name,
          email: email || user.email,
          role: 'restaurant',
          isVerified: false,
          businessName: businessName,
          gstNumber: gstNumber || null,
          restaurantId: newRestaurant._id,
          bankAccountNumber: bankAccountNumber || null,
          bankIFSC: bankIFSC || null,
          upiId: upiId || null
        });
      } else {
        restaurantUser.businessName = businessName;
        restaurantUser.gstNumber = gstNumber || null;
        restaurantUser.restaurantId = newRestaurant._id;
        restaurantUser.bankAccountNumber = bankAccountNumber || null;
        restaurantUser.bankIFSC = bankIFSC || null;
        restaurantUser.upiId = upiId || null;
        if (ownerName) restaurantUser.name = ownerName;
        if (email) restaurantUser.email = email;
        await restaurantUser.save();
      }

      // Handle GST certificate
      // if (req.file) {
      //   restaurantUser.gstCertificate = `/uploads/menu-items/${req.file.filename}`;
      //   await restaurantUser.save();
      // }
if (req.files?.gstCertificate && req.files.gstCertificate[0]) {
  restaurantUser.gstCertificate = `/uploads/restaurants/${req.files.gstCertificate[0].filename}`;
  await restaurantUser.save();

}
      const freshUser = await User.findById(userId);

      res.status(isUpdate ? 200 : 201).json({
        success: true,
        message: message,
        isUpdate: isUpdate,
        isVerified: restaurantUser.isVerified,
        user: {
          id: freshUser._id,
          name: restaurantUser.name,
          phone: freshUser.phone,
          email: restaurantUser.email,
          role: freshUser.role,
          isVerified: restaurantUser.isVerified,
          businessName: restaurantUser.businessName,
          restaurantId: newRestaurant._id,
          gstNumber: restaurantUser.gstNumber,
          address: newRestaurant.address,
          gstCertificate: restaurantUser.gstCertificate,
           images: newRestaurant.images || [] 
        },
        data: {
          restaurantId: newRestaurant._id,
          restaurantUserId: restaurantUser._id,
          businessName: newRestaurant.name,
          phone: phone,
          verificationStatus: restaurantUser.isVerified ? 'verified' : 'pending',
          city: newRestaurant.address?.city,
          address: newRestaurant.address,
          gstCertificate: restaurantUser.gstCertificate,
            images: newRestaurant.images || []
        }
      });

    } catch (err) {
      console.error('❌ Restaurant registration error:', err);
      if (req.file) fs.unlinkSync(req.file.path);
      next(err);
    }
  }
);
module.exports = router;
