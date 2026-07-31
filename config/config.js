require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 5000,
  MDB_URI: process.env.MDB_URI,
  API_VERSION: process.env.API_VERSION || "v1", 
  JWT_SECRET: process.env.JWT_SECRET || "your_fallback_jwt_secret_key_here",
  ALLOWLIST: [
  "https://admin.socket.io",
  "http://localhost:5000",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "https://rider-portal-pi.vercel.app",
  "https://restaurent-portal.vercel.app",
  "https://admin-portal-food.vercel.app",
  "https://delivery-hub-pi.vercel.app",
  "https://foodbe-1.onrender.com"
  ],
};