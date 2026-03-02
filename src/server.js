const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/database");

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

/**
 * CORS (MUST be before other middleware)
 * - Allows your production Vercel domain via CLIENT_URL
 * - Allows localhost for dev
 * - Optionally allows Vercel preview deployments (*.vercel.app)
 */
const allowedOrigins = [
  process.env.CLIENT_URL, // e.g. https://amp-tiles-dashboard.vercel.app
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (Postman / server-to-server)
      if (!origin) return callback(null, true);

      // Allow exact matches
      if (allowedOrigins.includes(origin)) return callback(null, true);

      // Allow Vercel preview URLs (optional but helpful)
      if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight handler (helps avoid some edge cases)
app.options("*", cors());

// Body parser middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Cookie parser middleware
app.use(cookieParser());

// Mount routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/stock", require("./routes/stockRoutes"));
app.use("/api/quotations", require("./routes/quotationRoutes"));
app.use("/api/invoices", require("./routes/invoiceRoutes"));
app.use("/api/suppliers", require("./routes/supplierRoutes"));
app.use("/api/purchase-orders", require("./routes/purchaseOrderRoutes"));

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    env: process.env.NODE_ENV || "unknown",
  });
});

// Error handler middleware
app.use((err, req, res, next) => {
  // Handle CORS errors nicely
  if (err && err.message && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || "Server Error",
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(
    `Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
  );
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});
