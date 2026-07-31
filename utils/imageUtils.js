const fs = require("fs");

// Function to delete image files
const deleteImageFiles = (images) => {
  if (!images || !Array.isArray(images)) return;

  images.forEach((image) => {
    if (image.path && fs.existsSync(image.path)) {
      try {
        fs.unlinkSync(image.path);
        console.log(`🗑️ Deleted image: ${image.path}`);
      } catch (error) {
        console.error(`❌ Error deleting image ${image.path}:`, error.message);
      }
    }
  });
};

module.exports = {
  deleteImageFiles
};