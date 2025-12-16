import { v2 as cloudinary } from "cloudinary";
import { Context, Next } from "hono";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadMiddleware = async (c: Context, next: Next) => {
  try {
    const formData = await c.req.formData();
    console.log("Received Form Data:", formData);

    const title = formData.get("title") as string;
    const type = formData.get("type") as string;
    const description = formData.get("description") as string;
    const points = Number(formData.get("points") || formData.get("point")); // ✅ Handle both "points" and "point"
    const image = formData.get("image");

    if (!title || !type || !description || !points || !(image instanceof File)) {
      return c.json({ error: "All fields and image  111 file are required." }, 400);
    }

    // Upload to Cloudinary
    const buffer = Buffer.from(await image.arrayBuffer());
    const uploadedImage :any= await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder: "uploads" }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }).end(buffer);
    });

    console.log("✅ Uploaded to Cloudinary:", uploadedImage.secure_url);

    c.set("fields", { title, type, description, points });
    c.set("filePath", uploadedImage.secure_url);

    await next();
  } catch (error) {
    console.error("❌ Upload Middleware Error:", error);
    return c.json({ error: "Failed to process file upload." }, 500);
  }
};
