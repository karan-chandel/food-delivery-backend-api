const https = require("https");
const querystring = require("querystring");
const {
  SMS_CLOUD_API_KEY,
  SMS_CLOUD_USERNAME,
  SMS_CLOUD_SENDER_ID,
  SMS_CLOUD_TEMPLATE_ID,
  SMS_CLOUD_GATEWAY_URL,
} = require("../config/config");

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
 * Universal HTTPS GET for SMSCloud TRAI DLT Gateway
 */
const postSmsCloud = (phone, otp, timeoutMs = 6000) => {
  return new Promise((resolve, reject) => {
    const sender = SMS_CLOUD_SENDER_ID || "CMTRA";
    const message = `Dear Customer, your OTP for CoverMantra verification is ${otp}. Valid for 10 minutes. - ${sender}`;
    const payload = {
      username: SMS_CLOUD_USERNAME || "KESHVACREDIT",
      apikey: SMS_CLOUD_API_KEY,
      senderid: sender,
      tempid: SMS_CLOUD_TEMPLATE_ID || "1707175922948829561",
      dest_mobileno: phone,
      message: message,
      response: "Y",
    };

    const queryParams = querystring.stringify(payload);
    const targetUrl = `${SMS_CLOUD_GATEWAY_URL || "https://app.smscloud.in/pushapi/sendbulkmsg"}?${queryParams}`;

    const req = https.get(targetUrl, { timeout: timeoutMs }, (res) => {
      let rawData = "";
      res.on("data", (chunk) => (rawData += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode, body: rawData });
        } else {
          resolve({ success: false, statusCode: res.statusCode, body: rawData });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`SMSCloud request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => reject(err));
  });
};

/**
 * Send OTP SMS strictly via SMSCloud DLT Gateway
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

  if (!SMS_CLOUD_API_KEY || SMS_CLOUD_API_KEY.trim() === "") {
    console.warn("⚠️ [SMS Service] SMS_CLOUD_API_KEY is not configured in .env. Skipping live SMS.");
    return {
      success: false,
      skipped: true,
      error: "SMS_CLOUD_API_KEY not configured",
    };
  }

  console.log(`📲 [SMS Service] Initiating SMSCloud OTP dispatch to +91 ${cleanPhone.slice(0, 2)}******${cleanPhone.slice(-2)}...`);

  try {
    const cloudRes = await postSmsCloud(cleanPhone, otp, 6000);
    if (cloudRes.success) {
      console.log(`✅ [SMS Service] SMSCloud OTP delivered successfully! Response:`, cloudRes.body);
      return {
        success: true,
        provider: "SMSCloud",
        message: "SMS dispatched successfully via SMSCloud DLT",
      };
    }

    console.error("❌ [SMS Service] SMSCloud Gateway rejected dispatch:", cloudRes.body);
    return {
      success: false,
      error: `SMSCloud dispatch failed with status ${cloudRes.statusCode}`,
    };
  } catch (err) {
    console.error("❌ [SMS Service] SMSCloud network error:", err.message);
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
