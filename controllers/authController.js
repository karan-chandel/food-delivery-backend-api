const User = require("../models/User");
const Customer = require("../models/Customer");
const Rider = require("../models/Rider");
const RestaurantUser = require("../models/RestaurantUser");
const OTP = require("../models/OTP");
const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, DEBUG_OTP } = require("../config/config");
const { uploadBufferToCloudinary } = require('../middlewares/upload');
const tokenHelper = require("../utils/tokenHelper");
const smsService = require("../utils/smsService");
const catalogClient = require("../utils/catalogClient");
const fs = require('fs');

// Generate random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ Send OTP API
exports.sendOtp = async (req, res, next) => {
  try {
    const { phone, role = 'customer' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required"
      });
    }

    const cleanPhone = String(phone).trim().replace(/\s+/g, "");

    if (!['customer', 'rider', 'restaurant'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role. Must be customer, rider, or restaurant"
      });
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number"
      });
    }

    // 🛡️ SECURITY 1: Phone-Level Cooldown (Must wait 60s between OTP requests)
    const lastOtp = await OTP.findOne({ phone: cleanPhone }).sort({ createdAt: -1 });
    if (lastOtp) {
      const elapsedSeconds = Math.floor((Date.now() - new Date(lastOtp.createdAt).getTime()) / 1000);
      const cooldownSeconds = 60;
      if (elapsedSeconds < cooldownSeconds) {
        const waitTime = cooldownSeconds - elapsedSeconds;
        return res.status(429).json({
          success: false,
          error: `Please wait ${waitTime} seconds before requesting a new OTP.`,
          retryAfter: waitTime
        });
      }
    }

    // 🛡️ SECURITY 2: Phone-Level Quota (Max 4 OTPs per 15 minutes to block SMS toll fraud)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentOtpCount = await OTP.countDocuments({
      phone: cleanPhone,
      createdAt: { $gte: fifteenMinutesAgo }
    });

    if (recentOtpCount >= 4) {
      return res.status(429).json({
        success: false,
        error: "Maximum OTP attempts exceeded for this phone number. Please try again after 15 minutes.",
        retryAfter: 900
      });
    }

    // 🛡️ SECURITY 3: Invalidate previous unused OTPs for this phone (Prevents token overlap)
    await OTP.updateMany(
      { phone: cleanPhone, isUsed: false },
      { $set: { isUsed: true } }
    );

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await OTP.create({
      phone: cleanPhone,
      otp,
      expiresAt,
      role
    });

    console.log(`OTP for ${cleanPhone} (${role}): ${otp}`);

    // 📲 Dispatch live SMS via SMSCloud DLT Gateway
    const smsResult = await smsService.sendOtpSms(cleanPhone, otp);

    const responseData = {
      success: true,
      message: "OTP sent successfully"
    };

    if (DEBUG_OTP) {
      responseData.debug_otp = otp;
      if (!smsResult.success) {
        responseData.sms_notice = smsResult.error;
      }
    }

    res.status(200).json(responseData);
  } catch (err) {
    next(err);
  }
};

// ✅ Verify OTP
exports.verifyOtp = async (req, res, next) => {
  try {
    const { phone, otp, email, name, address, additionalData } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        error: "Phone and OTP are required"
      });
    }

    const cleanPhone = String(phone).trim().replace(/\s+/g, "");

    const otpRecord = await OTP.findOneAndUpdate(
      { phone: cleanPhone, otp, isUsed: false, expiresAt: { $gt: new Date() } },
      { $set: { isUsed: true } },
      { new: true }
    );

    if (!otpRecord) {
      // 🛡️ SECURITY 4: Track failed attempts to prevent OTP brute-force
      const activeOtp = await OTP.findOne({ phone: cleanPhone, isUsed: false, expiresAt: { $gt: new Date() } });
      if (activeOtp) {
        activeOtp.attempts = (activeOtp.attempts || 0) + 1;
        if (activeOtp.attempts >= 3) {
          activeOtp.isUsed = true; // Invalidate after 3 wrong guesses
          await activeOtp.save();
          return res.status(401).json({
            success: false,
            error: "Too many incorrect OTP attempts. This OTP has been invalidated. Please request a new one."
          });
        }
        await activeOtp.save();
      }
      return res.status(401).json({ success: false, error: "Invalid or expired OTP" });
    }

    console.log(`📱 OTP Record - Phone: ${phone}, OTP Role: ${otpRecord.role}`);
    const otpRole = otpRecord.role;

    const getVerificationStatus = (role) => {
      return role === 'customer';
    };

    const isVerified = getVerificationStatus(otpRole);
    let baseUser = await User.findOne({ phone });
    let roleSpecificUser = null;
    let isNewUser = false;

    // Check if role-specific profiles already exist in DB
    const existingCustomer = await Customer.findOne({ phone });
    const existingRestaurantUser = await RestaurantUser.findOne({ phone });
    const existingRider = await Rider.findOne({ phone });

    if (!baseUser) {
      isNewUser = true;

      // Reuse existing role ID if available so foreign keys stay linked
      const existingId = existingRestaurantUser?._id || existingCustomer?._id || existingRider?._id;

      const baseUserData = {
        phone,
        name: name || existingRestaurantUser?.name || existingCustomer?.name || existingRider?.name || `User${phone.slice(-4)}`,
        email: email || existingRestaurantUser?.email || existingCustomer?.email || null,
        role: otpRole,
        isVerified: isVerified,
        lastLogin: new Date()
      };

      if (existingId) {
        baseUserData._id = existingId;
      }

      baseUser = await User.create(baseUserData);
      console.log(`... New/relinked ${otpRole} user created: ${baseUser._id}`);
    } else {
      const updateData = { lastLogin: new Date() };
      if (name) updateData.name = name;
      if (email) updateData.email = email;

      baseUser = await User.findByIdAndUpdate(baseUser._id, updateData, { new: true });
      console.log(`... Existing user logged in for role: ${otpRole}`);
    }

    // Ensure role-specific profile exists for the requested portal
    const profileData = {
      phone: baseUser.phone,
      name: baseUser.name,
      email: baseUser.email,
      _id: baseUser._id,
      lastLogin: new Date()
    };

    switch (otpRole) {
      case 'customer':
        roleSpecificUser = await Customer.findById(baseUser._id) || existingCustomer;
        if (!roleSpecificUser) {
          roleSpecificUser = await Customer.create({
            ...profileData,
            favorites: [],
            orders: [],
            loyaltyPoints: 0,
            totalOrders: 0,
            totalSpent: 0
          });
        } else {
          roleSpecificUser = await Customer.findByIdAndUpdate(roleSpecificUser._id, { lastLogin: new Date() }, { new: true });
        }
        break;

      case 'rider':
        roleSpecificUser = await Rider.findById(baseUser._id) || existingRider;
        if (!roleSpecificUser) {
          roleSpecificUser = await Rider.create({
            ...profileData,
            vehicleNo: additionalData?.vehicleNo || 'NOT_SET',
            vehicleType: additionalData?.vehicleType || 'bike',
            licenseNumber: additionalData?.licenseNumber || null,
            currentLocation: additionalData?.currentLocation || null,
            isAvailable: false,
            earnings: 0,
            totalDeliveries: 0,
            rating: 0
          });
        } else {
          roleSpecificUser = await Rider.findByIdAndUpdate(roleSpecificUser._id, { lastLogin: new Date() }, { new: true });
        }
        break;

      case 'restaurant':
        roleSpecificUser = await RestaurantUser.findById(baseUser._id) || existingRestaurantUser;
        if (!roleSpecificUser) {
          roleSpecificUser = await RestaurantUser.create({
            ...profileData,
            restaurantId: additionalData?.restaurantId || null,
            businessName: additionalData?.businessName || 'NOT_SET',
            gstNumber: additionalData?.gstNumber || null,
            totalEarnings: 0,
            totalOrders: 0
          });
        } else {
          roleSpecificUser = await RestaurantUser.findByIdAndUpdate(roleSpecificUser._id, { lastLogin: new Date() }, { new: true });
        }
        break;

      default:
        roleSpecificUser = await Customer.findById(baseUser._id);
    }

    if (address && otpRole === 'customer') {
      const customer = await Customer.findById(baseUser._id);
      if (customer) {
        customer.addresses.push(address);
        await customer.save();
      }
    }

    const tokenPayload = {
      userId: baseUser._id,
      phone: baseUser.phone,
      role: otpRole,
      isVerified: baseUser.isVerified
    };

    // 🛡️ TSK-202: Short-Lived Access Token (1h) + Rotatable Refresh Token (30d)
    const accessToken = tokenHelper.generateAccessToken(tokenPayload);
    const { refreshToken } = await tokenHelper.generateRefreshToken({
      userId: baseUser._id,
      role: otpRole,
      req
    });

    let userResponse = {
      id: baseUser._id,
      name: baseUser.name,
      phone: baseUser.phone,
      email: baseUser.email,
      profilePicture: baseUser.profilePicture,
      addresses: baseUser.addresses || [],
      role: baseUser.role,
      isVerified: baseUser.isVerified,
      lastLogin: baseUser.lastLogin
    };

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

    let message = isNewUser ? "Signup successful" : "Login successful";
    if (isNewUser && !isVerified && baseUser.role !== 'customer') {
      message = "Signup successful! Your account is pending verification. You will be able to login once verified by admin.";
    }

    res.status(200).json({
      success: true,
      message: message,
      token: accessToken, // 100% backward-compatible for existing Flutter apps reading data.token
      accessToken,
      refreshToken,
      expiresIn: 3600,
      user: userResponse
    });
  } catch (err) {
    console.error('❌ Verify OTP Error:', err);
    next(err);
  }
};

// ✅ Get Profile
exports.getProfile = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    const role = req.user.role || 'customer';

    let userDoc = await User.findById(userId);

    // If not found in legacy User collection, find directly from role-specific collection
    if (!userDoc) {
      if (role === 'customer') {
        userDoc = await Customer.findById(userId);
      } else if (role === 'rider') {
        userDoc = await Rider.findById(userId);
      } else if (role === 'restaurant') {
        userDoc = await RestaurantUser.findById(userId);
      }
    }

    if (!userDoc) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    let userResponse = {
      id: userDoc._id,
      name: userDoc.name,
      phone: userDoc.phone,
      email: userDoc.email,
      profilePicture: userDoc.profilePicture,
      role: userDoc.role || role,
      isVerified: userDoc.isVerified,
      isActive: userDoc.isActive,
      createdAt: userDoc.createdAt,
      lastLogin: userDoc.lastLogin,
      addresses: userDoc.addresses || []
    };

    if (role === 'customer' || userDoc.role === 'customer') {
      const customer = userDoc.addresses !== undefined ? userDoc : await Customer.findById(userId);
      if (customer) {
        userResponse.addresses = customer.addresses || [];
        userResponse.favorites = customer.favorites || [];
        userResponse.orders = customer.orders || [];
        userResponse.loyaltyPoints = customer.loyaltyPoints || 0;
        userResponse.totalOrders = customer.totalOrders || 0;
        userResponse.totalSpent = customer.totalSpent || 0;
      }
    } else if (role === 'rider' || userDoc.role === 'rider') {
      const rider = await Rider.findById(userId);
      if (rider) {
        userResponse.vehicleNo = rider.vehicleNo;
        userResponse.vehicleType = rider.vehicleType;
        userResponse.isAvailable = rider.isAvailable;
        userResponse.licenseNumber = rider.licenseNumber;
        userResponse.currentLocation = rider.currentLocation;
        userResponse.totalDeliveries = rider.totalDeliveries || 0;
        userResponse.rating = rider.averageRating || rider.rating;
        userResponse.earnings = rider.earnings || 0;
      }
    } else if (role === 'restaurant' || userDoc.role === 'restaurant') {
      const restaurantUser = await RestaurantUser.findById(userId);
      if (restaurantUser) {
        userResponse.restaurantId = restaurantUser.restaurantId;
        userResponse.businessName = restaurantUser.businessName;
        userResponse.gstNumber = restaurantUser.gstNumber;
        userResponse.totalEarnings = restaurantUser.totalEarnings || 0;
        userResponse.totalOrders = restaurantUser.totalOrders || 0;
      }
    }

    res.json({
      success: true,
      user: userResponse
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Update Profile
exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id || req.user.userId;
    const role = req.user.role || 'customer';
    const { name, email, profilePicture, addresses, ...roleSpecificData } = req.body;

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (email) updateData.email = email.trim();
    if (profilePicture !== undefined) updateData.profilePicture = profilePicture;
    if (Array.isArray(addresses)) updateData.addresses = addresses;

    let updatedUser = null;

    if (role === 'customer') {
      updatedUser = await Customer.findByIdAndUpdate(userId, updateData, { new: true });
      User.findByIdAndUpdate(userId, updateData).catch(() => {});
    } else if (role === 'rider') {
      const riderUpdate = { ...updateData };
      if (roleSpecificData.hasOwnProperty('isAvailable')) {
        riderUpdate.isAvailable = roleSpecificData.isAvailable;
      }
      updatedUser = await Rider.findByIdAndUpdate(userId, riderUpdate, { new: true });
      User.findByIdAndUpdate(userId, updateData).catch(() => {});
    } else if (role === 'restaurant') {
      updatedUser = await RestaurantUser.findByIdAndUpdate(userId, updateData, { new: true });
      User.findByIdAndUpdate(userId, updateData).catch(() => {});
    }

    if (!updatedUser) {
      updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });
    }

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        phone: updatedUser.phone,
        email: updatedUser.email,
        profilePicture: updatedUser.profilePicture,
        role: updatedUser.role || role,
        addresses: updatedUser.addresses || []
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Add Favorites
exports.addFavorite = async (req, res, next) => {
  try {
    const { restaurantId } = req.body;

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        error: "Restaurant ID is required"
      });
    }

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
};

// ✅ Rate Restaurant
exports.rateRestaurant = async (req, res, next) => {
  try {
    const { restaurantId, rating, review, orderId } = req.body;
    const userId = req.user._id;

    if (!restaurantId || !rating)
      return res.status(400).json({ success: false, error: "Restaurant ID and rating are required" });

    const customer = await Customer.findById(userId);
    if (!customer)
      return res.status(404).json({ success: false, error: "Customer not found" });

    const order = await Order.findOne({
      orderId,
      customerId: userId,
      status: "delivered",
    });

    if (!order)
      return res.status(400).json({ success: false, error: "Invalid or undelivered order" });

    const alreadyRated = customer.reviews.find(
      (r) => r.orderId === orderId && r.restaurantId?.toString() === restaurantId
    );

    if (alreadyRated)
      return res.status(400).json({
        success: false,
        error: "You have already rated this restaurant for this order",
      });

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

    customer.reviews.push({
      orderId,
      restaurantId,
      rating,
      review,
    });
    await customer.save();

    order.restaurantRating = rating;
    order.restaurantReview = review;
    await order.save();

    catalogClient.syncRestaurantReview(restaurantId, {
      customerId: userId,
      orderId,
      rating,
      review: review || "",
    }).catch(() => {});

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
};

// ✅ Rate Rider
exports.rateRider = async (req, res, next) => {
  try {
    const { riderId, rating, review, orderId } = req.body;
    const userId = req.user._id;

    if (!riderId || !rating)
      return res.status(400).json({ success: false, error: "Rider ID and rating are required" });

    const customer = await Customer.findById(userId);
    if (!customer)
      return res.status(404).json({ success: false, error: "Customer not found" });

    const order = await Order.findOne({
      orderId,
      customerId: userId,
      status: "delivered",
    });

    if (!order)
      return res.status(400).json({ success: false, error: "Invalid or undelivered order" });

    const rider = await Rider.findById(riderId);
    if (!rider)
      return res.status(404).json({ success: false, error: "Rider not found" });

    const riderAlreadyRated = rider.ratings.find(
      (r) => r.orderId === orderId && r.customerId.toString() === userId.toString()
    );

    if (riderAlreadyRated)
      return res.status(400).json({
        success: false,
        error: "You have already rated this rider for this order",
      });

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

    customer.reviews.push({
      orderId,
      riderId,
      rating,
      review,
    });
    await customer.save();

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
};

// ✅ Add Address
exports.addAddress = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    if (req.user.role !== "customer") {
      return res.status(403).json({ success: false, error: "Only customers can add addresses" });
    }

    const {
      type = "home",
      customLabel,
      flatNumber,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      latitude,
      longitude,
      isDefault,
      receiverName,
      receiverPhone,
      deliveryInstructions,
    } = req.body;

    if (!addressLine1 || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: addressLine1, city, state, and pincode are required",
      });
    }

    let customer = await Customer.findById(userId);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    // Determine if this address should be default:
    // If it's customer's first address, make it default automatically, or if isDefault is true
    const shouldBeDefault = customer.addresses.length === 0 ? true : Boolean(isDefault);

    if (shouldBeDefault) {
      customer.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    const newAddress = {
      type: ["home", "work", "other"].includes(type?.toLowerCase()) ? type.toLowerCase() : "other",
      customLabel: type?.toLowerCase() === "other" ? (customLabel || "").trim() : "",
      flatNumber: (flatNumber || "").trim(),
      addressLine1: addressLine1.trim(),
      addressLine2: (addressLine2 || "").trim(),
      landmark: (landmark || "").trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: String(pincode).trim(),
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      isDefault: shouldBeDefault,
      receiverName: (receiverName || "").trim(),
      receiverPhone: (receiverPhone || "").trim(),
      deliveryInstructions: (deliveryInstructions || "").trim(),
    };

    customer.addresses.push(newAddress);
    await customer.save();

    const addedAddress = customer.addresses[customer.addresses.length - 1];

    res.status(201).json({
      success: true,
      message: "Address added successfully",
      addresses: customer.addresses,
      addedAddress,
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Update Address
exports.updateAddress = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { addressId } = req.params;

    let customer = await Customer.findById(userId);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const address = customer.addresses.id(addressId);
    if (!address) {
      return res.status(404).json({ success: false, error: "Address not found" });
    }

    const {
      type,
      customLabel,
      flatNumber,
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      latitude,
      longitude,
      isDefault,
      receiverName,
      receiverPhone,
      deliveryInstructions,
    } = req.body;

    if (type !== undefined) {
      address.type = ["home", "work", "other"].includes(type?.toLowerCase()) ? type.toLowerCase() : "other";
    }
    if (customLabel !== undefined) address.customLabel = (customLabel || "").trim();
    if (flatNumber !== undefined) address.flatNumber = (flatNumber || "").trim();
    if (addressLine1 !== undefined) address.addressLine1 = addressLine1.trim();
    if (addressLine2 !== undefined) address.addressLine2 = (addressLine2 || "").trim();
    if (landmark !== undefined) address.landmark = (landmark || "").trim();
    if (city !== undefined) address.city = city.trim();
    if (state !== undefined) address.state = state.trim();
    if (pincode !== undefined) address.pincode = String(pincode).trim();
    if (latitude !== undefined) address.latitude = latitude ? parseFloat(latitude) : undefined;
    if (longitude !== undefined) address.longitude = longitude ? parseFloat(longitude) : undefined;
    if (receiverName !== undefined) address.receiverName = (receiverName || "").trim();
    if (receiverPhone !== undefined) address.receiverPhone = (receiverPhone || "").trim();
    if (deliveryInstructions !== undefined) address.deliveryInstructions = (deliveryInstructions || "").trim();

    if (isDefault !== undefined && Boolean(isDefault)) {
      customer.addresses.forEach((addr) => {
        addr.isDefault = addr._id.toString() === addressId.toString();
      });
    }

    await customer.save();

    res.status(200).json({
      success: true,
      message: "Address updated successfully",
      addresses: customer.addresses,
      updatedAddress: address,
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Delete Address
exports.deleteAddress = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { addressId } = req.params;

    let customer = await Customer.findById(userId);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const targetIndex = customer.addresses.findIndex((a) => a._id.toString() === addressId.toString());
    if (targetIndex === -1) {
      return res.status(404).json({ success: false, error: "Address not found" });
    }

    const wasDefault = customer.addresses[targetIndex].isDefault;
    customer.addresses.splice(targetIndex, 1);

    // If deleted address was default and customer has remaining addresses, make the first one default
    if (wasDefault && customer.addresses.length > 0) {
      customer.addresses[0].isDefault = true;
    }

    await customer.save();

    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
      addresses: customer.addresses,
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Set Default Address
exports.setDefaultAddress = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { addressId } = req.params;

    let customer = await Customer.findById(userId);
    if (!customer) {
      return res.status(404).json({ success: false, error: "Customer not found" });
    }

    const exists = customer.addresses.some((a) => a._id.toString() === addressId.toString());
    if (!exists) {
      return res.status(404).json({ success: false, error: "Address not found" });
    }

    customer.addresses.forEach((addr) => {
      addr.isDefault = addr._id.toString() === addressId.toString();
    });

    await customer.save();

    res.status(200).json({
      success: true,
      message: "Default address updated successfully",
      addresses: customer.addresses,
    });
  } catch (err) {
    next(err);
  }
};

// ✅ Complete Rider Registration
exports.completeRider = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    const phone = user.phone;

    const {
      name, email, vehicleType, vehicleNo, licenseNumber,
      bankAccountNumber, bankIFSC, aadharNumber
    } = req.body;

    if (!vehicleType || !vehicleNo || !licenseNumber) {
      return res.status(400).json({
        success: false,
        error: 'Vehicle type, vehicle number, and license number are required'
      });
    }

    if (name && name !== '') user.name = name;
    if (email && email !== '') user.email = email;
    await user.save();

    const existingRider = await Rider.findOne({ _id: userId });

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

    if (req.files?.licensePhoto?.[0]?.buffer) {
      const result = await uploadBufferToCloudinary(req.files.licensePhoto[0].buffer, "Zewito/riders");
      riderData.licensePhoto = result.secure_url;
    }
    if (req.files?.vehiclePhoto?.[0]?.buffer) {
      const result = await uploadBufferToCloudinary(req.files.vehiclePhoto[0].buffer, "Zewito/riders");
      riderData.vehiclePhoto = result.secure_url;
    }

    let newRider;
    let message;

    if (existingRider) {
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
    next(err);
  }
};

// ✅ Complete Restaurant Registration
exports.completeRestaurant = async (req, res, next) => {
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

    if (!businessName || !addressLine1 || !city || !state || !pincode || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: 'Business name, address line1, city, state, pincode, latitude, and longitude are required'
      });
    }

    if (!/^[1-9][0-9]{5}$/.test(String(pincode).trim())) {
      return res.status(400).json({
        success: false,
        error: 'Pincode must be a valid 6-digit Indian postal code (e.g. 125001)'
      });
    }

    const parsedLat = parseFloat(latitude);
    const parsedLng = parseFloat(longitude);
    if (isNaN(parsedLat) || isNaN(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      return res.status(400).json({
        success: false,
        error: 'Valid GPS latitude (-90 to 90) and longitude (-180 to 180) are required'
      });
    }

    const contactEmail = (email || user.email || "").trim();
    if (!contactEmail) {
      return res.status(400).json({
        success: false,
        error: 'Official contact email is required for restaurant verification'
      });
    }
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(contactEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact email address format (e.g. contact@restaurant.com)'
      });
    }

    if (upiId && !/^[a-zA-Z0-9.\-_]{2,50}@[a-zA-Z0-9.\-_]{2,30}$/.test(upiId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid UPI ID format. Expected format: username@bank (e.g. 9812345678@paytm or chef@okhdfcbank)'
      });
    }

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

    let existingRestaurant = await Restaurant.findOne({ ownerId: userId });

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
          latitude: parsedLat,
          longitude: parsedLng
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
            const res = await uploadBufferToCloudinary(file.buffer, "Zewito/restaurants");
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
            const res = await uploadBufferToCloudinary(file.buffer, "Zewito/restaurants");
            return res.secure_url;
          }
          return file.path;
        });
        restaurantData.images = await Promise.all(uploadPromises);
      }
      newRestaurant = await Restaurant.create(restaurantData);
      message = 'Restaurant registration completed successfully. Waiting for admin approval.';
      isUpdate = false;
    }

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

    if (req.files?.gstCertificate && req.files.gstCertificate[0]) {
      const gstFile = req.files.gstCertificate[0];
      if (gstFile.buffer) {
        try {
          const uploadRes = await uploadBufferToCloudinary(gstFile.buffer, "Zewito/restaurants/gst");
          restaurantUser.gstCertificate = uploadRes.secure_url;
        } catch (uploadErr) {
          console.error("GST Certificate upload error:", uploadErr);
        }
      } else {
        restaurantUser.gstCertificate = gstFile.path || (gstFile.filename ? `/uploads/restaurants/${gstFile.filename}` : null);
      }
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
    next(err);
  }
};

// 🔄 Silent Refresh Token Handler (TSK-202)
exports.refreshToken = async (req, res, next) => {
  try {
    const rawToken = req.body.refreshToken || req.cookies?.refreshToken;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        error: "Refresh token is required",
      });
    }

    const result = await tokenHelper.verifyAndRotateRefreshToken(rawToken, req);

    if (!result.valid) {
      return res.status(401).json({
        success: false,
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      token: result.accessToken, // Backward-compatible for Flutter/Web apps
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });
  } catch (err) {
    console.error("❌ Refresh Token Error:", err);
    next(err);
  }
};

// 🚪 Revoke Refresh Token on Logout (TSK-202)
exports.logout = async (req, res, next) => {
  try {
    const rawToken = req.body.refreshToken || req.cookies?.refreshToken;

    if (rawToken) {
      await tokenHelper.revokeRefreshToken(rawToken);
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    console.error("❌ Logout Error:", err);
    next(err);
  }
};

