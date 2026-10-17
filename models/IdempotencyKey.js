const mongoose = require("mongoose");

const idempotencyKeySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    requestHash: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "processing",
      index: true,
    },
    responseStatus: {
      type: Number,
    },
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index: MongoDB auto-removes expired keys
    },
  },
  {
    timestamps: true,
  }
);

// Composite unique constraint ensures atomic lock across parallel concurrent requests
idempotencyKeySchema.index({ key: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("IdempotencyKey", idempotencyKeySchema);
