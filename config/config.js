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

module.exports = {
  PORT: process.env.PORT || 5050,
  MDB_URI: process.env.MDB_URI,
  API_VERSION: process.env.API_VERSION || "v1", 
  JWT_SECRET: process.env.JWT_SECRET || "your_fallback_jwt_secret_key_here",
  ALLOWLIST: [...baseAllowlist, ...envAllowlist],
};