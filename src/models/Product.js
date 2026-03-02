const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a product name'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'Please provide a SKU'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Please provide a category'],
      trim: true,
    },
    finish: {
      type: String,
      required: [true, 'Please provide a finish'],
      trim: true,
    },
    size: {
      type: String,
      required: [true, 'Please provide size'],
      trim: true,
    },
    // --- Supplier / Packing ---
    supplierType: {
      type: String,
      required: [true, 'Please select supplier type'],
      enum: { values: ['third-party', 'own'], message: 'Supplier type must be Third-Party or Own' },
      trim: true,
    },
    supplierVendor: {
      type: String,
      trim: true,
      default: '',
    },
    supplierName: {
      type: String,
      trim: true,
      default: '',
    },
    boxCoveragePackingDetails: {
      type: String,
      required: [true, 'Please provide box coverage / packing details'],
      trim: true,
    },
    tilesPerBox: {
      type: Number,
      required: [true, 'Please provide tiles per box'],
      min: 0,
    },
    coveragePerBox: {
      type: Number,
      min: 0,
      default: null,
    },
    coveragePerBoxUnit: {
      type: String,
      enum: { values: ['sqft', 'sqm'], message: 'Must be sq ft or sq meter' },
      trim: true,
      default: 'sqft',
    },
    weightPerBox: {
      type: Number,
      min: 0,
      default: null,
    },
    // --- Sale (customer facing) ---
    retailPrice: {
      type: Number,
      required: [true, 'Please provide retail price'],
      min: 0,
    },
    pricingUnit: {
      type: String,
      required: [true, 'Please select pricing unit'],
      enum: { values: ['per_box', 'per_sqft', 'per_sqm', 'per_piece'], message: 'Invalid pricing unit' },
      trim: true,
    },
    discountSalePrice: {
      type: Number,
      min: 0,
      default: null,
    },
    taxPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    // --- Cost (admin only) ---
    costPrice: {
      type: Number,
      required: [true, 'Please provide cost price'],
      min: 0,
    },
    profitMargin: {
      type: Number,
      default: null,
    },
    // --- Legacy / compatibility ---
    price: {
      type: Number,
      min: 0,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    unit: {
      type: String,
      default: 'boxes',
      trim: true,
    },
    image: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-calculate profit margin before save
productSchema.pre('save', function (next) {
  if (this.retailPrice != null && this.costPrice != null && this.costPrice > 0) {
    this.profitMargin = Math.round(((this.retailPrice - this.costPrice) / this.costPrice) * 100 * 100) / 100;
  }
  if (this.retailPrice != null && !this.price) this.price = this.retailPrice;
  next();
});

// Index for better search performance
productSchema.index({ name: 'text', sku: 'text', category: 'text' });

module.exports = mongoose.model('Product', productSchema);
