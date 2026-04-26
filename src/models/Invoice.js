const mongoose = require('mongoose');

// Invoice Item Schema (tiles business: unit type, discount %, tax %, line total)
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
  size: {
    type: String,
    trim: true,
    default: '',
  },
  unitType: {
    type: String,
    enum: ['Box', 'Sq Ft', 'Sq Meter', 'Piece'],
    default: 'Box',
  },
  quantity: {
    type: Number,
    required: [true, 'Please provide quantity'],
    min: [0.001, 'Quantity must be greater than 0'],
  },
  rate: {
    type: Number,
    required: [true, 'Please provide rate'],
    min: [0, 'Rate must be a positive number'],
  },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  taxPercent: {
    type: Number,
    default: 10,
    min: 0,
    max: 100,
  },
  lineTotal: {
    type: Number,
    required: true,
    min: [0, 'Line total must be a positive number'],
  },
  coverageSqm: {
    type: Number,
    default: null,
  },
});

// Recalculate line total for an item: (qty * rate) * (1 - discount%/100) * (1 + tax%/100)
function calcLineTotal(item) {
  const base = (item.quantity || 0) * (item.rate || 0);
  const afterDiscount = base * (1 - (item.discountPercent || 0) / 100);
  return Math.round(afterDiscount * (1 + ((item.taxPercent ?? 10) / 100)) * 100) / 100;
}

function toCents(value) {
  const amount = Number(value) || 0;
  return Math.round(amount * 100);
}

invoiceItemSchema.pre('save', function (next) {
  const providedLineTotal = Number(this.lineTotal);
  if (Number.isFinite(providedLineTotal) && providedLineTotal >= 0) {
    this.lineTotal = Math.round(providedLineTotal * 100) / 100;
    return next();
  }
  this.lineTotal = calcLineTotal(this);
  next();
});

// Invoice Schema
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    quotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation',
    },
    reference: {
      type: String,
      trim: true,
    },
    customerName: {
      type: String,
      required: [true, 'Please provide customer name'],
      trim: true,
    },
    customerPhone: { type: String, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    customerAddress: { type: String, trim: true },
    deliveryAddress: { type: String, trim: true },
    invoiceDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    items: {
      type: [invoiceItemSchema],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: 'Invoice must have at least one item',
      },
    },
    subtotal: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    discountAmount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 10, min: 0 },
    deliveryCost: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },

    // Invoice lifecycle: stock reduces only when confirmed or delivered
    status: {
      type: String,
      enum: ['draft', 'confirmed', 'delivered', 'cancelled', 'sent', 'paid', 'overdue'],
      default: 'draft',
    },

    // Payment (advance + balance)
    paymentMethod: {
      type: String,
      enum: ['', 'cash', 'card', 'bank_transfer', 'eftpos', 'credit'],
      default: '',
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partially_paid', 'paid'],
      default: 'unpaid',
    },
    paidDate: { type: Date },

    notes: { type: String, trim: true },
    terms: { type: String, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
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
    this.invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  }
});

// Calculate subtotal/grandTotal and payment fields before saving
invoiceSchema.pre('save', function () {
  const parsedDeliveryCost = Number(this.deliveryCost);
  const normalizedDeliveryCost = Number.isFinite(parsedDeliveryCost)
    ? Math.max(0, parsedDeliveryCost)
    : 0;
  this.deliveryCost = Math.round(normalizedDeliveryCost * 100) / 100;

  if (this.items && this.items.length > 0) {
    const txRate = this.taxRate ?? 10;
    // subtotal = sum of pre-tax bases (lineTotal already includes per-item GST)
    this.subtotal = Math.round(this.items.reduce((sum, item) => {
      const taxP = Number(item.taxPercent ?? txRate);
      return sum + (Number(item.lineTotal || 0) / (1 + taxP / 100));
    }, 0) * 100) / 100;
    if (this.discount > 0) {
      this.discountAmount =
        this.discountType === 'percentage'
          ? Math.round((this.subtotal * this.discount) / 100 * 100) / 100
          : this.discount;
    } else {
      this.discountAmount = 0;
    }
    // tax = sum of per-item GST amounts embedded in lineTotals
    this.tax = Math.round(this.items.reduce((sum, item) => {
      const taxP = Number(item.taxPercent ?? txRate);
      const lt = Number(item.lineTotal || 0);
      return sum + (lt - lt / (1 + taxP / 100));
    }, 0) * 100) / 100;
    const deliveryGst = Math.round(this.deliveryCost * txRate / 100 * 100) / 100;
    this.grandTotal = Math.round(
      (this.subtotal - this.discountAmount + this.tax + this.deliveryCost + deliveryGst) * 100
    ) / 100;
  }
  // Remaining balance and payment status
  const grandTotalCents = toCents(this.grandTotal || 0);
  const paidCents = toCents(this.amountPaid || 0);
  this.amountPaid = paidCents / 100;
  this.remainingBalance = Math.max(0, grandTotalCents - paidCents) / 100;
  if (paidCents <= 0) this.paymentStatus = 'unpaid';
  else if (paidCents >= grandTotalCents) this.paymentStatus = 'paid';
  else this.paymentStatus = 'partially_paid';
});

module.exports = mongoose.model('Invoice', invoiceSchema);
module.exports.calcLineTotal = calcLineTotal;
