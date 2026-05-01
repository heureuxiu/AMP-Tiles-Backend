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

function getDeliveryAddress(source) {
  return String(source?.deliveryAddress || source?.customerAddress || '').trim();
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

const DEFAULT_DELIVERY_COST = 0;
const DELIVERY_GST_RATE = 10;
const COMPANY_NAME = 'AMP TILES PTY LTD';

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeDeliveryCost(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_DELIVERY_COST;
  return roundMoney(numeric);
}

function calculateDeliveryGst(deliveryCost) {
  const normalizedDeliveryCost = normalizeDeliveryCost(deliveryCost);
  return roundMoney((normalizedDeliveryCost * DELIVERY_GST_RATE) / 100);
}

function calculateQuotationGrandTotal({ subtotal, discount, tax, deliveryCost }) {
  const normalizedDeliveryCost = normalizeDeliveryCost(deliveryCost);
  const deliveryGst = calculateDeliveryGst(normalizedDeliveryCost);
  return roundMoney(
    (Number(subtotal) || 0) -
      (Number(discount) || 0) +
      (Number(tax) || 0) +
      normalizedDeliveryCost +
      deliveryGst
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
  const deliveryGst = calculateDeliveryGst(deliveryCost);
  const grandTotal = Number.isFinite(Number(quotation?.grandTotal))
    ? Number(quotation.grandTotal)
    : baseTotal + deliveryCost + deliveryGst;

  return {
    subtotal: roundMoney(subtotal),
    discount: roundMoney(discount),
    tax: roundMoney(tax),
    deliveryCost: roundMoney(deliveryCost),
    deliveryGst: roundMoney(deliveryGst),
    grandTotal: roundMoney(grandTotal),
  };
}

function getQuotationItemDetails(item) {
  const product =
    item && item.product && typeof item.product === 'object' ? item.product : null;
  const productName = item?.productName || product?.name || 'Product';
  const skuRaw = item?.sku ?? product?.sku;
  const descriptionRaw = item?.description ?? product?.description;
  const sizeRaw = product?.size ?? item?.size;
  const unitType = String(item?.unitType || '');
  const normalizedUnit = unitType.toLowerCase();
  const coverageSqm = Number(item?.coverageSqm);
  let displayQuantity = formatQuantity(item?.quantity);
  if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
    if (
      normalizedUnit.includes('sqft') ||
      normalizedUnit.includes('sq ft') ||
      normalizedUnit.includes('sqfeet')
    ) {
      displayQuantity = formatQuantity(coverageSqm * SQFT_PER_SQM);
    } else if (
      normalizedUnit.includes('sqm') ||
      normalizedUnit.includes('sq meter') ||
      normalizedUnit.includes('sqmetre')
    ) {
      displayQuantity = formatQuantity(coverageSqm);
    }
  }

  return {
    productName,
    sku: skuRaw ? String(skuRaw) : 'N/A',
    description: descriptionRaw ? String(descriptionRaw) : 'N/A',
    size: sizeRaw ? String(sizeRaw) : 'N/A',
    unit: unitType || 'N/A',
    quantity: displayQuantity,
    rate: Number(item?.rate) || 0,
    amount: Number(item?.lineTotal) || 0,
  };
}

function buildFallbackQuotationEmail(quotation) {
  const quoteNo = quotation.quotationNumber || String(quotation._id || '');
  const customerName = quotation.customerName || 'Customer';
  const deliveryAddress = getDeliveryAddress(quotation);
  const quoteDate = formatDate(quotation.quotationDate);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : 'N/A';
  const amounts = getQuotationAmountSnapshot(quotation);
  const grandTotal = formatCurrency(amounts.grandTotal);

  const rowsHtml = (quotation.items || [])
    .map((item) => {
      const details = getQuotationItemDetails(item);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.productName)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.sku)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.description)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.size)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.unit)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${details.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.rate)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.amount)}</td>
      </tr>`;
    })
    .join('');
  const totalsRowsHtml = [
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Subtotal</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.subtotal))}</td>
    </tr>`,
    amounts.discount > 0
      ? `<tr>
          <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Discount</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">-${escapeHtml(formatCurrency(amounts.discount))}</td>
        </tr>`
      : '',
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Tax (GST)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.tax))}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery Cost</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.deliveryCost))}</td>
    </tr>`,
    amounts.deliveryGst > 0
      ? `<tr>
          <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery GST (${DELIVERY_GST_RATE}%)</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.deliveryGst))}</td>
        </tr>`
      : '',
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Grand Total</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">${escapeHtml(grandTotal)}</td>
    </tr>`,
  ]
    .filter(Boolean)
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
    deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
    `Subtotal: ${formatCurrency(amounts.subtotal)}`,
    amounts.discount > 0 ? `Discount: -${formatCurrency(amounts.discount)}` : '',
    amounts.tax > 0 ? `Tax (GST): ${formatCurrency(amounts.tax)}` : '',
    `Delivery Cost: ${formatCurrency(amounts.deliveryCost)}`,
    amounts.deliveryGst > 0
      ? `Delivery GST (${DELIVERY_GST_RATE}%): ${formatCurrency(amounts.deliveryGst)}`
      : '',
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(quotation.items || []).map((item) => {
      const details = getQuotationItemDetails(item);
      return `- ${details.productName} | SKU: ${details.sku} | Desc: ${details.description} | Size: ${details.size} | Unit: ${details.unit} | Qty: ${details.quantity} | Rate: ${formatCurrency(details.rate)} | Amount: ${formatCurrency(details.amount)}`;
    }),
    '',
    'Please see attached quotation PDF for your records.',
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
        ${
          deliveryAddress
            ? `<strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress)}<br/>`
            : ''
        }
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
        ${
          amounts.deliveryGst > 0
            ? `<strong>Delivery GST (${DELIVERY_GST_RATE}%):</strong> ${escapeHtml(formatCurrency(amounts.deliveryGst))}<br/>`
            : ''
        }
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Product</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">SKU</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Description</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Size</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Unit</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Rate</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}${totalsRowsHtml}</tbody>
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

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function parseEmailList(values) {
  const rawValues = Array.isArray(values) ? values : [values];
  const normalized = [];
  const seen = new Set();

  for (const rawValue of rawValues) {
    const parts = String(rawValue || '')
      .split(/[,\n;\s]+/g)
      .map((part) => normalizeEmail(part))
      .filter(Boolean);

    for (const email of parts) {
      if (seen.has(email)) continue;
      seen.add(email);
      normalized.push(email);
    }
  }

  return normalized;
}

function summarizeEmailError(error, fallbackMessage = 'Failed to send quotation email') {
  return [
    error?.message || fallbackMessage,
    error?.code ? `code=${error.code}` : '',
    error?.command ? `command=${error.command}` : '',
    error?.responseCode ? `responseCode=${error.responseCode}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

async function sendQuotationEmailWithAttachment(quotationDoc, options = {}) {
  const quotation = quotationDoc?.toObject ? quotationDoc.toObject() : quotationDoc;
  if (!quotation) {
    const error = new Error('Quotation not found');
    error.statusCode = 404;
    throw error;
  }

  const overrideTo = normalizeEmail(options.toEmail);
  const customerEmail = overrideTo || normalizeEmail(quotation.customerEmail);
  if (!customerEmail) {
    const error = new Error(
      'Customer email is missing. Please add customer email before sending quotation.'
    );
    error.statusCode = 400;
    throw error;
  }
  const ccEmails = parseEmailList(options.ccEmails);

  const pdfBuffer = await generateQuotationPdf(quotation);
  const emailPayload = buildQuotationEmail(quotation);
  const quoteRef = String(quotation.quotationNumber || quotation._id || 'quotation').replace(
    /\s/g,
    '-'
  );

  await sendEmail({
    to: customerEmail,
    cc: ccEmails.length > 0 ? ccEmails.join(', ') : undefined,
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    attachments: [
      {
        filename: `quotation-${quoteRef}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return {
    customerEmail,
    ccEmails,
    emailPayload,
  };
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
      .populate('items.product', 'name sku description size')
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
      .populate('items.product', 'name sku description size image price unit')
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
      .populate('items.product', 'name sku description size');

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

    const customerEmail = normalizeEmail(quotation.customerEmail);
    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message:
          'Customer email is missing. Please add customer email before sending quotation.',
      });
    }

    const ccEmails = parseEmailList(quotation.customerCcEmails || []);
    await sendQuotationEmailWithAttachment(quotation, {
      toEmail: customerEmail,
      ccEmails,
    });

    if (quotation.status !== 'sent') {
      quotation.status = 'sent';
      await quotation.save();
      await quotation.populate('createdBy', 'name email');
      await quotation.populate('items.product', 'name sku description size');
    }

    res.status(200).json({
      success: true,
      emailSent: true,
      message: `Quotation sent to ${customerEmail}${
        ccEmails.length > 0 ? ` (cc: ${ccEmails.join(', ')})` : ''
      }`,
      quotation,
    });
  } catch (error) {
    const details = summarizeEmailError(error);
    console.error('Send quotation email error:', error);
    res.status(error.statusCode || 500).json({
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
      .populate('items.product', 'name sku description size')
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

function getTilesPerBox(product) {
  const tilesPerBox = Number(product.tilesPerBox) || 0;
  return tilesPerBox > 0 ? tilesPerBox : 0;
}

function getSqmPerPiece(product) {
  const sqmPerBox = getSqmPerBox(product);
  const tilesPerBox = getTilesPerBox(product);
  if (sqmPerBox <= 0 || tilesPerBox <= 0) return 0;
  return sqmPerBox / tilesPerBox;
}

function getDefaultRatePerSqm(product) {
  const baseRate = Number(product?.retailPrice ?? product?.price);
  if (!Number.isFinite(baseRate) || baseRate < 0) return 0;

  const pricingUnit = product?.pricingUnit || 'per_box';
  if (pricingUnit === 'per_sqm') return baseRate;
  if (pricingUnit === 'per_sqft') return baseRate * SQFT_PER_SQM;

  const sqmPerBox = getSqmPerBox(product);
  if (pricingUnit === 'per_box') {
    return sqmPerBox > 0 ? baseRate / sqmPerBox : baseRate;
  }

  const sqmPerPiece = getSqmPerPiece(product);
  if (pricingUnit === 'per_piece') {
    return sqmPerPiece > 0 ? baseRate / sqmPerPiece : baseRate;
  }

  return baseRate;
}

function resolveQuotationRatePerSqm(product, item) {
  const rawRate = item?.rate;
  const parsedRate = Number(rawRate);
  if (
    rawRate !== undefined &&
    rawRate !== null &&
    rawRate !== '' &&
    Number.isFinite(parsedRate) &&
    parsedRate >= 0
  ) {
    return parsedRate;
  }
  return getDefaultRatePerSqm(product);
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
  const sqmPerPiece = getSqmPerPiece(product);

  if (itemUnit === 'box') {
    return sqmPerBox > 0 ? quantity * sqmPerBox : quantity;
  }
  if (itemUnit === 'sqm') {
    return quantity;
  }
  if (itemUnit === 'sqft') {
    return quantity / SQFT_PER_SQM;
  }
  if (itemUnit === 'piece') {
    return sqmPerPiece > 0 ? quantity * sqmPerPiece : quantity;
  }
  return null;
}

function getItemStockDemand(product, item) {
  const quantity = Number(item.quantity) || 0;
  const coverageSqm = getItemCoverageSqm(product, item);
  if (coverageSqm == null) {
    return quantity;
  }

  const stockUnit = normalizeStockUnit(product.unit, product.pricingUnit);
  if (stockUnit === 'sqm') {
    return coverageSqm;
  }
  if (stockUnit === 'sqft') {
    return coverageSqm * SQFT_PER_SQM;
  }

  const sqmPerBox = getSqmPerBox(product);
  if (stockUnit === 'box') {
    if (sqmPerBox > 0) return coverageSqm / sqmPerBox;
    return quantity;
  }

  const sqmPerPiece = getSqmPerPiece(product);
  if (stockUnit === 'piece') {
    if (sqmPerPiece > 0) return coverageSqm / sqmPerPiece;
    return quantity;
  }

  return quantity;
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

// Helper to build one quotation item with canonical sqm quantity and configurable tax
function buildQuotationItem(product, item) {
  const rate = resolveQuotationRatePerSqm(product, item);
  const discountPercent = 0;
  const taxPercent =
    item.taxPercent != null && item.taxPercent !== ''
      ? Number(item.taxPercent)
      : 10;
  const quantitySqm = roundQty(Math.max(0, Number(getItemCoverageSqm(product, item)) || 0));
  const base = quantitySqm * rate;
  const discountAmount = 0;
  const taxAmount = (base * taxPercent) / 100;
  const lineTotal = Math.round((base + taxAmount) * 100) / 100;

  return {
    populated: {
      product: product._id,
      productName: product.name,
      size: String(product.size ?? item.size ?? ''),
      unitType: 'Sq Meter',
      quantity: quantitySqm,
      rate,
      discountPercent,
      taxPercent,
      lineTotal,
      coverageSqm: quantitySqm,
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
      deliveryAddress,
      reference,
      quotationDate,
      validUntil,
      items,
      discount,
      discountType,
      taxRate,
      deliveryCost,
      notes,
      terms,
      status,
      sendEmail: shouldSendEmail,
      customerEmails,
      customerCcEmails,
    } = req.body;

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one item',
      });
    }

    const normalizedPrimaryEmail = normalizeEmail(customerEmail);
    const normalizedCustomerEmails = parseEmailList([
      normalizedPrimaryEmail,
      customerEmails,
      customerCcEmails,
    ]);

    if (shouldSendEmail && normalizedCustomerEmails.length === 0) {
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

    const normalizedDeliveryCost = normalizeDeliveryCost(deliveryCost);
    const grandTotal = calculateQuotationGrandTotal({
      subtotal,
      discount: totalDiscount,
      tax: totalTax,
      deliveryCost: normalizedDeliveryCost,
    });

    const primaryEmail = normalizedPrimaryEmail || normalizedCustomerEmails[0] || undefined;
    const ccEmails = normalizedCustomerEmails.filter((email) => email !== primaryEmail);

    const quotation = await Quotation.create({
      customerName,
      customerPhone,
      customerEmail: primaryEmail,
      customerCcEmails: ccEmails,
      customerAddress,
      deliveryAddress: String(deliveryAddress || customerAddress || '').trim() || undefined,
      reference: String(reference || '').trim() || undefined,
      quotationDate: quotationDate || Date.now(),
      validUntil,
      items: populatedItems,
      subtotal,
      discount: totalDiscount,
      discountType: discountType || 'fixed',
      tax: totalTax,
      taxRate:
        taxRate !== undefined && taxRate !== null && taxRate !== ''
          ? taxRate
          : 10,
      deliveryCost: normalizedDeliveryCost,
      grandTotal,
      notes,
      terms,
      status: status || 'draft',
      createdBy: req.user.id,
    });

    await quotation.populate('createdBy', 'name email');
    await quotation.populate('items.product', 'name sku description size');

    let emailSent = false;
    let emailError = null;

    if (shouldSendEmail) {
      try {
        await sendQuotationEmailWithAttachment(quotation, {
          toEmail: primaryEmail,
          ccEmails,
        });
        emailSent = true;

        if (quotation.status === 'draft') {
          quotation.status = 'sent';
          await quotation.save();
          await quotation.populate('createdBy', 'name email');
          await quotation.populate('items.product', 'name sku description size');
        }
      } catch (error) {
        emailError = summarizeEmailError(error);
      }
    }

    res.status(201).json({
      success: true,
      message: shouldSendEmail
        ? emailSent
          ? `Quotation created and emailed to ${primaryEmail}${
              ccEmails.length > 0 ? ` (cc: ${ccEmails.join(', ')})` : ''
            }.`
          : 'Quotation created, but email could not be sent.'
        : undefined,
      quotation,
      quotations: [quotation],
      emailSent,
      emailError,
      emailStats: shouldSendEmail
        ? {
            total: 1,
            sent: emailSent ? 1 : 0,
            failed: emailSent ? 0 : 1,
            recipients: {
              to: primaryEmail || null,
              cc: ccEmails,
            },
            failures: emailSent
              ? []
              : [
                  {
                    email: primaryEmail || '',
                    error: emailError || 'Failed to send quotation email',
                  },
                ],
          }
        : undefined,
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
      deliveryAddress,
      reference,
      quotationDate,
      validUntil,
      items,
      discount,
      discountType,
      taxRate,
      deliveryCost,
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
        deliveryCost:
          deliveryCost !== undefined ? deliveryCost : quotation.deliveryCost,
      });

      quotation.items = populatedItems;
      quotation.subtotal = subtotal;
      quotation.discount = totalDiscount;
      quotation.discountType = discountType || quotation.discountType;
      quotation.tax = totalTax;
      if (taxRate !== undefined && taxRate !== null && taxRate !== '') {
        quotation.taxRate = taxRate;
      }
      quotation.grandTotal = grandTotal;
    }

    // Update other fields
    if (customerName) quotation.customerName = customerName;
    if (customerPhone !== undefined) quotation.customerPhone = customerPhone;
    if (customerEmail !== undefined) quotation.customerEmail = customerEmail;
    if (customerCcEmails !== undefined) {
      const effectivePrimaryEmail = normalizeEmail(
        customerEmail !== undefined ? customerEmail : quotation.customerEmail
      );
      quotation.customerCcEmails = parseEmailList(customerCcEmails).filter(
        (email) => email !== effectivePrimaryEmail
      );
    }
    if (customerAddress !== undefined) quotation.customerAddress = customerAddress;
    if (deliveryAddress !== undefined) quotation.deliveryAddress = deliveryAddress;
    if (reference !== undefined) {
      quotation.reference = String(reference || '').trim() || undefined;
    }
    if (quotationDate) quotation.quotationDate = quotationDate;
    if (validUntil !== undefined) quotation.validUntil = validUntil;
    if (notes !== undefined) quotation.notes = notes;
    if (terms !== undefined) quotation.terms = terms;
    if (deliveryCost !== undefined) {
      quotation.deliveryCost = normalizeDeliveryCost(deliveryCost);
    }
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
    await quotation.populate('items.product', 'name sku description size');

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
      .populate('items.product', 'name sku description size');

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
      size:
        (item.product && typeof item.product === 'object' ? item.product.size : '') ||
        item.size ||
        '',
      unitType: item.unitType || 'Sq Meter',
      quantity: item.quantity,
      rate: item.rate,
      discountPercent: item.discountPercent || 0,
      taxPercent: item.taxPercent ?? 10,
      lineTotal: item.lineTotal,
      coverageSqm: item.coverageSqm,
    }));

    // Reduce only own stock and ignore this quotation's own reservation while converting.
    await consumeOwnStockForItems(invoiceItems, { excludeQuotationId: quotation._id });

    // Create actual Invoice from quotation data
    const invoice = await Invoice.create({
      quotation: quotation._id,
      reference: String(quotation.reference || '').trim() || undefined,
      customerName: quotation.customerName,
      customerPhone: quotation.customerPhone,
      customerEmail: quotation.customerEmail,
      customerCcEmails: parseEmailList(quotation.customerCcEmails || []).filter(
        (email) => email !== normalizeEmail(quotation.customerEmail)
      ),
      customerAddress: quotation.customerAddress,
      deliveryAddress: getDeliveryAddress(quotation) || undefined,
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
      .populate('items.product', 'name sku description size')
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


