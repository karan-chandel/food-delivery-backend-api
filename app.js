const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const corsMiddleware = require("./middlewares/cors");
const errorHandler = require("./middlewares/errorHandler");


const { API_VERSION } = require("./config/config");
const path = require("path");
const fs = require("fs");

const app = express();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Uploads directory created');
}

// Ensure menu-items subdirectory exists
const menuItemsDir = path.join(uploadsDir, 'menu-items');
if (!fs.existsSync(menuItemsDir)) {
  fs.mkdirSync(menuItemsDir, { recursive: true });
  console.log('📁 Menu items upload directory created');
}
// Ensure riders subdirectory exists for rider documents
const ridersDir = path.join(uploadsDir, 'riders');
if (!fs.existsSync(ridersDir)) {
  fs.mkdirSync(ridersDir, { recursive: true });
  console.log('📁 Riders upload directory created');
}

// Ensure admin subdirectory exists for admin uploads
const adminDir = path.join(uploadsDir, 'admin');
if (!fs.existsSync(adminDir)) {
  fs.mkdirSync(adminDir, { recursive: true });
  console.log('📁 Admin upload directory created');
}
if (process.env.NODE_ENV === 'development') {
  console.log('✅ Memory status logging initialized from app.js');

  setInterval(() => {
    const used = process.memoryUsage();
    console.log(`Memory Usage (in MB):`);
    console.log(`  RSS         : ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(
      `  Heap Total  : ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(`  Heap Used   : ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  External    : ${(used.external / 1024 / 1024).toFixed(2)} MB`);
    console.log(
      `  ArrayBuffer : ${(used.arrayBuffers / 1024 / 1024).toFixed(2)} MB`,
    );
  }, 600000);
}

const { securityHeaders, mongoSanitize, globalApiLimiter } = require("./middlewares/security");

// Middlewares
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(logger("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(mongoSanitize);
app.use(cookieParser());
app.use("/api", globalApiLimiter);

// Health check & API info - ADD THIS
app.get('/', (req, res) => {
  res.json({
    message: 'Zewito Food Delivery API',
    version: API_VERSION,
    status: 'active',
    endpoints: {
      auth: `/api/${API_VERSION}/auth`,
      restaurants: `/api/${API_VERSION}/restaurants`,
      orders: `/api/${API_VERSION}/orders`,
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/test-socket', (req, res) => {
  const io = req.app.get("io");
  res.json({
    ioExists: !!io,
    appIoExists: !!req.app.get("io"),
    message: io ? "Socket.io is ready" : "Socket.io not found"
  });
});

// ✅ Serve static files from uploads directory (ADD THIS LINE)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Socket.io middleware Injection
app.use((req, res, next) => {
  req.io = req.app.get("io");
  next();
});

// ==================== PORTAL-BASED ROUTE GATEWAYS ====================
// ⚠️  CORE PLATFORM ONLY — Catalog domain routes have been split out.
// Restaurants, Menu, Cart, Coupons → zewito-catalog-service (port 4001)
// Orders, Riders, Dispatch, Payments, Admin → this service (zewito-core-platform)

app.use(`/api/${API_VERSION}/rider`, require('./routes/rider'));
app.use(`/api/${API_VERSION}/admin`, require('./routes/admin'));

// ==================== LEGACY COMPATIBILITY LAYER ====================
// Auth routes — still served by core (JWT is issued here)
app.use(`/api/${API_VERSION}/auth`, require('./routes/customer/auth'));
app.use(`/api/${API_VERSION}/auth`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/auth`, require('./routes/restaurant/auth'));
app.use(`/api/${API_VERSION}/auth/restaurant`, require('./routes/restaurant/auth'));
app.use(`/api/${API_VERSION}/auth/rider`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/register`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/register`, require('./routes/restaurant/auth'));

// Orders — core domain
app.use(`/api/${API_VERSION}/orders`, require('./routes/customer/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/restaurant/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/rider/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/rider/location'));

// Rider
app.use(`/api/${API_VERSION}/rider`, require('./routes/rider'));

// Restaurant profile & analytics (earnings, order aggregation)
app.use(`/api/${API_VERSION}/restaurants`, require('./routes/restaurant/profile'));

// Notifications, Support, Admin
app.use(`/api/${API_VERSION}/notifications`, require('./routes/customer/notifications'));
app.use(`/api/${API_VERSION}/contact-us`, require('./routes/customer/contactUs'));
app.use(`/api/${API_VERSION}/contact-us`, require('./routes/admin/contactUs'));
app.use(`/api/${API_VERSION}/super-admin`, require('./routes/admin/superAdmin'));
app.use(`/api/${API_VERSION}/super-admin/tickets`, require('./routes/admin/superAdminTickets'));
app.use(`/api/${API_VERSION}/admin/tickets`, require('./routes/admin/tickets'));
app.use(`/api/${API_VERSION}/tickets`, require('./routes/customer/tickets'));

// ── CATALOG DOMAIN — MOVED TO zewito-catalog-service ─────────────────────────
// The following routes are now handled by zewito-catalog-service (port 4001):
//   /api/v1/restaurants  → catalog-service/api/v1/customer/restaurants
//   /api/v1/menu         → catalog-service/api/v1/customer/menu
//   /api/v1/cart         → catalog-service/api/v1/customer/cart
//   /api/v1/coupons      → catalog-service/api/v1/restaurant/coupons
//
// Update your frontend CATALOG_API_URL env var to point to catalog-service URL.
// ─────────────────────────────────────────────────────────────────────────────

app.use(errorHandler);

module.exports = app;