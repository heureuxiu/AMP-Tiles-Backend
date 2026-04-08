const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const { generateQuotationPdf } = require('../utils/quotationPdf');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num);
}

const DEFAULT_DELIVERY_COST = 295;
const COMPANY_NAME = 'AMP TILES PTY LTD';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeDeliveryCost(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_DELIVERY_COST;
  return roundMoney(numeric);
}

function calculateQuotationGrandTotal({ subtotal, discount, tax, deliveryCost }) {
  return roundMoney(
    (Number(subtotal) || 0) -
      (Number(discount) || 0) +
      (Number(tax) || 0) +
      normalizeDeliveryCost(deliveryCost)
  );
}

function getQuotationAmountSnapshot(quotation) {
  const subtotal = Number(quotation?.subtotal) || 0;
  const discount = Number(quotation?.discount) || 0;
  const tax = Number(quotation?.tax) || 0;
  const baseTotal = subtotal - discount + tax;
  const parsedDelivery = Number(quotation?.deliveryCost);
  const fallbackDelivery = Math.max(0, roundMoney(Number(quotation?.grandTotal) - baseTotal));
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : DEFAULT_DELIVERY_COST;
  const grandTotal = Number.isFinite(Number(quotation?.grandTotal))
    ? Number(quotation.grandTotal)
    : baseTotal + deliveryCost;

  return {
    subtotal: roundMoney(subtotal),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    deliveryCost: roundMoney(deliveryCost),
    grandTotal: roundMoney(grandTotal),
  };
}

function buildFallbackQuotationEmail(quotation) {
  const quoteNo = quotation.quotationNumber || String(quotation._id || '');
  const customerName = quotation.customerName || 'Customer';
  const quoteDate = formatDate(quotation.quotationDate);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : 'N/A';
  const amounts = getQuotationAmountSnapshot(quotation);
  const grandTotal = formatCurrency(amounts.grandTotal);

  const rowsHtml = (quotation.items || [])
    .map((item) => {
      const productName = escapeHtml(item.productName || 'Product');
      const qty = Number(item.quantity) || 0;
      const rate = formatCurrency(item.rate);
      const amount = formatCurrency(item.lineTotal);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${productName}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${qty}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${rate}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${amount}</td>
      </tr>`;
    })
    .join('');

  const notesLine = quotation.notes ? `\nNotes: ${quotation.notes}` : '';
  const termsLine = quotation.terms ? `\nTerms: ${quotation.terms}` : '';

  const text = [
    `Quotation ${quoteNo}`,
    `Dear ${customerName},`,
    '',
    'Please find your quotation details below.',
    '',
    `Quotation Date: ${quoteDate}`,
    `Valid Until: ${validUntil}`,
    `Subtotal: ${formatCurrency(amounts.subtotal)}`,
    amounts.discount > 0 ? `Discount: -${formatCurrency(amounts.discount)}` : '',
    amounts.tax > 0 ? `Tax (GST): ${formatCurrency(amounts.tax)}` : '',
    `Delivery Cost: ${formatCurrency(amounts.deliveryCost)}`,
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(quotation.items || []).map((item) => {
      const qty = Number(item.quantity) || 0;
      const name = item.productName || 'Product';
      const amount = formatCurrency(item.lineTotal);
      return `- ${name}: ${qty} x ${formatCurrency(item.rate)} = ${amount}`;
    }),
    notesLine,
    termsLine,
    '',
    'Thank you,',
    COMPANY_NAME,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <h2 style="margin:0 0 16px;">Quotation ${escapeHtml(quoteNo)}</h2>
      <p>Dear ${escapeHtml(customerName)},</p>
      <p>Please find your quotation details below.</p>
      <p>
        <strong>Quotation Date:</strong> ${escapeHtml(quoteDate)}<br/>
        <strong>Valid Until:</strong> ${escapeHtml(validUntil)}<br/>
        <strong>Subtotal:</strong> ${escapeHtml(formatCurrency(amounts.subtotal))}<br/>
        ${
          amounts.discount > 0
            ? `<strong>Discount:</strong> -${escapeHtml(formatCurrency(amounts.discount))}<br/>`
            : ''
        }
        ${
          amounts.tax > 0
            ? `<strong>Tax (GST):</strong> ${escapeHtml(formatCurrency(amounts.tax))}<br/>`
            : ''
        }
        <strong>Delivery Cost:</strong> ${escapeHtml(formatCurrency(amounts.deliveryCost))}<br/>
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Product</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Rate</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      ${
        quotation.notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(quotation.notes)}</p>`
          : ''
      }
      ${
        quotation.terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(quotation.terms)}</p>`
          : ''
      }

      <p style="margin-top:24px;">Thank you,<br/>${COMPANY_NAME}</p>
    </div>
  `;

  return {
    subject: `Quotation ${quoteNo} from ${COMPANY_NAME}`,
    text,
    html,
  };
}

let sendEmail = async () => {
  throw new Error('Email service is not available');
};
let buildQuotationEmail = buildFallbackQuotationEmail;

function loadOptionalModule(candidates) {
  for (const mod of candidates) {
    try {
      return require(mod);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Failed loading optional module "${mod}"`, error.message);
        }
        return null;
      }
    }
  }
  return null;
}

const mailerModule = loadOptionalModule(['../utils/mailer']);
if (mailerModule && typeof mailerModule.sendEmail === 'function') {
  ({ sendEmail } = mailerModule);
} else if (process.env.NODE_ENV !== 'production') {
  console.warn('Mailer utility not found. Email sending will be disabled.');
}

const quotationEmailModule = loadOptionalModule([
  '../utils/quotationEmail',
  '../utils/quotation-email',
  '../utils/QuotationEmail',
]);
if (quotationEmailModule && typeof quotationEmailModule.buildQuotationEmail === 'function') {
  ({ buildQuotationEmail } = quotationEmailModule);
} else if (process.env.NODE_ENV !== 'production') {
  console.warn('Quotation email template utility not found. Using fallback template.');
}

const HOLDING_QUOTATION_STATUSES = ['sent', 'accepted'];
const CONVERTIBLE_QUOTATION_STATUSES = ['draft', 'sent', 'accepted'];
const SQFT_PER_SQM = 10.764;

// @desc    Get all quotations
// @route   GET /api/quotations
// @access  Private
exports.getQuotations = async (req, res) => {
  try {
    const { search, status, startDate, endDate, sortBy = '-createdAt' } = req.query;
    
    // Build query
    const query = {};
    
    // Search by quotation number or customer name
    if (search) {
      query.$or = [
        { quotationNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Filter by date range
    if (startDate || endDate) {
      query.quotationDate = {};
      if (startDate) {
        query.quotationDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.quotationDate.$lte = new Date(endDate);
      }
    }
    
    const quotations = await Quotation.find(query)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku')
      .sort(sortBy);

    // Calculate statistics
    const stats = {
      total: quotations.length,
      draft: quotations.filter(q => q.status === 'draft').length,
      sent: quotations.filter(q => q.status === 'sent').length,
      accepted: quotations.filter(q => q.status === 'accepted').length,
      rejected: quotations.filter(q => q.status === 'rejected').length,
      converted: quotations.filter(q => q.status === 'converted').length,
      expired: quotations.filter(q => q.status === 'expired').length,
      cancelled: quotations.filter(q => q.status === 'cancelled').length,
      totalValue: quotations.reduce((sum, q) => sum + q.grandTotal, 0),
    };

    res.status(200).json({
      success: true,
      count: quotations.length,
      stats,
      quotations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single quotation
// @route   GET /api/quotations/:id
// @access  Private
exports.getQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku image price unit')
      .populate('invoiceId', 'invoiceNumber');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found',
      });
    }

    res.status(200).json({
      success: true,
      quotation,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Send quotation to customer email and mark as sent
// @route   POST /api/quotations/:id/send
// @access  Private
exports.sendQuotationEmail = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found',
      });
    }

    if (quotation.status === 'converted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send a converted quotation',
      });
    }

    if (quotation.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send a cancelled quotation',
      });
    }

    const customerEmail = String(quotation.customerEmail || '')
      .trim()
      .toLowerCase();
    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message:
          'Customer email is missing. Please add customer email before sending quotation.',
      });
    }

    const emailPayload = buildQuotationEmail(quotation);
    await sendEmail({
      to: customerEmail,
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
    });

    if (quotation.status !== 'sent') {
      quotation.status = 'sent';
      await quotation.save();
      await quotation.populate('createdBy', 'name email');
      await quotation.populate('items.product', 'name sku');
    }

    res.status(200).json({
      success: true,
      emailSent: true,
      message: `Quotation sent to ${customerEmail}`,
      quotation,
    });
  } catch (error) {
    const details = [
      error?.message || 'Failed to send quotation email',
      error?.code ? `code=${error.code}` : '',
      error?.command ? `command=${error.command}` : '',
      error?.responseCode ? `responseCode=${error.responseCode}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    console.error('Send quotation email error:', error);
    res.status(500).json({
      success: false,
      message: details || 'Failed to send quotation email',
    });
  }
};

// @desc    Get quotation as PDF
// @route   GET /api/quotations/:id/pdf
// @access  Private
exports.getQuotationPdf = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku')
      .lean();

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found',
      });
    }

    const pdfBuffer = await generateQuotationPdf(quotation);
    const filename = `quotation-${quotation.quotationNumber || quotation._id}.pdf`.replace(
      /\s/g,
      '-'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Get quotation PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate quotation PDF',
      error: error.message,
    });
  }
};

function normalizeCoverageUnit(rawUnit, pricingUnit) {
  const normalized = String(rawUnit || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

  if (
    normalized.includes('sqm') ||
    normalized.includes('sqmeter') ||
    normalized.includes('sqmetre') ||
    normalized.includes('m2') ||
    normalized.includes('m²')
  ) {
    return 'sqm';
  }

  if (
    normalized.includes('sqft') ||
    normalized.includes('sqfeet') ||
    normalized.includes('ft2') ||
    normalized.includes('ft²')
  ) {
    return 'sqft';
  }

  if (pricingUnit === 'per_sqm') return 'sqm';
  if (pricingUnit === 'per_sqft') return 'sqft';
  return 'sqft';
}

function getSqmPerBox(product) {
  const covPerBox = Number(product.coveragePerBox) || 0;
  if (covPerBox <= 0) return 0;
  const covUnit = normalizeCoverageUnit(
    product.coveragePerBoxUnit,
    product.pricingUnit
  );
  return covUnit === 'sqm' ? covPerBox : covPerBox / SQFT_PER_SQM;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function normalizeStockUnit(rawUnit, pricingUnit) {
  const normalized = String(rawUnit || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

  if (
    normalized.includes('sqm') ||
    normalized.includes('sqmeter') ||
    normalized.includes('sqmetre') ||
    normalized.includes('m2') ||
    normalized.includes('m²')
  ) {
    return 'sqm';
  }
  if (
    normalized.includes('sqft') ||
    normalized.includes('sqfeet') ||
    normalized.includes('ft2') ||
    normalized.includes('ft²')
  ) {
    return 'sqft';
  }
  if (normalized.includes('piece')) return 'piece';
  if (normalized.includes('box')) return 'box';

  if (pricingUnit === 'per_sqm') return 'sqm';
  if (pricingUnit === 'per_sqft') return 'sqft';
  if (pricingUnit === 'per_piece') return 'piece';
  return 'box';
}

function normalizeItemUnitType(rawUnitType) {
  const normalized = String(rawUnitType || 'box')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
  if (normalized.includes('sqmeter') || normalized.includes('sqm') || normalized.includes('m2') || normalized.includes('m²')) {
    return 'sqm';
  }
  if (normalized.includes('sqfeet') || normalized.includes('sqft') || normalized.includes('ft2') || normalized.includes('ft²')) {
    return 'sqft';
  }
  if (normalized.includes('piece')) return 'piece';
  return 'box';
}

function getItemCoverageSqm(product, item) {
  const explicitCoverageSqm = Number(item.coverageSqm);
  if (explicitCoverageSqm > 0) return explicitCoverageSqm;

  const quantity = Number(item.quantity) || 0;
  const itemUnit = normalizeItemUnitType(item.unitType);
  const sqmPerBox = getSqmPerBox(product);
  const hasCoveragePerBox = sqmPerBox > 0;

  if (itemUnit === 'box') {
    return hasCoveragePerBox ? quantity * sqmPerBox : null;
  }
  if (itemUnit === 'sqm') {
    return hasCoveragePerBox ? quantity * sqmPerBox : quantity;
  }
  if (itemUnit === 'sqft') {
    return hasCoveragePerBox ? quantity * sqmPerBox : quantity / SQFT_PER_SQM;
  }
  return null;
}

function getItemStockDemand(product, item) {
  const quantity = Number(item.quantity) || 0;
  const stockUnit = normalizeStockUnit(product.unit, product.pricingUnit);
  if (stockUnit === 'box' || stockUnit === 'piece') {
    return quantity;
  }

  const coverageSqm = getItemCoverageSqm(product, item);
  if (coverageSqm == null) {
    return quantity;
  }
  if (stockUnit === 'sqm') {
    return coverageSqm;
  }
  return coverageSqm * SQFT_PER_SQM;
}

function getProductIdFromItem(item) {
  if (!item || !item.product) return '';
  if (typeof item.product === 'object' && item.product._id) {
    return String(item.product._id);
  }
  return String(item.product);
}

function formatStockQty(value) {
  const rounded = roundQty(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

// Helper to build one quotation item with discount/tax and optional tiles coverage
function buildQuotationItem(product, item) {
  const quantity = Number(item.quantity) || 0;
  const rate = Number(item.rate) || product.retailPrice || product.price || 0;
  const unitType = item.unitType || 'Box';
  const explicitCoverageSqm = Number(item.coverageSqm);
  const pricingUnit = product.pricingUnit || 'per_box';
  const discountPercent = Number(item.discountPercent) || 0;
  const taxPercent =
    item.taxPercent != null
      ? Number(item.taxPercent)
      : product.taxPercent != null
      ? product.taxPercent
      : 0;

  const sqmPerBox = getSqmPerBox(product);
  const coverageSqmFromBoxes = sqmPerBox > 0 ? quantity * sqmPerBox : null;

  let billableQuantity = quantity;
  if (pricingUnit === 'per_sqm' && coverageSqmFromBoxes != null) {
    billableQuantity = coverageSqmFromBoxes;
  } else if (pricingUnit === 'per_sqft' && coverageSqmFromBoxes != null) {
    billableQuantity = coverageSqmFromBoxes * 10.764;
  }

  const base = billableQuantity * rate;
  const discountAmount = (base * discountPercent) / 100;
  const taxable = base - discountAmount;
  const taxAmount = (taxable * taxPercent) / 100;
  const lineTotal = Math.round((taxable + taxAmount) * 100) / 100;

  // Tiles coverage in sqm (optional)
  let coverageSqm = null;
  if (Number.isFinite(explicitCoverageSqm) && explicitCoverageSqm > 0) {
    coverageSqm = explicitCoverageSqm;
  } else if (coverageSqmFromBoxes != null) {
    coverageSqm = coverageSqmFromBoxes;
  } else if (unitType === 'Sq Meter') {
    coverageSqm = quantity;
  } else if (unitType === 'Sq Ft') {
    coverageSqm = quantity / 10.764;
  }

  return {
    populated: {
      product: product._id,
      productName: product.name,
      unitType,
      quantity,
      rate,
      discountPercent,
      taxPercent,
      lineTotal,
      coverageSqm: coverageSqm != null ? Math.round(coverageSqm * 1000) / 1000 : undefined,
    },
    base,
    discountAmount,
    taxAmount,
  };
}

function createStockValidationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isOwnStockProduct(product) {
  return String(product?.supplierType || 'own') === 'own';
}

function isHoldingQuotationStatus(status) {
  return HOLDING_QUOTATION_STATUSES.includes(String(status || '').toLowerCase());
}

function isConvertibleQuotationStatus(status) {
  return CONVERTIBLE_QUOTATION_STATUSES.includes(String(status || '').toLowerCase());
}

function toObjectIds(ids) {
  return ids
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
}

async function getHeldQuantitiesByProduct(productIds, options = {}) {
  const { excludeQuotationId } = options;
  const objectIds = toObjectIds(productIds);
  if (objectIds.length === 0) return new Map();

  const query = {
    status: { $in: HOLDING_QUOTATION_STATUSES },
    'items.product': { $in: objectIds },
  };

  if (excludeQuotationId && mongoose.Types.ObjectId.isValid(String(excludeQuotationId))) {
    query._id = { $ne: new mongoose.Types.ObjectId(String(excludeQuotationId)) };
  }

  const quotations = await Quotation.find(query)
    .select('items')
    .populate('items.product', 'unit coveragePerBox coveragePerBoxUnit pricingUnit');

  const targetIds = new Set(objectIds.map((id) => String(id)));
  const heldByProduct = new Map();

  for (const quotation of quotations) {
    for (const item of quotation.items || []) {
      const productId = getProductIdFromItem(item);
      if (!productId || !targetIds.has(productId)) continue;
      if (!item.product || typeof item.product !== 'object') continue;

      const heldDemand = roundQty(getItemStockDemand(item.product, item));
      if (heldDemand <= 0) continue;
      heldByProduct.set(
        productId,
        roundQty((heldByProduct.get(productId) || 0) + heldDemand)
      );
    }
  }

  return heldByProduct;
}

async function assertRequestedStockAvailability(requestedByProduct, productMap, options = {}) {
  const heldByProduct = await getHeldQuantitiesByProduct(
    Array.from(requestedByProduct.keys()),
    options
  );

  for (const [productId, requestedQty] of requestedByProduct.entries()) {
    const product = productMap.get(productId);

    if (!product) {
      throw createStockValidationError(`Product not found: ${productId}`, 404);
    }

    if (!isOwnStockProduct(product)) {
      continue;
    }

    const onHandQty = roundQty(product.stock);
    const heldQty = roundQty(heldByProduct.get(productId));
    const availableQty = roundQty(Math.max(0, onHandQty - heldQty));

    if (requestedQty > availableQty + 0.0001) {
      const unitLabel = product.unit || 'units';
      throw createStockValidationError(
        `Insufficient stock for ${product.name}. On hand: ${formatStockQty(onHandQty)} ${unitLabel}, Held in quotations: ${formatStockQty(heldQty)} ${unitLabel}, Available: ${formatStockQty(availableQty)} ${unitLabel}, Requested: ${formatStockQty(requestedQty)} ${unitLabel}`,
        400
      );
    }
  }
}

async function validateStockAndLoadProducts(items, options = {}) {
  const requestedRows = [];
  const productIds = [];

  for (const item of items) {
    const productId = getProductIdFromItem(item);
    const quantity = Number(item.quantity) || 0;

    if (!productId) {
      throw createStockValidationError('Please provide a product for each item', 400);
    }

    if (quantity <= 0) {
      throw createStockValidationError('Quantity must be greater than 0', 400);
    }

    requestedRows.push({ productId, item });
    productIds.push(productId);
  }

  const products = await Product.find({ _id: { $in: Array.from(new Set(productIds)) } });
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const requestedByProduct = new Map();

  for (const row of requestedRows) {
    const product = productMap.get(row.productId);
    if (!product) {
      throw createStockValidationError(`Product not found: ${row.productId}`, 404);
    }
    const requestedDemand = roundQty(getItemStockDemand(product, row.item));
    if (requestedDemand <= 0) continue;
    requestedByProduct.set(
      row.productId,
      roundQty((requestedByProduct.get(row.productId) || 0) + requestedDemand)
    );
  }

  await assertRequestedStockAvailability(requestedByProduct, productMap, options);

  return productMap;
}

async function consumeOwnStockForItems(items, options = {}) {
  const productIds = [];
  for (const item of items) {
    const productId = getProductIdFromItem(item);
    if (!productId) continue;
    productIds.push(productId);
  }

  if (productIds.length === 0) return;

  const products = await Product.find({ _id: { $in: Array.from(new Set(productIds)) } });
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const requestedByProduct = new Map();

  for (const item of items) {
    const productId = getProductIdFromItem(item);
    const quantity = Number(item.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    const product = productMap.get(productId);
    if (!product) continue;
    const stockDemand = roundQty(getItemStockDemand(product, item));
    if (stockDemand <= 0) continue;
    requestedByProduct.set(
      productId,
      roundQty((requestedByProduct.get(productId) || 0) + stockDemand)
    );
  }

  if (requestedByProduct.size === 0) return;

  await assertRequestedStockAvailability(requestedByProduct, productMap, options);

  for (const [productId, quantity] of requestedByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product || !isOwnStockProduct(product)) continue;
    const nextStock = roundQty((Number(product.stock) || 0) - quantity);
    product.stock = Math.max(0, nextStock);
    // eslint-disable-next-line no-await-in-loop
    await product.save();
  }
}

// @desc    Create new quotation
// @route   POST /api/quotations
// @access  Private
exports.createQuotation = async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      quotationDate,
      validUntil,
      items,
      discount,
      discountType,
      taxRate,
      notes,
      terms,
      status,
      sendEmail: shouldSendEmail,
    } = req.body;

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one item',
      });
    }

    if (shouldSendEmail && !String(customerEmail || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is required to send quotation by email',
      });
    }

    // Validate and populate items (with discount / tax per line)
    const productMap = await validateStockAndLoadProducts(items);
    const populatedItems = [];
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    for (const item of items) {
      const product = productMap.get(String(item.product));

      const built = buildQuotationItem(product, item);
      populatedItems.push(built.populated);
      subtotal += built.base;
      totalDiscount += built.discountAmount;
      totalTax += built.taxAmount;
    }

    const deliveryCost = DEFAULT_DELIVERY_COST;
    const grandTotal = calculateQuotationGrandTotal({
      subtotal,
      discount: totalDiscount,
      tax: totalTax,
      deliveryCost,
    });

    // Create quotation
    const quotation = await Quotation.create({
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      quotationDate: quotationDate || Date.now(),
      validUntil,
      items: populatedItems,
      subtotal,
      discount: totalDiscount,
      discountType: discountType || 'fixed',
      tax: totalTax,
      taxRate: taxRate || 10,
      deliveryCost,
      grandTotal,
      notes,
      terms,
      status: status || 'draft',
      createdBy: req.user.id,
    });

    // Populate references
    await quotation.populate('createdBy', 'name email');
    await quotation.populate('items.product', 'name sku');

    let emailSent = false;
    let emailError = null;
    if (shouldSendEmail) {
      try {
        const emailPayload = buildQuotationEmail(quotation);
        await sendEmail({
          to: quotation.customerEmail,
          subject: emailPayload.subject,
          text: emailPayload.text,
          html: emailPayload.html,
        });
        emailSent = true;

        if (quotation.status === 'draft') {
          quotation.status = 'sent';
          await quotation.save();
          await quotation.populate('createdBy', 'name email');
          await quotation.populate('items.product', 'name sku');
        }
      } catch (error) {
        const parts = [
          error?.message || 'Failed to send quotation email',
          error?.code ? `code=${error.code}` : '',
          error?.command ? `command=${error.command}` : '',
          error?.responseCode ? `responseCode=${error.responseCode}` : '',
        ].filter(Boolean);
        emailError = parts.join(' | ');
      }
    }

    res.status(201).json({
      success: true,
      message:
        shouldSendEmail && !emailSent
          ? 'Quotation created, but email could not be sent'
          : undefined,
      quotation,
      emailSent,
      emailError,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update quotation
// @route   PUT /api/quotations/:id
// @access  Private
exports.updateQuotation = async (req, res) => {
  try {
    let quotation = await Quotation.findById(req.params.id);

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found',
      });
    }

    // Check if already converted
    if (quotation.status === 'converted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update converted quotation',
      });
    }

    const {
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      quotationDate,
      validUntil,
      items,
      discount,
      discountType,
      taxRate,
      notes,
      terms,
      status,
    } = req.body;

    const nextStatus = status || quotation.status;

    if (status === 'converted') {
      return res.status(400).json({
        success: false,
        message:
          'Cannot set quotation status to converted directly. Use the convert action to create an invoice.',
      });
    }

    const shouldValidateStock =
      (items && items.length > 0) || (status && isHoldingQuotationStatus(nextStatus));
    let validatedProductMap = null;

    if (shouldValidateStock) {
      const itemsToValidate = items && items.length > 0 ? items : quotation.items;
      validatedProductMap = await validateStockAndLoadProducts(itemsToValidate, {
        excludeQuotationId: quotation._id,
      });
    }

    // If items are being updated, recalculate totals
    if (items && items.length > 0) {
      const productMap =
        validatedProductMap ||
        (await validateStockAndLoadProducts(items, {
          excludeQuotationId: quotation._id,
        }));
      const populatedItems = [];
      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      for (const item of items) {
        const product = productMap.get(String(item.product));

        const built = buildQuotationItem(product, item);
        populatedItems.push(built.populated);
        subtotal += built.base;
        totalDiscount += built.discountAmount;
        totalTax += built.taxAmount;
      }

      const grandTotal = calculateQuotationGrandTotal({
        subtotal,
        discount: totalDiscount,
        tax: totalTax,
        deliveryCost: DEFAULT_DELIVERY_COST,
      });

      quotation.items = populatedItems;
      quotation.subtotal = subtotal;
      quotation.discount = totalDiscount;
      quotation.discountType = discountType || quotation.discountType;
      quotation.tax = totalTax;
      quotation.taxRate = taxRate || quotation.taxRate;
      quotation.deliveryCost = DEFAULT_DELIVERY_COST;
      quotation.grandTotal = grandTotal;
    }

    // Update other fields
    if (customerName) quotation.customerName = customerName;
    if (customerPhone !== undefined) quotation.customerPhone = customerPhone;
    if (customerEmail !== undefined) quotation.customerEmail = customerEmail;
    if (customerAddress !== undefined) quotation.customerAddress = customerAddress;
    if (quotationDate) quotation.quotationDate = quotationDate;
    if (validUntil !== undefined) quotation.validUntil = validUntil;
    if (notes !== undefined) quotation.notes = notes;
    if (terms !== undefined) quotation.terms = terms;
    if (status) quotation.status = status;

    quotation.deliveryCost = normalizeDeliveryCost(quotation.deliveryCost);
    quotation.grandTotal = calculateQuotationGrandTotal({
      subtotal: quotation.subtotal,
      discount: quotation.discount,
      tax: quotation.tax,
      deliveryCost: quotation.deliveryCost,
    });

    await quotation.save();

    // Populate references
    await quotation.populate('createdBy', 'name email');
    await quotation.populate('items.product', 'name sku');

    res.status(200).json({
      success: true,
      quotation,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete quotation
// @route   DELETE /api/quotations/:id
// @access  Private
exports.deleteQuotation = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id);

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found',
      });
    }

    // If converted, unlink the invoice so it stays but no longer references this quotation
    if (quotation.status === 'converted' && quotation.invoiceId) {
      await Invoice.findByIdAndUpdate(quotation.invoiceId, { $unset: { quotation: 1 } });
    }

    await quotation.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Quotation deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Convert quotation to invoice
// @route   POST /api/quotations/:id/convert
// @access  Private
exports.convertToInvoice = async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .populate('items.product', 'name sku');

    if (!quotation) {
      return res.status(404).json({
        success: false,
        message: 'Quotation not found',
      });
    }

    if (
      quotation.status === 'converted' &&
      (quotation.convertedToInvoice || quotation.invoiceId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Quotation already converted to invoice',
      });
    }

    const statusForConversion =
      quotation.status === 'converted' ? 'accepted' : quotation.status;

    if (!isConvertibleQuotationStatus(statusForConversion)) {
      return res.status(400).json({
        success: false,
        message: `Cannot convert quotation in "${quotation.status}" status. Set it to accepted first.`,
      });
    }

    // Build invoice items (product may be ObjectId or populated)
    const invoiceItems = quotation.items.map((item) => ({
      product: item.product._id || item.product,
      productName: item.productName || (item.product && item.product.name) || 'Product',
      unitType: item.unitType || 'Box',
      quantity: item.quantity,
      rate: item.rate,
      discountPercent: item.discountPercent || 0,
      taxPercent: item.taxPercent || 0,
      lineTotal: item.lineTotal,
      coverageSqm: item.coverageSqm,
    }));

    // Reduce only own stock and ignore this quotation's own reservation while converting.
    await consumeOwnStockForItems(invoiceItems, { excludeQuotationId: quotation._id });

    // Create actual Invoice from quotation data
    const invoice = await Invoice.create({
      quotation: quotation._id,
      customerName: quotation.customerName,
      customerPhone: quotation.customerPhone,
      customerEmail: quotation.customerEmail,
      customerAddress: quotation.customerAddress,
      invoiceDate: quotation.quotationDate || new Date(),
      dueDate: quotation.validUntil,
      items: invoiceItems,
      // Quotation line items already include discount and tax in lineTotal.
      // Keep invoice-level discount/tax neutral to prevent double-application.
      discount: 0,
      discountType: 'fixed',
      taxRate: 0,
      deliveryCost: normalizeDeliveryCost(quotation.deliveryCost),
      notes: quotation.notes,
      terms: quotation.terms,
      status: 'confirmed',
      createdBy: req.user.id,
    });

    // Mark quotation as converted and link to invoice
    quotation.status = 'converted';
    quotation.convertedToInvoice = true;
    quotation.invoiceId = invoice._id;
    await quotation.save();

    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku')
      .populate('quotation', 'quotationNumber');

    res.status(200).json({
      success: true,
      message: 'Quotation converted to invoice successfully',
      quotation,
      invoice: populatedInvoice,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get quotation statistics
// @route   GET /api/quotations/stats/summary
// @access  Private
exports.getQuotationStats = async (req, res) => {
  try {
    const totalQuotations = await Quotation.countDocuments();
    
    const stats = await Quotation.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$grandTotal' },
        },
      },
    ]);

    const statusStats = {
      draft: { count: 0, totalValue: 0 },
      sent: { count: 0, totalValue: 0 },
      accepted: { count: 0, totalValue: 0 },
      rejected: { count: 0, totalValue: 0 },
      converted: { count: 0, totalValue: 0 },
      expired: { count: 0, totalValue: 0 },
      cancelled: { count: 0, totalValue: 0 },
    };

    stats.forEach((stat) => {
      if (statusStats[stat._id]) {
        statusStats[stat._id] = {
          count: stat.count,
          totalValue: stat.totalValue,
        };
      }
    });

    const totalValue = stats.reduce((sum, stat) => sum + stat.totalValue, 0);

    res.status(200).json({
      success: true,
      stats: {
        total: totalQuotations,
        totalValue,
        byStatus: statusStats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
