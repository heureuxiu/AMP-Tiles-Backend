const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const StockTransaction = require('../models/StockTransaction');
const { generatePurchaseOrderPdf } = require('../utils/purchaseOrderPdf');

const AUTO_STOCK_ON_PO_RECEIVE_DEFAULT =
  String(process.env.AUTO_STOCK_ON_PO_RECEIVE ?? 'true').toLowerCase() !== 'false';

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

function fallbackFormatCurrency(amount, currency = 'AUD') {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency || 'AUD',
  }).format(num);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function getPurchaseOrderAmountSnapshot(purchaseOrder) {
  const subtotal =
    Number(purchaseOrder?.subtotal) ||
    (purchaseOrder?.items || []).reduce((sum, item) => sum + (Number(item?.lineTotal) || 0), 0);
  const tax = Number(purchaseOrder?.tax) || 0;
  const parsedDelivery = Number(purchaseOrder?.deliveryCost);
  const fallbackDelivery = Math.max(
    0,
    roundMoney(Number(purchaseOrder?.grandTotal) - subtotal - tax)
  );
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : 0;
  const grandTotal = Number.isFinite(Number(purchaseOrder?.grandTotal))
    ? Number(purchaseOrder.grandTotal)
    : subtotal + tax + deliveryCost;

  return {
    subtotal: roundMoney(subtotal),
    tax: roundMoney(tax),
    deliveryCost: roundMoney(deliveryCost),
    grandTotal: roundMoney(grandTotal),
  };
}

function getPurchaseOrderItemDetails(item) {
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
    quantity: Number(item?.quantityOrdered) || 0,
    rate: Number(item?.rate) || 0,
    amount: Number(item?.lineTotal) || 0,
  };
}

function buildFallbackPurchaseOrderEmail(purchaseOrder) {
  const poNumber = purchaseOrder.poNumber || String(purchaseOrder._id || '');
  const supplierName = purchaseOrder.supplierName || purchaseOrder.supplier?.name || 'Supplier';
  const poDate = fallbackFormatDate(purchaseOrder.poDate);
  const expectedDelivery = purchaseOrder.expectedDeliveryDate
    ? fallbackFormatDate(purchaseOrder.expectedDeliveryDate)
    : 'N/A';
  const currency = purchaseOrder.currency || 'AUD';
  const amounts = getPurchaseOrderAmountSnapshot(purchaseOrder);
  const grandTotal = fallbackFormatCurrency(amounts.grandTotal, currency);

  const rowsHtml = (purchaseOrder.items || [])
    .map((item) => {
      const details = getPurchaseOrderItemDetails(item);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.productName)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.sku)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.description)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.size)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.unit)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${details.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${fallbackFormatCurrency(details.rate, currency)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${fallbackFormatCurrency(details.amount, currency)}</td>
      </tr>`;
    })
    .join('');
  const totalsRowsHtml = [
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Subtotal</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(
        fallbackFormatCurrency(amounts.subtotal, currency)
      )}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Tax (GST)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(
        fallbackFormatCurrency(amounts.tax, currency)
      )}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery Cost</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(
        fallbackFormatCurrency(amounts.deliveryCost, currency)
      )}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Grand Total</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">${escapeHtml(
        grandTotal
      )}</td>
    </tr>`,
  ].join('');
  const notesLine = purchaseOrder.notes ? `\nNotes: ${purchaseOrder.notes}` : '';
  const termsLine = purchaseOrder.terms ? `\nTerms: ${purchaseOrder.terms}` : '';

  const text = [
    `Purchase Order ${poNumber}`,
    `Dear ${supplierName},`,
    '',
    'Please find the purchase order details below.',
    `PO Number: ${poNumber}`,
    `PO Date: ${poDate}`,
    `Expected Delivery Date: ${expectedDelivery}`,
    `Subtotal: ${fallbackFormatCurrency(amounts.subtotal, currency)}`,
    `Tax (GST): ${fallbackFormatCurrency(amounts.tax, currency)}`,
    `Delivery Cost: ${fallbackFormatCurrency(amounts.deliveryCost, currency)}`,
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(purchaseOrder.items || []).map((item) => {
      const details = getPurchaseOrderItemDetails(item);
      return `- ${details.productName} | SKU: ${details.sku} | Desc: ${details.description} | Size: ${details.size} | Unit: ${details.unit} | Qty: ${details.quantity} | Rate: ${fallbackFormatCurrency(details.rate, currency)} | Amount: ${fallbackFormatCurrency(details.amount, currency)}`;
    }),
    '',
    'Please see attached purchase order PDF for your records.',
    notesLine,
    termsLine,
    '',
    'Thank you,',
    'AMP Tiles',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <h2>Purchase Order ${escapeHtml(poNumber)}</h2>
      <p>Dear ${escapeHtml(supplierName)},</p>
      <p>Please find the purchase order details below.</p>
      <p>
        <strong>PO Number:</strong> ${escapeHtml(poNumber)}<br/>
        <strong>PO Date:</strong> ${escapeHtml(poDate)}<br/>
        <strong>Expected Delivery Date:</strong> ${escapeHtml(expectedDelivery)}<br/>
        <strong>Subtotal:</strong> ${escapeHtml(
          fallbackFormatCurrency(amounts.subtotal, currency)
        )}<br/>
        <strong>Tax (GST):</strong> ${escapeHtml(
          fallbackFormatCurrency(amounts.tax, currency)
        )}<br/>
        <strong>Delivery Cost:</strong> ${escapeHtml(
          fallbackFormatCurrency(amounts.deliveryCost, currency)
        )}<br/>
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
        purchaseOrder.notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(purchaseOrder.notes)}</p>`
          : ''
      }
      ${
        purchaseOrder.terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(purchaseOrder.terms)}</p>`
          : ''
      }

      <p>Thank you,<br/>AMP Tiles</p>
    </div>
  `;

  return {
    subject: `Purchase Order ${poNumber} from AMP Tiles`,
    text,
    html,
  };
}

let buildPurchaseOrderEmail = buildFallbackPurchaseOrderEmail;

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
  console.warn('Mailer utility not found. Purchase order email sending will be disabled.');
}

const purchaseOrderEmailModule = loadOptionalModule([
  '../utils/purchaseOrderEmail',
  '../utils/purchase-order-email',
  '../utils/PurchaseOrderEmail',
]);
if (
  purchaseOrderEmailModule &&
  typeof purchaseOrderEmailModule.buildPurchaseOrderEmail === 'function'
) {
  ({ buildPurchaseOrderEmail } = purchaseOrderEmailModule);
} else if (process.env.NODE_ENV !== 'production') {
  console.warn('Purchase order email template utility not found. Using fallback template.');
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function summarizeEmailError(error, fallbackMessage = 'Failed to send purchase order email') {
  return [
    error?.message || fallbackMessage,
    error?.code ? `code=${error.code}` : '',
    error?.command ? `command=${error.command}` : '',
    error?.responseCode ? `responseCode=${error.responseCode}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

async function sendPurchaseOrderEmailWithAttachment(purchaseOrderDoc) {
  const purchaseOrder = purchaseOrderDoc?.toObject
    ? purchaseOrderDoc.toObject()
    : purchaseOrderDoc;
  if (!purchaseOrder) {
    const error = new Error('Purchase order not found');
    error.statusCode = 404;
    throw error;
  }

  const supplierEmail = normalizeEmail(purchaseOrder?.supplier?.email);
  if (!supplierEmail) {
    const error = new Error(
      'Supplier email is missing. Please add supplier email before sending purchase order.'
    );
    error.statusCode = 400;
    throw error;
  }

  const pdfBuffer = await generatePurchaseOrderPdf(purchaseOrder);
  const emailPayload = buildPurchaseOrderEmail(purchaseOrder);
  const poRef = String(purchaseOrder.poNumber || purchaseOrder._id || 'purchase-order').replace(
    /\s/g,
    '-'
  );

  await sendEmail({
    to: supplierEmail,
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    attachments: [
      {
        filename: `purchase-order-${poRef}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return {
    supplierEmail,
    emailPayload,
  };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isProductLinkedToSupplier(product, supplierDoc) {
  if (!product || !supplierDoc) return false;

  // Preferred relation: ObjectId reference
  if (product.supplier) {
    return product.supplier.toString() === supplierDoc._id.toString();
  }

  // Backward compatibility for old products that only stored supplierName
  return normalizeText(product.supplierName) === normalizeText(supplierDoc.name);
}

function resolveProductCostRate(product) {
  const raw = Number(product?.costPrice);
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 100) / 100;
}

function parseBooleanLike(value, fallback) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

const SQM_PER_SQFT = 0.092903;

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function normalizePoUnitType(value) {
  const normalized = String(value || 'box')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

  if (normalized.includes('sqm') || normalized.includes('sqmeter') || normalized.includes('sqmetre')) {
    return 'sqm';
  }
  if (normalized.includes('sqft') || normalized.includes('sqfeet') || normalized.includes('ft2')) {
    return 'sqft';
  }
  if (normalized.includes('piece')) return 'piece';
  if (normalized.includes('pallet')) return 'pallet';
  return 'box';
}

function getSqmPerBox(product) {
  const coveragePerBox = Number(product?.coveragePerBox) || 0;
  if (coveragePerBox <= 0) return 0;
  return product?.coveragePerBoxUnit === 'sqm'
    ? coveragePerBox
    : coveragePerBox * SQM_PER_SQFT;
}

function createStockUnitValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function convertQuantityToSqm({ quantity, unitType, product }) {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return 0;

  const normalizedUnit = normalizePoUnitType(unitType);
  const sqmPerBox = getSqmPerBox(product);

  if (normalizedUnit === 'sqm') return roundQty(qty);
  if (normalizedUnit === 'sqft') return roundQty(qty * SQM_PER_SQFT);

  if (normalizedUnit === 'box') {
    if (sqmPerBox <= 0) {
      throw createStockUnitValidationError(
        `Cannot convert boxes to sqm for product "${product?.name || ''}". Please set coverage per box first.`
      );
    }
    return roundQty(qty * sqmPerBox);
  }

  if (normalizedUnit === 'piece') {
    const tilesPerBox = Number(product?.tilesPerBox) || 0;
    if (sqmPerBox <= 0 || tilesPerBox <= 0) {
      throw createStockUnitValidationError(
        `Cannot convert pieces to sqm for product "${product?.name || ''}". Please set coverage per box and tiles per box.`
      );
    }
    const sqmPerPiece = sqmPerBox / tilesPerBox;
    return roundQty(qty * sqmPerPiece);
  }

  throw createStockUnitValidationError(
    `Unsupported unit "${unitType}" for sqm-only inventory updates.`
  );
}

function getBoxesEquivalentFromSqm(receivedSqm, product) {
  const sqmPerBox = getSqmPerBox(product);
  if (sqmPerBox <= 0) {
    return {
      exactBoxes: null,
      wholeBoxes: null,
      sqmPerBox: null,
    };
  }

  const exactBoxes = receivedSqm / sqmPerBox;
  const roundedExactBoxes = roundQty(exactBoxes);
  const wholeBoxes = Math.ceil(exactBoxes - 1e-9);

  return {
    exactBoxes: roundedExactBoxes,
    wholeBoxes,
    sqmPerBox: roundQty(sqmPerBox),
  };
}

// @desc    Get all purchase orders with optional filtering
// @route   GET /api/purchase-orders
// @access  Private
exports.getPurchaseOrders = async (req, res) => {
  try {
    const {
      search,
      supplier,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } },
      ];
    }
    if (supplier && supplier !== 'all') query.supplier = supplier;
    if (status && status !== 'all') query.status = status;
    if (startDate || endDate) {
      query.poDate = {};
      if (startDate) query.poDate.$gte = new Date(startDate);
      if (endDate) query.poDate.$lte = new Date(endDate);
    }

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const purchaseOrders = await PurchaseOrder.find(query)
      .populate('supplier', 'name supplierNumber')
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size unit tilesPerBox coveragePerBox coveragePerBoxUnit')
      .sort(sortObj);

    const statuses = [
      'draft',
      'sent',
      'sent_to_supplier',
      'confirmed',
      'partially_received',
      'received',
      'cancelled',
    ];
    const stats = {
      total: await PurchaseOrder.countDocuments(),
      totalValue: 0,
    };
    for (const s of statuses) {
      stats[s] = await PurchaseOrder.countDocuments({ status: s });
    }
    const allOrders = await PurchaseOrder.find();
    stats.totalValue = allOrders.reduce((sum, po) => sum + (po.grandTotal || 0), 0);

    res.status(200).json({
      success: true,
      count: purchaseOrders.length,
      purchaseOrders,
      stats,
    });
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase orders',
      error: error.message,
    });
  }
};

// @desc    Get single purchase order
// @route   GET /api/purchase-orders/:id
// @access  Private
exports.getPurchaseOrder = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('supplier')
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku description size unit tilesPerBox coveragePerBox coveragePerBoxUnit');

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    res.status(200).json({
      success: true,
      purchaseOrder,
    });
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase order',
      error: error.message,
    });
  }
};

// Helper: compute line total and optionally coverage from product
function buildItem(product, item, forcedRate) {
  const qty = Number(item.quantityOrdered) || 0;
  const chosenRate =
    forcedRate != null && Number.isFinite(Number(forcedRate))
      ? Number(forcedRate)
      : Number(item.rate) || 0;
  const rate = Math.round(chosenRate * 100) / 100;
  const discount = Number(item.discountPercent) || 0;
  const parsedTax = Number(item.taxPercent);
  const tax = Number.isFinite(parsedTax) ? parsedTax : 10;
  const afterDiscount = qty * rate * (1 - discount / 100);
  const lineTotal = Math.round(afterDiscount * (1 + tax / 100) * 100) / 100;
  let coverageSqm = null;
  if (product && (product.coveragePerBox || product.tilesPerBox)) {
    const coveragePerBox = Number(product.coveragePerBox) || 0;
    const perBox = product.coveragePerBoxUnit === 'sqm' ? coveragePerBox : (coveragePerBox * SQM_PER_SQFT) || 0;
    if (item.unitType === 'Box' && perBox) coverageSqm = qty * perBox;
    else if ((item.unitType === 'Sqm' || item.unitType === 'Sq Meter') && qty) coverageSqm = qty;
    else if (item.unitType === 'Sq Ft' && qty) coverageSqm = Math.round((qty * SQM_PER_SQFT) * 100) / 100;
  }
  return {
    product: product._id,
    productName: product.name,
    sku: product.sku || '',
    size: String(product.size ?? item.size ?? ''),
    unitType: item.unitType || 'Box',
    quantityOrdered: qty,
    rate,
    discountPercent: discount,
    taxPercent: tax,
    lineTotal,
    coverageSqm,
    quantityReceived: Number(item.quantityReceived) || 0,
    damagedQuantity: Number(item.damagedQuantity) || 0,
    batchNumber: item.batchNumber || '',
    receivedDate: item.receivedDate || null,
  };
}

// @desc    Create new purchase order
// @route   POST /api/purchase-orders
// @access  Private
exports.createPurchaseOrder = async (req, res) => {
  try {
    const {
      supplier,
      poDate,
      expectedDeliveryDate,
      warehouseLocation,
      currency,
      paymentTerms,
      deliveryAddress,
      items,
      notes,
      terms,
    } = req.body;

    if (!supplier) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a supplier',
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Purchase order must have at least one item',
      });
    }

    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    const validatedItems = [];
    for (const item of items) {
      if (!item.product || item.quantityOrdered == null) {
        return res.status(400).json({
          success: false,
          message: 'Each item must have product and quantityOrdered',
        });
      }
      const product = await Product.findById(item.product).select('name sku size supplier supplierName coveragePerBox coveragePerBoxUnit tilesPerBox costPrice');
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product with ID ${item.product} not found`,
        });
      }
      if (!isProductLinkedToSupplier(product, supplierDoc)) {
        return res.status(400).json({
          success: false,
          message: `Product "${product.name}" is not linked to selected supplier "${supplierDoc.name}"`,
        });
      }
      const costRate = resolveProductCostRate(product);
      if (costRate == null) {
        return res.status(400).json({
          success: false,
          message: `Product "${product.name}" has no valid cost price configured`,
        });
      }
      validatedItems.push(buildItem(product, item, costRate));
    }

    const purchaseOrder = await PurchaseOrder.create({
      supplier,
      supplierName: supplierDoc.name,
      poDate: poDate || Date.now(),
      expectedDeliveryDate: expectedDeliveryDate || null,
      warehouseLocation: warehouseLocation || '',
      currency: currency || 'AUD',
      paymentTerms: paymentTerms || '',
      deliveryAddress: deliveryAddress || '',
      items: validatedItems,
      notes: notes || '',
      terms: terms || '',
      createdBy: req.user.id,
    });

    await purchaseOrder.populate('supplier');
    await purchaseOrder.populate(
      'items.product',
      'name sku description size tilesPerBox coveragePerBox coveragePerBoxUnit'
    );

    res.status(201).json({
      success: true,
      message: 'Purchase order created successfully',
      purchaseOrder,
    });
  } catch (error) {
    console.error('Error creating purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create purchase order',
      error: error.message,
    });
  }
};

// @desc    Update purchase order
// @route   PUT /api/purchase-orders/:id
// @access  Private
exports.updatePurchaseOrder = async (req, res) => {
  try {
    let purchaseOrder = await PurchaseOrder.findById(req.params.id);

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (['received', 'cancelled'].includes(purchaseOrder.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update ${purchaseOrder.status} purchase order`,
      });
    }

    const {
      supplier,
      poDate,
      expectedDeliveryDate,
      warehouseLocation,
      currency,
      paymentTerms,
      deliveryAddress,
      items,
      notes,
      terms,
      status,
    } = req.body;

    let effectiveSupplierDoc = null;
    if (supplier && supplier !== purchaseOrder.supplier.toString()) {
      const supplierDoc = await Supplier.findById(supplier);
      if (!supplierDoc) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found',
        });
      }
      purchaseOrder.supplier = supplier;
      purchaseOrder.supplierName = supplierDoc.name;
      effectiveSupplierDoc = supplierDoc;
    } else {
      effectiveSupplierDoc = await Supplier.findById(purchaseOrder.supplier).select('_id name');
      if (!effectiveSupplierDoc) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found for this purchase order',
        });
      }
    }

    if (poDate) purchaseOrder.poDate = poDate;
    if (expectedDeliveryDate !== undefined) purchaseOrder.expectedDeliveryDate = expectedDeliveryDate;
    if (warehouseLocation !== undefined) purchaseOrder.warehouseLocation = warehouseLocation;
    if (currency !== undefined) purchaseOrder.currency = currency;
    if (paymentTerms !== undefined) purchaseOrder.paymentTerms = paymentTerms;
    if (deliveryAddress !== undefined) purchaseOrder.deliveryAddress = deliveryAddress;
    if (notes !== undefined) purchaseOrder.notes = notes;
    if (terms !== undefined) purchaseOrder.terms = terms;
    if (status) {
      if (['received', 'partially_received'].includes(String(status))) {
        return res.status(400).json({
          success: false,
          message:
            'Use the receive endpoint to mark a purchase order as partially received or received so stock updates stay consistent.',
        });
      }
      purchaseOrder.status = status;
    }

    if (items && items.length > 0) {
      const validatedItems = [];
      for (const item of items) {
        if (!item.product || item.quantityOrdered == null) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have product and quantityOrdered',
          });
        }
        const product = await Product.findById(item.product).select('name sku size supplier supplierName coveragePerBox coveragePerBoxUnit tilesPerBox costPrice');
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product with ID ${item.product} not found`,
          });
        }
        if (!isProductLinkedToSupplier(product, effectiveSupplierDoc)) {
          return res.status(400).json({
            success: false,
            message: `Product "${product.name}" is not linked to selected supplier "${effectiveSupplierDoc.name}"`,
          });
        }
        const costRate = resolveProductCostRate(product);
        if (costRate == null) {
          return res.status(400).json({
            success: false,
            message: `Product "${product.name}" has no valid cost price configured`,
          });
        }
        const built = buildItem(product, item, costRate);
        if (item._id) built._id = item._id;
        if (item.quantityReceived != null) built.quantityReceived = Number(item.quantityReceived);
        if (item.damagedQuantity != null) built.damagedQuantity = Number(item.damagedQuantity);
        if (item.batchNumber != null) built.batchNumber = item.batchNumber;
        if (item.receivedDate != null) built.receivedDate = item.receivedDate;
        validatedItems.push(built);
      }
      purchaseOrder.items = validatedItems;
    }

    await purchaseOrder.save();
    await purchaseOrder.populate('supplier');
    await purchaseOrder.populate(
      'items.product',
      'name sku description size tilesPerBox coveragePerBox coveragePerBoxUnit'
    );

    res.status(200).json({
      success: true,
      message: 'Purchase order updated successfully',
      purchaseOrder,
    });
  } catch (error) {
    console.error('Error updating purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update purchase order',
      error: error.message,
    });
  }
};

// @desc    Get purchase order as PDF
// @route   GET /api/purchase-orders/:id/pdf
// @access  Private
exports.getPurchaseOrderPdf = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('supplier', 'name email phone contactPerson supplierNumber')
      .populate(
        'items.product',
        'name sku description size unit tilesPerBox coveragePerBox coveragePerBoxUnit'
      )
      .lean();

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    const pdfBuffer = await generatePurchaseOrderPdf(purchaseOrder);
    const filename = `purchase-order-${purchaseOrder.poNumber || purchaseOrder._id}.pdf`.replace(
      /\s/g,
      '-'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Get purchase order PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate purchase order PDF',
      error: error.message,
    });
  }
};

// @desc    Send purchase order to supplier email and mark as sent_to_supplier
// @route   POST /api/purchase-orders/:id/send-to-supplier
// @access  Private
exports.sendPurchaseOrderToSupplier = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('supplier', 'name email contactPerson supplierNumber')
      .populate('createdBy', 'name email')
      .populate(
        'items.product',
        'name sku description size unit tilesPerBox coveragePerBox coveragePerBoxUnit'
      );

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (purchaseOrder.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot send a cancelled purchase order',
      });
    }

    if (!purchaseOrder.supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found for this purchase order',
      });
    }

    const supplierEmail = normalizeEmail(purchaseOrder.supplier.email);
    if (!supplierEmail) {
      return res.status(400).json({
        success: false,
        message:
          'Supplier email is missing. Please add supplier email before sending purchase order.',
      });
    }

    await sendPurchaseOrderEmailWithAttachment(purchaseOrder);

    if (purchaseOrder.status !== 'sent_to_supplier') {
      purchaseOrder.status = 'sent_to_supplier';
      await purchaseOrder.save();
      await purchaseOrder.populate('supplier', 'name email contactPerson supplierNumber');
      await purchaseOrder.populate('createdBy', 'name email');
      await purchaseOrder.populate(
        'items.product',
        'name sku description size unit tilesPerBox coveragePerBox coveragePerBoxUnit'
      );
    }

    res.status(200).json({
      success: true,
      emailSent: true,
      message: `Purchase order sent to supplier at ${supplierEmail}`,
      purchaseOrder,
    });
  } catch (error) {
    const details = summarizeEmailError(error);
    console.error('Error sending purchase order email:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: details || 'Failed to send purchase order email',
    });
  }
};

// @desc    Receive goods (per-line quantities). Updates inventory in sqm only.
// @route   POST /api/purchase-orders/:id/receive
// @access  Private
exports.receivePurchaseOrder = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id).populate('items.product');
    const applyStockUpdate = parseBooleanLike(
      req.body?.applyStockUpdate,
      AUTO_STOCK_ON_PO_RECEIVE_DEFAULT
    );
    let stockUpdateCount = 0;
    let receivedQuantityTotal = 0;
    let receivedSqmTotal = 0;
    let boxesEquivalentTotal = 0;
    let boxesRoundedUpTotal = 0;

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (purchaseOrder.status === 'received') {
      return res.status(400).json({
        success: false,
        message: 'Purchase order is already fully received',
      });
    }

    if (purchaseOrder.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot receive a cancelled purchase order',
      });
    }

    let { items: receiveItems } = req.body || {};
    // receiveItems: array of { index or productId, quantityReceived, damagedQuantity, batchNumber }
    if (!receiveItems || !Array.isArray(receiveItems) || receiveItems.length === 0) {
      receiveItems = purchaseOrder.items.map((item, index) => ({
        index,
        quantityReceived: Math.max(0, item.quantityOrdered - (item.quantityReceived || 0) - (item.damagedQuantity || 0)),
        damagedQuantity: 0,
      }));
    }

    if (receiveItems && receiveItems.length > 0) {
      const receivedDate = new Date();
      for (let i = 0; i < receiveItems.length; i++) {
        const r = receiveItems[i];
        const itemIndex = r.index !== undefined ? r.index : purchaseOrder.items.findIndex((it) => it.product._id.toString() === (r.productId || r.product));
        if (itemIndex < 0 || itemIndex >= purchaseOrder.items.length) continue;

        const item = purchaseOrder.items[itemIndex];
        const qtyReceived = Number(r.quantityReceived) || 0;
        const damaged = Number(r.damagedQuantity) || 0;
        receivedQuantityTotal += Math.max(0, qtyReceived);

        item.quantityReceived = (item.quantityReceived || 0) + qtyReceived;
        item.damagedQuantity = (item.damagedQuantity || 0) + damaged;
        if (r.batchNumber) item.batchNumber = r.batchNumber;
        item.receivedDate = item.receivedDate || receivedDate;

        // Increase product stock in sqm only (when automatic mode is enabled)
        if (qtyReceived > 0 && item.product && applyStockUpdate) {
          const product = await Product.findById(item.product._id || item.product);
          if (product) {
            const receivedSqm = convertQuantityToSqm({
              quantity: qtyReceived,
              unitType: item.unitType,
              product,
            });
            const previousStock = roundQty(Number(product.stock || 0));
            product.stock = roundQty(previousStock + receivedSqm);
            product.unit = 'sqm';
            await product.save();
            stockUpdateCount += 1;
            receivedSqmTotal = roundQty(receivedSqmTotal + receivedSqm);

            const boxes = getBoxesEquivalentFromSqm(receivedSqm, product);
            if (boxes.exactBoxes != null) {
              boxesEquivalentTotal = roundQty(boxesEquivalentTotal + boxes.exactBoxes);
            }
            if (boxes.wholeBoxes != null) {
              boxesRoundedUpTotal += boxes.wholeBoxes;
            }

            const poRef = purchaseOrder.poNumber || purchaseOrder._id.toString();

            await StockTransaction.create({
              product: product._id,
              type: 'stock-in',
              quantity: receivedSqm,
              previousStock,
              newStock: product.stock,
              remarks: `PO ${poRef} received ${roundQty(receivedSqm)} sqm from ${qtyReceived} ${item.unitType || 'unit'}${r.batchNumber ? ` (Batch: ${r.batchNumber})` : ''}`.trim(),
              sourceType: 'purchase_order',
              sourceId: String(purchaseOrder._id),
              sourceRef: poRef,
              metadata: {
                batchNumber: r.batchNumber || '',
                damagedQuantity: damaged,
                sourceQuantityReceived: qtyReceived,
                sourceUnitType: item.unitType || '',
                receivedSqm,
                boxesEquivalent: boxes.exactBoxes,
                boxesRoundedUp: boxes.wholeBoxes,
                sqmPerBox: boxes.sqmPerBox,
              },
              createdBy: req.user.id,
            });
          }
        }
      }
    }

    // Determine new status
    const allReceived = purchaseOrder.items.every((item) => {
      const remaining = item.quantityOrdered - (item.quantityReceived || 0) - (item.damagedQuantity || 0);
      return remaining <= 0;
    });
    const anyReceived = purchaseOrder.items.some((item) => (item.quantityReceived || 0) > 0);

    if (allReceived) {
      purchaseOrder.status = 'received';
      purchaseOrder.receivedDate = purchaseOrder.receivedDate || new Date();
    } else if (anyReceived) {
      purchaseOrder.status = 'partially_received';
      purchaseOrder.receivedDate = purchaseOrder.receivedDate || new Date();
    }

    await purchaseOrder.save();
    await purchaseOrder.populate('supplier');
    await purchaseOrder.populate(
      'items.product',
      'name sku description size tilesPerBox coveragePerBox coveragePerBoxUnit'
    );

    const message = applyStockUpdate
      ? 'Goods receiving updated and stock increased in sqm only'
      : 'Goods receiving updated. Automatic stock update is disabled; use manual stock update if you need to adjust inventory.';

    res.status(200).json({
      success: true,
      message,
      stockUpdateMode: applyStockUpdate ? 'automatic' : 'manual',
      stockUpdateCount,
      receivedQuantityTotal,
      receivedSqmTotal,
      boxesEquivalentTotal,
      boxesRoundedUpTotal,
      purchaseOrder,
    });
  } catch (error) {
    console.error('Error receiving purchase order:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Failed to receive purchase order',
      error: error.message,
    });
  }
};

// @desc    Delete purchase order
// @route   DELETE /api/purchase-orders/:id
// @access  Private
exports.deletePurchaseOrder = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (purchaseOrder.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete draft purchase orders',
      });
    }

    await purchaseOrder.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Purchase order deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting purchase order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete purchase order',
      error: error.message,
    });
  }
};

// @desc    Get purchase order stats
// @route   GET /api/purchase-orders/stats/summary
// @access  Private
exports.getPurchaseOrderStats = async (req, res) => {
  try {
    const statuses = [
      'draft',
      'sent',
      'sent_to_supplier',
      'confirmed',
      'partially_received',
      'received',
      'cancelled',
    ];
    const stats = { totalPurchaseOrders: await PurchaseOrder.countDocuments(), totalValue: 0 };
    for (const s of statuses) {
      stats[s] = await PurchaseOrder.countDocuments({ status: s });
    }
    const allOrders = await PurchaseOrder.find();
    stats.totalValue = allOrders.reduce((sum, po) => sum + (po.grandTotal || 0), 0);
    stats.recentPurchaseOrders = await PurchaseOrder.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching purchase order stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase order stats',
      error: error.message,
    });
  }
};


