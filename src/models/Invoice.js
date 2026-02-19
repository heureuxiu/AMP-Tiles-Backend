const mongoose = require('mongoose');

// Invoice Item Schema
const invoiceItemSchema = new mongoose.Schema({
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
    min: [0, 'Rate must be a positive number'],
  },
  lineTotal: {
    type: Number,
    required: true,
    min: [0, 'Line total must be a positive number'],
  },
});

// Invoice Schema
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true, // Allows null initially until generated
    },
    quotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation',
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
    invoiceDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
    },
    items: {
      type: [invoiceItemSchema],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: 'Invoice must have at least one item',
      },
    },
    subtotal: {
      type: Number,
      default: 0,
      min: [0, 'Subtotal must be a positive number'],
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, 'Discount must be a positive number'],
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage',
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, 'Discount amount must be a positive number'],
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, 'Tax must be a positive number'],
    },
    taxRate: {
      type: Number,
      default: 10,
      min: [0, 'Tax rate must be a positive number'],
    },
    grandTotal: {
      type: Number,
      default: 0,
      min: [0, 'Grand total must be a positive number'],
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
      default: 'draft',
    },
    paymentMethod: {
      type: String,
      trim: true,
    },
    paidDate: {
      type: Date,
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: [0, 'Paid amount must be a positive number'],
    },
    notes: {
      type: String,
      trim: true,
    },
    terms: {
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

// Generate invoice number before saving
invoiceSchema.pre('save', async function () {
  if (this.isNew && !this.invoiceNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    });
    this.invoiceNumber = `INV-${year}-${String(count + 1).padStart(3, '0')}`;
  }
});

// Calculate totals before saving
invoiceSchema.pre('save', function () {
  if (this.items && this.items.length > 0) {
    // Calculate subtotal
    this.subtotal = this.items.reduce((sum, item) => sum + item.lineTotal, 0);

    // Calculate discount amount
    if (this.discount > 0) {
      if (this.discountType === 'percentage') {
        this.discountAmount = (this.subtotal * this.discount) / 100;
      } else {
        this.discountAmount = this.discount;
      }
    } else {
      this.discountAmount = 0;
    }

    // Calculate tax
    const taxableAmount = this.subtotal - this.discountAmount;
    this.tax = (taxableAmount * this.taxRate) / 100;

    // Calculate grand total
    this.grandTotal = taxableAmount + this.tax;
  }
});

// Update status to overdue if past due date
invoiceSchema.pre('save', function () {
  if (this.status === 'sent' && this.dueDate && new Date() > this.dueDate) {
    this.status = 'overdue';
  }
});

module.exports = mongoose.model('Invoice', invoiceSchema);
