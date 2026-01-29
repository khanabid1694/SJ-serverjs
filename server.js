require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Pool } = require("pg");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

console.log("🔥 Server started");

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
   HELPER: Upload to Cloudinary
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
   ADD PRODUCT
================================ */
app.post("/api/products", upload.single("image"), async (req, res) => {
  try {
    const { title, description, weight, category, imageUrl } = req.body;

    if (!title || !category) {
      return res.status(400).json({ error: "Title and category required" });
    }

    let finalImageUrl = null;

    // If file uploaded → send to Cloudinary
    if (req.file) {
      finalImageUrl = await uploadToCloudinary(req.file.buffer);
    }
    // If imageUrl provided directly
    else if (imageUrl) {
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
    console.error("ADD ERROR:", err.message);
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

    // If new file uploaded → upload to Cloudinary
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
    console.error("UPDATE ERROR:", err.message);
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
    console.error("DELETE ERROR:", err.message);
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
    console.error("GET ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch products" });
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
