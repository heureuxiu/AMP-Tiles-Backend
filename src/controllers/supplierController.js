const Supplier = require('../models/Supplier');

// @desc    Get all suppliers with optional filtering
// @route   GET /api/suppliers
// @access  Private
exports.getSuppliers = async (req, res) => {
  try {
    const {
      search,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      limit,
    } = req.query;

    // Build query
    const query = {};

    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { supplierNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    let suppliersQuery = Supplier.find(query)
      .populate('createdBy', 'name email')
      .sort(sortObj);

    if (limit) {
      suppliersQuery = suppliersQuery.limit(parseInt(limit));
    }

    const suppliers = await suppliersQuery;

    // Get stats
    const stats = {
      total: await Supplier.countDocuments(),
      active: await Supplier.countDocuments({ status: 'active' }),
      inactive: await Supplier.countDocuments({ status: 'inactive' }),
    };

    res.status(200).json({
      success: true,
      count: suppliers.length,
      suppliers,
      stats,
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suppliers',
      error: error.message,
    });
  }
};

// @desc    Get single supplier
// @route   GET /api/suppliers/:id
// @access  Private
exports.getSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id).populate(
      'createdBy',
      'name email'
    );

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    res.status(200).json({
      success: true,
      supplier,
    });
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier',
      error: error.message,
    });
  }
};

// @desc    Create new supplier
// @route   POST /api/suppliers
// @access  Private
exports.createSupplier = async (req, res) => {
  try {
    const {
      name,
      contactPerson,
      phone,
      email,
      address,
      website,
      abn,
      notes,
      paymentTerms,
    } = req.body;

    // Validation
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and phone number',
      });
    }

    // Check if supplier with same email exists
    if (email) {
      const existingSupplier = await Supplier.findOne({ email });
      if (existingSupplier) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this email already exists',
        });
      }
    }

    // Create supplier
    const supplier = await Supplier.create({
      name,
      contactPerson,
      phone,
      email,
      address,
      website,
      abn,
      notes,
      paymentTerms,
      createdBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      supplier,
    });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create supplier',
      error: error.message,
    });
  }
};

// @desc    Update supplier
// @route   PUT /api/suppliers/:id
// @access  Private
exports.updateSupplier = async (req, res) => {
  try {
    const {
      name,
      contactPerson,
      phone,
      email,
      address,
      website,
      abn,
      notes,
      status,
      paymentTerms,
    } = req.body;

    let supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Check if email is being changed and if it already exists
    if (email && email !== supplier.email) {
      const existingSupplier = await Supplier.findOne({ email });
      if (existingSupplier) {
        return res.status(400).json({
          success: false,
          message: 'Supplier with this email already exists',
        });
      }
    }

    // Update fields
    supplier.name = name || supplier.name;
    supplier.contactPerson = contactPerson !== undefined ? contactPerson : supplier.contactPerson;
    supplier.phone = phone || supplier.phone;
    supplier.email = email !== undefined ? email : supplier.email;
    supplier.address = address || supplier.address;
    supplier.website = website !== undefined ? website : supplier.website;
    supplier.abn = abn !== undefined ? abn : supplier.abn;
    supplier.notes = notes !== undefined ? notes : supplier.notes;
    supplier.status = status || supplier.status;
    supplier.paymentTerms = paymentTerms !== undefined ? paymentTerms : supplier.paymentTerms;

    await supplier.save();

    res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      supplier,
    });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update supplier',
      error: error.message,
    });
  }
};

// @desc    Delete supplier
// @route   DELETE /api/suppliers/:id
// @access  Private
exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    await supplier.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Supplier deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete supplier',
      error: error.message,
    });
  }
};

// @desc    Get supplier stats
// @route   GET /api/suppliers/stats/summary
// @access  Private
exports.getSupplierStats = async (req, res) => {
  try {
    const stats = {
      totalSuppliers: await Supplier.countDocuments(),
      activeSuppliers: await Supplier.countDocuments({ status: 'active' }),
      inactiveSuppliers: await Supplier.countDocuments({ status: 'inactive' }),
      recentSuppliers: await Supplier.countDocuments({
        createdAt: {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      }),
    };

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching supplier stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supplier stats',
      error: error.message,
    });
  }
};
