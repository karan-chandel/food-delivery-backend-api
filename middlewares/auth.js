// middlewares/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/config');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const RestaurantUser = require('../models/RestaurantUser');

// ✅ Enhanced authentication middleware (Supports both Users, Admins, and role-specific collections)
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    
    // console.log("🔐 Auth Middleware - Processing token");
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: "Access token required" 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    // console.log("🔐 Decoded Token - UserID:", decoded.userId, "Role:", decoded.role);
    
    // ✅ CHECK IF IT'S AN ADMIN TOKEN
    if (decoded.role && decoded.role.includes('admin')) {
      const admin = await Admin.findById(decoded.adminId || decoded.userId);
      
      if (!admin) {
        return res.status(401).json({ 
          success: false,
          error: "Admin not found" 
        });
      }
      
      if (!admin.isActive) {
        return res.status(401).json({ 
          success: false,
          error: "Admin account is deactivated" 
        });
      }
      
      req.admin = admin;
      req.user = decoded; // For compatibility with existing code
      
    } else {
      // ✅ REGULAR USER TOKEN - Check role-specific collections first to resolve actual Mongoose model
      let user = null;
      if (decoded.role === 'customer') {
        user = await Customer.findById(decoded.userId);
      } else if (decoded.role === 'rider') {
        user = await Rider.findById(decoded.userId);
      } else if (decoded.role === 'restaurant') {
        user = await RestaurantUser.findById(decoded.userId);
      }

      // Fallback to base User collection if not found in role-specific collection
      if (!user) {
        user = await User.findById(decoded.userId);
      }
      
      if (!user) {
        // console.log("❌ User not found in any collection for ID:", decoded.userId);
        return res.status(401).json({ 
          success: false,
          error: "User not found" 
        });
      }
      
      // console.log("🔐 User found - Name:", user.name, "Role:", user.role, "Verified:", user.isVerified);
      
      if (!user.isActive) {
        return res.status(401).json({ 
          success: false,
          error: "User account is deactivated" 
        });
      }
      
      // ✅ Check verification for riders/restaurants (except for rider completion)
    //   if (user.role !== 'customer' && !user.isVerified && 
    // !req.originalUrl.includes('/rider/complete')
    //   && 
    // !req.originalUrl.includes('/restaurant/complete'))) {
    if (user.role !== 'customer' && !user.isVerified && 
    !req.originalUrl.includes('/rider/complete') && 
    !req.originalUrl.includes('/restaurant/complete')) {
        return res.status(403).json({ 
          success: false,
          error: `Your ${user.role} account is pending verification. Please contact admin.` 
        });
      }
      
      req.user = user;
    }
    
    next();
  } catch (err) {
    // console.error("🔐 Auth Middleware Error:", err.message);
    return res.status(403).json({ 
      success: false,
      error: "Invalid or expired token" 
    });
  }
};

// ✅ Enhanced role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    // Check if it's admin access
    if (req.admin) {
      if (!roles.includes(req.admin.role)) {
        return res.status(403).json({ 
          success: false, 
          error: `Access denied. Required roles: ${roles.join(', ')}` 
        });
      }
      return next();
    }
    
    // Check if it's user access
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: "Authentication required" 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. Required roles: ${roles.join(', ')}` 
      });
    }
    
    next();
  };
};

// ✅ Admin-specific middleware (only for admin routes)
const requireAdmin = (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ 
      success: false, 
      error: "Admin authentication required" 
    });
  }
  next();
};

// ✅ Permission-based middleware for admin routes
const requirePermission = (module, action) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ 
        success: false, 
        error: "Admin authentication required" 
      });
    }

    // Super admin has all permissions
    if (req.admin.role === 'super_admin') {
      return next();
    }

    // Check specific permission
    if (!req.admin.permissions[module] || !req.admin.permissions[module][action]) {
      return res.status(403).json({
        success: false,
        error: `Insufficient permissions. Required: ${module}.${action}`
      });
    }
    
    next();
  };
};

// ✅ Export all middlewares
module.exports = {
  auth: authenticateToken,
  requireRole,
  requireAdmin,
  requirePermission
};