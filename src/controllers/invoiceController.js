const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const { generateInvoicePdf } = require('../utils/invoicePdf');

// @desc    Get all invoices
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res) => {
  try {
    const { search, status, startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    // Build query
    const query = {};

    // Search by invoice number, customer name, phone, or email
    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }

    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) {
        query.invoiceDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.invoiceDate.$lte = new Date(endDate);
      }
    }

    // Execute query
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const invoices = await Invoice.find(query)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku')
      .sort(sort);

    // Get statistics
    const stats = {
      total: invoices.length,
      draft: invoices.filter(inv => inv.status === 'draft').length,
      sent: invoices.filter(inv => inv.status === 'sent').length,
      paid: invoices.filter(inv => inv.status === 'paid').length,
      overdue: invoices.filter(inv => inv.status === 'overdue').length,
      cancelled: invoices.filter(inv => inv.status === 'cancelled').length,
      totalRevenue: invoices
        .filter(inv => inv.status === 'paid')
        .reduce((sum, inv) => sum + inv.grandTotal, 0),
      pendingAmount: invoices
        .filter(inv => inv.status === 'sent' || inv.status === 'overdue')
        .reduce((sum, inv) => sum + inv.grandTotal, 0),
    };

    res.status(200).json({
      success: true,
      count: invoices.length,
      stats,
      invoices,
    });
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
      .populate('items.product', 'name sku price')
      .populate('quotation', 'quotationNumber');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    res.status(200).json({
      success: true,
      invoice,
    });
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
      status,
    } = req.body;

    // Validate required fields
    if (!customerName || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customer name and at least one item',
      });
    }

    // Validate and populate item details
    const populatedItems = [];
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.product}`,
        });
      }

      populatedItems.push({
        product: product._id,
        productName: product.name,
        quantity: item.quantity,
        rate: item.rate || product.price,
        lineTotal: item.quantity * (item.rate || product.price),
      });
    }

    // Create invoice
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
      status: status || 'draft',
      createdBy: req.user.id,
    });

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
    let invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // Don't allow updating paid or cancelled invoices
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot update ${invoice.status} invoice`,
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
      status,
    } = req.body;

    // If items are being updated, validate and populate
    if (items && items.length > 0) {
      const populatedItems = [];
      for (const item of items) {
        const product = await Product.findById(item.product);
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.product}`,
          });
        }

        populatedItems.push({
          product: product._id,
          productName: product.name,
          quantity: item.quantity,
          rate: item.rate || product.price,
          lineTotal: item.quantity * (item.rate || product.price),
        });
      }
      invoice.items = populatedItems;
    }

    // Update fields
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
    if (status) invoice.status = status;

    await invoice.save();

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

// @desc    Mark invoice as paid
// @route   POST /api/invoices/:id/pay
// @access  Private
exports.markInvoiceAsPaid = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Invoice is already paid',
      });
    }

    const { paymentMethod, paidAmount, paidDate } = req.body;

    invoice.status = 'paid';
    invoice.paymentMethod = paymentMethod;
    invoice.paidAmount = paidAmount || invoice.grandTotal;
    invoice.paidDate = paidDate || Date.now();

    await invoice.save();

    const updatedInvoice = await Invoice.findById(invoice._id)
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku');

    res.status(200).json({
      success: true,
      message: 'Invoice marked as paid successfully',
      invoice: updatedInvoice,
    });
  } catch (error) {
    console.error('Mark invoice as paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while marking invoice as paid',
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
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
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
      return res.status(404).json({
        success: false,
        message: 'Invoice not found',
      });
    }

    // Only allow deleting draft invoices
    if (invoice.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft invoices can be deleted',
      });
    }

    await invoice.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully',
    });
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

    const stats = {
      totalInvoices: invoices.length,
      draft: invoices.filter(inv => inv.status === 'draft').length,
      sent: invoices.filter(inv => inv.status === 'sent').length,
      paid: invoices.filter(inv => inv.status === 'paid').length,
      overdue: invoices.filter(inv => inv.status === 'overdue').length,
      cancelled: invoices.filter(inv => inv.status === 'cancelled').length,
      totalRevenue: invoices
        .filter(inv => inv.status === 'paid')
        .reduce((sum, inv) => sum + inv.paidAmount, 0),
      pendingAmount: invoices
        .filter(inv => inv.status === 'sent' || inv.status === 'overdue')
        .reduce((sum, inv) => sum + inv.grandTotal, 0),
      overdueAmount: invoices
        .filter(inv => inv.status === 'overdue')
        .reduce((sum, inv) => sum + inv.grandTotal, 0),
    };

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching invoice statistics',
      error: error.message,
    });
  }
};
