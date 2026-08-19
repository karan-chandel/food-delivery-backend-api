const Admin = require("../models/Admin");
const User = require("../models/User");
const Customer = require("../models/Customer");
const Rider = require("../models/Rider");
const RestaurantUser = require("../models/RestaurantUser");
const Restaurant = require("../models/Restaurant");
const Order = require("../models/Order");
const Ticket = require("../models/Ticket");
const OTP = require("../models/OTP");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/config");
const { PERMISSION_PRESETS } = require("../config/adminPermissions");

// ✅ CONSTANTS FOR CONSISTENCY
const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  ON_HOLD: 'on_hold',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

const TICKET_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
};

// ✅ SUPER ADMIN SETUP (First time only)
exports.setupSuperAdmin = async (req, res, next) => {
  try {
    const existingSuperAdmin = await Admin.findOne({ role: "super_admin" });
    if (existingSuperAdmin) {
      return res.status(400).json({
        success: false,
        error: "Super admin already exists"
      });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, email and password are required"
      });
    }

    const superAdmin = await Admin.create({
      name,
      email,
      password,
      role: "super_admin",
      permissions: PERMISSION_PRESETS.super_admin
    });

    res.status(201).json({
      success: true,
      message: "Super admin created successfully",
      admin: superAdmin
    });
  } catch (err) {
    next(err);
  }
};

// ✅ ADMIN LOGIN
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required"
      });
    }

    const admin = await Admin.findOne({ email, isActive: true });
    if (!admin) {
      return res.status(401).json({
        success: false,
        error: "Invalid admin credentials"
      });
    }

    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid admin credentials"
      });
    }

    admin.lastLogin = new Date();
    admin.loginHistory.push({
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date()
    });

    if (admin.loginHistory.length > 10) {
      admin.loginHistory = admin.loginHistory.slice(-10);
    }

    await admin.save();

    const token = jwt.sign(
      {
        adminId: admin._id,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        isVerified: true
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      success: true,
      message: "Admin login successful",
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ CREATE NEW ADMIN (Only by super_admin)
exports.createAdmin = async (req, res, next) => {
  try {
    const { name, email, password, role = "admin" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, email and password are required"
      });
    }

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        error: "Admin with this email already exists"
      });
    }

    if (!PERMISSION_PRESETS[role]) {
      return res.status(400).json({
        success: false,
        error: "Invalid admin role"
      });
    }

    const newAdmin = await Admin.create({
      name,
      email,
      password,
      role,
      permissions: PERMISSION_PRESETS[role],
      createdBy: req.admin._id
    });

    res.status(201).json({
      success: true,
      message: `${role} created successfully`,
      admin: newAdmin
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ALL ADMINS
exports.getAllAdmins = async (req, res, next) => {
  try {
    const { role, isActive, page = 1, limit = 10 } = req.query;

    let query = {};
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    if (req.admin.role !== 'super_admin') {
      query.role = { $ne: 'super_admin' };
    }

    const admins = await Admin.find(query)
      .select("-password -loginHistory")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Admin.countDocuments(query);

    res.json({
      success: true,
      admins,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ADMIN PROFILE
exports.getAdminProfile = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin._id).select("-password");
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    res.json({
      success: true,
      admin
    });
  } catch (err) {
    next(err);
  }
};

// ✅ UPDATE ADMIN PROFILE
exports.updateAdminProfile = async (req, res, next) => {
  try {
    const { name, email } = req.body;

    const updateFields = {};
    if (name) updateFields.name = name;
    if (email) {
      const emailExists = await Admin.findOne({ email, _id: { $ne: req.admin._id } });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          error: "Email is already in use by another admin"
        });
      }
      updateFields.email = email;
    }

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { $set: updateFields },
      { new: true }
    ).select("-password");

    res.json({
      success: true,
      message: "Profile updated successfully",
      admin
    });
  } catch (err) {
    next(err);
  }
};

// ✅ UPDATE ADMIN STATUS
exports.updateAdminStatus = async (req, res, next) => {
  try {
    const { adminId } = req.params;
    const { isActive } = req.body;

    if (adminId.toString() === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "Cannot change your own status"
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { isActive },
      { new: true }
    ).select("-password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    res.json({
      success: true,
      message: `Admin ${isActive ? 'activated' : 'deactivated'} successfully`,
      admin
    });
  } catch (err) {
    next(err);
  }
};

// ✅ UPDATE ADMIN PERMISSIONS
exports.updateAdminPermissions = async (req, res, next) => {
  try {
    const { adminId } = req.params;
    const { permissions } = req.body;

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    if (admin.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: "Super Admin permissions cannot be modified"
      });
    }

    admin.permissions = permissions;
    await admin.save();

    res.json({
      success: true,
      message: "Admin permissions updated successfully",
      permissions: admin.permissions
    });
  } catch (err) {
    next(err);
  }
};

// ✅ CHANGE ADMIN PASSWORD
exports.changeAdminPassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Old password and new password are required"
      });
    }

    const admin = await Admin.findById(req.admin._id);
    const isMatch = await admin.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: "Incorrect old password"
      });
    }

    admin.password = newPassword;
    await admin.save();

    res.json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (err) {
    next(err);
  }
};

// ✅ DELETE ADMIN
exports.deleteAdmin = async (req, res, next) => {
  try {
    const { adminId } = req.params;

    if (adminId.toString() === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete yourself"
      });
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    if (admin.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: "Super Admin cannot be deleted"
      });
    }

    await Admin.findByIdAndDelete(adminId);

    res.json({
      success: true,
      message: "Admin deleted successfully"
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET LOGIN HISTORY
exports.getLoginHistory = async (req, res, next) => {
  try {
    const { adminId, limit = 50 } = req.query;

    let query = {};
    if (adminId) query._id = adminId;

    const admins = await Admin.find(query)
      .select("name email role loginHistory")
      .sort({ "loginHistory.timestamp": -1 })
      .limit(parseInt(limit));

    const loginHistory = admins.flatMap(admin =>
      admin.loginHistory.map(login => ({
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role
        },
        ...login.toObject()
      }))
    ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
     .slice(0, limit);

    res.json({
      success: true,
      loginHistory
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET MAIN DASHBOARD STATS
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalCustomers,
      totalRiders,
      totalRestaurants,
      pendingRiders,
      pendingRestaurants,
      totalOrders,
      recentOrders,
      totalEarnings,
      activeAdmins,
      activeOrders,
      todaysOrders,
      todaysEarnings,
      totalTickets,
      openTickets,
      highPriorityTickets,
      unassignedTickets
    ] = await Promise.all([
      User.countDocuments(),
      Customer.countDocuments(),
      Rider.countDocuments(),
      RestaurantUser.countDocuments(),
      User.countDocuments({ role: 'rider', isVerified: false }),
      User.countDocuments({ role: 'restaurant', isVerified: false }),
      Order.countDocuments(),
      Order.find().sort({ createdAt: -1 }).limit(10),
      Order.aggregate([
        { $match: { status: "delivered" } },
        { $group: { _id: null, total: { $sum: "$finalAmount" } } }
      ]),
      Admin.countDocuments({ isActive: true }),
      Order.countDocuments({ status: { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] } }),
      Order.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      Order.aggregate([
        {
          $match: {
            status: "delivered",
            createdAt: {
              $gte: new Date(new Date().setHours(0, 0, 0, 0))
            }
          }
        },
        { $group: { _id: null, total: { $sum: "$finalAmount" } } }
      ]),
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: TICKET_STATUS.OPEN }),
      Ticket.countDocuments({ priority: TICKET_PRIORITY.HIGH }),
      Ticket.countDocuments({ 'assignedTo.adminId': { $exists: false } })
    ]);

    const earnings = totalEarnings.length > 0 ? totalEarnings[0].total : 0;
    const todaysEarningsTotal = todaysEarnings.length > 0 ? todaysEarnings[0].total : 0;

    res.json({
      success: true,
      dashboard: {
        totals: {
          users: totalUsers,
          customers: totalCustomers,
          riders: totalRiders,
          restaurants: totalRestaurants,
          orders: totalOrders,
          activeOrders: activeOrders,
          todaysOrders: todaysOrders,
          earnings: earnings,
          todaysEarnings: todaysEarningsTotal,
          admins: activeAdmins,
          tickets: totalTickets,
          openTickets: openTickets,
          highPriorityTickets: highPriorityTickets,
          unassignedTickets: unassignedTickets
        },
        pendingVerifications: {
          riders: pendingRiders,
          restaurants: pendingRestaurants,
          total: pendingRiders + pendingRestaurants
        },
        recentOrders: recentOrders.map(order => ({
          id: order._id,
          orderId: order.orderId,
          customerId: order.customerId,
          totalAmount: order.finalAmount,
          status: order.status,
          createdAt: order.createdAt
        }))
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET TICKET DASHBOARD DETAILS
exports.getDashboardTickets = async (req, res, next) => {
  try {
    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      closedTickets,
      highPriorityTickets,
      mediumPriorityTickets,
      lowPriorityTickets,
      todayTickets,
      unassignedTickets,
      recentTickets
    ] = await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: TICKET_STATUS.OPEN }),
      Ticket.countDocuments({ status: TICKET_STATUS.IN_PROGRESS }),
      Ticket.countDocuments({ status: TICKET_STATUS.RESOLVED }),
      Ticket.countDocuments({ status: TICKET_STATUS.CLOSED }),
      Ticket.countDocuments({ priority: TICKET_PRIORITY.HIGH }),
      Ticket.countDocuments({ priority: TICKET_PRIORITY.MEDIUM }),
      Ticket.countDocuments({ priority: TICKET_PRIORITY.LOW }),
      Ticket.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      Ticket.countDocuments({ 'assignedTo.adminId': { $exists: false } }),
      Ticket.find().sort({ createdAt: -1 }).limit(10)
        .select('ticketId subject userInfo.name userInfo.role status priority createdAt')
    ]);

    const slaTickets = await Ticket.aggregate([
      {
        $match: {
          status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
          resolvedAt: { $exists: true },
          resolutionDueAt: { $exists: true }
        }
      },
      {
        $project: {
          metSLA: {
            $cond: {
              if: { $lte: ["$resolvedAt", "$resolutionDueAt"] },
              then: true,
              else: false
            }
          }
        }
      },
      {
        $group: {
          _id: "$metSLA",
          count: { $sum: 1 }
        }
      }
    ]);

    const resolutionStats = await Ticket.aggregate([
      {
        $match: {
          status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
          resolvedAt: { $exists: true }
        }
      },
      {
        $project: {
          resolutionHours: {
            $divide: [
              { $subtract: ["$resolvedAt", "$createdAt"] },
              1000 * 60 * 60
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgResolutionHours: { $avg: "$resolutionHours" },
          minResolutionHours: { $min: "$resolutionHours" },
          maxResolutionHours: { $max: "$resolutionHours" }
        }
      }
    ]);

    let slaCompliant = 0;
    let slaViolated = 0;

    slaTickets.forEach(item => {
      if (item._id === true) slaCompliant = item.count;
      if (item._id === false) slaViolated = item.count;
    });

    const totalResolved = slaCompliant + slaViolated;
    const slaComplianceRate = totalResolved > 0 ? (slaCompliant / totalResolved) * 100 : 0;

    const ticketsByCategory = await Ticket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const ticketsByUserRole = await Ticket.aggregate([
      {
        $group: {
          _id: "$userInfo.role",
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      dashboard: {
        totals: {
          all: totalTickets,
          open: openTickets,
          inProgress: inProgressTickets,
          resolved: resolvedTickets,
          closed: closedTickets,
          today: todayTickets,
          unassigned: unassignedTickets
        },
        priority: {
          high: highPriorityTickets,
          medium: mediumPriorityTickets,
          low: lowPriorityTickets
        },
        sla: {
          compliant: slaCompliant,
          violated: slaViolated,
          complianceRate: Math.round(slaComplianceRate * 100) / 100,
          totalResolved: totalResolved
        },
        resolutionTime: resolutionStats[0] || {
          avgResolutionHours: 0,
          minResolutionHours: 0,
          maxResolutionHours: 0
        },
        distribution: {
          byCategory: ticketsByCategory,
          byUserRole: ticketsByUserRole
        },
        recentTickets: recentTickets.map(ticket => ({
          ticketId: ticket.ticketId,
          subject: ticket.subject,
          userName: ticket.userInfo.name,
          userRole: ticket.userInfo.role,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt
        }))
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET PENDING VERIFICATIONS
exports.getPendingVerifications = async (req, res, next) => {
  try {
    const { role, page = 1, limit = 10 } = req.query;

    let query = { isVerified: false };

    if (role && ['rider', 'restaurant'].includes(role)) {
      query.role = role;
    }

    const users = await User.find(query)
      .select("_id name phone email role createdAt lastLogin")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    const usersWithDetails = await Promise.all(
      users.map(async (user) => {
        let userDetails = user.toObject();

        if (user.role === 'rider') {
          const rider = await Rider.findById(user._id)
            .select("name email phone vehicleNo vehicleType licenseNumber bankAccountNumber bankIFSC aadharNumber licensePhoto vehiclePhoto isOnline isAvailable totalDeliveries completedDeliveries cancelledDeliveries averageRating earnings currentLocation");

          if (rider) {
            userDetails.name = rider.name || user.name;
            userDetails.email = rider.email || user.email;
            userDetails.phone = rider.phone || user.phone;

            userDetails.riderDetails = {
              name: rider.name,
              email: rider.email,
              phone: rider.phone,
              vehicleNo: rider.vehicleNo,
              vehicleType: rider.vehicleType,
              licenseNumber: rider.licenseNumber,
              bankAccountNumber: rider.bankAccountNumber,
              bankIFSC: rider.bankIFSC,
              aadharNumber: rider.aadharNumber,
              licensePhoto: rider.licensePhoto,
              vehiclePhoto: rider.vehiclePhoto,
              isOnline: rider.isOnline,
              isAvailable: rider.isAvailable,
              totalDeliveries: rider.totalDeliveries,
              completedDeliveries: rider.completedDeliveries,
              cancelledDeliveries: rider.cancelledDeliveries,
              averageRating: rider.averageRating,
              earnings: rider.earnings,
              currentLocation: rider.currentLocation,
              registrationComplete: !!(rider.vehicleNo && rider.vehicleNo !== 'NOT_SET' && rider.licenseNumber),
              hasDocuments: !!(rider.licensePhoto || rider.vehiclePhoto)
            };
          }
        }
        else if (user.role === 'restaurant') {
          const restaurantUser = await RestaurantUser.findById(user._id)
            .select("name email businessName gstNumber restaurantId bankAccountNumber bankIFSC upiId totalOrders totalEarnings");

          if (restaurantUser) {
            userDetails.name = restaurantUser.name || user.name;
            userDetails.email = restaurantUser.email || user.email;

            userDetails.restaurantDetails = {
              name: restaurantUser.name,
              email: restaurantUser.email,
              businessName: restaurantUser.businessName,
              gstNumber: restaurantUser.gstNumber,
              restaurantId: restaurantUser.restaurantId,
              bankAccountNumber: restaurantUser.bankAccountNumber,
              bankIFSC: restaurantUser.bankIFSC,
              upiId: restaurantUser.upiId,
              totalOrders: restaurantUser.totalOrders,
              totalEarnings: restaurantUser.totalEarnings
            };
          }
        }

        return userDetails;
      })
    );

    res.json({
      success: true,
      pendingVerifications: usersWithDetails,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (err) {
    next(err);
  }
};

// ✅ VERIFY SINGLE USER
exports.verifyUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (user.role === 'customer') {
      return res.status(400).json({
        success: false,
        error: "Customers are auto-verified"
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        error: "User is already verified"
      });
    }

    let isRegistrationComplete = false;
    let missingFields = [];

    if (user.role === 'rider') {
      const rider = await Rider.findById(userId);

      if (!rider) {
        return res.status(400).json({
          success: false,
          error: "Rider profile not found. Please complete registration first."
        });
      }

      if (!rider.vehicleNo || rider.vehicleNo === 'NOT_SET') {
        missingFields.push('vehicleNo');
      }
      if (!rider.licenseNumber) {
        missingFields.push('licenseNumber');
      }
      if (!rider.vehicleType) {
        missingFields.push('vehicleType');
      }

      isRegistrationComplete = missingFields.length === 0;

      if (!isRegistrationComplete) {
        return res.status(400).json({
          success: false,
          error: `Rider registration incomplete. Missing fields: ${missingFields.join(', ')}. Please complete registration first.`,
          missingFields: missingFields,
          requiresRegistrationCompletion: true
        });
      }
    }
    else if (user.role === 'restaurant') {
      const restaurantUser = await RestaurantUser.findById(userId);
      const restaurant = await Restaurant.findOne({ ownerId: userId });

      if (!restaurantUser) {
        return res.status(400).json({
          success: false,
          error: "Restaurant profile not found. Please complete registration first."
        });
      }

      if (!restaurantUser.businessName || restaurantUser.businessName === 'NOT_SET') {
        missingFields.push('businessName');
      }
      if (!restaurantUser.gstNumber) {
        missingFields.push('gstNumber');
      }

      isRegistrationComplete = missingFields.length === 0;

      if (!isRegistrationComplete) {
        return res.status(400).json({
          success: false,
          error: `Restaurant registration incomplete. Missing fields: ${missingFields.join(', ')}. Please complete registration first.`,
          missingFields: missingFields,
          requiresRegistrationCompletion: true
        });
      }

      if (restaurant) {
        restaurant.isActive = true;
        await restaurant.save();
      }
    }

    user.isVerified = true;
    await user.save();

    if (user.role === 'rider') {
      await Rider.findByIdAndUpdate(userId, { isVerified: true });
    } else if (user.role === 'restaurant') {
      await RestaurantUser.findByIdAndUpdate(userId, { isVerified: true });
    }

    res.json({
      success: true,
      message: `${user.role} verified successfully`,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        isVerified: true
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET USER DETAILS (role-specific)
exports.getUserDetails = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    let userDetails = user.toObject();

    if (user.role === 'customer') {
      const customer = await Customer.findById(userId);
      if (customer) {
        userDetails = {
          ...userDetails,
          ...customer.toObject(),
          type: 'customer'
        };
      }
    }
    else if (user.role === 'rider') {
      const rider = await Rider.findById(userId);
      if (rider) {
        userDetails = {
          ...userDetails,
          name: rider.name || user.name,
          email: rider.email || user.email,
          phone: rider.phone || user.phone,
          ...rider.toObject(),
          type: 'rider',
          registrationComplete: !!(rider.vehicleNo && rider.vehicleNo !== 'NOT_SET' && rider.licenseNumber),
          hasDocuments: !!(rider.licensePhoto || rider.vehiclePhoto),
          documentsAvailable: {
            licensePhoto: !!rider.licensePhoto,
            vehiclePhoto: !!rider.vehiclePhoto
          }
        };
      }
    }
    else if (user.role === 'restaurant') {
      const restaurantUser = await RestaurantUser.findById(userId);
      if (restaurantUser) {
        userDetails = {
          ...userDetails,
          name: restaurantUser.name || user.name,
          email: restaurantUser.email || user.email,
          ...restaurantUser.toObject(),
          type: 'restaurant'
        };
      }
    }

    res.json({
      success: true,
      user: userDetails
    });
  } catch (err) {
    next(err);
  }
};

// ✅ BULK VERIFY USERS
exports.bulkVerifyUsers = async (req, res, next) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "User IDs array is required"
      });
    }

    const result = await User.updateMany(
      { _id: { $in: userIds }, role: { $ne: 'customer' } },
      { $set: { isVerified: true } }
    );

    await Rider.updateMany(
      { _id: { $in: userIds } },
      { $set: { isVerified: true } }
    );

    await RestaurantUser.updateMany(
      { _id: { $in: userIds } },
      { $set: { isVerified: true } }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} users verified successfully`,
      verifiedCount: result.modifiedCount
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET VERIFICATION STATS
exports.getVerificationStats = async (req, res, next) => {
  try {
    const [pendingRiders, pendingRestaurants, totalRiders, totalRestaurants] = await Promise.all([
      User.countDocuments({ role: 'rider', isVerified: false }),
      User.countDocuments({ role: 'restaurant', isVerified: false }),
      User.countDocuments({ role: 'rider' }),
      User.countDocuments({ role: 'restaurant' })
    ]);

    res.json({
      success: true,
      stats: {
        pending: {
          riders: pendingRiders,
          restaurants: pendingRestaurants,
          total: pendingRiders + pendingRestaurants
        },
        total: {
          riders: totalRiders,
          restaurants: totalRestaurants
        },
        verified: {
          riders: totalRiders - pendingRiders,
          restaurants: totalRestaurants - pendingRestaurants
        },
        verificationRate: {
          riders: totalRiders > 0 ? ((totalRiders - pendingRiders) / totalRiders * 100).toFixed(2) : 0,
          restaurants: totalRestaurants > 0 ? ((totalRestaurants - pendingRestaurants) / totalRestaurants * 100).toFixed(2) : 0
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ALL USERS (with pagination and filter)
exports.getAllUsers = async (req, res, next) => {
  try {
    const { role, isVerified, search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (role && ['customer', 'rider', 'restaurant'].includes(role)) {
      query.role = role;
    }
    if (isVerified !== undefined) {
      query.isVerified = isVerified === 'true';
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select("_id name phone email role isVerified isActive createdAt lastLogin")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (err) {
    next(err);
  }
};

// ✅ UPDATE USER STATUS (Activate/Deactivate)
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "isActive must be a boolean"
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true }
    ).select("_id name phone email role isActive isVerified");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    if (user.role === 'customer') {
      await Customer.findByIdAndUpdate(userId, { isActive });
    } else if (user.role === 'rider') {
      await Rider.findByIdAndUpdate(userId, { isActive });
    } else if (user.role === 'restaurant') {
      await RestaurantUser.findByIdAndUpdate(userId, { isActive });
    }

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ALL RESTAURANTS
exports.getAllRestaurants = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
        { cuisineType: { $regex: search, $options: 'i' } }
      ];
    }

    const restaurants = await Restaurant.find(query)
      .select("_id name email phone address cuisineType rating status isActive createdAt")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Restaurant.countDocuments(query);

    res.json({
      success: true,
      restaurants,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ALL RIDERS
exports.getAllRiders = async (req, res, next) => {
  try {
    const { isAvailable, isVerified, search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (isAvailable !== undefined) {
      query.isAvailable = isAvailable === 'true';
    }
    if (isVerified !== undefined) {
      query.isVerified = isVerified === 'true';
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { vehicleNo: { $regex: search, $options: 'i' } }
      ];
    }

    const riders = await Rider.find(query)
      .select("_id name phone email vehicleNo vehicleType isAvailable isVerified totalDeliveries averageRating earnings createdAt")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Rider.countDocuments(query);

    res.json({
      success: true,
      riders,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ALL ORDERS
exports.getAllOrders = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { orderId: { $regex: search, $options: 'i' } },
        { 'customerDetails.name': { $regex: search, $options: 'i' } },
        { 'restaurantDetails.name': { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await Order.find(query)
      .populate("customerId", "name phone")
      .populate("restaurantId", "name")
      .populate("riderId", "name phone")
      .select("orderId customerId restaurantId riderId totalAmount status paymentStatus createdAt")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      orders,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET ALL TICKETS WITH FILTERS
exports.getAllTickets = async (req, res, next) => {
  try {
    const {
      status,
      priority,
      category,
      role,
      assignedTo,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (page - 1) * limit;
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (role) filter['userInfo.role'] = role;

    if (assignedTo === 'me') {
      filter['assignedTo.adminId'] = req.admin._id;
    } else if (assignedTo === 'unassigned') {
      filter['assignedTo.adminId'] = { $exists: false };
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    if (search) {
      filter.$or = [
        { ticketId: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'userInfo.name': { $regex: search, $options: 'i' } },
        { 'userInfo.phone': { $regex: search, $options: 'i' } }
      ];
    }

    const tickets = await Ticket.find(filter)
      .populate('assignedTo.adminId', 'name email')
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('ticketId subject category status priority userInfo assignedTo createdAt updatedAt');

    const total = await Ticket.countDocuments(filter);

    const stats = await Ticket.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusStats = {};
    stats.forEach(stat => {
      statusStats[stat._id] = stat.count;
    });

    res.json({
      success: true,
      data: tickets,
      stats: {
        total,
        byStatus: statusStats
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalTickets: total
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET TICKET DETAILS
exports.getTicketById = async (req, res, next) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findOne({ ticketId })
      .populate('assignedTo.adminId', 'name email')
      .populate('closedBy', 'name email');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    const ticketWithResponseHistory = {
      ...ticket.toObject(),
      responses: ticket.responses || []
    };

    res.json({
      success: true,
      data: ticketWithResponseHistory
    });
  } catch (err) {
    next(err);
  }
};

// ✅ UPDATE TICKET PRIORITY
exports.updateTicketPriority = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { priority } = req.body;

    if (!ticketId || !ticketId.startsWith('TCKT-')) {
      return res.status(400).json({
        success: false,
        error: "Invalid ticket ID format"
      });
    }

    if (!Object.values(TICKET_PRIORITY).includes(priority)) {
      return res.status(400).json({
        success: false,
        error: "Invalid priority"
      });
    }

    const ticket = await Ticket.findOneAndUpdate(
      { ticketId },
      { priority },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    res.json({
      success: true,
      message: "Ticket priority updated",
      data: ticket
    });
  } catch (err) {
    next(err);
  }
};

// ✅ ASSIGN TICKET TO ADMIN
exports.assignTicket = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { adminId } = req.body;

    if (!ticketId || !ticketId.startsWith('TCKT-')) {
      return res.status(400).json({
        success: false,
        error: "Invalid ticket ID format"
      });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    const assignToAdminId = adminId || req.admin._id;
    const admin = await Admin.findById(assignToAdminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    ticket.assignedTo = {
      adminId: assignToAdminId,
      adminName: admin.name,
      assignedAt: new Date()
    };

    if (ticket.status === TICKET_STATUS.OPEN) {
      ticket.status = TICKET_STATUS.IN_PROGRESS;
    }

    await ticket.save();

    res.json({
      success: true,
      message: `Ticket assigned to ${admin.name}`,
      data: ticket
    });
  } catch (err) {
    next(err);
  }
};

// ✅ UPDATE TICKET STATUS
exports.updateTicketStatus = async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { status, note } = req.body;

    if (!ticketId || !ticketId.startsWith('TCKT-')) {
      return res.status(400).json({
        success: false,
        error: "Invalid ticket ID format"
      });
    }

    if (!Object.values(TICKET_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status"
      });
    }

    const ticket = await Ticket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }

    const oldStatus = ticket.status;
    ticket.status = status;

    if (status === TICKET_STATUS.RESOLVED && oldStatus !== TICKET_STATUS.RESOLVED) {
      ticket.resolvedAt = new Date();
    } else if (status === TICKET_STATUS.CLOSED && oldStatus !== TICKET_STATUS.CLOSED) {
      ticket.closedAt = new Date();
      ticket.closedBy = req.admin._id;
    }

    if (note) {
      if (!ticket.internalNotes) ticket.internalNotes = [];
      ticket.internalNotes.push({
        adminId: req.admin._id,
        adminName: req.admin.name,
        note,
        createdAt: new Date()
      });
    }

    await ticket.save();

    res.json({
      success: true,
      message: `Ticket status updated to ${status}`,
      data: {
        oldStatus,
        newStatus: status,
        updatedAt: ticket.updatedAt
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ GET TICKET ANALYTICS OVERVIEW
exports.getTicketAnalytics = async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const dailyTickets = await Ticket.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
          "_id.day": 1
        }
      },
      {
        $limit: 30
      }
    ]);

    const categoryDistribution = await Ticket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const statusDistribution = await Ticket.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    const resolutionStats = await Ticket.aggregate([
      {
        $match: {
          status: { $in: [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED] },
          resolvedAt: { $exists: true }
        }
      },
      {
        $project: {
          resolutionHours: {
            $divide: [
              { $subtract: ["$resolvedAt", "$createdAt"] },
              1000 * 60 * 60
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgResolutionHours: { $avg: "$resolutionHours" },
          minResolutionHours: { $min: "$resolutionHours" },
          maxResolutionHours: { $max: "$resolutionHours" }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        dailyTickets,
        categoryDistribution,
        statusDistribution,
        resolutionStats: resolutionStats[0] || {
          avgResolutionHours: 0,
          minResolutionHours: 0,
          maxResolutionHours: 0
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// ✅ EXPORT TICKETS
exports.exportTickets = async (req, res, next) => {
  try {
    const { status, priority, category, startDate, endDate } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .select('ticketId subject category status priority userInfo.name userInfo.role assignedTo.adminName createdAt updatedAt resolvedAt');

    const exportData = tickets.map(ticket => ({
      TicketID: ticket.ticketId,
      Subject: ticket.subject,
      Category: ticket.category,
      Status: ticket.status,
      Priority: ticket.priority,
      Customer: ticket.userInfo.name,
      CustomerRole: ticket.userInfo.role,
      AssignedTo: ticket.assignedTo?.adminName || 'Unassigned',
      CreatedAt: ticket.createdAt.toISOString(),
      UpdatedAt: ticket.updatedAt.toISOString(),
      ResolvedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : 'Not Resolved'
    }));

    res.json({
      success: true,
      data: exportData,
      count: tickets.length,
      exportDate: new Date()
    });
  } catch (err) {
    next(err);
  }
};
