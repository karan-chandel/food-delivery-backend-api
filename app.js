const express = require("express");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const corsMiddleware = require("./middlewares/cors");
const errorHandler = require("./middlewares/errorHandler");

const couponRoutes = require("./routes/coupon");


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

// Middlewares
app.use(corsMiddleware);
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// Routes 
app.use(`/api/${API_VERSION}/auth`, require('./routes/auth'));
app.use(`/api/${API_VERSION}/contact-us`, require('./routes/contactUs'));
app.use(`/api/${API_VERSION}/register`, require('./routes/register'));
app.use(`/api/${API_VERSION}/restaurants`, require('./routes/restaurants'));
app.use(`/api/${API_VERSION}/menu`, require('./routes/menu'));
app.use(`/api/${API_VERSION}/orders`, require('./routes/order'));
app.use(`/api/${API_VERSION}/cart`, require("./routes/cart"));
app.use(`/api/${API_VERSION}/rider`, require("./routes/rider"));
app.use(`/api/${API_VERSION}/notifications`, require("./routes/notificationRoutes"));
app.use(`/api/${API_VERSION}/super-admin`, require("./routes/super-admin"));
// Ticket Routes Registration
app.use(`/api/${API_VERSION}/super-admin/tickets`, require("./routes/super-admin/tickets"));
app.use(`/api/${API_VERSION}/admin`, require("./routes/admin/tickets"));
app.use(`/api/${API_VERSION}/tickets`, require("./routes/tickets"));
app.use(`/api/${API_VERSION}/coupons`, couponRoutes);

app.use(errorHandler);

module.exports = app;