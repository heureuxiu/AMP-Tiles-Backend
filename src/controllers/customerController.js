const Customer = require('../models/Customer');
const Invoice = require('../models/Invoice');
const Quotation = require('../models/Quotation');
const { generateMonthlyStatementPdf } = require('../utils/monthlyStatementPdf');

let sendEmail = async () => {
  throw new Error('Email service is not available');
};

const SQFT_PER_SQM = 10.764;
const COMPANY_NAME = 'AMP TILES';

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

function normalizeEmailList(value, primaryEmail = '') {
  const seen = new Set();
  const normalizedPrimary = normalizeEmail(primaryEmail);
  const values = Array.isArray(value) ? value : String(value || '').split(/[,\n;\s]+/g);

  return values
    .map(normalizeEmail)
    .filter(Boolean)
    .filter((email) => {
      if (email === normalizedPrimary || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
}

function summarizeEmailError(error, fallbackMessage = 'Failed to send monthly statement email') {
  return [
    error?.message || fallbackMessage,
    error?.code ? `code=${error.code}` : '',
    error?.command ? `command=${error.command}` : '',
    error?.responseCode ? `responseCode=${error.responseCode}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEmailDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(Number(amount) || 0);
}

function buildMonthlyStatementEmail(statement) {
  const customerName = statement.customer?.name || 'Customer';
  const periodLabel = statement.monthLabel || [
    formatEmailDate(statement.dateRange?.start),
    formatEmailDate(statement.dateRange?.end),
  ].join(' - ');
  const balanceDue = Number(statement.totals?.outstandingTotal) || 0;
  const invoiceTotal = Number(statement.totals?.grandTotal) || 0;
  const paidTotal = Number(statement.totals?.paidTotal) || 0;

  const text = [
    `Dear ${customerName},`,
    '',
    `Please find attached your activity statement for ${periodLabel}.`,
    '',
    `From Date: ${formatEmailDate(statement.dateRange?.start)}`,
    `To Date: ${formatEmailDate(statement.dateRange?.end)}`,
    `Invoice Amount: ${formatCurrency(invoiceTotal)}`,
    `Payments: ${formatCurrency(paidTotal)}`,
    `Balance Due: ${formatCurrency(balanceDue)}`,
    '',
    'Should you have any questions regarding this statement, please do not hesitate to contact us.',
    '',
    'Thank you,',
    COMPANY_NAME,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color:#111827; line-height:1.45;">
      <p>Dear ${escapeHtml(customerName)},</p>
      <p>Please find attached your activity statement for ${escapeHtml(periodLabel)}.</p>
      <p>
        <strong>From Date:</strong> ${escapeHtml(formatEmailDate(statement.dateRange?.start))}<br/>
        <strong>To Date:</strong> ${escapeHtml(formatEmailDate(statement.dateRange?.end))}<br/>
        <strong>Invoice Amount:</strong> ${escapeHtml(formatCurrency(invoiceTotal))}<br/>
        <strong>Payments:</strong> ${escapeHtml(formatCurrency(paidTotal))}<br/>
        <strong>Balance Due:</strong> ${escapeHtml(formatCurrency(balanceDue))}
      </p>
      <p>Should you have any questions regarding this statement, please do not hesitate to contact us.</p>
      <p style="margin-top:24px;">
        Thank you,<br/>
        ${escapeHtml(COMPANY_NAME)}
      </p>
    </div>
  `;

  return {
    subject: `Activity Statement ${periodLabel} from ${COMPANY_NAME}`,
    text,
    html,
  };
}

function loadOptionalModule(candidates) {
  for (const mod of candidates) {
    try {
      return require(mod);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`Failed loading optional module "${mod}"`, error.message);
        }
        return null;
      }
    }
  }
  return null;
}

const mailerModule = loadOptionalModule(['../utils/mailer']);
if (mailerModule && typeof mailerModule.sendEmail === 'function') {
  ({ sendEmail } = mailerModule);
} else if (process.env.NODE_ENV !== 'production') {
  console.warn('Mailer utility not found. Monthly statement email sending will be disabled.');
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

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, monthNumber, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, day, 0, 0, 0, 0));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseStatementDateRange({ month, startDate, endDate } = {}) {
  if (startDate || endDate) {
    const start = parseDateOnly(startDate);
    const endStartOfDay = parseDateOnly(endDate);

    if (!start || !endStartOfDay) {
      const error = new Error('Please provide startDate and endDate in YYYY-MM-DD format');
      error.statusCode = 400;
      throw error;
    }

    const endExclusive = new Date(endStartOfDay.getTime() + 24 * 60 * 60 * 1000);
    if (start >= endExclusive) {
      const error = new Error('Start date must be before or equal to end date');
      error.statusCode = 400;
      throw error;
    }

    const end = new Date(endExclusive.getTime() - 1);
    const label = `${start.toLocaleDateString('en-AU', { timeZone: 'UTC' })} - ${endStartOfDay.toLocaleDateString('en-AU', { timeZone: 'UTC' })}`;

    return {
      start,
      end,
      endExclusive,
      label,
      key: `${startDate}-to-${endDate}`,
    };
  }

  const dateRange = parseStatementMonth(month);
  if (!dateRange) {
    const error = new Error('Please provide month in YYYY-MM format or startDate/endDate in YYYY-MM-DD format');
    error.statusCode = 400;
    throw error;
  }

  return {
    ...dateRange,
    key: month,
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

async function buildMonthlyStatement(customerId, periodOptions) {
  const dateRange = parseStatementDateRange(periodOptions);
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
    month: dateRange.key,
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
      page,
      limit,
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { customerNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { ccEmails: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { abn: { $regex: search, $options: 'i' } },
      ];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    const shouldPaginate = page !== undefined || limit !== undefined;
    const maxLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const skip = (currentPage - 1) * maxLimit;

    let customersQuery = Customer.find(query)
      .populate('createdBy', 'name email')
      .sort(sortObj);

    if (shouldPaginate) {
      customersQuery = customersQuery.skip(skip).limit(maxLimit);
    }

    const [customers, total] = await Promise.all([
      customersQuery,
      Customer.countDocuments(query),
    ]);

    const stats = {
      total,
      active: await Customer.countDocuments({ ...query, status: 'active' }),
      inactive: await Customer.countDocuments({ ...query, status: 'inactive' }),
    };

    res.status(200).json({
      success: true,
      count: customers.length,
      total,
      pagination: {
        page: currentPage,
        limit: shouldPaginate ? maxLimit : total,
        total,
        totalPages: shouldPaginate ? Math.max(Math.ceil(total / maxLimit), 1) : 1,
      },
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
    const { name, phone, email, ccEmails, abn, paymentTerms, deliveryMethod, address, notes } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedCcEmails = normalizeEmailList(ccEmails, normalizedEmail);

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and phone number',
      });
    }

    if (normalizedEmail) {
      const existingCustomer = await Customer.findOne({ email: normalizedEmail });
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
      email: normalizedEmail || undefined,
      ccEmails: normalizedCcEmails,
      abn,
      paymentTerms,
      deliveryMethod,
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
    const { name, phone, email, ccEmails, abn, paymentTerms, deliveryMethod, address, notes, status } = req.body;
    const normalizedEmail = email !== undefined ? normalizeEmail(email) : undefined;

    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    const normalizedCcEmails =
      ccEmails !== undefined ? normalizeEmailList(ccEmails, normalizedEmail ?? customer.email) : undefined;

    if (normalizedEmail && normalizedEmail !== customer.email) {
      const existingCustomer = await Customer.findOne({ email: normalizedEmail });
      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this email already exists',
        });
      }
    }

    customer.name = name || customer.name;
    customer.phone = phone || customer.phone;
    customer.email = normalizedEmail !== undefined ? normalizedEmail : customer.email;
    customer.ccEmails = normalizedCcEmails !== undefined ? normalizedCcEmails : customer.ccEmails;
    customer.abn = abn !== undefined ? abn : customer.abn;
    customer.paymentTerms =
      paymentTerms !== undefined ? paymentTerms : customer.paymentTerms;
    customer.deliveryMethod =
      deliveryMethod !== undefined ? deliveryMethod : customer.deliveryMethod;
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
    const statement = await buildMonthlyStatement(req.params.id, {
      month: req.query.month,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

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
    const statement = await buildMonthlyStatement(req.params.id, {
      month: req.query.month,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
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

exports.sendCustomerMonthlyStatementEmail = async (req, res) => {
  try {
    const statement = await buildMonthlyStatement(req.params.id, {
      month: req.query.month || req.body?.month,
      startDate: req.query.startDate || req.body?.startDate,
      endDate: req.query.endDate || req.body?.endDate,
    });

    const customerEmail = normalizeEmail(statement.customer?.email);
    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is missing. Please add customer email before sending monthly statement.',
      });
    }

    const customer = await Customer.findById(req.params.id).select('ccEmails');
    const ccEmails = normalizeEmailList(customer?.ccEmails || [], customerEmail);
    const pdfBuffer = await generateMonthlyStatementPdf(statement);
    const emailPayload = buildMonthlyStatementEmail(statement);
    const safeCustomerName = String(statement.customer?.name || 'customer')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const filename = `monthly-statement-${safeCustomerName}-${statement.month}.pdf`;

    await sendEmail({
      to: customerEmail,
      cc: ccEmails.length > 0 ? ccEmails.join(', ') : undefined,
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
      attachments: [
        {
          filename,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    });

    res.status(200).json({
      success: true,
      emailSent: true,
      message: `Monthly statement sent to ${customerEmail}${
        ccEmails.length > 0 ? ` (cc: ${ccEmails.join(', ')})` : ''
      }`,
      monthlyStatement: statement,
    });
  } catch (error) {
    const details = summarizeEmailError(error);
    console.error('Error sending customer monthly statement email:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: details || 'Failed to send monthly statement email',
    });
  }
};
