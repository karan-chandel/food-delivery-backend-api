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

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant || !restaurant.isActive) {
    return {
      success: true,
      isValid: false,
      reason: "RESTAURANT_NOT_FOUND",
      message: "Restaurant does not exist or is inactive",
    };
  }

  if (!restaurant.isOpen) {
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

module.exports = {
  validateCart,
  localValidateCart,
};
