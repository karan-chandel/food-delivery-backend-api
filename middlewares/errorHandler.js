module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const message = process.env.NODE_ENV === "production" && status === 500
    ? "Internal Server Error"
    : (err.message || "Internal Server Error");

  // Log error in all environments for debugging
  console.error("❌ Error caught by global handler:", err);

  res.status(status).json({
    success: false,
    error: message,
    message: message
  });
};
