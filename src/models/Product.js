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
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Please provide a price'],
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

// Index for better search performance
productSchema.index({ name: 'text', sku: 'text', category: 'text' });

module.exports = mongoose.model('Product', productSchema);
