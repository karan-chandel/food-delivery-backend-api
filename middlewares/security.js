/**
 * Advanced In-House Security Middleware Suite (Zero External Dependencies)
 * 1. Security Headers (Helmet-equivalent hardening)
 * 2. In-Memory Sliding-Window Rate Limiter
 * 3. NoSQL Injection Sanitizer
 */

/**
 * 1. Security Headers Middleware
 * Protects against MIME sniffing, clickjacking, and information leakage.
 */
function securityHeaders(req, res, next) {
  // Prevent MIME-sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Prevent Clickjacking
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Cross-site scripting filter protection (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Hide backend technology
  res.removeHeader("X-Powered-By");
  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Download options
  res.setHeader("X-Download-Options", "noopen");

  next();
}

/**
 * 2. Recursive NoSQL Injection Sanitizer
 * Strips object keys starting with '$' or containing '.'
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    // Strip keys starting with '$' or containing '.'
    if (key.startsWith("$") || key.includes(".")) {
      console.warn(`⚠️ [Security Alert] Blocked suspicious NoSQL key: "${key}"`);
      continue;
    }
    clean[key] = sanitizeObject(value);
  }
  return clean;
}

function mongoSanitize(req, res, next) {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  next();
}

/**
 * 3. In-Memory High-Performance Rate Limiter
 * @param {Object} options - { windowMs, max, message, keyGenerator }
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // default 1 minute
  const max = options.max || 100; // default 100 requests per window
  const message = options.message || {
    success: false,
    error: "Too many requests. Please slow down and try again later."
  };
  const keyGenerator = options.keyGenerator || ((req) => req.ip || req.connection?.remoteAddress || "global");

  const hits = new Map();

  // Periodic cleanup every 60 seconds to avoid memory leaks
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, Math.min(windowMs, 60000));

  // Allow Node to exit without waiting for this timer
  if (cleanupTimer.unref) cleanupTimer.unref();

  return function rateLimiter(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();

    let record = hits.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json(message);
    }

    next();
  };
}

// Preset Limiters
const globalApiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per 15 min per IP
  message: {
    success: false,
    error: "Too many requests from this IP. Please try again after 15 minutes."
  }
});

const otpLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // max 5 OTP requests in 5 minutes
  message: {
    success: false,
    error: "Too many OTP requests. Please wait 5 minutes before trying again."
  },
  keyGenerator: (req) => {
    const phone = req.body?.phone || "";
    const ip = req.ip || req.connection?.remoteAddress || "";
    return `otp_${ip}_${phone}`;
  }
});

module.exports = {
  securityHeaders,
  mongoSanitize,
  createRateLimiter,
  globalApiLimiter,
  otpLimiter
};
