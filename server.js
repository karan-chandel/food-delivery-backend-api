const mongoose = require("mongoose");
const figlet = require("figlet");
const { createServer } = require("http");
require("dotenv").config();
const app = require("./app");
const { PORT, MDB_URI } = require("./config/config");
const fs = require("fs");
const path = require("path");

async function main() {
  try {
    console.log(" Connecting to MongoDB...");
    await mongoose.connect(MDB_URI);
    console.log(" Database Connected Successfully ");

    // Create HTTP server for Socket.io
    const server = createServer(app);

    // Initialize Socket.io
    const initializeSocket = require('./middlewares/socket');
    const io = initializeSocket(server);

    // ✅ IMPORTANT: io initialize hone ke baad hi instrument use karein
    const { instrument } = require("@socket.io/admin-ui");
    
    // ✅ Enable Admin UI AFTER io is created
    instrument(io, {
      auth: false, 
      mode: "development", 
     
    });

    // Make io accessible to routes
    app.set("io", io);

    server.listen(PORT, () => {
      console.log(` Server running at http://localhost:${PORT}`);
      console.log(` API Version: ${require("./config/config").API_VERSION}`);
      console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(` Socket.io ready for real-time updates`);
      console.log(`📊 Admin UI available at: https://admin.socket.io/#`);
      console.log(`🔗 Or visit: http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error("❌ Startup Error:", err.message);
    process.exit(1);
  }
}

main();