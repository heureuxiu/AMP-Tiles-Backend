const Quotation = require('../models/Quotation');
const Product = require('../models/Product');
const Invoice = require('../models/Invoice');

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

// Helper to build one quotation item with discount/tax and optional tiles coverage
function buildQuotationItem(product, item) {
  const quantity = Number(item.quantity) || 0;
  const rate = Number(item.rate) || product.retailPrice || product.price || 0;
  const unitType = item.unitType || 'Box';
  const discountPercent = Number(item.discountPercent) || 0;
  const taxPercent =
    item.taxPercent != null
      ? Number(item.taxPercent)
      : product.taxPercent != null
      ? product.taxPercent
      : 0;

  const base = quantity * rate;
  const discountAmount = (base * discountPercent) / 100;
  const taxable = base - discountAmount;
  const taxAmount = (taxable * taxPercent) / 100;
  const lineTotal = Math.round((taxable + taxAmount) * 100) / 100;

  // Tiles coverage in sqm (optional)
  let coverageSqm = null;
  const covPerBox = product.coveragePerBox;
  const covUnit = (product.coveragePerBoxUnit || 'sqft').toLowerCase();
  if (covPerBox != null && covPerBox > 0) {
    if (unitType === 'Box') {
      coverageSqm = covUnit === 'sqm' ? quantity * covPerBox : (quantity * covPerBox) / 10.764;
    } else if (unitType === 'Sq Meter') {
      coverageSqm = quantity;
    } else if (unitType === 'Sq Ft') {
      coverageSqm = quantity / 10.764;
    }
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
    } = req.body;

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one item',
      });
    }

    // Validate and populate items (with discount / tax per line)
    const populatedItems = [];
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found: ${item.product}`,
        });
      }

      const built = buildQuotationItem(product, item);
      populatedItems.push(built.populated);
      subtotal += built.base;
      totalDiscount += built.discountAmount;
      totalTax += built.taxAmount;
    }

    const grandTotal = subtotal - totalDiscount + totalTax;

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
      grandTotal,
      notes,
      terms,
      status: status || 'draft',
      createdBy: req.user.id,
    });

    // Populate references
    await quotation.populate('createdBy', 'name email');
    await quotation.populate('items.product', 'name sku');

    res.status(201).json({
      success: true,
      quotation,
    });
  } catch (error) {
    res.status(400).json({
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

    // If items are being updated, recalculate totals
    if (items && items.length > 0) {
      const populatedItems = [];
      let subtotal = 0;
      let totalDiscount = 0;
      let totalTax = 0;
      for (const item of items) {
        const product = await Product.findById(item.product);
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product not found: ${item.product}`,
          });
        }

        const built = buildQuotationItem(product, item);
        populatedItems.push(built.populated);
        subtotal += built.base;
        totalDiscount += built.discountAmount;
        totalTax += built.taxAmount;
      }

      const grandTotal = subtotal - totalDiscount + totalTax;

      quotation.items = populatedItems;
      quotation.subtotal = subtotal;
      quotation.discount = totalDiscount;
      quotation.discountType = discountType || quotation.discountType;
      quotation.tax = totalTax;
      quotation.taxRate = taxRate || quotation.taxRate;
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

    await quotation.save();

    // Populate references
    await quotation.populate('createdBy', 'name email');
    await quotation.populate('items.product', 'name sku');

    res.status(200).json({
      success: true,
      quotation,
    });
  } catch (error) {
    res.status(400).json({
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

    if (quotation.status === 'converted') {
      return res.status(400).json({
        success: false,
        message: 'Quotation already converted to invoice',
      });
    }

    // Build invoice items (product may be ObjectId or populated)
    const invoiceItems = quotation.items.map((item) => ({
      product: item.product._id || item.product,
      productName: item.productName || (item.product && item.product.name) || 'Product',
      quantity: item.quantity,
      rate: item.rate,
      lineTotal: item.lineTotal,
    }));

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
      discount: quotation.discount || 0,
      discountType: quotation.discountType || 'fixed',
      taxRate: quotation.taxRate || 10,
      notes: quotation.notes,
      terms: quotation.terms,
      status: 'draft',
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
