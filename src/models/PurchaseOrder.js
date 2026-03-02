const mongoose = require('mongoose');

const purchaseOrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product is required'],
    },
    productName: { type: String, required: true },
    sku: { type: String, default: '' },
    unitType: {
      type: String,
      required: true,
      enum: ['Box', 'Sq Ft', 'Piece', 'Pallet'],
      default: 'Box',
    },
    quantityOrdered: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [0, 'Quantity must be at least 0'],
    },
    rate: {
      type: Number,
      required: [true, 'Rate is required'],
      min: [0, 'Rate must be a positive number'],
    },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    lineTotal: {
      type: Number,
      required: true,
      min: [0, 'Line total must be a positive number'],
    },
    // Coverage (sq m) - for tiles: from product or computed
    coverageSqm: { type: Number, default: null },
    // Goods receiving
    quantityReceived: { type: Number, default: 0, min: 0 },
    damagedQuantity: { type: Number, default: 0, min: 0 },
    batchNumber: { type: String, trim: true, default: '' },
    receivedDate: { type: Date, default: null },
  },
  { _id: true }
);

// Remaining = quantityOrdered - quantityReceived - damagedQuantity (computed in app)

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: [true, 'Please provide a supplier'],
    },
    supplierName: { type: String, required: true },
    poDate: {
      type: Date,
      required: [true, 'Please provide PO date'],
      default: Date.now,
    },
    expectedDeliveryDate: { type: Date, default: null },
    warehouseLocation: { type: String, trim: true, default: '' },
    currency: { type: String, trim: true, default: 'AUD' },
    paymentTerms: { type: String, trim: true, default: '' },
    deliveryAddress: { type: String, trim: true, default: '' },
    items: {
      type: [purchaseOrderItemSchema],
      validate: {
        validator: function (items) {
          return items && items.length > 0;
        },
        message: 'Purchase order must have at least one item',
      },
    },
    subtotal: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: [
        'draft',
        'sent',
        'sent_to_supplier',
        'confirmed',
        'partially_received',
        'received',
        'cancelled',
      ],
      default: 'draft',
    },
    notes: { type: String, trim: true, default: '' },
    terms: { type: String, trim: true, default: '' },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Auto-generate PO number: PO-YYYY-NNNN (4 digits)
purchaseOrderSchema.pre('save', async function () {
  if (this.isNew && !this.poNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    });
    this.poNumber = `PO-${year}-${String(count + 1).padStart(4, '0')}`;
  }
});

// Calculate line totals and PO totals before save
purchaseOrderSchema.pre('save', function () {
  if (this.items && this.items.length > 0) {
    this.items.forEach((item) => {
      const afterDiscount =
        item.quantityOrdered * item.rate * (1 - (item.discountPercent || 0) / 100);
      item.lineTotal = Math.round(
        afterDiscount * (1 + (item.taxPercent || 0) / 100) * 100
      ) / 100;
    });
    this.subtotal = this.items.reduce((sum, i) => sum + i.lineTotal, 0);
    this.tax = 0; // tax is per line now
    this.grandTotal = this.subtotal;
  }
});

purchaseOrderSchema.index({ poNumber: 1 });
purchaseOrderSchema.index({ supplier: 1 });
purchaseOrderSchema.index({ status: 1 });
purchaseOrderSchema.index({ poDate: -1 });
purchaseOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
