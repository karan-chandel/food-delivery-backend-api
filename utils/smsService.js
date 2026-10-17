const https = require("https");
const { FAST2SMS_API_KEY } = require("../config/config");

/**
 * Clean & normalize Indian 10-digit mobile number
 * Handles +91, 91, 0, spaces, and hyphens
 */
const sanitizeIndianPhoneNumber = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");

  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("091")) return digits.slice(3);

  // Return last 10 digits if valid length
  if (digits.length > 10) return digits.slice(-10);

  return digits.length === 10 ? digits : null;
};

/**
 * Universal HTTPS POST with strict timeout
 */
const postFast2Sms = (payload, apiKey, timeoutMs = 5000) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: "www.fast2sms.com",
      path: "/dev/bulkV2",
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let rawData = "";
      res.on("data", (chunk) => (rawData += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: rawData });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Fast2SMS request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => reject(err));
    req.write(postData);
    req.end();
  });
};

/**
 * Send OTP SMS via Fast2SMS Gateway
 *
 * @param {string} phone - Recipient phone number
 * @param {string} otp - 6-digit OTP code
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
const sendOtpSms = async (phone, otp) => {
  const cleanPhone = sanitizeIndianPhoneNumber(phone);

  if (!cleanPhone || cleanPhone.length !== 10) {
    console.warn(`⚠️ [SMS Service] Invalid 10-digit Indian phone number: "${phone}"`);
    return {
      success: false,
      error: "Invalid 10-digit Indian mobile number",
    };
  }

  if (!FAST2SMS_API_KEY || FAST2SMS_API_KEY.trim() === "") {
    console.warn("⚠️ [SMS Service] FAST2SMS_API_KEY is not configured in .env. Skipping live SMS.");
    return {
      success: false,
      skipped: true,
      error: "FAST2SMS_API_KEY not configured",
    };
  }

  console.log(`📲 [SMS Service] Initiating Fast2SMS OTP dispatch to +91 ${cleanPhone.slice(0, 2)}******${cleanPhone.slice(-2)}...`);

  try {
    // 1. Try dedicated OTP route (Highest deliverability & DLT approved)
    const otpPayload = {
      variables_values: String(otp),
      route: "otp",
      numbers: cleanPhone,
    };

    const response = await postFast2Sms(otpPayload, FAST2SMS_API_KEY, 5000);

    // Fast2SMS returns: { return: true, request_id: "...", message: ["SMS sent successfully."] }
    if (response.body && response.body.return === true) {
      console.log(`✅ [SMS Service] Fast2SMS OTP delivered successfully! Request ID: ${response.body.request_id || "N/A"}`);
      return {
        success: true,
        requestId: response.body.request_id,
        message: "SMS dispatched successfully",
      };
    }

    // If OTP route failed with DLT restriction, try quick SMS route fallback
    console.warn("⚠️ [SMS Service] Fast2SMS OTP route response:", JSON.stringify(response.body));

    const quickPayload = {
      route: "q",
      message: `Your Zewito verification OTP is ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`,
      language: "english",
      flash: 0,
      numbers: cleanPhone,
    };

    const fallbackResponse = await postFast2Sms(quickPayload, FAST2SMS_API_KEY, 5000);

    if (fallbackResponse.body && fallbackResponse.body.return === true) {
      console.log(`✅ [SMS Service] Fast2SMS Quick Route delivered successfully! Request ID: ${fallbackResponse.body.request_id || "N/A"}`);
      return {
        success: true,
        requestId: fallbackResponse.body.request_id,
        message: "SMS dispatched via fallback route",
      };
    }

    console.error("❌ [SMS Service] Fast2SMS Gateway rejected dispatch:", JSON.stringify(fallbackResponse.body));
    return {
      success: false,
      error: fallbackResponse.body?.message?.[0] || fallbackResponse.body?.message || "Fast2SMS gateway error",
    };
  } catch (err) {
    console.error("❌ [SMS Service] Fast2SMS network error:", err.message);
    // Non-blocking: fail gracefully so the user flow is not crashed
    return {
      success: false,
      error: err.message,
    };
  }
};

module.exports = {
  sendOtpSms,
  sanitizeIndianPhoneNumber,
};
