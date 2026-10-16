const cors = require("cors");
const { ALLOWLIST } = require("../config/config");

module.exports = (req, res, next) => {
  const corsOptions = {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      const normalizedOrigin = origin.replace(/\/$/, "");
      const isAllowed = ALLOWLIST.some(item => item.replace(/\/$/, "") === normalizedOrigin);

      if (isAllowed) {
        callback(null, true);
      } else {
        console.log("❌ CORS Blocked Origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    optionsSuccessStatus: 200
  };

  return cors(corsOptions)(req, res, next);
};