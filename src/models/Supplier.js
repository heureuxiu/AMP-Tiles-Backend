const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    supplierNumber: {
      type: String,
      unique: true,
      sparse: true, // Allows null initially until generated
    },
    name: {
      type: String,
      required: [true, 'Please provide supplier name'],
      trim: true,
    },
    contactPerson: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Please provide phone number'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email',
      ],
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postcode: { type: String, trim: true },
      country: { type: String, trim: true, default: 'Australia' },
    },
    website: {
      type: String,
      trim: true,
    },
    abn: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    paymentTerms: {
      type: String,
      trim: true,
    },
    deliveryMethod: {
      type: String,
      trim: true,
      enum: ['Supplier Delivery', 'Pickup', 'Freight'],
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

// Generate unique supplier number before saving
supplierSchema.pre('save', async function () {
  if (this.isNew && !this.supplierNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    });
    this.supplierNumber = `SUP-${year}-${String(count + 1).padStart(3, '0')}`;
  }
});

// Indexes for better query performance
supplierSchema.index({ name: 1 });
supplierSchema.index({ email: 1 });
supplierSchema.index({ status: 1 });
supplierSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Supplier', supplierSchema);
