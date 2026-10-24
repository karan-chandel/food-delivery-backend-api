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

    const candidateSecrets = [
      JWT_SECRET,
      "your_super_secure_jwt_secret_key_here",
      "your_jwt_secret_key",
      "your_fallback_jwt_secret_key_here",
    ].filter(Boolean);

    let decoded = null;
    let lastErr = null;
    let isExpired = false;

    for (const secret of candidateSecrets) {
      try {
        decoded = jwt.verify(token, secret);
        break;
      } catch (err) {
        if (err.name === "TokenExpiredError") {
          isExpired = true;
        }
        lastErr = err;
      }
    }

    if (!decoded) {
      if (isExpired) {
        const expErr = new Error("jwt expired");
        expErr.name = "TokenExpiredError";
        throw expErr;
      }
      throw lastErr;
    }
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
        if (!user && decoded.phone) {
          user = await Customer.findOne({ phone: decoded.phone });
        }
        // JIT Provisioning: if user was created in auth microservice, ensure record exists in core DB
        if (!user) {
          try {
            user = await Customer.create({
              _id: decoded.userId,
              name: decoded.name || `User_${(decoded.phone || "0000").slice(-4)}`,
              phone: decoded.phone || "0000000000",
              role: 'customer',
              isVerified: decoded.isVerified ?? true,
              isActive: true,
            });
          } catch (syncErr) {
            user = await Customer.findOne({ phone: decoded.phone });
            if (!user) {
              user = {
                _id: decoded.userId,
                name: decoded.name || `User_${(decoded.phone || "0000").slice(-4)}`,
                phone: decoded.phone,
                role: 'customer',
                isVerified: decoded.isVerified ?? true,
                isActive: true,
              };
            }
          }
        }
      } else if (decoded.role === 'rider') {
        user = await Rider.findById(decoded.userId);
        if (!user && decoded.phone) {
          user = await Rider.findOne({ phone: decoded.phone });
        }
        if (!user) {
          try {
            user = await Rider.create({
              _id: decoded.userId,
              name: decoded.name || `Rider_${(decoded.phone || "0000").slice(-4)}`,
              phone: decoded.phone || "0000000000",
              role: 'rider',
              isVerified: decoded.isVerified ?? true,
              isActive: true,
            });
          } catch {
            user = await Rider.findOne({ phone: decoded.phone });
          }
        }
      } else if (decoded.role === 'restaurant') {
        user = await RestaurantUser.findById(decoded.userId);
        if (!user && decoded.phone) {
          user = await RestaurantUser.findOne({ phone: decoded.phone });
        }
        if (!user && decoded.restaurantId) {
          user = await RestaurantUser.findOne({ restaurantId: decoded.restaurantId });
        }
        if (!user) {
          try {
            user = await RestaurantUser.create({
              _id: decoded.userId,
              name: decoded.name || decoded.businessName || "Restaurant Partner",
              phone: decoded.phone || "0000000000",
              email: decoded.email,
              role: 'restaurant',
              businessName: decoded.businessName || "Restaurant Partner",
              restaurantId: decoded.restaurantId,
              isVerified: decoded.isVerified ?? true,
              isActive: true,
            });
          } catch {
            user = await RestaurantUser.findOne({ phone: decoded.phone });
          }
        }
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
      
      // ✅ Check verification for riders/restaurants (allow completion/onboarding routes)
      const isCompletionRoute = 
        req.originalUrl.includes('/rider/complete') ||
        req.originalUrl.includes('/rider/auth/complete') ||
        req.originalUrl.includes('/restaurant/complete') ||
        req.originalUrl.includes('/restaurant/auth/complete') ||
        (req.originalUrl.includes('/restaurants') && req.method === 'POST');

      if (user.role !== 'customer' && !user.isVerified && !isCompletionRoute) {
        return res.status(403).json({ 
          success: false,
          error: `Your ${user.role} account is pending verification. Please contact admin.` 
        });
      }
      
      req.user = user;
    }
    
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "Token expired",
        code: "TOKEN_EXPIRED",
        isExpired: true
      });
    }
    return res.status(403).json({ 
      success: false,
      error: "Invalid token" 
    });
  }
};

// ✅ Enhanced role-based authorization middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    // Check if it's admin access
    if (req.admin) {
      if (req.admin.role === 'super_admin' || roles.includes(req.admin.role)) {
        return next();
      }
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. Required roles: ${roles.join(', ')}` 
      });
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