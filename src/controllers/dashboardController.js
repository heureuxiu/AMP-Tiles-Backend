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
