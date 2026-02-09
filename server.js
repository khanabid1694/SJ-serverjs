require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const axios = require("axios");

const app = express();

/* ===============================
   MIDDLEWARE
================================ */
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* ===============================
   DATABASE
================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err) => {
  console.error("❌ PG Pool Error:", err);
});

/* ===============================
   CLOUDINARY
================================ */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

/* ===============================
   HELPERS
================================ */
function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "products" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

async function sendWhatsAppOrder(order) {
  const message =
    `🛍 *NEW ORDER*\n\n` +
    `👤 Name: ${order.customerName}\n` +
    `📞 Phone: ${order.phone}\n` +
    `📍 Address: ${order.address || "Not provided"}\n\n` +
    `📦 Items: ${order.items?.length || 0}\n` +
    `💰 Total: Rs ${order.totalAmount}\n\n` +
    `SJ Jewellers`;

  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: process.env.ADMIN_WHATSAPP_NUMBER,
      type: "text",
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}

/* ===============================
   ROUTES
================================ */
app.get("/", (req, res) => {
  res.send("🚀 SJ Jewellers Backend Live");
});

/* ===============================
   PRODUCTS
================================ */
app.get("/api/products", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const { title, description, weight, category, imageUrl } = req.body;
    let finalImage = imageUrl;

    if (req.file) {
      finalImage = await uploadToCloudinary(req.file.buffer);
    }

    if (!finalImage || !title) {
      return res.status(400).json({ error: "Title and Image are required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO products (title, description, image, weight, category)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, description, finalImage, weight, category]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("❌ Upload Error:", err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

/* ===============================
   ORDERS + WHATSAPP
================================ */
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body;

    if (!order.customerName || !order.phone || !order.totalAmount) {
      return res.status(400).json({
        success: false,
        message: "Missing required order data",
      });
    }

    // Send WhatsApp first
    await sendWhatsAppOrder(order);

    res.json({
      success: true,
      message: "Order placed and WhatsApp notification sent!",
    });
  } catch (err) {
    console.error("❌ WhatsApp Error:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: "Order saved but WhatsApp failed",
      error: err.response?.data || err.message,
    });
  }
});

/* ===============================
   SERVER
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
