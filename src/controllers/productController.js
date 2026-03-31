const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const mongoose = require('mongoose');

function isSqmUnit(unit) {
  return String(unit || '')
    .trim()
    .toLowerCase() === 'sqm';
}

function normalizeStockByUnit(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  if (isSqmUnit(unit)) return Math.round(numericValue * 100) / 100;
  return Math.floor(numericValue);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactCaseInsensitiveRegex(value) {
  return new RegExp(`^${escapeRegex(String(value || '').trim())}$`, 'i');
}

async function resolveSupplierDocument({ supplierId, supplierName, fallbackSupplierName }) {
  const normalizedSupplierId = String(supplierId || '').trim();
  if (normalizedSupplierId) {
    if (!mongoose.Types.ObjectId.isValid(normalizedSupplierId)) {
      return { error: 'Invalid supplier id' };
    }
    const supplierDoc = await Supplier.findById(normalizedSupplierId).select('_id name supplierNumber');
    if (!supplierDoc) {
      return { error: 'Selected supplier not found' };
    }
    return { supplierDoc };
  }

  const candidateName =
    supplierName !== undefined
      ? String(supplierName || '').trim()
      : String(fallbackSupplierName || '').trim();

  if (!candidateName) {
    return { error: 'Please select a supplier for Third-Party products' };
  }

  const supplierDoc = await Supplier.findOne({
    name: exactCaseInsensitiveRegex(candidateName),
  }).select('_id name supplierNumber');

  if (!supplierDoc) {
    return {
      error: `Supplier "${candidateName}" not found. Please choose an existing supplier.`,
    };
  }

  return { supplierDoc };
}

// @desc    Get all products
// @route   GET /api/products
// @access  Private
exports.getProducts = async (req, res) => {
  try {
    const { search, category, finish, status, supplierName, supplier } = req.query;

    const conditions = [];

    // Search by name, SKU, or category
    if (search) {
      conditions.push({
        $or: [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        ],
      });
    }

    // Filter by category
    if (category) {
      conditions.push({ category });
    }

    // Filter by finish
    if (finish) {
      conditions.push({ finish });
    }

    // Filter by supplier id (preferred), with backward-compatible supplierName fallback
    if (supplier && supplier !== 'all') {
      if (mongoose.Types.ObjectId.isValid(String(supplier))) {
        const supplierDoc = await Supplier.findById(supplier).select('_id name');
        if (!supplierDoc) {
          return res.status(200).json({
            success: true,
            count: 0,
            products: [],
          });
        }

        conditions.push({
          $or: [
            { supplier: supplierDoc._id },
            { supplierName: exactCaseInsensitiveRegex(supplierDoc.name) },
          ],
        });
      } else {
        conditions.push({
          supplierName: { $regex: String(supplier), $options: 'i' },
        });
      }
    } else if (supplierName) {
      conditions.push({ supplierName: { $regex: supplierName, $options: 'i' } });
    }

    // Filter by status (in stock, low stock, out of stock)
    if (status === 'out-of-stock') {
      conditions.push({ stock: 0 });
    } else if (status === 'low-stock') {
      conditions.push({ stock: { $gt: 0, $lte: 30 } });
    } else if (status === 'in-stock') {
      conditions.push({ stock: { $gt: 30 } });
    }

    const query =
      conditions.length === 0
        ? {}
        : conditions.length === 1
          ? conditions[0]
          : { $and: conditions };

    const products = await Product.find(query)
      .populate('createdBy', 'name email')
      .populate('supplier', 'name supplierNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Private
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      'createdBy',
      'name email'
    ).populate('supplier', 'name supplierNumber');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Create new product
// @route   POST /api/products
// @access  Private
exports.createProduct = async (req, res) => {
  try {
    // Add user to req.body
    req.body.createdBy = req.user.id;

    if (req.body.supplierType === 'own') {
      req.body.supplier = null;
      req.body.supplierName = '';
    } else if (req.body.supplierType === 'third-party') {
      const { supplierDoc, error } = await resolveSupplierDocument({
        supplierId: req.body.supplier || req.body.supplierId,
        supplierName: req.body.supplierName,
      });

      if (error) {
        return res.status(400).json({
          success: false,
          message: error,
        });
      }

      req.body.supplier = supplierDoc._id;
      req.body.supplierName = supplierDoc.name;
    }

    if (req.body.stock !== undefined) {
      req.body.stock = normalizeStockByUnit(req.body.stock, req.body.unit || 'boxes');
    }

    // Check if SKU already exists
    const existingProduct = await Product.findOne({ sku: req.body.sku });
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product with this SKU already exists',
      });
    }

    const product = await Product.create(req.body);
    await product.populate('supplier', 'name supplierNumber');

    res.status(201).json({
      success: true,
      product,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private
exports.updateProduct = async (req, res) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    const nextSupplierType = req.body.supplierType || product.supplierType || 'own';
    if (nextSupplierType === 'own') {
      req.body.supplier = null;
      req.body.supplierName = '';
    } else if (nextSupplierType === 'third-party') {
      const shouldResolveSupplier =
        req.body.supplierType !== undefined ||
        req.body.supplier !== undefined ||
        req.body.supplierId !== undefined ||
        req.body.supplierName !== undefined ||
        !product.supplier;

      if (shouldResolveSupplier) {
        const { supplierDoc, error } = await resolveSupplierDocument({
          supplierId: req.body.supplier || req.body.supplierId || product.supplier,
          supplierName: req.body.supplierName,
          fallbackSupplierName: product.supplierName,
        });

        if (error) {
          return res.status(400).json({
            success: false,
            message: error,
          });
        }

        req.body.supplier = supplierDoc._id;
        req.body.supplierName = supplierDoc.name;
      }
    }

    if (req.body.stock !== undefined || req.body.unit !== undefined) {
      const nextUnit = req.body.unit !== undefined ? req.body.unit : product.unit;
      const nextStock =
        req.body.stock !== undefined ? req.body.stock : product.stock;
      req.body.stock = normalizeStockByUnit(nextStock, nextUnit);
    }

    // Check if SKU is being updated and if it already exists
    if (req.body.sku && req.body.sku !== product.sku) {
      const existingProduct = await Product.findOne({ sku: req.body.sku });
      if (existingProduct) {
        return res.status(400).json({
          success: false,
          message: 'Product with this SKU already exists',
        });
      }
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    await product.populate('supplier', 'name supplierNumber');

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    await product.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update product stock
// @route   PATCH /api/products/:id/stock
// @access  Private
exports.updateStock = async (req, res) => {
  try {
    const { quantity, type } = req.body; // type: 'add' or 'subtract'

    if (!quantity || !type) {
      return res.status(400).json({
        success: false,
        message: 'Please provide quantity and type',
      });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    if (type === 'add') {
      product.stock += quantity;
    } else if (type === 'subtract') {
      if (product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock',
        });
      }
      product.stock -= quantity;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid type. Use "add" or "subtract"',
      });
    }

    await product.save();

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
