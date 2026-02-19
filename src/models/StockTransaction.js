const mongoose = require('mongoose');

const stockTransactionSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Please provide a product'],
    },
    type: {
      type: String,
      enum: ['stock-in', 'stock-out'],
      required: [true, 'Please provide transaction type'],
    },
    quantity: {
      type: Number,
      required: [true, 'Please provide quantity'],
      min: [1, 'Quantity must be at least 1'],
    },
    previousStock: {
      type: Number,
      required: true,
    },
    newStock: {
      type: Number,
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
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

// Index for better query performance
stockTransactionSchema.index({ product: 1, createdAt: -1 });
stockTransactionSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('StockTransaction', stockTransactionSchema);
