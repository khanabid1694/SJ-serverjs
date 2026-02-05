require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const axios = require("axios");

console.log("🔥 Server starting...");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===============================
   DATABASE
================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL");
});

/* ===============================
   CLOUDINARY
================================ */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* ===============================
   MULTER
================================ */
const upload = multer({ storage: multer.memoryStorage() });

/* ===============================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("🚀 Backend running successfully");
});

/* ===============================
   CLOUDINARY HELPER
================================ */
function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "products" },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

/* ===============================
   WHATSAPP HELPER
================================ */
async function sendWhatsAppOrder(order) {
  try {
    const message = `
🛍 NEW ORDER

👤 Name: ${order.customerName}
📞 Phone: ${order.phone}
📍 Address: ${order.address}

📦 Items: ${order.items?.length || 0}
💰 Total: Rs ${order.total}
`;

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
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
      }
    );

    console.log("✅ WhatsApp sent:", response.data);
  } catch (err) {
    console.error("❌ WhatsApp API ERROR:");
    console.error(err.response?.data || err.message);
    throw new Error("WhatsApp failed");
  }
}

/* ===============================
   PRODUCTS CRUD
================================ */
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const { title, description, weight, category, imageUrl } = req.body;

    if (!title || !category) {
      return res.status(400).json({ error: "Title & category required" });
    }

    let finalImage;

    if (req.file) {
      finalImage = await uploadToCloudinary(req.file.buffer);
    } else if (imageUrl) {
      finalImage = imageUrl;
    } else {
      return res.status(400).json({ error: "Image required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO products (title, description, image, weight, category)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, description, finalImage, weight, category]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Add product failed" });
  }
});

app.get("/api/products", async (_, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM products ORDER BY id DESC"
  );
  res.json(rows);
});

/* ===============================
   PLACE ORDER (FIXED)
================================ */
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body;

    if (!order.customerName || !order.phone || !order.address) {
      return res.status(400).json({
        success: false,
        message: "Invalid order data",
      });
    }

    await sendWhatsAppOrder(order);

    res.json({
      success: true,
      message: "Order placed successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to process order",
    });
  }
});

/* ===============================
   DB TEST
================================ */
app.get("/db-test", async (req, res) => {
  const result = await pool.query("SELECT NOW()");
  res.json(result.rows[0]);
});

/* ===============================
   START SERVER (RAILWAY SAFE)
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
