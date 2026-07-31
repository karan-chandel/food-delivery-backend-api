// routes/super-admin.js - FINAL COMPLETE VERSION
const express = require("express");
const router = express.Router();
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
const { auth, requireRole, requireAdmin } = require("../middlewares/auth");
//const { findTicket } = require("../utils/ticketHelper");
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

// ✅ PERMISSION MIDDLEWARE
const requirePermission = (module, action) => {
  return (req, res, next) => {
    if (req.admin.role === 'super_admin') return next();
    
    if (!req.admin.permissions[module] || !req.admin.permissions[module][action]) {
      return res.status(403).json({
        success: false,
        error: `Insufficient permissions. Required: ${module}.${action}`
      });
    }
    next();
  };
};

// ============================ ADMIN AUTHENTICATION ============================

// ✅ SUPER ADMIN SETUP (First time only)
router.post("/setup", async (req, res, next) => {
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
});

// ✅ ADMIN LOGIN
router.post("/login", async (req, res, next) => {
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

    // Update last login
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

    // Generate token
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
});

// ============================ ADMIN MANAGEMENT ============================

// ✅ CREATE NEW ADMIN (Only by super_admin)
router.post("/admins", auth, requireRole(["super_admin"]), async (req, res, next) => {
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
});

// ✅ GET ALL ADMINS
router.get("/admins", auth, requireAdmin, 
  requirePermission("user_management", "view"), 
  async (req, res, next) => {
  try {
    const { role, isActive, page = 1, limit = 10 } = req.query;

    let query = {};
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    // Non-super_admins can't see super_admins
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
});

// ✅ GET ADMIN PROFILE
router.get("/profile", auth, requireAdmin, async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.admin._id)
      .select("-password -loginHistory");

    res.json({
      success: true,
      admin
    });

  } catch (err) {
    next(err);
  }
});

// ✅ UPDATE ADMIN PROFILE
router.put("/profile", auth, requireAdmin, async (req, res, next) => {
  try {
    const { name, email, profilePicture } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (profilePicture) updateData.profilePicture = profilePicture;

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      updateData,
      { new: true, runValidators: true }
    ).select("-password -loginHistory");

    res.json({
      success: true,
      message: "Profile updated successfully",
      admin
    });

  } catch (err) {
    next(err);
  }
});

// ✅ UPDATE ADMIN STATUS
router.put("/admins/:adminId/status", auth, requireRole(["super_admin"]), 
  requirePermission("user_management", "edit"), 
  async (req, res, next) => {
  try {
    const { adminId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "isActive must be a boolean"
      });
    }

    if (adminId === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "Cannot change your own status"
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { isActive },
      { new: true }
    ).select("-password -loginHistory");

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
});

// ✅ UPDATE ADMIN PERMISSIONS
router.put("/admins/:adminId/permissions", auth, requireRole(["super_admin"]), 
  async (req, res, next) => {
  try {
    const { adminId } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({
        success: false,
        error: "Valid permissions object is required"
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { permissions },
      { new: true, runValidators: true }
    ).select("-password -loginHistory");

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    res.json({
      success: true,
      message: "Permissions updated successfully",
      admin
    });

  } catch (err) {
    next(err);
  }
});

// ✅ CHANGE PASSWORD
router.put("/change-password", auth, requireAdmin, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Current password and new password are required"
      });
    }

    const admin = await Admin.findById(req.admin._id);
    
    const isCurrentPasswordValid = await admin.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        error: "Current password is incorrect"
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
});

// ✅ DELETE ADMIN
router.delete("/admins/:adminId", auth, requireRole(["super_admin"]), 
  requirePermission("user_management", "delete"), 
  async (req, res, next) => {
  try {
    const { adminId } = req.params;

    if (adminId === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete your own account"
      });
    }

    const admin = await Admin.findByIdAndDelete(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        error: "Admin not found"
      });
    }

    res.json({
      success: true,
      message: "Admin deleted successfully"
    });

  } catch (err) {
    next(err);
  }
});

// ✅ GET ADMIN LOGIN HISTORY
router.get("/login-history", auth, requireRole(["super_admin"]), 
  async (req, res, next) => {
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
});

// ============================ DASHBOARD ============================

// ✅ MAIN DASHBOARD STATS (Enhanced with Tickets)
router.get("/dashboard", auth, requireAdmin, 
  requirePermission("analytics", "view"), 
  async (req, res, next) => {
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
      // ✅ ENHANCED METRICS
      activeOrders,
      todaysOrders,
      todaysEarnings,
      // ✅ TICKET STATS
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
      // ✅ NEW METRICS
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
      // ✅ TICKET COUNTS
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
          // ✅ TICKET TOTALS
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
});

// ✅ TICKET DASHBOARD (Detailed Ticket Stats)
router.get("/dashboard/tickets", auth, requireAdmin, 
  requirePermission("analytics", "view"), 
  async (req, res, next) => {
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
    
    // ✅ Calculate SLA compliance
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
    
    // ✅ Average resolution time
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
    
    // ✅ Tickets by category
    const ticketsByCategory = await Ticket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    // ✅ Tickets by user role
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
});

// ============================ VERIFICATION MANAGEMENT ============================

// Get pending verifications
// router.get("/verifications/pending", auth, requireAdmin, 
//   requirePermission("user_management", "view"), 
//   async (req, res, next) => {
//   try {
//     const { role, page = 1, limit = 10 } = req.query;

//     let query = { isVerified: false };
    
//     if (role && ['rider', 'restaurant'].includes(role)) {
//       query.role = role;
//     }

//     const users = await User.find(query)
//       .select("_id name phone email role createdAt lastLogin")
//       .sort({ createdAt: -1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     const total = await User.countDocuments(query);

//     const usersWithDetails = await Promise.all(
//       users.map(async (user) => {
//         let userDetails = user.toObject();
        
//         if (user.role === 'rider') {
//           const rider = await Rider.findById(user._id)
//             .select("vehicleNo vehicleType licenseNumber totalDeliveries isAvailable");
//           if (rider) userDetails.riderDetails = rider;
//         } else if (user.role === 'restaurant') {
//           const restaurantUser = await RestaurantUser.findById(user._id)
//             .select("businessName gstNumber totalOrders totalEarnings");
//           if (restaurantUser) userDetails.restaurantDetails = restaurantUser;
//         }
        
//         return userDetails;
//       })
//     );

//     res.json({
//       success: true,
//       pendingVerifications: usersWithDetails,
//       totalPages: Math.ceil(total / limit),
//       currentPage: parseInt(page),
//       total
//     });

//   } catch (err) {
//     next(err);
//   }
// });
// Get pending verifications - FIXED to get data from Rider model
router.get("/verifications/pending", auth, requireAdmin, 
  requirePermission("user_management", "view"), 
  async (req, res, next) => {
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
          // ✅ FIXED: Get ALL data from Rider model (including name, email)
          const rider = await Rider.findById(user._id)
            .select("name email phone vehicleNo vehicleType licenseNumber bankAccountNumber bankIFSC aadharNumber licensePhoto vehiclePhoto isOnline isAvailable totalDeliveries completedDeliveries cancelledDeliveries averageRating earnings currentLocation");
          
          if (rider) {
            // ✅ Use rider data for name and email if User model has null
            userDetails.name = rider.name || user.name;
            userDetails.email = rider.email || user.email;
            userDetails.phone = rider.phone || user.phone;
            
            userDetails.riderDetails = {
              // Basic Info (from rider model)
              name: rider.name,
              email: rider.email,
              phone: rider.phone,
              
              // Vehicle details
              vehicleNo: rider.vehicleNo,
              vehicleType: rider.vehicleType,
              licenseNumber: rider.licenseNumber,
              
              // Bank details
              bankAccountNumber: rider.bankAccountNumber,
              bankIFSC: rider.bankIFSC,
              aadharNumber: rider.aadharNumber,
              
              // Documents
              licensePhoto: rider.licensePhoto,
              vehiclePhoto: rider.vehiclePhoto,
              
              // Status
              isOnline: rider.isOnline,
              isAvailable: rider.isAvailable,
              
              // Performance
              totalDeliveries: rider.totalDeliveries,
              completedDeliveries: rider.completedDeliveries,
              cancelledDeliveries: rider.cancelledDeliveries,
              averageRating: rider.averageRating,
              
              // Earnings
              earnings: rider.earnings,
              
              // Location
              currentLocation: rider.currentLocation,
              
              // Registration complete check
              registrationComplete: !!(rider.vehicleNo && rider.vehicleNo !== 'NOT_SET' && rider.licenseNumber),
              hasDocuments: !!(rider.licensePhoto || rider.vehiclePhoto)
            };
          }
        } 
        else if (user.role === 'restaurant') {
          const restaurantUser = await RestaurantUser.findById(user._id)
            .select("name email businessName gstNumber restaurantId bankAccountNumber bankIFSC upiId totalOrders totalEarnings");
          
          if (restaurantUser) {
            // ✅ Use restaurant data for name and email
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
});
// Verify single user
// 
// super-admin.js - Fixed verification
// super-admin.js - Fixed verification
router.post("/users/:userId/verify", auth, requireAdmin, 
  requirePermission("user_management", "verify"), 
  async (req, res, next) => {
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

      console.log(`🔍 Verifying restaurant user: ${userId}`);
      console.log(`📋 RestaurantUser found: ${restaurantUser ? 'yes' : 'no'}`);
      console.log(`🏪 Restaurant found: ${restaurant ? 'yes' : 'no'}`);
      if (restaurant) {
        console.log(`📍 Restaurant ownerId: ${restaurant.ownerId}, userId: ${userId}`);
      }

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
      
      // ✅ Activate restaurant
      if (restaurant) {
        console.log(`🔄 Setting restaurant isActive to true for: ${restaurant.name}`);
        restaurant.isActive = true;
        try {
          await restaurant.save();
          console.log(`✅ Restaurant activated: ${restaurant.name}, isActive: ${restaurant.isActive}`);
        } catch (saveError) {
          console.error(`❌ Error saving restaurant: ${saveError.message}`);
          return res.status(500).json({
            success: false,
            error: `Failed to activate restaurant: ${saveError.message}`
          });
        }
      } else {
        console.log(`⚠️ Restaurant not found for ownerId: ${userId}`);
      }
    }

    // ✅ Registration is complete, now verify
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
    console.error('❌ Verification error:', err);
    next(err);
  }
});
// Get user details - FIXED to get data from role-specific models
router.get("/users/:userId", auth, requireAdmin, 

  requirePermission("user_management", "view"), 
  async (req, res, next) => {
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
        // ✅ Override with rider data
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
});
// Bulk verify users
router.post("/verifications/bulk-verify", auth, requireAdmin, 
  requirePermission("user_management", "verify"), 
  async (req, res, next) => {
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
});

// Get verification statistics
router.get("/verifications/stats", auth, requireAdmin, 
  requirePermission("user_management", "view"), 
  async (req, res, next) => {
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
});

// ============================ USER MANAGEMENT ============================

// Get all users with filters
router.get("/users", auth, requireAdmin, 
  requirePermission("user_management", "view"), 
  async (req, res, next) => {
  try {
    const { 
      role, 
      isVerified, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

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
});

// Get user details
// router.get("/users/:userId", auth, requireAdmin, 
//   requirePermission("user_management", "view"), 
//   async (req, res, next) => {
//   try {
//     const { userId } = req.params;

//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         error: "User not found"
//       });
//     }

//     let userDetails = user.toObject();

//     if (user.role === 'customer') {
//       const customer = await Customer.findById(userId);
//       if (customer) userDetails = { ...userDetails, ...customer.toObject() };
//     } else if (user.role === 'rider') {
//       const rider = await Rider.findById(userId);
//       if (rider) userDetails = { ...userDetails, ...rider.toObject() };
//     } else if (user.role === 'restaurant') {
//       const restaurantUser = await RestaurantUser.findById(userId);
//       if (restaurantUser) userDetails = { ...userDetails, ...restaurantUser.toObject() };
//     }

//     res.json({
//       success: true,
//       user: userDetails
//     });

//   } catch (err) {
//     next(err);
//   }
// });

// Update user status
router.put("/users/:userId/status", auth, requireAdmin, 
  requirePermission("user_management", "edit"), 
  async (req, res, next) => {
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
});

// ============================ RESTAURANT MANAGEMENT ============================

// Get all restaurants
router.get("/restaurants", auth, requireAdmin, 
  requirePermission("restaurant_management", "view"), 
  async (req, res, next) => {
  try {
    const { 
      status, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

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
});

// ============================ RIDER MANAGEMENT ============================

// Get all riders
router.get("/riders", auth, requireAdmin, 
  requirePermission("rider_management", "view"), 
  async (req, res, next) => {
  try {
    const { 
      isAvailable, 
      isVerified, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

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
});

// ============================ ORDER MANAGEMENT ============================

// Get all orders
router.get("/orders", auth, requireAdmin, 
  requirePermission("order_management", "view"), 
  async (req, res, next) => {
  try {
    const { 
      status, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

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
});

// ============================ TICKET MANAGEMENT ============================

// Get all tickets with filters
router.get("/tickets", auth, requireAdmin, 
  requirePermission("analytics", "view"), 
  async (req, res, next) => {
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
    
    // Date filtering
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
    
    // Get stats for the filter
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
});

// ✅ GET TICKET DETAILS (Fixed version)
router.get("/tickets/:ticketId", auth, requireAdmin, 
  requirePermission("analytics", "view"), 
  async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    
    // Validate ticket ID format
    // if (!ticketId || !ticketId.startsWith('TCKT-')) {
    //   return res.status(400).json({
    //     success: false,
    //     error: "Invalid ticket ID format. Must start with 'TCKT-'"
    //   });
    // }
    
    const ticket = await Ticket.findOne({ ticketId: ticketId })
      .populate('assignedTo.adminId', 'name email')
      .populate('closedBy', 'name email');
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found"
      });
    }
    
    // Add admin response history if available
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
});

// ✅ UPDATE TICKET PRIORITY
router.put("/tickets/:ticketId/priority", auth, requireAdmin, 
  requirePermission("analytics", "edit"), 
  async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { priority } = req.body;
    
    // Validate ticket ID format
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
      { ticketId },  // ✅ ticketId field के based पर search
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
});

// ✅ ASSIGN TICKET TO ADMIN
router.put("/tickets/:ticketId/assign", auth, requireAdmin, 
  requirePermission("analytics", "edit"), 
  async (req, res, next) => {
  try {
    const { ticketId } = req.params;
    const { adminId } = req.body;
       // Validate ticket ID format

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
    
    // If adminId is provided, assign to that admin, else self-assign
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
});

// ✅ UPDATE TICKET STATUS
router.put("/tickets/:ticketId/status", auth, requireAdmin, 
  requirePermission("analytics", "edit"), 
  async (req, res, next) => {
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
    
    // Update timestamps
    if (status === TICKET_STATUS.RESOLVED && oldStatus !== TICKET_STATUS.RESOLVED) {
      ticket.resolvedAt = new Date();
    } else if (status === TICKET_STATUS.CLOSED && oldStatus !== TICKET_STATUS.CLOSED) {
      ticket.closedAt = new Date();
      ticket.closedBy = req.admin._id;
    }
    
    // Add internal note if provided
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
});

// Get ticket analytics for charts
router.get("/tickets/analytics/overview", auth, requireAdmin, 
  requirePermission("analytics", "view"), 
  async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    // Daily ticket counts
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
    
    // Category distribution
    const categoryDistribution = await Ticket.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    // Status distribution
    const statusDistribution = await Ticket.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Average resolution time
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
});

// ✅ TICKET EXPORT ENDPOINT
router.get("/tickets/export", auth, requireAdmin, 
  requirePermission("analytics", "export"), 
  async (req, res, next) => {
  try {
    const { 
      status, 
      priority, 
      category, 
      startDate,
      endDate 
    } = req.query;
    
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
    
    // Convert to export format
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
});

module.exports = router;