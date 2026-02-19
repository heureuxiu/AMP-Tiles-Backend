const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');

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

    // Build query
    const query = {};

    // Search filter
    if (search) {
      query.$or = [
        { poNumber: { $regex: search, $options: 'i' } },
        { supplierName: { $regex: search, $options: 'i' } },
      ];
    }

    // Supplier filter
    if (supplier && supplier !== 'all') {
      query.supplier = supplier;
    }

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      query.poDate = {};
      if (startDate) query.poDate.$gte = new Date(startDate);
      if (endDate) query.poDate.$lte = new Date(endDate);
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const purchaseOrders = await PurchaseOrder.find(query)
      .populate('supplier', 'name supplierNumber')
      .populate('createdBy', 'name email')
      .populate('items.product', 'name sku')
      .sort(sortObj);

    // Get stats
    const stats = {
      total: await PurchaseOrder.countDocuments(),
      draft: await PurchaseOrder.countDocuments({ status: 'draft' }),
      sent: await PurchaseOrder.countDocuments({ status: 'sent' }),
      received: await PurchaseOrder.countDocuments({ status: 'received' }),
      cancelled: await PurchaseOrder.countDocuments({ status: 'cancelled' }),
      totalValue: 0,
    };

    // Calculate total value
    const allOrders = await PurchaseOrder.find();
    stats.totalValue = allOrders.reduce((sum, po) => sum + po.grandTotal, 0);

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
      .populate('items.product', 'name sku unit');

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

// @desc    Create new purchase order
// @route   POST /api/purchase-orders
// @access  Private
exports.createPurchaseOrder = async (req, res) => {
  try {
    const {
      supplier,
      poDate,
      expectedDeliveryDate,
      items,
      taxRate,
      notes,
      terms,
    } = req.body;

    // Validation
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

    // Verify supplier exists
    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Validate and calculate item totals
    const validatedItems = [];
    for (const item of items) {
      if (!item.product || !item.quantity || !item.rate) {
        return res.status(400).json({
          success: false,
          message: 'Each item must have product, quantity, and rate',
        });
      }

      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product with ID ${item.product} not found`,
        });
      }

      validatedItems.push({
        product: item.product,
        productName: product.name,
        quantity: item.quantity,
        rate: item.rate,
        lineTotal: item.quantity * item.rate,
      });
    }

    // Create purchase order
    const purchaseOrder = await PurchaseOrder.create({
      supplier,
      supplierName: supplierDoc.name,
      poDate: poDate || Date.now(),
      expectedDeliveryDate,
      items: validatedItems,
      taxRate: taxRate || 10,
      notes,
      terms,
      createdBy: req.user.id,
    });

    // Populate references before sending response
    await purchaseOrder.populate('supplier');
    await purchaseOrder.populate('items.product', 'name sku');

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

    // Check if PO is already received or cancelled
    if (purchaseOrder.status === 'received' || purchaseOrder.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot update ${purchaseOrder.status} purchase order`,
      });
    }

    const {
      supplier,
      poDate,
      expectedDeliveryDate,
      items,
      taxRate,
      notes,
      terms,
      status,
    } = req.body;

    // If supplier is being changed, verify it exists
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
    }

    // If items are being updated, validate them
    if (items && items.length > 0) {
      const validatedItems = [];
      for (const item of items) {
        if (!item.product || !item.quantity || !item.rate) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have product, quantity, and rate',
          });
        }

        const product = await Product.findById(item.product);
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product with ID ${item.product} not found`,
          });
        }

        validatedItems.push({
          product: item.product,
          productName: product.name,
          quantity: item.quantity,
          rate: item.rate,
          lineTotal: item.quantity * item.rate,
        });
      }
      purchaseOrder.items = validatedItems;
    }

    // Update other fields
    if (poDate) purchaseOrder.poDate = poDate;
    if (expectedDeliveryDate) purchaseOrder.expectedDeliveryDate = expectedDeliveryDate;
    if (taxRate !== undefined) purchaseOrder.taxRate = taxRate;
    if (notes !== undefined) purchaseOrder.notes = notes;
    if (terms !== undefined) purchaseOrder.terms = terms;
    if (status) purchaseOrder.status = status;

    await purchaseOrder.save();

    // Populate references
    await purchaseOrder.populate('supplier');
    await purchaseOrder.populate('items.product', 'name sku');

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

// @desc    Mark purchase order as received (and update stock)
// @route   POST /api/purchase-orders/:id/receive
// @access  Private
exports.receivePurchaseOrder = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id).populate('items.product');

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: 'Purchase order not found',
      });
    }

    if (purchaseOrder.status === 'received') {
      return res.status(400).json({
        success: false,
        message: 'Purchase order is already marked as received',
      });
    }

    if (purchaseOrder.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot receive a cancelled purchase order',
      });
    }

    // Update stock for each item
    for (const item of purchaseOrder.items) {
      const product = await Product.findById(item.product);
      if (product) {
        product.stock += item.quantity;
        await product.save();
      }
    }

    // Update PO status
    purchaseOrder.status = 'received';
    purchaseOrder.receivedDate = new Date();
    await purchaseOrder.save();

    res.status(200).json({
      success: true,
      message: 'Purchase order marked as received and stock updated',
      purchaseOrder,
    });
  } catch (error) {
    console.error('Error receiving purchase order:', error);
    res.status(500).json({
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

    // Only allow deletion of draft purchase orders
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
    const stats = {
      totalPurchaseOrders: await PurchaseOrder.countDocuments(),
      draft: await PurchaseOrder.countDocuments({ status: 'draft' }),
      sent: await PurchaseOrder.countDocuments({ status: 'sent' }),
      received: await PurchaseOrder.countDocuments({ status: 'received' }),
      cancelled: await PurchaseOrder.countDocuments({ status: 'cancelled' }),
      recentPurchaseOrders: await PurchaseOrder.countDocuments({
        createdAt: {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      }),
      totalValue: 0,
    };

    // Calculate total value
    const allOrders = await PurchaseOrder.find();
    stats.totalValue = allOrders.reduce((sum, po) => sum + po.grandTotal, 0);

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
