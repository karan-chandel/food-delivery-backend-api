const crypto = require("crypto");
const IdempotencyKey = require("../models/IdempotencyKey");

/**
 * Enterprise Idempotency & In-Flight Distributed Lock Middleware (TSK-203)
 *
 * Prevents double-charging, race conditions, and duplicate order creation
 * when users double-tap "Place Order" or network lags during checkout.
 *
 * @param {Object} options
 * @param {number} options.ttlSeconds - Lifetime of the idempotency record (default: 120s)
 */
const idempotency = (options = {}) => {
  const ttlSeconds = options.ttlSeconds || 120;

  return async (req, res, next) => {
    // Only apply to state-changing methods (POST, PUT, PATCH)
    if (!["POST", "PUT", "PATCH"].includes(req.method)) {
      return next();
    }

    const userId = req.user?._id || req.user?.userId;
    if (!userId) {
      return next();
    }

    // 1. Resolve Idempotency Key
    let key =
      req.headers["x-idempotency-key"] ||
      req.headers["idempotency-key"] ||
      req.body?.idempotencyKey;

    let isFingerprintFallback = false;

    // 2. Smart Fingerprint Fallback for older clients that don't send X-Idempotency-Key
    if (!key) {
      isFingerprintFallback = true;
      const normalizedPayload = {
        userId: userId.toString(),
        restaurantId: req.body?.restaurantId || "",
        items: (req.body?.items || []).map((i) => ({
          id: i.menuItemId || i.itemId,
          qty: i.quantity,
          price: i.price,
        })),
        paymentMethod: req.body?.paymentMethod || "",
      };

      // Hash deterministic payload
      key = "auto_" + crypto
        .createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");
    }

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    try {
      // 3. Check for existing idempotency record
      const existing = await IdempotencyKey.findOne({ key, userId });

      if (existing) {
        // Case A: Request is currently in-flight (Lock active)
        if (existing.status === "processing") {
          return res.status(409).json({
            success: false,
            error: "A checkout request is currently being processed. Please wait a moment.",
            code: "CONCURRENT_CHECKOUT",
          });
        }

        // Case B: Request was already successfully completed (Idempotent Replay)
        if (existing.status === "completed" && existing.responseBody) {
          res.setHeader("X-Idempotent-Replay", "true");
          return res.status(existing.responseStatus || 200).json({
            ...existing.responseBody,
            isIdempotentReplay: true,
          });
        }
      }

      // 4. Acquire Lock atomically via insert
      let record;
      try {
        record = await IdempotencyKey.create({
          key,
          userId,
          endpoint: req.originalUrl,
          status: "processing",
          expiresAt,
        });
      } catch (insertErr) {
        // Duplicate key race condition caught by MongoDB unique index
        if (insertErr.code === 11000) {
          return res.status(409).json({
            success: false,
            error: "A checkout request is already processing for this action.",
            code: "CONCURRENT_CHECKOUT",
          });
        }
        throw insertErr;
      }

      // 5. Intercept res.json to capture response payload
      const originalJson = res.json.bind(res);

      res.json = function (body) {
        const statusCode = res.statusCode;

        if (statusCode >= 200 && statusCode < 300) {
          // Success: Mark completed and persist response snapshot
          IdempotencyKey.updateOne(
            { _id: record._id },
            {
              $set: {
                status: "completed",
                responseStatus: statusCode,
                responseBody: body,
              },
            }
          ).catch((err) =>
            console.warn("⚠️ [Idempotency] Failed to mark completed:", err.message)
          );
        } else {
          // Failure (e.g. 400 Bad Request): Delete lock so user can retry immediately
          IdempotencyKey.deleteOne({ _id: record._id }).catch((err) =>
            console.warn("⚠️ [Idempotency] Failed to release failed lock:", err.message)
          );
        }

        return originalJson(body);
      };

      next();
    } catch (err) {
      console.error("⚠️ [Idempotency] Middleware Error:", err);
      // Fail-open: Never block legitimate orders if idempotency table has transient error
      next();
    }
  };
};

module.exports = idempotency;
