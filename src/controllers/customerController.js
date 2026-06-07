const Customer = require('../models/Customer');

exports.getCustomers = async (req, res) => {
  try {
    const {
      search,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      limit,
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { customerNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    let customersQuery = Customer.find(query)
      .populate('createdBy', 'name email')
      .sort(sortObj);

    if (limit) {
      customersQuery = customersQuery.limit(parseInt(limit));
    }

    const customers = await customersQuery;

    const stats = {
      total: await Customer.countDocuments(),
      active: await Customer.countDocuments({ status: 'active' }),
      inactive: await Customer.countDocuments({ status: 'inactive' }),
    };

    res.status(200).json({
      success: true,
      count: customers.length,
      customers,
      stats,
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message,
    });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate(
      'createdBy',
      'name email'
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    res.status(200).json({
      success: true,
      customer,
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer',
      error: error.message,
    });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and phone number',
      });
    }

    if (email) {
      const existingCustomer = await Customer.findOne({ email });
      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this email already exists',
        });
      }
    }

    const customerPayload = {
      name,
      phone,
      email,
      address,
      notes,
      createdBy: req.user.id,
    };

    const maxCreateAttempts = 5;
    let customer;

    for (let attempt = 0; attempt < maxCreateAttempts; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        customer = await Customer.create(customerPayload);
        break;
      } catch (createError) {
        const isCustomerNumberDuplicate =
          createError?.code === 11000 &&
          (createError?.keyPattern?.customerNumber || createError?.keyValue?.customerNumber);

        const isFinalAttempt = attempt === maxCreateAttempts - 1;
        if (!isCustomerNumberDuplicate || isFinalAttempt) {
          throw createError;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customer,
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer',
      error: error.message,
    });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { name, phone, email, address, notes, status } = req.body;

    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    if (email && email !== customer.email) {
      const existingCustomer = await Customer.findOne({ email });
      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this email already exists',
        });
      }
    }

    customer.name = name || customer.name;
    customer.phone = phone || customer.phone;
    customer.email = email !== undefined ? email : customer.email;
    customer.address = address || customer.address;
    customer.notes = notes !== undefined ? notes : customer.notes;
    customer.status = status || customer.status;

    await customer.save();

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      customer,
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer',
      error: error.message,
    });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    await customer.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete customer',
      error: error.message,
    });
  }
};

exports.getCustomerStats = async (req, res) => {
  try {
    const stats = {
      totalCustomers: await Customer.countDocuments(),
      activeCustomers: await Customer.countDocuments({ status: 'active' }),
      inactiveCustomers: await Customer.countDocuments({ status: 'inactive' }),
      recentCustomers: await Customer.countDocuments({
        createdAt: {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      }),
    };

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching customer stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer stats',
      error: error.message,
    });
  }
};
