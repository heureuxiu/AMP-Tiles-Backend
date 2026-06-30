const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const Quotation = require('../models/Quotation');
const Invoice = require('../models/Invoice');
const PurchaseOrder = require('../models/PurchaseOrder');

// @desc    Get lightweight dashboard summary counts
// @route   GET /api/dashboard/summary
// @access  Private
exports.getDashboardSummary = async (req, res) => {
  try {
    const [
      totalProducts,
      totalSuppliers,
      totalQuotations,
      totalInvoices,
      totalPurchaseOrders,
    ] = await Promise.all([
      Product.countDocuments(),
      Supplier.countDocuments(),
      Quotation.countDocuments(),
      Invoice.countDocuments(),
      PurchaseOrder.countDocuments(),
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalProducts,
        totalSuppliers,
        totalQuotations,
        totalInvoices,
        totalPurchaseOrders,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard summary',
      error: error.message,
    });
  }
};

// @desc    Get lightweight dashboard overview data
// @route   GET /api/dashboard/overview
// @access  Private
exports.getDashboardOverview = async (req, res) => {
  try {
    const startedAt = Date.now();
    const [
      totalProducts,
      totalSuppliers,
      totalQuotations,
      totalInvoices,
      totalPurchaseOrders,
      recentProducts,
      recentQuotations,
      recentInvoices,
    ] = await Promise.all([
      Product.countDocuments(),
      Supplier.countDocuments(),
      Quotation.countDocuments(),
      Invoice.countDocuments(),
      PurchaseOrder.countDocuments(),
      Product.find()
        .select('name sku category finish stock unit image')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Quotation.find()
        .select('quotationNumber customerName quotationDate grandTotal status')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Invoice.find()
        .select('invoiceNumber customerName invoiceDate grandTotal status')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    console.log(`Dashboard overview generated in ${Date.now() - startedAt}ms`);

    res.status(200).json({
      success: true,
      stats: {
        totalProducts,
        totalSuppliers,
        totalQuotations,
        totalInvoices,
        totalPurchaseOrders,
      },
      recentProducts,
      recentQuotations,
      recentInvoices,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard overview',
      error: error.message,
    });
  }
};
