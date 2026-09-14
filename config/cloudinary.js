const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadBufferToCloudinary = (buffer, folder = "hungry-hub/menu-items") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: "image",
        transformation: [{ width: 1000, height: 1000, crop: "limit", quality: "auto" }]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

cloudinary.uploadBufferToCloudinary = uploadBufferToCloudinary;
module.exports = cloudinary;
module.exports.uploadBufferToCloudinary = uploadBufferToCloudinary;
