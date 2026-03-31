const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const Quotation = require('../models/Quotation');
const StockTransaction = require('../models/StockTransaction');
const { generateInvoicePdf } = require('../utils/invoicePdf');

const HOLDING_QUOTATION_STATUSES = ['sent', 'accepted'];
const SQFT_PER_SQM = 10.764;

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

// Build one invoice line item with line total and optional coverage (tiles)
function buildInvoiceItem(product, item) {
  const quantity = pickFirstFiniteNumber([item.quantity], 0);
  const rate = roundMoney(
    pickFirstFiniteNumber([item.rate, product.retailPrice, product.price], 0)
  );
  const discountPercent = pickFirstFiniteNumber([item.discountPercent], 0);
  const taxPercent = pickFirstFiniteNumber([item.taxPercent, product.taxPercent], 0);
  const unitType = item.unitType || 'Box';

  const base = quantity * rate;
  const lineTotal = Math.round(base * (1 - discountPercent / 100) * (1 + taxPercent / 100) * 100) / 100;

  let coverageSqm = null;
  const sqmPerBox = getSqmPerBox(product);
  if (sqmPerBox > 0) {
    if (unitType === 'Box') {
      coverageSqm = quantity * sqmPerBox;
    } else if (unitType === 'Sq Meter' && quantity > 0) {
      coverageSqm = quantity;
    } else if (unitType === 'Sq Ft' && quantity > 0) {
      coverageSqm = quantity / SQFT_PER_SQM;
    }
  }

  return {
    product: product._id,
    productName: product.name,
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
      .populate('items.product', 'name sku retailPrice price coveragePerBox coveragePerBoxUnit')
      .sort(sort);

    const statuses = ['draft', 'confirmed', 'delivered', 'cancelled', 'sent', 'paid', 'overdue'];
    const stats = { total: invoices.length };
    statuses.forEach(s => {
      stats[s] = invoices.filter(inv => inv.status === s).length;
    });
    stats.totalRevenue = invoices
      .filter(inv => inv.paymentStatus === 'paid' || inv.status === 'paid')
      .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
    stats.pendingAmount = invoices
      .filter(inv => inv.paymentStatus !== 'paid' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + (inv.remainingBalance || inv.grandTotal || 0), 0);

    res.status(200).json({ success: true, count: invoices.length, stats, invoices });
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
      .populate('items.product', 'name sku retailPrice price coveragePerBox coveragePerBoxUnit')
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
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      invoiceDate,
      dueDate,
      items,
      discount,
      discountType,
      taxRate,
      notes,
      terms,
      status: reqStatus,
      paymentMethod,
      amountPaid,
    } = req.body;

    if (!customerName || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customer name and at least one item',
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
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      invoiceDate: invoiceDate || Date.now(),
      dueDate,
      items: populatedItems,
      discount: pickFirstFiniteNumber([discount], 0),
      discountType: discountType || 'percentage',
      taxRate: pickFirstFiniteNumber([taxRate], 10),
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
      .populate('items.product', 'name sku');

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      invoice: populatedInvoice,
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
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      invoiceDate,
      dueDate,
      items,
      discount,
      discountType,
      taxRate,
      notes,
      terms,
      status: newStatus,
      paymentMethod,
      amountPaid,
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
    if (invoiceDate) invoice.invoiceDate = invoiceDate;
    if (dueDate !== undefined) invoice.dueDate = dueDate;
    if (discount !== undefined) {
      invoice.discount = pickFirstFiniteNumber([discount], invoice.discount || 0);
    }
    if (discountType) invoice.discountType = discountType;
    if (taxRate !== undefined) {
      invoice.taxRate = pickFirstFiniteNumber([taxRate], invoice.taxRate || 0);
    }
    if (notes !== undefined) invoice.notes = notes;
    if (terms !== undefined) invoice.terms = terms;
    if (paymentMethod !== undefined) invoice.paymentMethod = paymentMethod;
    if (amountPaid !== undefined) {
      invoice.amountPaid = pickFirstFiniteNumber([amountPaid], invoice.amountPaid || 0);
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
      .populate('items.product', 'name sku');

    res.status(200).json({
      success: true,
      message: 'Invoice updated successfully',
      invoice: updatedInvoice,
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

    const { paymentMethod, paidAmount, paidDate } = req.body;
    const amount = paidAmount != null
      ? pickFirstFiniteNumber([paidAmount], invoice.grandTotal || 0)
      : invoice.grandTotal;

    invoice.paymentMethod = paymentMethod || invoice.paymentMethod || '';
    invoice.amountPaid = amount;
    invoice.paidDate = paidDate ? new Date(paidDate) : new Date();
    await invoice.save();

    const updatedInvoice = await Invoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku');

    res.status(200).json({
      success: true,
      message: 'Payment updated successfully',
      invoice: updatedInvoice,
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

// @desc    Get invoice as PDF
// @route   GET /api/invoices/:id/pdf
// @access  Private
exports.getInvoicePdf = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('quotation', 'quotationNumber')
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
