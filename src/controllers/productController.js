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

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(csvText) {
  const normalizedText = String(csvText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], error: 'CSV must include a header row and at least one product row' };
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] !== undefined ? values[headerIndex] : '';
    });
    return { rowNumber: index + 2, row };
  });

  return { rows };
}

function csvValue(row, aliases) {
  for (const alias of aliases) {
    const key = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (row[key] !== undefined && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function csvNumber(row, aliases, { required = false, min = 0 } = {}) {
  const value = csvValue(row, aliases);
  if (!value) {
    if (required) return { error: `${aliases[0]} is required` };
    return { value: undefined };
  }

  const numberValue = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(numberValue)) {
    return { error: `${aliases[0]} must be a valid number` };
  }
  if (numberValue < min) {
    return { error: `${aliases[0]} must be ${min} or greater` };
  }

  return { value: numberValue };
}

function buildProductPayloadFromCsv(row) {
  const requiredTextFields = [
    ['name', ['name', 'productName', 'product']],
    ['sku', ['sku', 'code', 'productCode']],
    ['category', ['category']],
    ['finish', ['finish']],
    ['size', ['size']],
    ['boxCoveragePackingDetails', ['boxCoveragePackingDetails', 'packingDetails', 'boxPacking', 'packing']],
  ];

  const payload = {};
  const errors = [];

  requiredTextFields.forEach(([field, aliases]) => {
    const value = csvValue(row, aliases);
    if (!value) errors.push(`${aliases[0]} is required`);
    payload[field] = value;
  });

  payload.description = csvValue(row, ['description']);
  payload.supplierType = csvValue(row, ['supplierType', 'supplier type']) || 'own';
  payload.supplierType = payload.supplierType.toLowerCase();
  if (!['own', 'third-party'].includes(payload.supplierType)) {
    errors.push('supplierType must be own or third-party');
  }
  payload.supplierName = csvValue(row, ['supplierName', 'supplier', 'supplier name']);

  const unit = csvValue(row, ['unit']) || 'sqm';
  payload.unit = unit;
  payload.pricingUnit = csvValue(row, ['pricingUnit', 'pricing unit']) || unitToPricingUnit(unit);
  if (!['per_box', 'per_sqft', 'per_sqm', 'per_piece'].includes(payload.pricingUnit)) {
    errors.push('pricingUnit must be per_box, per_sqft, per_sqm, or per_piece');
  }

  payload.coveragePerBoxUnit = csvValue(row, ['coveragePerBoxUnit', 'coverage unit']) || 'sqm';
  if (!['sqft', 'sqm'].includes(payload.coveragePerBoxUnit)) {
    errors.push('coveragePerBoxUnit must be sqft or sqm');
  }

  const numericFields = [
    ['retailPrice', ['retailPrice', 'retail price', 'price'], { required: true, min: 0 }],
    ['costPrice', ['costPrice', 'cost price'], { required: true, min: 0 }],
    ['stock', ['stock', 'quantity', 'qty'], { required: false, min: 0 }],
    ['tilesPerBox', ['tilesPerBox', 'tiles per box'], { required: false, min: 0 }],
    ['coveragePerBox', ['coveragePerBox', 'coverage per box'], { required: false, min: 0 }],
    ['weightPerBox', ['weightPerBox', 'weight per box'], { required: false, min: 0 }],
    ['discountSalePrice', ['discountSalePrice', 'discount sale price'], { required: false, min: 0 }],
    ['builderPrice', ['builderPrice', 'builder price'], { required: false, min: 0 }],
    ['taxPercent', ['taxPercent', 'tax percent', 'gst'], { required: false, min: 0 }],
  ];

  numericFields.forEach(([field, aliases, options]) => {
    const result = csvNumber(row, aliases, options);
    if (result.error) errors.push(result.error);
    if (result.value !== undefined) payload[field] = result.value;
  });

  if (payload.taxPercent !== undefined && payload.taxPercent > 100) {
    errors.push('taxPercent must be 100 or less');
  }

  return { payload, errors };
}

function unitToPricingUnit(unit) {
  const normalizedUnit = String(unit || '').trim().toLowerCase();
  if (normalizedUnit === 'pieces' || normalizedUnit === 'piece' || normalizedUnit === 'pcs') {
    return 'per_piece';
  }
  if (normalizedUnit === 'sqft' || normalizedUnit === 'sq ft') {
    return 'per_sqft';
  }
  if (normalizedUnit === 'box' || normalizedUnit === 'boxes') {
    return 'per_box';
  }
  return 'per_sqm';
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
    const {
      search,
      category,
      finish,
      status,
      supplierName,
      supplier,
      supplierType,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      limit,
    } = req.query;

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

    if (supplierType && supplierType !== 'all') {
      conditions.push({ supplierType });
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

    const maxLimit = Math.min(Math.max(Number(limit) || 0, 0), 100);
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    let productsQuery = Product.find(query)
      .populate('createdBy', 'name email')
      .populate('supplier', 'name supplierNumber')
      .sort(sort);

    if (maxLimit > 0) {
      productsQuery = productsQuery.limit(maxLimit);
    }

    const products = await productsQuery;

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

// @desc    Bulk import products from CSV
// @route   POST /api/products/import-csv
// @access  Private
exports.importCsvProducts = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please upload a CSV file',
      });
    }

    const { rows, error } = parseCsv(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    const result = {
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    for (const { rowNumber, row } of rows) {
      const { payload, errors } = buildProductPayloadFromCsv(row);

      if (payload.supplierType === 'third-party') {
        const { supplierDoc, error: supplierError } = await resolveSupplierDocument({
          supplierName: payload.supplierName,
        });

        if (supplierError) {
          errors.push(supplierError);
        } else {
          payload.supplier = supplierDoc._id;
          payload.supplierName = supplierDoc.name;
        }
      } else {
        payload.supplier = null;
        payload.supplierName = '';
      }

      if (payload.stock !== undefined) {
        payload.stock = normalizeStockByUnit(payload.stock, payload.unit);
      }

      if (errors.length > 0) {
        result.failed += 1;
        result.errors.push({ row: rowNumber, errors });
        continue;
      }

      const sku = String(payload.sku || '').trim().toUpperCase();
      let product = await Product.findOne({ sku });
      const isNewProduct = !product;

      if (!product) {
        product = new Product({
          ...payload,
          sku,
          createdBy: req.user.id,
        });
      } else {
        product.set({
          ...payload,
          sku,
        });
      }

      try {
        await product.save();
        if (isNewProduct) {
          result.created += 1;
        } else {
          result.updated += 1;
        }
      } catch (saveError) {
        result.failed += 1;
        result.errors.push({
          row: rowNumber,
          errors: [saveError.message],
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `CSV import completed. Created: ${result.created}, Updated: ${result.updated}, Failed: ${result.failed}`,
      importResult: result,
    });
  } catch (error) {
    res.status(500).json({
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
