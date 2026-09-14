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
  },  600000); 
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
    message: 'Hungry-Hub Food Delivery API', 
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
app.use(`/api/${API_VERSION}/customer`, require('./routes/customer'));
app.use(`/api/${API_VERSION}/restaurant`, require('./routes/restaurant'));
app.use(`/api/${API_VERSION}/rider`, require('./routes/rider'));
app.use(`/api/${API_VERSION}/admin`, require('./routes/admin'));

// ==================== LEGACY COMPATIBILITY LAYER ====================
// Zero downtime for existing frontends by routing legacy paths to modular portals
app.use(`/api/${API_VERSION}/auth`, require('./routes/customer/auth'));
app.use(`/api/${API_VERSION}/auth`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/auth`, require('./routes/restaurant/auth'));
app.use(`/api/${API_VERSION}/contact-us`, require('./routes/customer/contactUs'));
app.use(`/api/${API_VERSION}/contact-us`, require('./routes/admin/contactUs'));
app.use(`/api/${API_VERSION}/register`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/register`, require('./routes/restaurant/auth'));
app.use(`/api/${API_VERSION}/restaurants`, require('./routes/customer/restaurants'));
app.use(`/api/${API_VERSION}/restaurants`, require('./routes/restaurant/profile'));
app.use(`/api/${API_VERSION}/menu`, require('./routes/customer/menu'));
app.use(`/api/${API_VERSION}/menu`, require('./routes/restaurant/menu'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/customer/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/restaurant/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/rider/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/rider/location'));
app.use(`/api/${API_VERSION}/cart`, require('./routes/customer/cart'));
app.use(`/api/${API_VERSION}/rider`, require('./routes/rider'));
app.use(`/api/${API_VERSION}/notifications`, require('./routes/customer/notifications'));
app.use(`/api/${API_VERSION}/super-admin`, require('./routes/admin/superAdmin'));
app.use(`/api/${API_VERSION}/super-admin/tickets`, require('./routes/admin/superAdminTickets'));
app.use(`/api/${API_VERSION}/admin/tickets`, require('./routes/admin/tickets'));
app.use(`/api/${API_VERSION}/tickets`, require('./routes/customer/tickets'));
app.use(`/api/${API_VERSION}/coupons`, require('./routes/restaurant/coupons'));
app.use(`/api/${API_VERSION}/coupons`, require('./routes/customer/coupons'));

app.use(errorHandler);

module.exports = app;