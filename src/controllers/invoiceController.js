const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const { generateInvoicePdf } = require('../utils/invoicePdf');

// Build one invoice line item with line total and optional coverage (tiles)
function buildInvoiceItem(product, item) {
  const quantity = Number(item.quantity) || 0;
  const rate = Number(item.rate) ?? product.retailPrice ?? product.price ?? 0;
  const discountPercent = Number(item.discountPercent) || 0;
  const taxPercent = Number(item.taxPercent) ?? product.taxPercent ?? 0;
  const unitType = item.unitType || 'Box';

  const base = quantity * rate;
  const lineTotal = Math.round(base * (1 - discountPercent / 100) * (1 + taxPercent / 100) * 100) / 100;

  let coverageSqm = null;
  const covPerBox = product.coveragePerBox;
  const covUnit = product.coveragePerBoxUnit || 'sqft';
  if (covPerBox != null && covPerBox > 0) {
    if (unitType === 'Box') {
      coverageSqm = covUnit === 'sqm' ? quantity * covPerBox : (quantity * covPerBox) / 10.764;
    } else if (unitType === 'Sq Meter' && quantity > 0) {
      coverageSqm = quantity;
    } else if (unitType === 'Sq Ft' && quantity > 0) {
      coverageSqm = quantity / 10.764;
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

// Decrease stock for invoice items (when confirming/delivering)
async function decreaseStockForInvoice(invoice) {
  for (const item of invoice.items) {
    const product = await Product.findById(item.product);
    if (!product) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    product.stock = Math.max(0, (product.stock || 0) - qty);
    await product.save();
  }
}

// Restore stock when reverting from confirmed/delivered to draft
async function restoreStockForInvoice(invoice) {
  for (const item of invoice.items) {
    const product = await Product.findById(item.product);
    if (!product) continue;
    const qty = Number(item.quantity) || 0;
    if (qty > 0) {
      product.stock = (product.stock || 0) + qty;
      await product.save();
    }
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

    const status = reqStatus || 'draft';
    const invoice = await Invoice.create({
      quotation: quotation || undefined,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      invoiceDate: invoiceDate || Date.now(),
      dueDate,
      items: populatedItems,
      discount: discount || 0,
      discountType: discountType || 'percentage',
      taxRate: taxRate || 10,
      notes,
      terms,
      status,
      paymentMethod: paymentMethod || '',
      amountPaid: amountPaid != null ? Number(amountPaid) : 0,
      createdBy: req.user.id,
    });

    // Stock decrease only when status is confirmed or delivered
    if (status === 'confirmed' || status === 'delivered') {
      await decreaseStockForInvoice(invoice);
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
    res.status(500).json({
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
    if (discount !== undefined) invoice.discount = discount;
    if (discountType) invoice.discountType = discountType;
    if (taxRate !== undefined) invoice.taxRate = taxRate;
    if (notes !== undefined) invoice.notes = notes;
    if (terms !== undefined) invoice.terms = terms;
    if (paymentMethod !== undefined) invoice.paymentMethod = paymentMethod;
    if (amountPaid !== undefined) invoice.amountPaid = Number(amountPaid);

    // Status change: stock only on confirmed/delivered
    if (newStatus) {
      if (willConfirmOrDeliver && !wasConfirmedOrDelivered) {
        invoice.status = newStatus;
        await invoice.save();
        await decreaseStockForInvoice(invoice);
      } else if (!willConfirmOrDeliver && wasConfirmedOrDelivered) {
        await restoreStockForInvoice(invoice);
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
    res.status(500).json({
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
    const amount = paidAmount != null ? Number(paidAmount) : invoice.grandTotal;

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
