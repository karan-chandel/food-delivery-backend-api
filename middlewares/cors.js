const cors = require("cors");
const { ALLOWLIST } = require("../config/config");

module.exports = (req, res, next) => {
  const corsOptions = {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      const normalizedOrigin = origin.replace(/\/$/, "");
      const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);
      const isAllowed = ALLOWLIST.some(item => item.replace(/\/$/, "") === normalizedOrigin);

      if (isAllowed || isLocalhost) {
        callback(null, true);
      } else {
        console.log("❌ CORS Blocked Origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
    optionsSuccessStatus: 200
  };

  return cors(corsOptions)(req, res, next);
};