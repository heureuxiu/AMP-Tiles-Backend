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
  unitType: {
    type: String,
    enum: ['Box', 'Sq Ft', 'Sq Meter', 'Piece'],
    default: 'Box',
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
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  taxPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  lineTotal: {
    type: Number,
    required: true,
    min: 0,
  },
  coverageSqm: {
    type: Number,
    default: null,
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
      // Accepted / Rejected / Converted to Invoice (converted) – keep cancelled for backward compatibility
      enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'],
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
// More robust against duplicate-key race conditions: we loop until we find a free number.
quotationSchema.pre('save', async function () {
  if (!this.isNew || this.quotationNumber) return;

  const year = new Date().getFullYear();

  // Start from count+1, but if that number already exists (because of concurrent creates
  // or imported data), keep incrementing until we find a free slot.
  const baseCount = await this.constructor.countDocuments({
    createdAt: {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  });

  let sequence = baseCount + 1;
  // Safety cap to avoid infinite loops in case of unexpected data – 10k quotations per year.
  const maxAttempts = 10000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = `QT-${year}-${String(sequence).padStart(3, '0')}`;
    // Check if this quotation number is already taken
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.constructor.exists({ quotationNumber: candidate });
    if (!exists) {
      this.quotationNumber = candidate;
      return;
    }
    sequence += 1;
  }
});

// Index for better query performance
quotationSchema.index({ quotationNumber: 1 });
quotationSchema.index({ customerName: 'text' });
quotationSchema.index({ status: 1, createdAt: -1 });
quotationSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
