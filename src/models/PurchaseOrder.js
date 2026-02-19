const mongoose = require('mongoose');

const purchaseOrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product is required'],
  },
  productName: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1'],
  },
  rate: {
    type: Number,
    required: [true, 'Rate is required'],
    min: [0, 'Rate must be a positive number'],
  },
  lineTotal: {
    type: Number,
    required: true,
    min: [0, 'Line total must be a positive number'],
  },
});

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      unique: true,
      sparse: true, // Allows null initially until generated
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: [true, 'Please provide a supplier'],
    },
    supplierName: {
      type: String,
      required: true,
    },
    poDate: {
      type: Date,
      required: [true, 'Please provide PO date'],
      default: Date.now,
    },
    expectedDeliveryDate: {
      type: Date,
    },
    items: {
      type: [purchaseOrderItemSchema],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: 'Purchase order must have at least one item',
      },
    },
    subtotal: {
      type: Number,
      default: 0,
      min: [0, 'Subtotal must be a positive number'],
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, 'Tax must be a positive number'],
    },
    taxRate: {
      type: Number,
      default: 10, // 10% GST
      min: [0, 'Tax rate must be a positive number'],
    },
    grandTotal: {
      type: Number,
      default: 0,
      min: [0, 'Grand total must be a positive number'],
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'received', 'cancelled'],
      default: 'draft',
    },
    notes: {
      type: String,
      trim: true,
    },
    terms: {
      type: String,
      trim: true,
    },
    receivedDate: {
      type: Date,
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

// Generate unique PO number before saving
purchaseOrderSchema.pre('save', async function () {
  if (this.isNew && !this.poNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    });
    this.poNumber = `PO-${year}-${String(count + 1).padStart(3, '0')}`;
  }
});

// Calculate totals before saving
purchaseOrderSchema.pre('save', function () {
  // Calculate subtotal from items
  if (this.items && this.items.length > 0) {
    this.subtotal = this.items.reduce((sum, item) => sum + item.lineTotal, 0);
    
    // Calculate tax
    this.tax = (this.subtotal * this.taxRate) / 100;
    
    // Calculate grand total
    this.grandTotal = this.subtotal + this.tax;
  }
});

// Indexes for better query performance
purchaseOrderSchema.index({ poNumber: 1 });
purchaseOrderSchema.index({ supplier: 1 });
purchaseOrderSchema.index({ status: 1 });
purchaseOrderSchema.index({ poDate: -1 });
purchaseOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
