const crypto = require("crypto");
const { RIDER_SERVICE_URL, INTERNAL_SERVICE_SECRET } = require("../config/config");
const Rider = require("../models/Rider");

function getInternalHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (INTERNAL_SERVICE_SECRET) {
    headers["X-Internal-Secret"] = INTERNAL_SERVICE_SECRET;
    headers["X-Internal-Service-Token"] = crypto
      .createHmac("sha256", INTERNAL_SERVICE_SECRET)
      .update("zewito-inter-service-comm")
      .digest("hex");
  }
  return headers;
}

/**
 * Fetches rider metadata from zewito-rider-service with resilient fallback to local Rider collection.
 */
async function getRiderById(riderId) {
  const baseUrl = (RIDER_SERVICE_URL || "").replace(/\/+$/, "");
  if (baseUrl && riderId) {
    try {
      const res = await fetch(`${baseUrl}/internal/v1/rider/${encodeURIComponent(String(riderId))}`, {
        method: "GET",
        headers: getInternalHeaders(),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.success && json?.data) {
          return json.data;
        }
      }
    } catch (err) {
      console.warn(`⚠️ [RiderClient] Falling back to local Rider DB (${err.message})`);
    }
  }

  return Rider.findById(riderId);
}

/**
 * Syncs order assignment / completion stats back to zewito-rider-service.
 */
async function syncRiderStats(riderId, statsPayload) {
  const baseUrl = (RIDER_SERVICE_URL || "").replace(/\/+$/, "");
  if (!baseUrl || !riderId) return null;

  try {
    const res = await fetch(
      `${baseUrl}/internal/v1/rider/${encodeURIComponent(String(riderId))}/sync-stats`,
      {
        method: "POST",
        headers: getInternalHeaders(),
        body: JSON.stringify(statsPayload),
        signal: AbortSignal.timeout(3000),
      }
    );
    return res.ok ? await res.json().catch(() => null) : null;
  } catch (err) {
    console.warn(`⚠️ [RiderClient] Failed to sync stats to Rider Service: ${err.message}`);
    return null;
  }
}

module.exports = {
  getRiderById,
  syncRiderStats,
};

