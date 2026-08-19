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

    if (!['customer', 'rider', 'restaurant'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: "Invalid role. Must be customer, rider, or restaurant"
      });
    }

    if (phone.length < 10) {
      return res.status(400).json({
        success: false,
        error: "Invalid phone number"
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await OTP.create({
      phone,
      otp,
      expiresAt,
      role
    });

    console.log(`OTP for ${phone} (${role}): ${otp}`);

    const responseData = {
      success: true,
      message: "OTP sent successfully"
    };

    if (DEBUG_OTP) {
      responseData.debug_otp = otp;
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

    const otpRecord = await OTP.findOneAndUpdate(
      { phone, otp, isUsed: false, expiresAt: { $gt: new Date() } },
      { $set: { isUsed: true } },
      { new: true }
    );

    if (!otpRecord) {
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

    if (!baseUser) {
      isNewUser = true;

      const baseUserData = {
        phone,
        name: name || `User${phone.slice(-4)}`,
        email: email || null,
        role: otpRole,
        isVerified: isVerified,
        lastLogin: new Date()
      };

      baseUser = await User.create(baseUserData);
      console.log(`... New ${otpRole} user created: ${baseUser._id}`);

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
          break;

        default:
          roleSpecificUser = await Customer.create({
            ...baseUserData,
            _id: baseUser._id
          });
      }

      if (address && baseUser.role === 'customer') {
        const customer = await Customer.findById(baseUser._id);
        if (customer) {
          customer.addresses.push(address);
          await customer.save();
        }
      }
    } else {
      if (baseUser.role !== otpRole) {
        return res.status(400).json({
          success: false,
          error: `This phone number is already registered as ${baseUser.role}. Please use ${baseUser.role} login or use a different phone number.`
        });
      }

      const updateData = { lastLogin: new Date() };
      if (name) updateData.name = name;
      if (email) updateData.email = email;

      baseUser = await User.findByIdAndUpdate(baseUser._id, updateData, { new: true });
      console.log(`... Existing ${baseUser.role} user logged in`);

      switch (baseUser.role) {
        case 'customer':
          roleSpecificUser = await Customer.findByIdAndUpdate(baseUser._id, updateData, { new: true });
          break;
        case 'rider':
          roleSpecificUser = await Rider.findByIdAndUpdate(baseUser._id, updateData, { new: true });
          break;
        case 'restaurant':
          roleSpecificUser = await RestaurantUser.findByIdAndUpdate(baseUser._id, updateData, { new: true });
          break;
      }
    }

    const token = jwt.sign(
      {
        userId: baseUser._id, phone: baseUser.phone, role: baseUser.role, isVerified: baseUser.isVerified
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

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
      token,
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
    const userId = req.user._id;
    const baseUser = await User.findById(userId);

    if (!baseUser) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

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
      addresses: []
    };

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
    } else if (baseUser.role === 'rider') {
      const rider = await Rider.findById(userId);
      if (rider) {
        userResponse.vehicleNo = rider.vehicleNo;
        userResponse.vehicleType = rider.vehicleType;
        userResponse.isAvailable = rider.isAvailable;
        userResponse.licenseNumber = rider.licenseNumber;
        userResponse.currentLocation = rider.currentLocation;
        userResponse.totalDeliveries = rider.totalDeliveries || 0;
        userResponse.rating = rider.rating;
        userResponse.earnings = rider.earnings || 0;
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
    const { name, email, profilePicture, ...roleSpecificData } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (profilePicture) updateData.profilePicture = profilePicture;

    const baseUser = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true }
    );

    if (!baseUser) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    let roleSpecificUser;
    if (baseUser.role === 'customer') {
      roleSpecificUser = await Customer.findByIdAndUpdate(
        req.user._id,
        updateData,
        { new: true }
      );
    } else if (baseUser.role === 'rider') {
      const riderUpdate = { ...updateData };
      if (roleSpecificData.hasOwnProperty('isAvailable')) {
        riderUpdate.isAvailable = roleSpecificData.isAvailable;
      }
      roleSpecificUser = await Rider.findByIdAndUpdate(
        req.user._id,
        riderUpdate,
        { new: true }
      );
    } else if (baseUser.role === 'restaurant') {
      roleSpecificUser = await RestaurantUser.findByIdAndUpdate(
        req.user._id,
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
      (r) => r.orderId === orderId && r.customerId.toString() === userId
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
    const addressData = req.body;

    if (req.user.role !== "customer") {
      return res.status(403).json({ success: false, error: "Only customers can add addresses" });
    }

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

    if (!businessName || !addressLine1 || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        error: 'Business name, address line1, city, state, and pincode are required'
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
    next(err);
  }
};
