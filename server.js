const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");
const { createServer } = require("http");
require("dotenv").config();
const app = require("./app");
const { PORT, ORDER_DB_URI, MDB_URI, API_VERSION } = require("./config/config");

const dbConnectionString =
  process.env.ORDER_DB_URI ||
  ORDER_DB_URI ||
  process.env.MDB_URI ||
  MDB_URI ||
  "mongodb+srv://karan_db_user:m14pVH3e96sn7PhG@zewito-cluster.zmmfnld.mongodb.net/zewito-core-db?retryWrites=true&w=majority&appName=Zewito-Cluster";

async function main() {
  try {
    console.log("🔗 Connecting to MongoDB (Single Source of Truth: zewito-core-db)...");
    await mongoose.connect(dbConnectionString);
    const dbName = mongoose.connection.name || "zewito-core-db";
    console.log(`✅ Database Connected Successfully (${dbName})`);

    // Create HTTP server for Socket.io
    const server = createServer(app);

    // Initialize Socket.io
    const initializeSocket = require('./middlewares/socket');
    const io = initializeSocket(server);

    // Enable Admin UI in development
    const { instrument } = require("@socket.io/admin-ui");
    instrument(io, {
      auth: false, 
      mode: "development", 
    });

    // Make io accessible to routes
    app.set("io", io);

    server.listen(PORT, () => {
      console.log("==================================================");
      console.log(`🚀 zewito-order-service running at http://localhost:${PORT}`);
      console.log(`📖 API Version  : ${API_VERSION}`);
      console.log(`🌍 Environment  : ${process.env.NODE_ENV || "development"}`);
      console.log(`⚡ Realtime Engine: Socket.io + Redis Geospatial Engine`);
      console.log(`📋 Health Check : http://localhost:${PORT}/health`);
      console.log("==================================================");
    });

  } catch (err) {
    console.error("❌ Startup Error in zewito-order-service:", err.message);
    process.exit(1);
  }
}

main();
