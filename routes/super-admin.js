const express = require("express");
const router = express.Router();
const superAdminController = require("../controllers/superAdminController");
const { auth, requireRole, requireAdmin } = require("../middlewares/auth");

// ✅ PERMISSION MIDDLEWARE DEFINITION FOR ROUTING LAYER
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
router.post("/setup", superAdminController.setupSuperAdmin);
router.post("/login", superAdminController.adminLogin);

// ============================ ADMIN MANAGEMENT ============================
router.post("/admins", auth, requireRole(["super_admin"]), superAdminController.createAdmin);
router.get("/admins", auth, requireAdmin, requirePermission("user_management", "view"), superAdminController.getAllAdmins);
router.get("/profile", auth, requireAdmin, superAdminController.getAdminProfile);
router.put("/profile", auth, requireAdmin, superAdminController.updateAdminProfile);
router.put("/admins/:adminId/status", auth, requireRole(["super_admin"]), superAdminController.updateAdminStatus);
router.put("/admins/:adminId/permissions", auth, requireRole(["super_admin"]), superAdminController.updateAdminPermissions);
router.put("/change-password", auth, requireAdmin, superAdminController.changeAdminPassword);
router.delete("/admins/:adminId", auth, requireRole(["super_admin"]), superAdminController.deleteAdmin);
router.get("/login-history", auth, requireRole(["super_admin"]), superAdminController.getLoginHistory);

// ============================ DASHBOARD ============================
router.get("/dashboard", auth, requireAdmin, requirePermission("analytics", "view"), superAdminController.getDashboardStats);
router.get("/dashboard/tickets", auth, requireAdmin, requirePermission("analytics", "view"), superAdminController.getDashboardTickets);

// ============================ VERIFICATION MANAGEMENT ============================
router.get("/verifications/pending", auth, requireAdmin, requirePermission("user_management", "view"), superAdminController.getPendingVerifications);
router.post("/users/:userId/verify", auth, requireAdmin, requirePermission("user_management", "verify"), superAdminController.verifyUser);
router.get("/users/:userId", auth, requireAdmin, requirePermission("user_management", "view"), superAdminController.getUserDetails);
router.post("/verifications/bulk-verify", auth, requireAdmin, requirePermission("user_management", "verify"), superAdminController.bulkVerifyUsers);
router.get("/verifications/stats", auth, requireAdmin, requirePermission("user_management", "view"), superAdminController.getVerificationStats);

// ============================ USER MANAGEMENT ============================
router.get("/users", auth, requireAdmin, requirePermission("user_management", "view"), superAdminController.getAllUsers);
router.put("/users/:userId/status", auth, requireAdmin, requirePermission("user_management", "edit"), superAdminController.updateUserStatus);

// ============================ RESTAURANT MANAGEMENT ============================
router.get("/restaurants", auth, requireAdmin, requirePermission("restaurant_management", "view"), superAdminController.getAllRestaurants);

// ============================ RIDER MANAGEMENT ============================
router.get("/riders", auth, requireAdmin, requirePermission("rider_management", "view"), superAdminController.getAllRiders);

// ============================ ORDER MANAGEMENT ============================
router.get("/orders", auth, requireAdmin, requirePermission("order_management", "view"), superAdminController.getAllOrders);

// ============================ TICKET MANAGEMENT ============================
router.get("/tickets", auth, requireAdmin, requirePermission("analytics", "view"), superAdminController.getAllTickets);
router.get("/tickets/:ticketId", auth, requireAdmin, requirePermission("analytics", "view"), superAdminController.getTicketById);
router.put("/tickets/:ticketId/priority", auth, requireAdmin, requirePermission("analytics", "edit"), superAdminController.updateTicketPriority);
router.put("/tickets/:ticketId/assign", auth, requireAdmin, requirePermission("analytics", "edit"), superAdminController.assignTicket);
router.put("/tickets/:ticketId/status", auth, requireAdmin, requirePermission("analytics", "edit"), superAdminController.updateTicketStatus);
router.get("/tickets/analytics/overview", auth, requireAdmin, requirePermission("analytics", "view"), superAdminController.getTicketAnalytics);
router.get("/tickets/export", auth, requireAdmin, requirePermission("analytics", "export"), superAdminController.exportTickets);

module.exports = router;