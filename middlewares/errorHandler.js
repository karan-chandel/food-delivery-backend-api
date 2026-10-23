module.exports = (err, req, res, next) => {
  const isValidationError = err.name === "ValidationError" || err.name === "CastError";
  const status = err.status || (isValidationError ? 400 : 500);
  const message = err.message || "Internal Server Error";

  // Log error in all environments for debugging
  console.error("❌ Error caught by global handler:", err);

  res.status(status).json({
    success: false,
    error: message,
    message: message
  });
};
