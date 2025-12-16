import { v2 as cloudinary } from "cloudinary";
import * as dotenv from "dotenv";

dotenv.config(); // Load environment variables

cloudinary.config({
  folder: "uploads",
  resource_type: "image",
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Ensures HTTPS usage
});

export default cloudinary;