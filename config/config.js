require("dotenv").config();

const isDev = process.env.NODE_ENV !== "production";

const envAllowlist = (process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS || "")
  ? (process.env.FRONTEND_URL || process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map(url => url.trim().replace(/\/$/, ""))
      .filter(Boolean)
  : [];

const baseAllowlist = [
  "https://admin.socket.io",
  "https://zewito-api-gateway.onrender.com"
];

// Dual-Environment: Automatically allow all local development frontend & microservice ports
if (isDev) {
  baseAllowlist.push(
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:4200",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://localhost:5050",
    "http://localhost:58590",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3003",
    "http://127.0.0.1:4200",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5050"
  );
}

// Single Source of Truth DB URI (prioritizes ORDER_DB_URI, falls back to MDB_URI)
const dbUri = process.env.ORDER_DB_URI || process.env.MDB_URI;

// Enforce JWT_SECRET and DB URI in production
if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET) {
    throw new Error("FATAL: JWT_SECRET environment variable is required in production!");
  }
  if (!dbUri) {
    throw new Error("FATAL: ORDER_DB_URI or MDB_URI environment variable is required in production!");
  }
}

const orderServiceUrl =
  process.env.ORDER_SERVICE_URL ||
  (isDev ? "http://localhost:5050" : "https://food-delivery-backend-api-n91v.onrender.com");

module.exports = {
  PORT: process.env.PORT || 5050,
  ORDER_DB_URI: dbUri,
  MDB_URI: dbUri,
  API_VERSION: process.env.API_VERSION || "v1", 
  JWT_SECRET: process.env.JWT_SECRET || "your_fallback_jwt_secret_key_here",
  ALLOWLIST: [...new Set([...baseAllowlist, ...envAllowlist])],
  // DEBUG_OTP is true in dev unless explicitly disabled, and false in production unless explicitly enabled
  DEBUG_OTP: (process.env.DEBUG_OTP && ["true", "1"].includes(String(process.env.DEBUG_OTP).toLowerCase().trim())) || (isDev && process.env.DEBUG_OTP !== "false"),
  ORDER_SERVICE_URL: orderServiceUrl,
  CORE_PLATFORM_URL: orderServiceUrl,
  CATALOG_SERVICE_URL:
    process.env.CATALOG_SERVICE_URL ||
    (isDev ? "http://localhost:4001" : "https://zewito-catalog-service.onrender.com"),
  RIDER_SERVICE_URL:
    process.env.RIDER_SERVICE_URL ||
    (isDev ? "http://localhost:5054" : "https://zewito-rider-service.onrender.com"),
  LOGISTICS_SERVICE_URL:
    process.env.LOGISTICS_SERVICE_URL ||
    (isDev ? "http://localhost:5051" : "https://zewito-logistics-service.onrender.com"),
  AUTH_SERVICE_URL:
    process.env.AUTH_SERVICE_URL ||
    (isDev ? "http://localhost:5052" : "https://zewito-auth-service.onrender.com"),
  ADMIN_SERVICE_URL:
    process.env.ADMIN_SERVICE_URL ||
    (isDev ? "http://localhost:5053" : "https://zewito-admin-service.onrender.com"),
  GATEWAY_URL:
    process.env.GATEWAY_URL ||
    (isDev ? "http://localhost:8000" : "https://zewito-api-gateway.onrender.com"),
  INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
  REDIS_URL: process.env.REDIS_URL || process.env.REDIS_URI || "",
  SMS_CLOUD_API_KEY: process.env.SMS_CLOUD_API_KEY || "",
  SMS_CLOUD_USERNAME: process.env.SMS_CLOUD_USERNAME || "KESHVACREDIT",
  SMS_CLOUD_SENDER_ID: process.env.SMS_CLOUD_SIGNATURE || process.env.SMS_CLOUD_SENDER_ID || "CMTRA",
  SMS_CLOUD_TEMPLATE_ID: process.env.SMS_CLOUD_TEMPLATE_ID || "1707175922948829561",
  SMS_CLOUD_GATEWAY_URL: process.env.SMS_CLOUD_URL || process.env.SMS_CLOUD_GATEWAY_URL || "https://app.smscloud.in/pushapi/sendbulkmsg"
};
