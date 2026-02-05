require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

console.log("🔥 Server starting...");

/* ===============================
   DATABASE
================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
   ROOT
================================ */
app.get("/", (_, res) => {
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
   WHATSAPP (NON-BLOCKING)
================================ */
async function sendWhatsAppOrder(order) {
  try {
    const message = `🛍 NEW ORDER

Name: ${order.customerName}
Phone: ${order.phone}
Address: ${order.address}
Total: Rs ${order.total}`;

    await axios.post(
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

    console.log("✅ WhatsApp sent");
  } catch (err) {
    console.error("⚠️ WhatsApp failed (IGNORED)");
    console.error(err.response?.data || err.message);
  }
}

/* ===============================
   PRODUCTS
================================ */
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const { title, description, weight, category, imageUrl } = req.body;

    let image = imageUrl;
    if (req.file) image = await uploadToCloudinary(req.file.buffer);

    const { rows } = await pool.query(
      `INSERT INTO products (title, description, image, weight, category)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, description, image, weight, category]
    );

    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Product failed" });
  }
});

app.get("/api/products", async (_, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM products ORDER BY id DESC"
  );
  res.json(rows);
});

/* ===============================
   PLACE ORDER (FIXED FOREVER)
================================ */
app.post("/api/orders", async (req, res) => {
  const order = req.body;

  if (!order.customerName || !order.phone || !order.address) {
    return res.status(400).json({
      success: false,
      message: "Invalid order data",
    });
  }

  // ✅ Respond immediately
  res.json({
    success: true,
    message: "Order placed successfully",
  });

  // 🔥 WhatsApp runs AFTER response
  sendWhatsAppOrder(order);
});

/* ===============================
   SERVER
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
