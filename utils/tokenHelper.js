const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const RefreshToken = require("../models/RefreshToken");
const User = require("../models/User");
const Admin = require("../models/Admin");
const { JWT_SECRET } = require("../config/config");

// Configurable expiration windows
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || "1h"; // 1 hour short-lived
const REFRESH_TOKEN_DAYS = 30; // 30 days long-lived

/**
 * Generate a short-lived Access Token (JWT)
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
};

/**
 * Generate and persist a secure long-lived Refresh Token
 */
const generateRefreshToken = async ({ userId, role, req = null }) => {
  const token = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const ipAddress = req ? req.ip || req.headers["x-forwarded-for"] || "" : "";
  const userAgent = req ? req.headers["user-agent"] || "" : "";

  await RefreshToken.create({
    userId,
    role,
    token,
    expiresAt,
    ipAddress,
    userAgent,
  });

  return {
    refreshToken: token,
    expiresAt,
  };
};

/**
 * Verify and Rotate a Refresh Token (Bank-Grade Security)
 * Implements Token Reuse Detection: if an already revoked token is used,
 * it indicates a stolen token and revokes ALL sessions for that user.
 */
const verifyAndRotateRefreshToken = async (rawToken, req = null) => {
  if (!rawToken || typeof rawToken !== "string") {
    return { valid: false, error: "Refresh token is required" };
  }

  const existingTokenDoc = await RefreshToken.findOne({ token: rawToken });

  if (!existingTokenDoc) {
    return { valid: false, error: "Invalid refresh token" };
  }

  // 🛡️ REUSE DETECTION: If token was already revoked, someone is replaying a stolen token
  if (existingTokenDoc.revokedAt) {
    console.warn(
      `🚨 [Security Alert] Replay attempt with revoked refresh token for user: ${existingTokenDoc.userId}. Revoking all sessions!`
    );
    await RefreshToken.updateMany(
      { userId: existingTokenDoc.userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return {
      valid: false,
      error: "Suspicious activity detected. All active sessions have been terminated. Please log in again.",
    };
  }

  // Check expiration
  if (new Date() >= existingTokenDoc.expiresAt) {
    return { valid: false, error: "Refresh token has expired. Please log in again." };
  }

  // Resolve user identity to build fresh access token payload
  let tokenPayload = {
    userId: existingTokenDoc.userId,
    role: existingTokenDoc.role,
  };

  if (["admin", "super_admin"].includes(existingTokenDoc.role)) {
    const admin = await Admin.findById(existingTokenDoc.userId);
    if (!admin || !admin.isActive) {
      return { valid: false, error: "Admin account is inactive or not found" };
    }
    tokenPayload = {
      adminId: admin._id,
      userId: admin._id,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
      isVerified: true,
    };
  } else {
    const user = await User.findById(existingTokenDoc.userId);
    if (!user || !user.isActive) {
      return { valid: false, error: "User account is deactivated or not found" };
    }
    tokenPayload = {
      userId: user._id,
      phone: user.phone,
      role: existingTokenDoc.role,
      isVerified: user.isVerified,
    };
  }

  // Generate new Access Token
  const newAccessToken = generateAccessToken(tokenPayload);

  // Generate new Refresh Token (Rotation)
  const newRefreshTokenStr = crypto.randomBytes(40).toString("hex");
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const ipAddress = req ? req.ip || req.headers["x-forwarded-for"] || "" : "";
  const userAgent = req ? req.headers["user-agent"] || "" : "";

  // Revoke old token and link to replacement
  existingTokenDoc.revokedAt = new Date();
  existingTokenDoc.replacedByToken = newRefreshTokenStr;
  await existingTokenDoc.save();

  // Save new rotated token
  await RefreshToken.create({
    userId: existingTokenDoc.userId,
    role: existingTokenDoc.role,
    token: newRefreshTokenStr,
    expiresAt: newExpiresAt,
    ipAddress,
    userAgent,
  });

  return {
    valid: true,
    accessToken: newAccessToken,
    refreshToken: newRefreshTokenStr,
    userId: existingTokenDoc.userId,
    role: existingTokenDoc.role,
    expiresIn: 3600, // seconds (1 hour)
  };
};

/**
 * Revoke a single refresh token (e.g. on logout)
 */
const revokeRefreshToken = async (rawToken) => {
  if (!rawToken) return;
  await RefreshToken.updateOne(
    { token: rawToken, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};

/**
 * Revoke all refresh tokens for a user (e.g. password reset or account freeze)
 */
const revokeAllUserTokens = async (userId) => {
  if (!userId) return;
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAndRotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
