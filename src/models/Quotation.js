const mongoose = require('mongoose');

const quotationItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Please provide a product'],
  },
  productName: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: [true, 'Please provide quantity'],
    min: [1, 'Quantity must be at least 1'],
  },
  rate: {
    type: Number,
    required: [true, 'Please provide rate'],
    min: [0, 'Rate cannot be negative'],
  },
  lineTotal: {
    type: Number,
    required: true,
    min: 0,
  },
});

const quotationSchema = new mongoose.Schema(
  {
    quotationNumber: {
      type: String,
      unique: true,
      sparse: true, // Allow null values until generated
    },
    customerName: {
      type: String,
      required: [true, 'Please provide customer name'],
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    customerAddress: {
      type: String,
      trim: true,
    },
    quotationDate: {
      type: Date,
      required: [true, 'Please provide quotation date'],
      default: Date.now,
    },
    validUntil: {
      type: Date,
    },
    items: [quotationItemSchema],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'fixed',
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxRate: {
      type: Number,
      default: 10, // GST in Australia
      min: 0,
    },
    grandTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
    },
    terms: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'converted', 'expired', 'cancelled'],
      default: 'draft',
    },
    convertedToInvoice: {
      type: Boolean,
      default: false,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
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

// Generate quotation number before saving
quotationSchema.pre('save', async function () {
  if (this.isNew && !this.quotationNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    });
    this.quotationNumber = `QT-${year}-${String(count + 1).padStart(3, '0')}`;
  }
});

// Index for better query performance
quotationSchema.index({ quotationNumber: 1 });
quotationSchema.index({ customerName: 'text' });
quotationSchema.index({ status: 1, createdAt: -1 });
quotationSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
