const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    customerNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: [true, 'Please provide customer name'],
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
    ccEmails: {
      type: [String],
      default: [],
      set: (emails) =>
        Array.isArray(emails)
          ? emails
              .map((email) => String(email || '').trim().toLowerCase())
              .filter(Boolean)
          : [],
      validate: {
        validator(emails) {
          return (emails || []).every((email) =>
            /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email)
          );
        },
        message: 'Please provide valid CC email addresses',
      },
    },
    abn: {
      type: String,
      trim: true,
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postcode: { type: String, trim: true },
      country: { type: String, trim: true, default: 'Australia' },
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

customerSchema.pre('save', async function () {
  if (!this.isNew || this.customerNumber) return;

  const year = new Date().getFullYear();
  const baseCount = await this.constructor.countDocuments({
    createdAt: {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  });

  let sequence = baseCount + 1;
  const maxAttempts = 10000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = `CUS-${year}-${String(sequence).padStart(3, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.constructor.exists({ customerNumber: candidate });

    if (!exists) {
      this.customerNumber = candidate;
      return;
    }

    sequence += 1;
  }

  throw new Error(`Unable to generate unique customer number for year ${year}`);
});

customerSchema.index({ name: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ ccEmails: 1 });
customerSchema.index({ abn: 1 });
customerSchema.index({ status: 1 });
customerSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Customer', customerSchema);
