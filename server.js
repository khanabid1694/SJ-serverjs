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
   CLOUDINARY CONFIG
================================ */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* ===============================
   MULTER MEMORY STORAGE
================================ */
const upload = multer({ storage: multer.memoryStorage() });

/* ===============================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("🚀 Backend running successfully");
});

/* ===============================
   CLOUDINARY UPLOAD HELPER
================================ */
function uploadToCloudinary(fileBuffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "products" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
}

/* ===============================
   WHATSAPP HELPER
================================ */
async function sendWhatsAppOrder(order) {
  let itemsText = "";
  order.items.forEach((item, i) => {
    itemsText += `${i + 1}. ${item.title} (${item.weight}g)\n`;
  });

  const message = `🛍 *NEW ORDER RECEIVED*

👤 *Name:* ${order.customerName}
📞 *Phone:* ${order.phone}
📍 *Address:* ${order.address}

💳 *Payment:* ${order.paymentMethod}
💰 *Total:* Rs ${order.totalAmount}

📦 *Items:*
${itemsText}

🆔 *Order ID:* ${order.orderId}

SJ Jewellers`;

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
}

/* ===============================
   ADD PRODUCT
================================ */
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const { title, description, weight, category, imageUrl } = req.body;

    if (!title || !category) {
      return res.status(400).json({ error: "Title and category required" });
    }

    let finalImageUrl;

    if (req.file) {
      finalImageUrl = await uploadToCloudinary(req.file.buffer);
    } else if (imageUrl) {
      finalImageUrl = imageUrl;
    } else {
      return res.status(400).json({ error: "Image or Image URL required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO products (title, description, image, weight, category)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [title, description, finalImageUrl, weight, category]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("ADD PRODUCT ERROR:", err.message);
    res.status(500).json({ error: "Failed to add product" });
  }
});

/* ===============================
   UPDATE PRODUCT
================================ */
app.put("/api/products/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, weight, category, imageUrl } = req.body;

    let finalImageUrl = imageUrl || null;

    if (req.file) {
      finalImageUrl = await uploadToCloudinary(req.file.buffer);
    }

    const { rows } = await pool.query(
      `UPDATE products
       SET title=$1, description=$2, image=$3, weight=$4, category=$5
       WHERE id=$6 RETURNING *`,
      [title, description, finalImageUrl, weight, category, id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err.message);
    res.status(500).json({ error: "Failed to update product" });
  }
});

/* ===============================
   DELETE PRODUCT
================================ */
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM products WHERE id=$1", [id]);
    res.json({ message: "Product deleted" });
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err.message);
    res.status(500).json({ error: "Failed to delete product" });
  }
});

/* ===============================
   GET PRODUCTS
================================ */
app.get("/api/products", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ===============================
   PLACE ORDER → WHATSAPP
================================ */
app.post("/api/orders", async (req, res) => {
  try {
    const order = req.body;

    if (
      !order.customerName ||
      !order.phone ||
      !order.address ||
      !order.items
    ) {
      return res.status(400).json({ error: "Missing order fields" });
    }

    await sendWhatsAppOrder(order);

    res.json({
      success: true,
      message: "Order received & WhatsApp sent",
    });
  } catch (err) {
    console.error("ORDER ERROR:", err.response?.data || err.message);
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
   START SERVER
================================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
