const Product = require('../models/Product');
const StockTransaction = require('../models/StockTransaction');

// @desc    Get all stock transactions
// @route   GET /api/stock/transactions
// @access  Private
exports.getTransactions = async (req, res) => {
  try {
    const { productId, type, startDate, endDate, limit = 50 } = req.query;
    
    // Build query
    const query = {};
    
    // Filter by product
    if (productId) {
      query.product = productId;
    }
    
    // Filter by type (stock-in or stock-out)
    if (type) {
      query.type = type;
    }
    
    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }
    
    const transactions = await StockTransaction.find(query)
      .populate('product', 'name sku image category finish')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single transaction
// @route   GET /api/stock/transactions/:id
// @access  Private
exports.getTransaction = async (req, res) => {
  try {
    const transaction = await StockTransaction.findById(req.params.id)
      .populate('product', 'name sku image category finish')
      .populate('createdBy', 'name email');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.status(200).json({
      success: true,
      transaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Create stock transaction (update stock)
// @route   POST /api/stock/update
// @access  Private
exports.updateStock = async (req, res) => {
  try {
    const { productId, type, quantity, remarks } = req.body;

    // Validation
    if (!productId || !type || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Please provide productId, type, and quantity',
      });
    }

    if (!['stock-in', 'stock-out'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Use "stock-in" or "stock-out"',
      });
    }

    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be at least 1',
      });
    }

    // Get product
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const previousStock = product.stock;
    let newStock;

    // Calculate new stock
    if (type === 'stock-in') {
      newStock = previousStock + quantity;
    } else {
      // stock-out
      if (previousStock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${previousStock}, Requested: ${quantity}`,
        });
      }
      newStock = previousStock - quantity;
    }

    // Update product stock
    product.stock = newStock;
    await product.save();

    // Create transaction record
    const transaction = await StockTransaction.create({
      product: productId,
      type,
      quantity,
      previousStock,
      newStock,
      remarks: remarks || '',
      createdBy: req.user.id,
    });

    // Populate transaction data
    await transaction.populate('product', 'name sku image category finish');
    await transaction.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: `Stock ${type === 'stock-in' ? 'added' : 'removed'} successfully`,
      transaction,
      product: {
        _id: product._id,
        name: product.name,
        sku: product.sku,
        previousStock,
        newStock,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get stock statistics
// @route   GET /api/stock/stats
// @access  Private
exports.getStockStats = async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    
    const stockStats = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalStock: { $sum: '$stock' },
          lowStockCount: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', 30] }] },
                1,
                0,
              ],
            },
          },
          outOfStockCount: {
            $sum: {
              $cond: [{ $eq: ['$stock', 0] }, 1, 0],
            },
          },
          inStockCount: {
            $sum: {
              $cond: [{ $gt: ['$stock', 30] }, 1, 0],
            },
          },
        },
      },
    ]);

    const stats = stockStats[0] || {
      totalStock: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      inStockCount: 0,
    };

    // Get recent transactions count
    const recentTransactions = await StockTransaction.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
    });

    res.status(200).json({
      success: true,
      stats: {
        totalProducts,
        totalStock: stats.totalStock,
        inStock: stats.inStockCount,
        lowStock: stats.lowStockCount,
        outOfStock: stats.outOfStockCount,
        recentTransactions,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get product stock history
// @route   GET /api/stock/history/:productId
// @access  Private
exports.getProductHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 20 } = req.query;

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const history = await StockTransaction.find({ product: productId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: history.length,
      product: {
        _id: product._id,
        name: product.name,
        sku: product.sku,
        currentStock: product.stock,
      },
      history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
