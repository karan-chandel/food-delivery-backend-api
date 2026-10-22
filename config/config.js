require("dotenv").config();

const envAllowlist = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map(url => url.trim())
  : [];

const baseAllowlist = [
  "https://admin.socket.io",
  "http://localhost:5050",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://localhost:58590",
  "http://localhost:58590/",
  "https://rider-portal-pi.vercel.app",
  "https://restaurent-portal.vercel.app",
  "https://admin-portal-food.vercel.app",
  "https://delivery-hub-pi.vercel.app",
  "https://zewito-api-gateway.onrender.com"
];

// Enforce JWT_SECRET in production
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is required in production!");
}

module.exports = {
  PORT: process.env.PORT || 5050,
  MDB_URI: process.env.MDB_URI,
  API_VERSION: process.env.API_VERSION || "v1", 
  JWT_SECRET: process.env.JWT_SECRET || "your_fallback_jwt_secret_key_here",
  ALLOWLIST: [...baseAllowlist, ...envAllowlist],
  // DEBUG_OTP is true in dev unless explicitly disabled, and false in production unless explicitly enabled
  DEBUG_OTP: (process.env.DEBUG_OTP && ["true", "1"].includes(String(process.env.DEBUG_OTP).toLowerCase().trim())) || (process.env.NODE_ENV !== "production" && process.env.DEBUG_OTP !== "false"),
  CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || (process.env.NODE_ENV === "production" ? "https://zewito-catalog-service.onrender.com" : "http://localhost:4001"),
  LOGISTICS_SERVICE_URL: process.env.LOGISTICS_SERVICE_URL || (process.env.NODE_ENV === "production" ? "https://zewito-logistics-service.onrender.com" : "http://localhost:5051"),
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || (process.env.NODE_ENV === "production" ? "https://zewito-auth-service.onrender.com" : "http://localhost:5052"),
  ADMIN_SERVICE_URL: process.env.ADMIN_SERVICE_URL || (process.env.NODE_ENV === "production" ? "https://zewito-admin-service.onrender.com" : "http://localhost:5053"),
  INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
  REDIS_URL: process.env.REDIS_URL || process.env.REDIS_URI || "",
  FAST2SMS_API_KEY: process.env.FAST2SMS_API_KEY || ""
};