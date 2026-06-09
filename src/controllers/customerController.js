const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Quotation = require('../models/Quotation');
const { generateMonthlyStatementPdf } = require('../utils/monthlyStatementPdf');

const SQFT_PER_SQM = 10.764;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundQty(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatAddress(address) {
  if (!address) return '';
  if (typeof address === 'string') return normalizeText(address);
  return [
    address.street,
    address.city,
    address.state,
    address.postcode,
    address.country,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(', ');
}

function parseStatementMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) return null;

  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(year, monthNumber, 1, 0, 0, 0, 0));
  const end = new Date(endExclusive.getTime() - 1);

  return {
    start,
    end,
    endExclusive,
    label: start.toLocaleDateString('en-AU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  };
}

function buildCustomerSnapshot(customer) {
  return {
    _id: customer._id,
    customerNumber: customer.customerNumber || '',
    name: customer.name || '',
    phone: customer.phone || '',
    email: customer.email || '',
    abn: customer.abn || '',
    address: formatAddress(customer.address),
  };
}

function buildCustomerTransactionQuery(customer, dateField, dateRange) {
  const or = [];
  const email = normalizeEmail(customer.email);
  const phone = normalizeText(customer.phone);
  const name = normalizeText(customer.name);

  if (email) or.push({ customerEmail: email });
  if (phone) or.push({ customerPhone: phone });
  if (name) or.push({ customerName: new RegExp(`^${escapeRegex(name)}$`, 'i') });

  return {
    [dateField]: {
      $gte: dateRange.start,
      $lt: dateRange.endExclusive,
    },
    ...(or.length > 0 ? { $or: or } : { customerName: '__no_customer_match__' }),
  };
}

function getDiscountAmount(doc) {
  const direct = Number(doc?.discountAmount);
  if (Number.isFinite(direct)) return roundMoney(direct);

  const discount = Number(doc?.discount) || 0;
  if (doc?.discountType === 'percentage') {
    return roundMoney((Number(doc?.subtotal) || 0) * (discount / 100));
  }
  return roundMoney(discount);
}

function getInvoiceAmounts(invoice) {
  const subtotal = roundMoney(invoice.subtotal);
  const discount = getDiscountAmount(invoice);
  const gst = roundMoney(invoice.tax);
  const delivery = roundMoney(invoice.deliveryCost);
  const grandTotal = roundMoney(invoice.grandTotal);
  const paid = roundMoney(Math.min(Math.max(0, Number(invoice.amountPaid) || 0), grandTotal));
  const outstanding = roundMoney(
    Number.isFinite(Number(invoice.remainingBalance))
      ? invoice.remainingBalance
      : Math.max(0, grandTotal - paid)
  );

  return { subtotal, discount, gst, delivery, grandTotal, paid, outstanding };
}

function getQuotationAmounts(quotation) {
  return {
    subtotal: roundMoney(quotation.subtotal),
    discount: getDiscountAmount(quotation),
    gst: roundMoney(quotation.tax),
    delivery: roundMoney(quotation.deliveryCost),
    grandTotal: roundMoney(quotation.grandTotal),
  };
}

function getCoverageTotals(item) {
  const quantity = Number(item?.quantity) || 0;
  const coverageSqm = Number(item?.coverageSqm);
  const unitType = String(item?.unitType || '').toLowerCase();

  if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
    return {
      coverageSqm: roundQty(coverageSqm),
      coverageSqft: roundQty(coverageSqm * SQFT_PER_SQM),
    };
  }

  if (unitType.includes('sq meter') || unitType.includes('sqm')) {
    return {
      coverageSqm: roundQty(quantity),
      coverageSqft: roundQty(quantity * SQFT_PER_SQM),
    };
  }

  if (unitType.includes('sq ft') || unitType.includes('sqft')) {
    return {
      coverageSqm: roundQty(quantity / SQFT_PER_SQM),
      coverageSqft: roundQty(quantity),
    };
  }

  return { coverageSqm: 0, coverageSqft: 0 };
}

function addProductSummary(productMap, item) {
  const productId = item?.product?._id || item?.product || '';
  const key = String(productId || `${item?.productName || 'Product'}-${item?.size || ''}-${item?.unitType || ''}`);
  const quantity = Number(item?.quantity) || 0;
  const unitType = item?.unitType || '';
  const lineTotal = roundMoney(item?.lineTotal);
  const coverageTotals = getCoverageTotals(item);

  if (!productMap.has(key)) {
    productMap.set(key, {
      productId: productId ? String(productId) : '',
      productName: item?.productName || item?.product?.name || 'Product',
      size: item?.size || item?.product?.size || '',
      unitType,
      quantity: 0,
      boxes: 0,
      coverageSqm: 0,
      coverageSqft: 0,
      unitPrice: roundMoney(item?.rate),
      total: 0,
    });
  }

  const summary = productMap.get(key);
  summary.quantity = roundQty(summary.quantity + quantity);
  if (String(unitType).toLowerCase().includes('box')) {
    summary.boxes = roundQty(summary.boxes + quantity);
  }
  summary.coverageSqm = roundQty(summary.coverageSqm + coverageTotals.coverageSqm);
  summary.coverageSqft = roundQty(summary.coverageSqft + coverageTotals.coverageSqft);
  summary.total = roundMoney(summary.total + lineTotal);
  summary.unitPrice = summary.quantity > 0 ? roundMoney(summary.total / summary.quantity) : summary.unitPrice;
}

async function buildMonthlyStatement(customerId, month) {
  const dateRange = parseStatementMonth(month);
  if (!dateRange) {
    const error = new Error('Please provide month in YYYY-MM format');
    error.statusCode = 400;
    throw error;
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    const error = new Error('Customer not found');
    error.statusCode = 404;
    throw error;
  }

  const [invoices, quotations] = await Promise.all([
    Invoice.find(buildCustomerTransactionQuery(customer, 'invoiceDate', dateRange))
      .populate('items.product', 'name sku size coveragePerBox coveragePerBoxUnit')
      .sort({ invoiceDate: 1, createdAt: 1 }),
    Quotation.find(buildCustomerTransactionQuery(customer, 'quotationDate', dateRange))
      .populate('items.product', 'name sku size coveragePerBox coveragePerBoxUnit')
      .sort({ quotationDate: 1, createdAt: 1 }),
  ]);

  const productMap = new Map();
  const totals = {
    subtotalBeforeGst: 0,
    gstTotal: 0,
    deliveryTotal: 0,
    discountTotal: 0,
    grandTotal: 0,
    paidTotal: 0,
    outstandingTotal: 0,
  };

  const invoiceList = invoices.map((invoice) => {
    const amounts = getInvoiceAmounts(invoice);
    totals.subtotalBeforeGst = roundMoney(totals.subtotalBeforeGst + amounts.subtotal);
    totals.gstTotal = roundMoney(totals.gstTotal + amounts.gst);
    totals.deliveryTotal = roundMoney(totals.deliveryTotal + amounts.delivery);
    totals.discountTotal = roundMoney(totals.discountTotal + amounts.discount);
    totals.grandTotal = roundMoney(totals.grandTotal + amounts.grandTotal);
    totals.paidTotal = roundMoney(totals.paidTotal + amounts.paid);
    totals.outstandingTotal = roundMoney(totals.outstandingTotal + amounts.outstanding);

    (invoice.items || []).forEach((item) => addProductSummary(productMap, item));

    return {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber || String(invoice._id),
      reference: invoice.reference || '',
      date: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      paidDate: invoice.paidDate,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      subtotal: amounts.subtotal,
      gst: amounts.gst,
      delivery: amounts.delivery,
      discount: amounts.discount,
      total: amounts.grandTotal,
      paid: amounts.paid,
      outstanding: amounts.outstanding,
    };
  });

  const quotationList = quotations.map((quotation) => {
    const amounts = getQuotationAmounts(quotation);
    return {
      _id: quotation._id,
      quotationNumber: quotation.quotationNumber || String(quotation._id),
      date: quotation.quotationDate,
      validUntil: quotation.validUntil,
      status: quotation.status,
      subtotal: amounts.subtotal,
      gst: amounts.gst,
      delivery: amounts.delivery,
      discount: amounts.discount,
      total: amounts.grandTotal,
    };
  });

  return {
    customer: buildCustomerSnapshot(customer),
    month,
    monthLabel: dateRange.label,
    dateRange: {
      start: dateRange.start,
      end: dateRange.end,
    },
    transactionCount: invoiceList.length + quotationList.length,
    totalInvoiceCount: invoiceList.length,
    totalQuotationCount: quotationList.length,
    invoices: invoiceList,
    quotations: quotationList,
    productSummary: Array.from(productMap.values()).sort((a, b) =>
      a.productName.localeCompare(b.productName)
    ),
    totals,
  };
}

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
        { abn: { $regex: search, $options: 'i' } },
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
    const { name, phone, email, abn, address, notes } = req.body;

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
      abn,
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
    const { name, phone, email, abn, address, notes, status } = req.body;

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
    customer.abn = abn !== undefined ? abn : customer.abn;
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

exports.getCustomerMonthlyStatement = async (req, res) => {
  try {
    const statement = await buildMonthlyStatement(req.params.id, req.query.month);

    res.status(200).json({
      success: true,
      monthlyStatement: statement,
    });
  } catch (error) {
    console.error('Error fetching customer monthly statement:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch customer monthly statement',
    });
  }
};

exports.getCustomerMonthlyStatementPdf = async (req, res) => {
  try {
    const statement = await buildMonthlyStatement(req.params.id, req.query.month);
    const pdfBuffer = await generateMonthlyStatementPdf(statement);
    const safeCustomerName = String(statement.customer?.name || 'customer')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const filename = `monthly-statement-${safeCustomerName}-${statement.month}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating customer monthly statement PDF:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to generate customer monthly statement PDF',
    });
  }
};
