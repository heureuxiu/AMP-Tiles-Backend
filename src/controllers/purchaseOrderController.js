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
      .populate('items.product', 'name sku unit tilesPerBox coveragePerBox coveragePerBoxUnit')
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
      .populate('items.product', 'name sku unit tilesPerBox coveragePerBox coveragePerBoxUnit');

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
function buildItem(product, item) {
  const qty = Number(item.quantityOrdered) || 0;
  const rate = Number(item.rate) || 0;
  const discount = Number(item.discountPercent) || 0;
  const tax = Number(item.taxPercent) || 0;
  const afterDiscount = qty * rate * (1 - discount / 100);
  const lineTotal = Math.round(afterDiscount * (1 + tax / 100) * 100) / 100;
  let coverageSqm = null;
  if (product && (product.coveragePerBox || product.tilesPerBox)) {
    const coveragePerBox = Number(product.coveragePerBox) || 0;
    const perBox = product.coveragePerBoxUnit === 'sqm' ? coveragePerBox : (coveragePerBox * 0.092903) || 0;
    if (item.unitType === 'Box' && perBox) coverageSqm = qty * perBox;
    else if (item.unitType === 'Sq Ft' && qty) coverageSqm = Math.round((qty * 0.092903) * 100) / 100;
  }
  return {
    product: product._id,
    productName: product.name,
    sku: product.sku || '',
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
      if (!item.product || item.quantityOrdered == null || item.rate == null) {
        return res.status(400).json({
          success: false,
          message: 'Each item must have product, quantityOrdered, and rate',
        });
      }
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product with ID ${item.product} not found`,
        });
      }
      validatedItems.push(buildItem(product, item));
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
    await purchaseOrder.populate('items.product', 'name sku tilesPerBox coveragePerBox coveragePerBoxUnit');

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

    if (poDate) purchaseOrder.poDate = poDate;
    if (expectedDeliveryDate !== undefined) purchaseOrder.expectedDeliveryDate = expectedDeliveryDate;
    if (warehouseLocation !== undefined) purchaseOrder.warehouseLocation = warehouseLocation;
    if (currency !== undefined) purchaseOrder.currency = currency;
    if (paymentTerms !== undefined) purchaseOrder.paymentTerms = paymentTerms;
    if (deliveryAddress !== undefined) purchaseOrder.deliveryAddress = deliveryAddress;
    if (notes !== undefined) purchaseOrder.notes = notes;
    if (terms !== undefined) purchaseOrder.terms = terms;
    if (status) purchaseOrder.status = status;

    if (items && items.length > 0) {
      const validatedItems = [];
      for (const item of items) {
        if (!item.product || item.quantityOrdered == null || item.rate == null) {
          return res.status(400).json({
            success: false,
            message: 'Each item must have product, quantityOrdered, and rate',
          });
        }
        const product = await Product.findById(item.product);
        if (!product) {
          return res.status(404).json({
            success: false,
            message: `Product with ID ${item.product} not found`,
          });
        }
        const built = buildItem(product, item);
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
    await purchaseOrder.populate('items.product', 'name sku tilesPerBox coveragePerBox coveragePerBoxUnit');

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

// @desc    Receive goods (per-line quantities). Updates stock only for quantityReceived.
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

        item.quantityReceived = (item.quantityReceived || 0) + qtyReceived;
        item.damagedQuantity = (item.damagedQuantity || 0) + damaged;
        if (r.batchNumber) item.batchNumber = r.batchNumber;
        item.receivedDate = item.receivedDate || receivedDate;

        // Increase product stock by quantityReceived only
        if (qtyReceived > 0 && item.product) {
          const product = await Product.findById(item.product._id || item.product);
          if (product) {
            product.stock = (product.stock || 0) + qtyReceived;
            await product.save();
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
    } else if (anyReceived) {
      purchaseOrder.status = 'partially_received';
    }

    await purchaseOrder.save();
    await purchaseOrder.populate('supplier');
    await purchaseOrder.populate('items.product', 'name sku tilesPerBox coveragePerBox coveragePerBoxUnit');

    res.status(200).json({
      success: true,
      message: 'Goods receiving updated and stock increased for received quantities',
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
