// utils/ticketUserHelper.js
const User = require('../models/User');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const RestaurantUser = require('../models/RestaurantUser');

/**
 * Fetch complete user info for ticket (DENORMALIZED)
 * This solves your multi-model structure problem
 */
exports.getUserInfoForTicket = async (userId) => {
  try {
    // Step 1: Get base user from User model
    const baseUser = await User.findById(userId);
    if (!baseUser) return null;
    
    const userInfo = {
      userId: baseUser._id,
      name: baseUser.name,
      phone: baseUser.phone,
      email: baseUser.email,
      profilePicture: baseUser.profilePicture,
      role: baseUser.role
    };
    
    // Step 2: Get role-specific data
    switch(baseUser.role) {
      case 'customer':
        const customer = await Customer.findById(userId);
        if (customer) {
          userInfo.customerAddresses = customer.addresses?.slice(0, 3) || []; // Last 3 addresses
        }
        break;
        
      case 'rider':
        const rider = await Rider.findById(userId);
        if (rider) {
          userInfo.riderVehicle = {
            vehicleNo: rider.vehicleNo,
            vehicleType: rider.vehicleType
          };
        }
        break;
        
      case 'restaurant':
        const restaurantUser = await RestaurantUser.findById(userId);
        if (restaurantUser) {
          userInfo.restaurantDetails = {
            restaurantId: restaurantUser.restaurantId,
            businessName: restaurantUser.businessName
          };
        }
        break;
    }
    
    return userInfo;
  } catch (error) {
    console.error('Error fetching user info for ticket:', error);
    return null;
  }
};

/**
 * Get order details for ticket reference
 */
exports.getOrderInfoForTicket = async (orderId) => {
  try {
    const Order = require('../models/Order');
    const order = await Order.findOne({ orderId })
      .populate('restaurantId', 'name')
      .populate('customerId', 'name');
    
    if (!order) return null;
    
    return {
      orderId: order.orderId,
      orderAmount: order.finalAmount,
      restaurantName: order.restaurantId?.name || 'Unknown Restaurant',
      orderDate: order.createdAt
    };
  } catch (error) {
    console.error('Error fetching order info:', error);
    return null;
  }
};