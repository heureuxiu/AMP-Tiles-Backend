const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Quotation = require('../models/Quotation');
const StockTransaction = require('../models/StockTransaction');
const { generateInvoicePdf } = require('../utils/invoicePdf');

let sendEmail = async () => {
  throw new Error('Email service is not available');
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackFormatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fallbackFormatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num);
}

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function getDeliveryAddress(source) {
  return String(source?.deliveryAddress || source?.customerAddress || '').trim();
}

const DEFAULT_DELIVERY_COST = 0;
const COMPANY_NAME = 'AMP TILES PTY LTD';
const SQFT_PER_SQM = 10.764;

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

function getDisplayQuantity(item) {
  const unitType = String(item?.unitType || '').toLowerCase();
  const coverageSqm = Number(item?.coverageSqm);
  if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
    if (
      unitType.includes('sqft') ||
      unitType.includes('sq ft') ||
      unitType.includes('sqfeet')
    ) {
      return formatQuantity(coverageSqm * SQFT_PER_SQM);
    }
    if (
      unitType.includes('sqm') ||
      unitType.includes('sq meter') ||
      unitType.includes('sqmetre')
    ) {
      return formatQuantity(coverageSqm);
    }
  }
  return formatQuantity(item?.quantity ?? 0);
}

function normalizeDeliveryCost(value, fallback = DEFAULT_DELIVERY_COST) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return roundMoney(fallback);
  return roundMoney(numeric);
}

function getInvoiceAmountSnapshot(invoice) {
  const subtotal = Number(invoice?.subtotal) || 0;
  const discountAmount = Number(invoice?.discountAmount ?? invoice?.discount) || 0;
  const taxAmount = Number(invoice?.tax) || 0;
  const baseTotal = subtotal - discountAmount + taxAmount;
  const parsedDelivery = Number(invoice?.deliveryCost);
  const fallbackDelivery = Math.max(0, Math.round((Number(invoice?.grandTotal) - baseTotal) * 100) / 100);
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : DEFAULT_DELIVERY_COST;
  const grandTotal = Number.isFinite(Number(invoice?.grandTotal))
    ? Number(invoice.grandTotal)
    : baseTotal + deliveryCost;

  return {
    subtotal,
    discountAmount,
    taxAmount,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

function getInvoiceItemDetails(item) {
  const product =
    item && item.product && typeof item.product === 'object' ? item.product : null;
  const productName = item?.productName || product?.name || 'Product';
  const skuRaw = item?.sku ?? product?.sku;
  const descriptionRaw = item?.description ?? product?.description;
  const sizeRaw = product?.size ?? item?.size;

  return {
    productName,
    sku: skuRaw ? String(skuRaw) : 'N/A',
    description: descriptionRaw ? String(descriptionRaw) : 'N/A',
    size: sizeRaw ? String(sizeRaw) : 'N/A',
    unit: item?.unitType || 'N/A',
    quantity: getDisplayQuantity(item),
    rate: Number(item?.rate) || 0,
    amount: Number(item?.lineTotal) || 0,
  };
}

function buildFallbackInvoiceEmail(invoice) {
  const invoiceNo = invoice.invoiceNumber || String(invoice._id || '');
  const customerName = invoice.customerName || 'Customer';
  const deliveryAddress = getDeliveryAddress(invoice);
  const amounts = getInvoiceAmountSnapshot(invoice);
  const grandTotalCents = Math.max(0, toCents(amounts.grandTotal));
  const paidCents = Math.max(0, Math.min(grandTotalCents, toCents(invoice.amountPaid)));
  const remainingCents = Math.max(0, grandTotalCents - paidCents);
  const isFinalReceipt = grandTotalCents > 0 && remainingCents === 0;

  const subject = isFinalReceipt
    ? `Payment received in full for Invoice ${invoiceNo}`
    : `Updated Invoice ${invoiceNo} from ${COMPANY_NAME}`;

  const rowsHtml = (invoice.items || [])
    .map((item) => {
      const details = getInvoiceItemDetails(item);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.productName)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.sku)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.description)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.size)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.unit)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${details.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${fallbackFormatCurrency(details.rate)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${fallbackFormatCurrency(details.amount)}</td>
      </tr>`;
    })
    .join('');
  const totalsRowsHtml = [
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Subtotal</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${fallbackFormatCurrency(amounts.subtotal)}</td>
    </tr>`,
    amounts.discountAmount > 0
      ? `<tr>
          <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Discount</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">-${fallbackFormatCurrency(amounts.discountAmount)}</td>
        </tr>`
      : '',
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Tax (GST)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${fallbackFormatCurrency(amounts.taxAmount)}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery Cost</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${fallbackFormatCurrency(amounts.deliveryCost)}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Grand Total</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">${fallbackFormatCurrency(amounts.grandTotal)}</td>
    </tr>`,
  ]
    .filter(Boolean)
    .join('');

  const text = [
    `Invoice ${invoiceNo}`,
    `Dear ${customerName},`,
    '',
    isFinalReceipt
      ? 'Thank you. We confirm this invoice is now fully paid.'
      : 'Please find your latest updated invoice and payment status below.',
    '',
    `Invoice Date: ${fallbackFormatDate(invoice.invoiceDate)}`,
    `Due Date: ${invoice.dueDate ? fallbackFormatDate(invoice.dueDate) : 'N/A'}`,
    deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
    `Subtotal: ${fallbackFormatCurrency(amounts.subtotal)}`,
    amounts.discountAmount > 0 ? `Discount: -${fallbackFormatCurrency(amounts.discountAmount)}` : '',
    amounts.taxAmount > 0 ? `Tax (GST): ${fallbackFormatCurrency(amounts.taxAmount)}` : '',
    `Delivery Cost: ${fallbackFormatCurrency(amounts.deliveryCost)}`,
    `Grand Total: ${fallbackFormatCurrency(amounts.grandTotal)}`,
    `Amount Received: ${fallbackFormatCurrency(paidCents / 100)}`,
    `Outstanding: ${fallbackFormatCurrency(remainingCents / 100)}`,
    '',
    'Items:',
    ...(invoice.items || []).map((item) => {
      const details = getInvoiceItemDetails(item);
      return `- ${details.productName} | SKU: ${details.sku} | Desc: ${details.description} | Size: ${details.size} | Unit: ${details.unit} | Qty: ${details.quantity} | Rate: ${fallbackFormatCurrency(details.rate)} | Amount: ${fallbackFormatCurrency(details.amount)}`;
    }),
    '',
    'Please see attached invoice PDF for your records.',
    '',
    'Thank you,',
    COMPANY_NAME,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <h2>Invoice ${invoiceNo}</h2>
      <p>Dear ${customerName},</p>
      <p>${
        isFinalReceipt
          ? 'Thank you. We confirm this invoice is now fully paid.'
          : 'Please find your latest updated invoice and payment status below.'
      }</p>
      <p>
        <strong>Invoice Date:</strong> ${fallbackFormatDate(invoice.invoiceDate)}<br/>
        <strong>Due Date:</strong> ${
          invoice.dueDate ? fallbackFormatDate(invoice.dueDate) : 'N/A'
        }<br/>
        ${
          deliveryAddress
            ? `<strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress)}<br/>`
            : ''
        }
        <strong>Subtotal:</strong> ${fallbackFormatCurrency(amounts.subtotal)}<br/>
        ${
          amounts.discountAmount > 0
            ? `<strong>Discount:</strong> -${fallbackFormatCurrency(amounts.discountAmount)}<br/>`
            : ''
        }
        ${
          amounts.taxAmount > 0
            ? `<strong>Tax (GST):</strong> ${fallbackFormatCurrency(amounts.taxAmount)}<br/>`
            : ''
        }
        <strong>Delivery Cost:</strong> ${fallbackFormatCurrency(amounts.deliveryCost)}<br/>
        <strong>Grand Total:</strong> ${fallbackFormatCurrency(amounts.grandTotal)}<br/>
        <strong>Amount Received:</strong> ${fallbackFormatCurrency(paidCents / 100)}<br/>
        <strong>Outstanding:</strong> ${fallbackFormatCurrency(remainingCents / 100)}
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

      <p>Thank you,<br/>${COMPANY_NAME}</p>
    </div>
  `;

  return {
    subject,
    text,
    html,
    isFinalReceipt,
  };
}

let buildInvoiceEmail = buildFallbackInvoiceEmail;

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
  console.warn('Mailer utility not found. Invoice email sending will be disabled.');
}

const invoiceEmailModule = loadOptionalModule([
  '../utils/invoiceEmail',
  '../utils/invoice-email',
  '../utils/InvoiceEmail',
]);
if (invoiceEmailModule && typeof invoiceEmailModule.buildInvoiceEmail === 'function') {
  ({ buildInvoiceEmail } = invoiceEmailModule);
} else if (process.env.NODE_ENV !== 'production') {
  console.warn('Invoice email template utility not found. Using fallback template.');
}

const HOLDING_QUOTATION_STATUSES = ['sent', 'accepted'];

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function pickFirstFiniteNumber(values, fallback = 0) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function roundMoney(value) {
  return Math.round(pickFirstFiniteNumber([value], 0) * 100) / 100;
}

function formatStockQty(value) {
  const rounded = roundQty(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

function normalizeCoverageUnit(rawUnit, pricingUnit) {
  const normalized = String(rawUnit || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

  if (
    normalized.includes('sqm') ||
    normalized.includes('sqmeter') ||
    normalized.includes('sqmetre') ||
    normalized.includes('m2')
  ) {
    return 'sqm';
  }

  if (
    normalized.includes('sqft') ||
    normalized.includes('sqfeet') ||
    normalized.includes('ft2')
  ) {
    return 'sqft';
  }

  if (pricingUnit === 'per_sqm') return 'sqm';
  if (pricingUnit === 'per_sqft') return 'sqft';
  return 'sqft';
}

function normalizeStockUnit(rawUnit, pricingUnit) {
  const normalized = String(rawUnit || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

  if (
    normalized.includes('sqm') ||
    normalized.includes('sqmeter') ||
    normalized.includes('sqmetre') ||
    normalized.includes('m2')
  ) {
    return 'sqm';
  }
  if (
    normalized.includes('sqft') ||
    normalized.includes('sqfeet') ||
    normalized.includes('ft2')
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

  if (
    normalized.includes('sqm') ||
    normalized.includes('sqmeter') ||
    normalized.includes('sqmetre') ||
    normalized.includes('m2')
  ) {
    return 'sqm';
  }
  if (
    normalized.includes('sqft') ||
    normalized.includes('sqfeet') ||
    normalized.includes('ft2')
  ) {
    return 'sqft';
  }
  if (normalized.includes('piece')) return 'piece';
  return 'box';
}

function getSqmPerBox(product) {
  const covPerBox = Number(product.coveragePerBox) || 0;
  if (covPerBox <= 0) return 0;
  const covUnit = normalizeCoverageUnit(product.coveragePerBoxUnit, product.pricingUnit);
  return covUnit === 'sqm' ? covPerBox : covPerBox / SQFT_PER_SQM;
}

function getProductIdFromItem(item) {
  if (!item || !item.product) return '';
  if (typeof item.product === 'object' && item.product._id) {
    return String(item.product._id);
  }
  return String(item.product);
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
  if (stockUnit === 'box' || stockUnit === 'piece') return quantity;

  const coverageSqm = getItemCoverageSqm(product, item);
  if (coverageSqm == null) return quantity;
  if (stockUnit === 'sqm') return coverageSqm;
  return coverageSqm * SQFT_PER_SQM;
}

function getBillableQuantity(product, item) {
  const quantity = pickFirstFiniteNumber([item.quantity], 0);
  const pricingUnit = product.pricingUnit || 'per_box';
  const sqmPerBox = getSqmPerBox(product);
  const coverageSqmFromBoxes = sqmPerBox > 0 ? quantity * sqmPerBox : null;

  if (pricingUnit === 'per_sqm' && coverageSqmFromBoxes != null) {
    return coverageSqmFromBoxes;
  }
  if (pricingUnit === 'per_sqft' && coverageSqmFromBoxes != null) {
    return coverageSqmFromBoxes * SQFT_PER_SQM;
  }
  return quantity;
}

// Build one invoice line item with line total and optional coverage (tiles)
function buildInvoiceItem(product, item) {
  const quantity = pickFirstFiniteNumber([item.quantity], 0);
  const rate = roundMoney(
    pickFirstFiniteNumber([item.rate, product.retailPrice, product.price], 0)
  );
  const discountPercent = pickFirstFiniteNumber([item.discountPercent], 0);
  const taxPercent = pickFirstFiniteNumber([item.taxPercent, product.taxPercent], 10);
  const unitType = item.unitType || 'Box';

  const billableQuantity = getBillableQuantity(product, item);
  const base = billableQuantity * rate;
  const lineTotal = Math.round(base * (1 - discountPercent / 100) * (1 + taxPercent / 100) * 100) / 100;

  const coverageSqm = getItemCoverageSqm(product, {
    quantity,
    unitType,
    coverageSqm: item.coverageSqm,
  });

  return {
    product: product._id,
    productName: product.name,
    size: String(product.size ?? item.size ?? ''),
    unitType,
    quantity,
    rate,
    discountPercent,
    taxPercent,
    lineTotal,
    coverageSqm: coverageSqm != null ? Math.round(coverageSqm * 1000) / 1000 : undefined,
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

function toObjectIds(ids) {
  return ids
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
}

function buildRequestedByProduct(items, productMap) {
  const requestedByProduct = new Map();

  for (const item of items || []) {
    const productId = getProductIdFromItem(item);
    const quantity = Number(item.quantity) || 0;
    if (!productId || quantity <= 0) continue;

    const product = productMap.get(productId);
    if (!product) continue;

    const demand = roundQty(getItemStockDemand(product, item));
    if (demand <= 0) continue;
    requestedByProduct.set(productId, roundQty((requestedByProduct.get(productId) || 0) + demand));
  }

  return requestedByProduct;
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
      heldByProduct.set(productId, roundQty((heldByProduct.get(productId) || 0) + heldDemand));
    }
  }

  return heldByProduct;
}

async function assertStockAvailabilityForItems(items, options = {}) {
  const { excludeQuotationId } = options;
  const requestedProductIds = [];
  for (const item of items || []) {
    const productId = getProductIdFromItem(item);
    const quantity = Number(item.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    requestedProductIds.push(productId);
  }

  if (requestedProductIds.length === 0) {
    return { requestedByProduct: new Map(), productMap: new Map() };
  }

  const uniqueProductIds = Array.from(new Set(requestedProductIds));
  const products = await Product.find({ _id: { $in: uniqueProductIds } });
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  for (const productId of uniqueProductIds) {
    if (!productMap.has(productId)) {
      throw createStockValidationError(`Product not found: ${productId}`, 404);
    }
  }

  const requestedByProduct = buildRequestedByProduct(items, productMap);
  if (requestedByProduct.size === 0) {
    return { requestedByProduct, productMap };
  }

  const heldByProduct = await getHeldQuantitiesByProduct(
    Array.from(requestedByProduct.keys()),
    { excludeQuotationId }
  );

  for (const [productId, requestedQty] of requestedByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product || !isOwnStockProduct(product)) continue;

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

  return { requestedByProduct, productMap };
}

async function createInvoiceStockTransaction({
  productId,
  type,
  quantity,
  previousStock,
  newStock,
  invoice,
  createdBy,
  remarks,
}) {
  if (!createdBy) return;
  const invoiceRef = invoice?.invoiceNumber || String(invoice?._id || '');
  await StockTransaction.create({
    product: productId,
    type,
    quantity,
    previousStock,
    newStock,
    remarks,
    sourceType: 'invoice',
    sourceId: String(invoice?._id || ''),
    sourceRef: invoiceRef,
    createdBy,
  });
}

// Decrease stock for own-stock invoice items (when confirming/delivering)
async function decreaseStockForInvoice(invoice, options = {}) {
  const { actorId } = options;
  const { requestedByProduct, productMap } = await assertStockAvailabilityForItems(invoice.items, options);

  for (const [productId, qty] of requestedByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product || !isOwnStockProduct(product)) continue;
    const previousStock = roundQty(Number(product.stock) || 0);
    const nextStock = roundQty((Number(product.stock) || 0) - qty);
    product.stock = Math.max(0, nextStock);
    // eslint-disable-next-line no-await-in-loop
    await product.save();
    // eslint-disable-next-line no-await-in-loop
    await createInvoiceStockTransaction({
      productId: product._id,
      type: 'stock-out',
      quantity: qty,
      previousStock,
      newStock: product.stock,
      invoice,
      createdBy: actorId,
      remarks: `Invoice ${invoice.invoiceNumber || invoice._id} stock deducted`,
    });
  }
}

// Restore stock when reverting from confirmed/delivered to draft
async function restoreStockForInvoice(invoice, options = {}) {
  const { actorId, reason } = options;
  const productIds = [];
  for (const item of invoice.items || []) {
    const productId = getProductIdFromItem(item);
    const quantity = Number(item.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    productIds.push(productId);
  }
  if (productIds.length === 0) return;

  const uniqueProductIds = Array.from(new Set(productIds));
  const products = await Product.find({ _id: { $in: uniqueProductIds } });
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const requestedByProduct = buildRequestedByProduct(invoice.items, productMap);

  for (const [productId, qty] of requestedByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product || !isOwnStockProduct(product)) continue;
    const previousStock = roundQty(Number(product.stock) || 0);
    product.stock = roundQty((Number(product.stock) || 0) + qty);
    // eslint-disable-next-line no-await-in-loop
    await product.save();
    // eslint-disable-next-line no-await-in-loop
    await createInvoiceStockTransaction({
      productId: product._id,
      type: 'stock-in',
      quantity: qty,
      previousStock,
      newStock: product.stock,
      invoice,
      createdBy: actorId,
      remarks: `Invoice ${invoice.invoiceNumber || invoice._id} stock restored${reason ? ` (${reason})` : ''}`,
    });
  }
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function summarizeEmailError(error, fallbackMessage = 'Failed to send invoice email') {
  return [
    error?.message || fallbackMessage,
    error?.code ? `code=${error.code}` : '',
    error?.command ? `command=${error.command}` : '',
    error?.responseCode ? `responseCode=${error.responseCode}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

async function sendInvoiceEmailWithAttachment(invoiceDoc, options = {}) {
  const invoice = invoiceDoc?.toObject ? invoiceDoc.toObject() : invoiceDoc;
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
  }

  const customerEmail = normalizeEmail(invoice.customerEmail);
  if (!customerEmail) {
    const error = new Error(
      'Customer email is missing. Please add customer email before sending invoice.'
    );
    error.statusCode = 400;
    throw error;
  }

  const pdfBuffer = await generateInvoicePdf(invoice);
  const emailPayload = buildInvoiceEmail(invoice, options);
  const invoiceRef = String(invoice.invoiceNumber || invoice._id || 'invoice').replace(/\s/g, '-');

  await sendEmail({
    to: customerEmail,
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    attachments: [
      {
        filename: `invoice-${invoiceRef}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return {
    customerEmail,
    emailPayload,
  };
}

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const { search, status, startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }
    if (status && status !== 'all') query.status = status;
    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) query.invoiceDate.$gte = new Date(startDate);
      if (endDate) query.invoiceDate.$lte = new Date(endDate);
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    const invoices = await Invoice.find(query)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size retailPrice price coveragePerBox coveragePerBoxUnit')
      .sort(sort);

    // Recompute grandTotal / remainingBalance from line items so stale DB values don't reach the client
    const correctedInvoices = invoices.map(inv => {
      const obj = inv.toObject();
      const items = obj.items || [];
      const txRate = items.length > 0
        ? (Number(items[0].taxPercent) > 0 ? Number(items[0].taxPercent) : 10)
        : (Number(obj.taxRate) > 0 ? Number(obj.taxRate) : 10);
      const itemsPreTax = Math.round(items.reduce((sum, item) => {
        const p = Number(item.taxPercent ?? txRate);
        return sum + (Number(item.lineTotal || 0) / (1 + p / 100));
      }, 0) * 100) / 100;
      const itemsGst = Math.round(items.reduce((sum, item) => {
        const p = Number(item.taxPercent ?? txRate);
        const lt = Number(item.lineTotal || 0);
        return sum + (lt - lt / (1 + p / 100));
      }, 0) * 100) / 100;
      const discountAmount = Number(obj.discountAmount) || 0;
      const deliveryCost = Math.max(0, Number(obj.deliveryCost) || 0);
      const deliveryGst = Math.round(deliveryCost * txRate / 100 * 100) / 100;
      const grandTotal = Math.round((itemsPreTax - discountAmount + itemsGst + deliveryCost + deliveryGst) * 100) / 100;
      const amountPaid = Math.max(0, Number(obj.amountPaid) || 0);
      const remainingBalance = Math.max(0, Math.round((grandTotal - amountPaid) * 100) / 100);
      return { ...obj, grandTotal, remainingBalance };
    });

    const statuses = ['draft', 'confirmed', 'delivered', 'cancelled', 'sent', 'paid', 'overdue'];
    const stats = { total: correctedInvoices.length };
    statuses.forEach(s => {
      stats[s] = correctedInvoices.filter(inv => inv.status === s).length;
    });
    stats.totalRevenue = correctedInvoices
      .filter(inv => inv.paymentStatus === 'paid' || inv.status === 'paid')
      .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
    stats.pendingAmount = correctedInvoices
      .filter(inv => inv.paymentStatus !== 'paid' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + (inv.remainingBalance || inv.grandTotal || 0), 0);

    res.status(200).json({ success: true, count: correctedInvoices.length, stats, invoices: correctedInvoices });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invoices',
      error: error.message,
    });
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
// @access  Private
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size retailPrice price coveragePerBox coveragePerBoxUnit')
      .populate('quotation', 'quotationNumber');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    res.status(200).json({ success: true, invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invoice',
      error: error.message,
    });
  }
};

// @desc    Create new invoice
// @route   POST /api/invoices
// @access  Private
exports.createInvoice = async (req, res) => {
  try {
    const {
      quotation,
      reference,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      deliveryAddress,
      invoiceDate,
      dueDate,
      items,
      discount,
      discountType,
      taxRate,
      deliveryCost,
      notes,
      terms,
      status: reqStatus,
      paymentMethod,
      amountPaid,
      sendEmail: shouldSendEmail,
    } = req.body;

    if (!customerName || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customer name and at least one item',
      });
    }
    if (shouldSendEmail && !normalizeEmail(customerEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is required to send invoice by email',
      });
    }

    const populatedItems = [];
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.product}`,
        });
      }
      populatedItems.push(buildInvoiceItem(product, item));
    }

    const status = reqStatus || 'confirmed';
    const shouldDeductStock = status === 'confirmed' || status === 'delivered';
    const linkedQuotationId = quotation || undefined;
    if (shouldDeductStock) {
      await assertStockAvailabilityForItems(populatedItems, {
        excludeQuotationId: linkedQuotationId,
      });
    }

    const invoice = await Invoice.create({
      quotation: quotation || undefined,
      reference: String(reference || '').trim() || undefined,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      deliveryAddress: String(deliveryAddress || customerAddress || '').trim() || undefined,
      invoiceDate: invoiceDate || Date.now(),
      dueDate,
      items: populatedItems,
      discount: pickFirstFiniteNumber([discount], 0),
      discountType: discountType || 'percentage',
      taxRate: pickFirstFiniteNumber([taxRate], 10),
      deliveryCost: normalizeDeliveryCost(deliveryCost),
      notes,
      terms,
      status,
      paymentMethod: paymentMethod || '',
      amountPaid: pickFirstFiniteNumber([amountPaid], 0),
      createdBy: req.user.id,
    });

    // Stock decrease only when status is confirmed or delivered
    if (shouldDeductStock) {
      await decreaseStockForInvoice(invoice, {
        excludeQuotationId: linkedQuotationId,
        actorId: req.user.id,
      });
    }

    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size')
      .populate('quotation', 'quotationNumber');

    let emailSent = false;
    let emailError = null;
    let responseMessage = 'Invoice created successfully';

    if (shouldSendEmail) {
      try {
        await sendInvoiceEmailWithAttachment(populatedInvoice);
        emailSent = true;
        responseMessage = `Invoice created and emailed to ${normalizeEmail(populatedInvoice.customerEmail)}`;
      } catch (error) {
        emailError = summarizeEmailError(error);
        responseMessage = 'Invoice created, but email could not be sent';
      }
    }

    res.status(201).json({
      success: true,
      message: responseMessage,
      invoice: populatedInvoice,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Server error while creating invoice',
      error: error.message,
    });
  }
};

// @desc    Update invoice
// @route   PUT /api/invoices/:id
// @access  Private
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    if (invoice.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update cancelled invoice',
      });
    }

    const {
      reference,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      deliveryAddress,
      invoiceDate,
      dueDate,
      items,
      discount,
      discountType,
      taxRate,
      deliveryCost,
      notes,
      terms,
      status: newStatus,
      paymentMethod,
      amountPaid,
      sendEmail: shouldSendEmail,
    } = req.body;

    const oldStatus = invoice.status;
    const willConfirmOrDeliver = newStatus === 'confirmed' || newStatus === 'delivered';
    const wasConfirmedOrDelivered = oldStatus === 'confirmed' || oldStatus === 'delivered';

    if (items && items.length > 0 && oldStatus === 'draft') {
      const populatedItems = [];
      for (const item of items) {
        const product = await Product.findById(item.product);
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.product}`,
          });
        }
        populatedItems.push(buildInvoiceItem(product, item));
      }
      invoice.items = populatedItems;
    }

    if (customerName) invoice.customerName = customerName;
    if (customerPhone !== undefined) invoice.customerPhone = customerPhone;
    if (customerEmail !== undefined) invoice.customerEmail = customerEmail;
    if (customerAddress !== undefined) invoice.customerAddress = customerAddress;
    if (deliveryAddress !== undefined) invoice.deliveryAddress = deliveryAddress;
    if (reference !== undefined) {
      invoice.reference = String(reference || '').trim() || undefined;
    }
    if (invoiceDate) invoice.invoiceDate = invoiceDate;
    if (dueDate !== undefined) invoice.dueDate = dueDate;
    if (discount !== undefined) {
      invoice.discount = pickFirstFiniteNumber([discount], invoice.discount || 0);
    }
    if (discountType) invoice.discountType = discountType;
    if (taxRate !== undefined) {
      invoice.taxRate = pickFirstFiniteNumber([taxRate], invoice.taxRate ?? 10);
    }
    if (deliveryCost !== undefined) {
      invoice.deliveryCost = normalizeDeliveryCost(deliveryCost, invoice.deliveryCost);
    }
    if (notes !== undefined) invoice.notes = notes;
    if (terms !== undefined) invoice.terms = terms;
    if (paymentMethod !== undefined) invoice.paymentMethod = paymentMethod;
    if (amountPaid !== undefined) {
      invoice.amountPaid = pickFirstFiniteNumber([amountPaid], invoice.amountPaid || 0);
    }
    if (shouldSendEmail && !normalizeEmail(invoice.customerEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is required to send updated invoice',
      });
    }

    // Status change: stock only on confirmed/delivered
    if (newStatus) {
      if (willConfirmOrDeliver && !wasConfirmedOrDelivered) {
        invoice.status = newStatus;
        await invoice.save();
        await decreaseStockForInvoice(invoice, {
          excludeQuotationId: invoice.quotation,
          actorId: req.user.id,
        });
      } else if (!willConfirmOrDeliver && wasConfirmedOrDelivered) {
        await restoreStockForInvoice(invoice, {
          actorId: req.user.id,
          reason: `status changed to ${newStatus}`,
        });
        invoice.status = newStatus;
        await invoice.save();
      } else {
        invoice.status = newStatus;
        await invoice.save();
      }
    } else {
      await invoice.save();
    }

    const updatedInvoice = await Invoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size')
      .populate('quotation', 'quotationNumber');

    let emailSent = false;
    let emailError = null;
    let responseMessage = 'Invoice updated successfully';

    if (shouldSendEmail) {
      try {
        const { emailPayload, customerEmail: recipientEmail } =
          await sendInvoiceEmailWithAttachment(updatedInvoice);
        emailSent = true;
        responseMessage = emailPayload.isFinalReceipt
          ? `Payment received in full. Final invoice emailed to ${recipientEmail}`
          : `Updated invoice emailed to ${recipientEmail}`;
      } catch (error) {
        emailError = summarizeEmailError(error);
        responseMessage = 'Invoice updated, but email could not be sent';
      }
    }

    res.status(200).json({
      success: true,
      message: responseMessage,
      invoice: updatedInvoice,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Update invoice error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Server error while updating invoice',
      error: error.message,
    });
  }
};

// @desc    Mark invoice as paid (update payment: amountPaid, paymentMethod)
// @route   POST /api/invoices/:id/pay
// @access  Private
exports.markInvoiceAsPaid = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const { paymentMethod, paidAmount, paidDate, sendEmail: shouldSendEmail } = req.body;
    const amount = paidAmount != null
      ? pickFirstFiniteNumber([paidAmount], invoice.grandTotal || 0)
      : invoice.grandTotal;

    if (shouldSendEmail && !normalizeEmail(invoice.customerEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is required to send updated invoice',
      });
    }

    invoice.paymentMethod = paymentMethod || invoice.paymentMethod || '';
    invoice.amountPaid = amount;
    invoice.paidDate = paidDate ? new Date(paidDate) : new Date();
    await invoice.save();

    const updatedInvoice = await Invoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size')
      .populate('quotation', 'quotationNumber');

    let emailSent = false;
    let emailError = null;
    let responseMessage = 'Payment updated successfully';

    if (shouldSendEmail) {
      try {
        const { emailPayload, customerEmail: recipientEmail } =
          await sendInvoiceEmailWithAttachment(updatedInvoice);
        emailSent = true;
        responseMessage = emailPayload.isFinalReceipt
          ? `Payment received in full. Final invoice emailed to ${recipientEmail}`
          : `Updated invoice emailed to ${recipientEmail}`;
      } catch (error) {
        emailError = summarizeEmailError(error);
        responseMessage = 'Payment updated, but email could not be sent';
      }
    }

    res.status(200).json({
      success: true,
      message: responseMessage,
      invoice: updatedInvoice,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Mark invoice as paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating payment',
      error: error.message,
    });
  }
};

// @desc    Send invoice to customer email
// @route   POST /api/invoices/:id/send
// @access  Private
exports.sendInvoiceEmail = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size')
      .populate('quotation', 'quotationNumber');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    if (invoice.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send a cancelled invoice',
      });
    }

    const { customerEmail, emailPayload } = await sendInvoiceEmailWithAttachment(invoice);

    res.status(200).json({
      success: true,
      emailSent: true,
      message: emailPayload.isFinalReceipt
        ? `Final payment receipt sent to ${customerEmail}`
        : `Updated invoice sent to ${customerEmail}`,
      invoice,
    });
  } catch (error) {
    const details = summarizeEmailError(error);
    console.error('Send invoice email error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: details || 'Failed to send invoice email',
    });
  }
};

// @desc    Get invoice as PDF
// @route   GET /api/invoices/:id/pdf
// @access  Private
exports.getInvoicePdf = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('quotation', 'quotationNumber')
      .populate('items.product', 'name sku size')
      .lean();
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const pdfBuffer = await generateInvoicePdf(invoice);
    const filename = `invoice-${invoice.invoiceNumber || invoice._id}.pdf`.replace(/\s/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Get invoice PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice PDF',
      error: error.message,
    });
  }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
// @access  Private
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    if (invoice.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft invoices can be deleted',
      });
    }
    await invoice.deleteOne();
    res.status(200).json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting invoice',
      error: error.message,
    });
  }
};

// @desc    Get invoice statistics
// @route   GET /api/invoices/stats/summary
// @access  Private
exports.getInvoiceStats = async (req, res) => {
  try {
    const invoices = await Invoice.find();
    const statuses = ['draft', 'confirmed', 'delivered', 'cancelled', 'sent', 'paid', 'overdue'];
    const stats = { totalInvoices: invoices.length };
    statuses.forEach(s => {
      stats[s] = invoices.filter(inv => inv.status === s).length;
    });
    stats.totalRevenue = invoices
      .filter(inv => inv.paymentStatus === 'paid' || inv.status === 'paid')
      .reduce((sum, inv) => sum + (inv.grandTotal || inv.paidAmount || 0), 0);
    stats.pendingAmount = invoices
      .filter(inv => inv.paymentStatus !== 'paid' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + (inv.remainingBalance || inv.grandTotal || 0), 0);
    stats.overdueAmount = invoices
      .filter(inv => inv.status === 'overdue')
      .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
    res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invoice statistics',
      error: error.message,
    });
  }
};

