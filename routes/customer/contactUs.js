const express = require("express");
const router = express.Router();
const contactUsController = require("../../controllers/contactUsController");
const { upload, handleUploadErrors } = require("../../middlewares/upload");

// @route   POST /api/v1/customer/contact-us
// @desc    Submit a contact us message
router.post("/", contactUsController.submitContactUs);

// @route   POST /api/v1/customer/contact-us/with-attachment
// @desc    Submit contact us form with file attachment
router.post(
  "/with-attachment",
  upload.single("attachment"),
  handleUploadErrors,
  contactUsController.submitContactUsWithAttachment
);

module.exports = router;
