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
  "https://rider-portal-pi.vercel.app",
  "https://restaurent-portal.vercel.app",
  "https://admin-portal-food.vercel.app",
  "https://delivery-hub-pi.vercel.app"
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
  DEBUG_OTP: process.env.DEBUG_OTP === "true" || (process.env.NODE_ENV !== "production" && process.env.DEBUG_OTP !== "false")
};