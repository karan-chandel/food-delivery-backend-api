const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const corsMiddleware = require("./middlewares/cors");
const errorHandler = require("./middlewares/errorHandler");


const { API_VERSION, ADMIN_SERVICE_URL } = require("./config/config");
const path = require("path");
const fs = require("fs");

const app = express();
app.set("trust proxy", 1); // Enable trusting reverse proxy headers (Render, Cloudflare, API Gateway)

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

// Health check & API info
app.get('/', (req, res) => {
  res.json({
    service: 'Zewito Core Order, Dispatch & Realtime Service (zewito-order-service)',
    version: API_VERSION,
    status: 'active',
    port: 5050,
    domain: 'order-dispatch',
    endpoints: {
      orders: `/api/${API_VERSION}/orders`,
      rider: `/api/${API_VERSION}/rider`,
      notifications: `/api/${API_VERSION}/notifications`,
      socket: '/socket.io',
      uploads: '/uploads',
    },
    microservices: {
      catalog: 'zewito-catalog-service (Port 4001)',
      logistics: 'zewito-logistics-service (Port 5051)',
      auth: 'zewito-auth-service (Port 5052)',
      admin: 'zewito-admin-service (Port 5053)',
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

// ✅ Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Socket.io middleware Injection
app.use((req, res, next) => {
  req.io = req.app.get("io");
  next();
});

// ==================== CORE ORDER & DISPATCH DOMAIN ====================
// Order lifecycle (customer, restaurant, rider dispatch)
app.use(`/api/${API_VERSION}/orders`, require('./routes/customer/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/restaurant/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/rider/orders'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/rider/location'));

// Rider operations (dispatch status, vehicle, deliveries)
app.use(`/api/${API_VERSION}/rider`, require('./routes/rider'));

// Order notifications & alerts
app.use(`/api/${API_VERSION}/notifications`, require('./routes/customer/notifications'));

// ==================== STANDALONE AUTH COMPATIBILITY LAYER ====================
// Note: When calling through API Gateway, /api/v1/auth is routed directly to zewito-auth-service (Port 5052).
app.use(`/api/${API_VERSION}/auth`, require('./routes/customer/auth'));
app.use(`/api/${API_VERSION}/auth`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/auth`, require('./routes/restaurant/auth'));
app.use(`/api/${API_VERSION}/auth/restaurant`, require('./routes/restaurant/auth'));
app.use(`/api/${API_VERSION}/auth/rider`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/register`, require('./routes/rider/auth'));
app.use(`/api/${API_VERSION}/register`, require('./routes/restaurant/auth'));

// ==================== DECOUPLED SERVICES (ADMIN / CATALOG / LOGISTICS) ====================
// 🛡️ Admin & Support domain (/admin, /super-admin, /tickets, /contact-us) -> zewito-admin-service (Port 5053)
const forwardToAdminService = (req, res) => {
  const baseUrl = (ADMIN_SERVICE_URL || 'http://localhost:5053').replace(/\/+$/, '');
  const targetUrl = `${baseUrl}${req.originalUrl}`;
  res.redirect(307, targetUrl);
};

app.use(`/api/${API_VERSION}/admin`, forwardToAdminService);
app.use(`/api/${API_VERSION}/super-admin`, forwardToAdminService);
app.use(`/api/${API_VERSION}/tickets`, forwardToAdminService);
app.use(`/api/${API_VERSION}/contact-us`, forwardToAdminService);

app.use(`/api/admin`, forwardToAdminService);
app.use(`/api/super-admin`, forwardToAdminService);
app.use(`/api/tickets`, forwardToAdminService);
app.use(`/api/contact-us`, forwardToAdminService);

// 🥗 Catalog domain (/restaurants, /menu, /cart, /coupons) -> zewito-catalog-service (Port 4001)
// 🏍️ Logistics & Payout domain (/payout, /tracking) -> zewito-logistics-service (Port 5051)

app.use(errorHandler);

module.exports = app;