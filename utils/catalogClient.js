const http = require("http");
const https = require("https");
const { URL } = require("url");
const { CATALOG_SERVICE_URL, INTERNAL_SERVICE_SECRET } = require("../config/config");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Coupon = require("../models/Coupon");

/**
 * Universal HTTP POST helper using built-in Node modules or fetch
 * Zero external dependencies, with strict configurable timeout
 */
const postJson = async (urlStr, payload, headers = {}, timeoutMs = 25000) => {
  if (typeof globalThis.fetch === "function") {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(urlStr, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json();
      return { status: response.status, data };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Fallback to native http/https
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const postData = JSON.stringify(payload);

    const req = transport.request(
      parsedUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let rawBody = "";
        res.on("data", (chunk) => (rawBody += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(rawBody);
            resolve({ status: res.statusCode, data });
          } catch (e) {
            reject(new Error(`Failed to parse catalog response: ${rawBody}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Catalog Service request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => reject(err));
    req.write(postData);
    req.end();
  });
};

/**
 * Local Fallback Cart Validation
 * Used if Catalog Service is offline, restarting, or unreachable.
 * Mirrors the authoritative logic of Catalog Microservice.
 */
const localValidateCart = async ({ restaurantId, items, couponCode }) => {
  console.warn("⚠️ [CatalogClient] Using LOCAL DB fallback for cart validation");

  let restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) {
    // Attempt JIT fallback fetch from Catalog Service
    try {
      const targetUrl = `${CATALOG_SERVICE_URL.replace(/\/+$/, "")}/internal/v1/restaurant/${encodeURIComponent(String(restaurantId))}`;
      const res = await fetch(targetUrl, {
        headers: {
          "X-Internal-Secret": INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body?.data) {
          restaurant = body.data;
          // Cache stub in local DB for future lookups & populates
          Restaurant.findByIdAndUpdate(
            restaurantId,
            {
              $set: {
                name: restaurant.name || "Restaurant",
                ...(restaurant.contact ? { contact: restaurant.contact } : {}),
                ...(restaurant.address ? { address: restaurant.address } : {}),
                isActive: true,
                isOpen: typeof restaurant.isOpen === "boolean" ? restaurant.isOpen : true,
              },
            },
            { upsert: true, runValidators: false }
          ).catch(() => {});
        }
      }
    } catch (e) {
      // Continue to next check
    }
  }

  if (restaurant && restaurant.isActive === false) {
    return {
      success: true,
      isValid: false,
      reason: "RESTAURANT_NOT_FOUND",
      message: "Restaurant does not exist or is inactive",
    };
  }

  if (restaurant && restaurant.isOpen === false) {
    return {
      success: true,
      isValid: false,
      reason: "RESTAURANT_CLOSED",
      message: "Restaurant is currently closed",
    };
  }

  const menuItemIds = items.map((i) => i.itemId || i.menuItemId).filter(Boolean);
  const menuItems = await MenuItem.find({ _id: { $in: menuItemIds } });
  const menuItemMap = new Map(menuItems.map((m) => [m._id.toString(), m]));

  let subtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    const id = (item.itemId || item.menuItemId || "").toString();
    const menuItem = menuItemMap.get(id);

    if (!menuItem) {
      return {
        success: true,
        isValid: false,
        reason: "ITEM_NOT_FOUND",
        message: `Menu item ${id} not found`,
      };
    }

    if (!menuItem.isAvailable) {
      return {
        success: true,
        isValid: false,
        reason: "ITEM_UNAVAILABLE",
        message: `"${menuItem.name}" is currently unavailable`,
      };
    }

    if (menuItem.restaurantId.toString() !== restaurantId.toString()) {
      return {
        success: true,
        isValid: false,
        reason: "ITEM_RESTAURANT_MISMATCH",
        message: `Item "${menuItem.name}" does not belong to this restaurant`,
      };
    }

    let unitPrice = menuItem.discountedPrice || menuItem.price;
    let variantSnapshot = null;

    if (item.variantName || item.variantId || (item.variant && item.variant.name)) {
      const vName = item.variantName || item.variant?.name;
      const vId = (item.variantId || item.variant?._id || "").toString();
      const dbVariant = menuItem.variants?.find(
        (v) => (v._id && v._id.toString() === vId) || v.name === vName
      );
      if (dbVariant) {
        unitPrice = dbVariant.price;
        variantSnapshot = { name: dbVariant.name, price: dbVariant.price };
      }
    }

    const modifierSnapshots = [];
    const addonNames = item.addonNames || (Array.isArray(item.addons) ? item.addons.map(a => typeof a === "string" ? a : a.name) : []);
    if (addonNames && addonNames.length) {
      for (const addonName of addonNames) {
        for (const group of menuItem.addonGroups || []) {
          const found = group.items?.find((i) => i.name === addonName);
          if (found) {
            unitPrice += found.price;
            modifierSnapshots.push({ name: found.name, price: found.price });
            break;
          }
        }
      }
    }

    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const itemLineTotal = unitPrice * quantity;
    subtotal += itemLineTotal;

    verifiedItems.push({
      itemId: menuItem._id,
      nameSnapshot: menuItem.name,
      priceSnapshot: menuItem.discountedPrice || menuItem.price,
      isVeg: menuItem.isVeg,
      variantSnapshot,
      modifierSnapshots,
      finalUnitTotal: unitPrice,
      quantity,
      itemLineTotal,
      specialInstructions: item.specialInstructions || "",
    });
  }

  // Validate Minimum Order Amount
  if (restaurant.minOrderAmount && subtotal < restaurant.minOrderAmount) {
    return {
      success: true,
      isValid: false,
      reason: "MIN_ORDER_NOT_MET",
      message: `Minimum order amount is ₹${restaurant.minOrderAmount}. Current subtotal is ₹${subtotal}`,
    };
  }

  // Validate Coupon
  let discountApplied = 0;
  let couponSnapshot = null;

  if (couponCode) {
    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      restaurantId,
      isActive: true,
      expiryDate: { $gte: new Date() },
    });

    if (coupon && coupon.usedCount < (coupon.usageLimit || Infinity)) {
      if (subtotal >= (coupon.minOrderAmount || 0)) {
        if (coupon.discountType === "percentage") {
          discountApplied = (subtotal * coupon.discountValue) / 100;
          if (coupon.maxDiscount) {
            discountApplied = Math.min(discountApplied, coupon.maxDiscount);
          }
        } else {
          discountApplied = Math.min(coupon.discountValue, subtotal);
        }
        couponSnapshot = {
          couponId: coupon._id,
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountApplied,
        };
      }
    }
  }

  const restaurantSnapshot = {
    restaurantId: restaurant._id,
    nameSnapshot: restaurant.name,
    deliveryFee: restaurant.deliveryFee || 0,
    taxRate: restaurant.taxRate !== undefined ? restaurant.taxRate : 5,
    minOrderAmount: restaurant.minOrderAmount || 0,
    deliveryTime: restaurant.deliveryTime || 30,
    address: restaurant.address,
    contact: restaurant.contact,
  };

  return {
    success: true,
    isValid: true,
    isOpen: restaurant.isOpen,
    subtotal: Math.round(subtotal * 100) / 100,
    discountApplied: Math.round(discountApplied * 100) / 100,
    verifiedItems,
    couponSnapshot,
    restaurantSnapshot,
    isFallback: true,
  };
};

/**
 * Validate Cart via Catalog Microservice with Local DB Fallback
 * Single Source of Truth for Checkout Pricing and Stock.
 */
const validateCart = async ({ restaurantId, items, couponCode }) => {
  // Normalize items payload for Catalog Service
  const normalizedItems = (items || []).map((item) => ({
    itemId: item.itemId || item.menuItemId || item._id,
    quantity: Number(item.quantity) || 1,
    variantName: item.variantName || item.variant?.name || (typeof item.variant === "string" ? item.variant : undefined),
    variantId: item.variantId || item.variant?._id || item.variant?.id,
    addonNames: item.addonNames || (Array.isArray(item.addons) ? item.addons.map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean) : []),
    specialInstructions: item.specialInstructions || "",
  }));

  const targetUrl = `${CATALOG_SERVICE_URL.replace(/\/+$/, "")}/internal/v1/cart/validate`;

  try {
    const { status, data } = await postJson(
      targetUrl,
      {
        restaurantId,
        items: normalizedItems,
        couponCode,
      },
      {
        "X-Internal-Secret": INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
      },
      25000 // 25s timeout to comfortably absorb Render cold starts
    );

    if (status === 200 && data) {
      // Catalog service answered successfully
      return {
        ...data,
        isRemote: true,
      };
    }

    if (status === 400 && data && data.isValid === false) {
      // Legitimate business rejection from Catalog Service
      return data;
    }

    console.warn(`⚠️ [CatalogClient] Catalog service returned status ${status}. Triggering local fallback.`);
    return await localValidateCart({ restaurantId, items: normalizedItems, couponCode });
  } catch (err) {
    console.warn(`⚠️ [CatalogClient] Failed to reach Catalog Service at ${targetUrl}: ${err.message}. Triggering local fallback.`);
    return await localValidateCart({ restaurantId, items: normalizedItems, couponCode });
  }
};

/**
 * Fetch restaurant document by ownerId via Catalog internal endpoint (fallback to local DB).
 */
const getRestaurantByOwnerId = async (ownerId, phone, name) => {
  if (!ownerId && !phone) return null;
  const params = new URLSearchParams();
  if (phone) params.set("phone", String(phone).trim());
  if (name) params.set("name", String(name).trim());
  const qs = params.toString() ? `?${params.toString()}` : "";
  const lookupKey = ownerId || phone;
  const targetUrl = `${CATALOG_SERVICE_URL.replace(/\/+$/, "")}/internal/v1/restaurant/owner/${encodeURIComponent(String(lookupKey))}${qs}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "X-Internal-Secret": INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const json = await response.json();
      if (json?.success && json?.data) return json.data;
    }
  } catch (err) {
    console.warn(`⚠️ [CatalogClient] getRestaurantByOwnerId skipped (${err.message})`);
  }

  const cleanPhone = phone ? String(phone).replace(/^\+91/, '').trim() : null;
  return Restaurant.findOne({
    $or: [
      ...(ownerId ? [{ ownerId }, { createdBy: ownerId }] : []),
      ...(phone ? [
        { "contact.phone": phone },
        { "contact.phone": cleanPhone },
        { "contact.phone": `+91${cleanPhone}` }
      ] : []),
    ],
  }).lean();
};

/**
 * Sync customer review & rating to zewito-catalog-service so Restaurant Portal reflects live reviews.
 */
const syncRestaurantReview = async (restaurantId, reviewPayload) => {
  if (!restaurantId) return null;
  const targetUrl = `${CATALOG_SERVICE_URL.replace(/\/+$/, "")}/internal/v1/restaurant/${encodeURIComponent(String(restaurantId))}/review`;
  try {
    const { status, data } = await postJson(
      targetUrl,
      reviewPayload,
      {
        "X-Internal-Secret": INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
      },
      5000
    );
    return status >= 200 && status < 300 ? data : null;
  } catch (err) {
    console.warn(`⚠️ [CatalogClient] Review sync failed for restaurant ${restaurantId}: ${err.message}`);
    return null;
  }
};

/**
 * Retrieve user's active cart directly from Catalog Service via internal endpoint
 */
const getUserCart = async (userId) => {
  if (!userId) return null;
  const targetUrl = `${CATALOG_SERVICE_URL.replace(/\/+$/, "")}/internal/v1/cart/user/${encodeURIComponent(String(userId))}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "X-Internal-Secret": INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const body = await response.json();
    return body?.data || null;
  } catch (err) {
    console.warn(`⚠️ [CatalogClient] Failed to fetch cart for user ${userId}: ${err.message}`);
    return null;
  }
};

/**
 * Clear user's active cart in Catalog Service once Core Platform confirms checkout
 */
const clearUserCart = async (userId) => {
  if (!userId) return null;
  const targetUrl = `${CATALOG_SERVICE_URL.replace(/\/+$/, "")}/internal/v1/cart/user/${encodeURIComponent(String(userId))}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(targetUrl, {
      method: "DELETE",
      headers: {
        "X-Internal-Secret": INTERNAL_SERVICE_SECRET || "d778a0a96422d9c1203f62e9753cbbb2fb9b175e41295e5a1d02ed0224152595",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (err) {
    console.warn(`⚠️ [CatalogClient] Failed to clear cart for user ${userId}: ${err.message}`);
    return false;
  }
};

module.exports = {
  validateCart,
  localValidateCart,
  getRestaurantByOwnerId,
  syncRestaurantReview,
  getUserCart,
  clearUserCart,
};
