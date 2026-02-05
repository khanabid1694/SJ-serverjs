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
   WHATSAPP HELPER (NON-BLOCKING)
================================ */
async function sendWhatsAppOrder(order) {
  try {
    if (!order.customerName || !order.phone || !order.address || !order.total) {
      console.warn("⚠️ WhatsApp skipped: incomplete order data");
      return;
    }

    const message = 
`🛍 NEW ORDER
Name: ${order.customerName}
Phone: ${order.phone}
Address: ${order.address}
Total: Rs ${order.total}`;

    const url = `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: process.env.ADMIN_WHATSAPP_NUMBER,
      type: "text",
      text: { body: message },
    };

    const headers = {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    };

    const response = await axios.post(url, payload, { headers });

    console.log("✅ WhatsApp sent:", response.data);
  } catch (err) {
    console.error("⚠️ WhatsApp failed (IGNORED)");
    console.error(err.response?.data || err.message);
  }
}

/* ===============================
   PRODUCTS ROUTES
================================ */
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const { title, description, weight, category, imageUrl } = req.body;

    console.log("REQ.BODY:", req.body);
    console.log("REQ.FILE:", req.file);

    if (!title || !description || !weight || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let image = imageUrl || null;
    if (req.file) {
      image = await uploadToCloudinary(req.file.buffer);
    }

    const { rows } = await pool.query(
      `INSERT INTO products (title, description, image, weight, category)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, description, image, weight, category]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("🔥 PRODUCT ERROR:", err);
    res.status(500).json({ error: "Product failed", details: err.message });
  }
});

app.get("/api/products", async (_, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("🔥 FETCH PRODUCTS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch products", details: err.message });
  }
});

/* ===============================
   ORDERS ROUTE
================================ */
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body;

    if (!order.customerName || !order.phone || !order.address || !order.total) {
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

    // 🔥 Send WhatsApp AFTER response (non-blocking)
    sendWhatsAppOrder(order);

    // Optional: store order in DB if needed
    // await pool.query(
    //   "INSERT INTO orders (customer_name, phone, address, total) VALUES ($1,$2,$3,$4)",
    //   [order.customerName, order.phone, order.address, order.total]
    // );

  } catch (err) {
    console.error("🔥 ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Order failed", details: err.message });
  }
});

/* ===============================
   SERVER
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
