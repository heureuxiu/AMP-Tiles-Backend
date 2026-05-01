function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num);
}

function toCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

const DEFAULT_DELIVERY_COST = 0;
const COMPANY_DETAILS = {
  name: 'AMP TILES PTY LTD',
  abn: '14 690 181 858',
  address: 'Unit 15/55 Anderson Road, Smeaton Grange, NSW 2567',
};
const SQFT_PER_SQM = 10.764;
const BANK_DETAILS = {
  bank: 'NAB',
  accountName: 'AMP TILES PTY LTD',
  bsb: '082-356',
  accountNumber: '26-722-1347',
};

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

function getDisplayQuantity(item) {
  const unitType = String(item?.unitType || '').toLowerCase();
  const coverageSqm = Number(item?.coverageSqm);
  if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
    if (
      unitType.includes('sqft') ||
      unitType.includes('sq ft') ||
      unitType.includes('sqfeet')
    ) {
      return formatQuantity(coverageSqm * SQFT_PER_SQM);
    }
    if (
      unitType.includes('sqm') ||
      unitType.includes('sq meter') ||
      unitType.includes('sqmetre')
    ) {
      return formatQuantity(coverageSqm);
    }
  }
  return formatQuantity(item?.quantity ?? 0);
}

function getInvoiceAmountSnapshot(invoice) {
  const subtotal = Number(invoice?.subtotal) || 0;
  const discountAmount = Number(invoice?.discountAmount ?? invoice?.discount) || 0;
  const taxAmount = Number(invoice?.tax) || 0;
  const baseTotal = subtotal - discountAmount + taxAmount;
  const parsedDelivery = Number(invoice?.deliveryCost);
  const fallbackDelivery = Math.max(0, Math.round((Number(invoice?.grandTotal) - baseTotal) * 100) / 100);
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : DEFAULT_DELIVERY_COST;
  const grandTotal = Number.isFinite(Number(invoice?.grandTotal))
    ? Number(invoice.grandTotal)
    : baseTotal + deliveryCost;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

function getPaymentSnapshot(invoice) {
  const amounts = getInvoiceAmountSnapshot(invoice);
  const totalCents = Math.max(0, toCents(amounts.grandTotal));
  const paidCents = Math.max(0, Math.min(totalCents, toCents(invoice?.amountPaid)));
  const remainingCents = Math.max(0, totalCents - paidCents);
  const paidPercent = totalCents > 0 ? Math.round((paidCents / totalCents) * 100) : 0;

  const paymentStatus =
    paidCents <= 0
      ? 'unpaid'
      : paidCents >= totalCents
        ? 'paid'
        : 'partially_paid';

  return {
    amounts,
    totalCents,
    paidCents,
    remainingCents,
    paidPercent,
    paymentStatus,
  };
}

function getDeliveryAddress(source) {
  return String(source?.deliveryAddress || source?.customerAddress || '').trim();
}

function getInvoiceItemDetails(item) {
  const product =
    item && item.product && typeof item.product === 'object' ? item.product : null;
  const productName = item?.productName || product?.name || 'Product';
  const skuRaw = item?.sku ?? product?.sku;
  const descriptionRaw = item?.description ?? product?.description;
  const sizeRaw = product?.size ?? item?.size;

  return {
    productName,
    sku: skuRaw ? String(skuRaw) : 'N/A',
    description: descriptionRaw ? String(descriptionRaw) : 'N/A',
    size: sizeRaw ? String(sizeRaw) : 'N/A',
    unit: item?.unitType || 'N/A',
    quantity: getDisplayQuantity(item),
    rate: Number(item?.rate) || 0,
    amount: Number(item?.lineTotal) || 0,
  };
}

function buildInvoiceEmail(invoice) {
  const invoiceNo = invoice.invoiceNumber || String(invoice._id || '');
  const customerName = invoice.customerName || 'Customer';
  const deliveryAddress = getDeliveryAddress(invoice);
  const payment = getPaymentSnapshot(invoice);

  const isFinalReceipt = payment.paymentStatus === 'paid';
  const paymentStatusLabel = isFinalReceipt
    ? 'Fully Paid'
    : payment.paymentStatus === 'partially_paid'
      ? 'Partially Paid'
      : 'Unpaid';

  const subject = isFinalReceipt
    ? `Payment received in full for Invoice ${invoiceNo}`
    : `Updated Invoice ${invoiceNo} from ${COMPANY_DETAILS.name}`;

  const intro = isFinalReceipt
    ? 'Thank you. We confirm this invoice is now fully paid.'
    : 'Please find your latest updated invoice and payment status below.';

  const rowsHtml = (invoice.items || [])
    .map((item) => {
      const details = getInvoiceItemDetails(item);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.productName)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.sku)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.description)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.size)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.unit)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${details.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.rate)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.amount)}</td>
      </tr>`;
    })
    .join('');
  const totalsRowsHtml = [
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Subtotal</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(payment.amounts.subtotal))}</td>
    </tr>`,
    payment.amounts.discountAmount > 0
      ? `<tr>
          <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Discount</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">-${escapeHtml(formatCurrency(payment.amounts.discountAmount))}</td>
        </tr>`
      : '',
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Tax (GST)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(payment.amounts.taxAmount))}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery Cost</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(payment.amounts.deliveryCost))}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Grand Total</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">${escapeHtml(formatCurrency(payment.amounts.grandTotal))}</td>
    </tr>`,
  ]
    .filter(Boolean)
    .join('');

  const text = [
    `Invoice ${invoiceNo}`,
    `Dear ${customerName},`,
    '',
    intro,
    '',
    `Invoice Date: ${formatDate(invoice.invoiceDate)}`,
    `Due Date: ${invoice.dueDate ? formatDate(invoice.dueDate) : 'N/A'}`,
    deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
    `Subtotal: ${formatCurrency(payment.amounts.subtotal)}`,
    payment.amounts.discountAmount > 0
      ? `Discount: -${formatCurrency(payment.amounts.discountAmount)}`
      : '',
    payment.amounts.taxAmount > 0 ? `Tax (GST): ${formatCurrency(payment.amounts.taxAmount)}` : '',
    `Delivery Cost: ${formatCurrency(payment.amounts.deliveryCost)}`,
    `Grand Total: ${formatCurrency(payment.amounts.grandTotal)}`,
    `Amount Received: ${formatCurrency(payment.paidCents / 100)}`,
    `Outstanding: ${formatCurrency(payment.remainingCents / 100)}`,
    `Payment Status: ${paymentStatusLabel} (${payment.paidPercent}%)`,
    '',
    'Items:',
    ...(invoice.items || []).map((item) => {
      const details = getInvoiceItemDetails(item);
      return `- ${details.productName} | SKU: ${details.sku} | Desc: ${details.description} | Size: ${details.size} | Unit: ${details.unit} | Qty: ${details.quantity} | Rate: ${formatCurrency(details.rate)} | Amount: ${formatCurrency(details.amount)}`;
    }),
    '',
    'Please see attached invoice PDF for your records.',
    '',
    `${COMPANY_DETAILS.name}`,
    `ABN: ${COMPANY_DETAILS.abn}`,
    `Address: ${COMPANY_DETAILS.address}`,
    `Bank: ${BANK_DETAILS.bank}`,
    `Account Name: ${BANK_DETAILS.accountName}`,
    `BSB: ${BANK_DETAILS.bsb}`,
    `Account Number: ${BANK_DETAILS.accountNumber}`,
    '',
    'Thank you,',
    COMPANY_DETAILS.name,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.45;">
      <h2 style="margin:0 0 16px;">Invoice ${escapeHtml(invoiceNo)}</h2>
      <p>Dear ${escapeHtml(customerName)},</p>
      <p>${escapeHtml(intro)}</p>
      <p>
        <strong>Invoice Date:</strong> ${escapeHtml(formatDate(invoice.invoiceDate))}<br/>
        <strong>Due Date:</strong> ${escapeHtml(invoice.dueDate ? formatDate(invoice.dueDate) : 'N/A')}<br/>
        ${
          deliveryAddress
            ? `<strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress)}<br/>`
            : ''
        }
        <strong>Subtotal:</strong> ${escapeHtml(formatCurrency(payment.amounts.subtotal))}<br/>
        ${
          payment.amounts.discountAmount > 0
            ? `<strong>Discount:</strong> -${escapeHtml(formatCurrency(payment.amounts.discountAmount))}<br/>`
            : ''
        }
        ${
          payment.amounts.taxAmount > 0
            ? `<strong>Tax (GST):</strong> ${escapeHtml(formatCurrency(payment.amounts.taxAmount))}<br/>`
            : ''
        }
        <strong>Delivery Cost:</strong> ${escapeHtml(formatCurrency(payment.amounts.deliveryCost))}<br/>
        <strong>Grand Total:</strong> ${escapeHtml(formatCurrency(payment.amounts.grandTotal))}<br/>
        <strong>Amount Received:</strong> ${escapeHtml(formatCurrency(payment.paidCents / 100))}<br/>
        <strong>Outstanding:</strong> ${escapeHtml(formatCurrency(payment.remainingCents / 100))}<br/>
        <strong>Payment Status:</strong> ${escapeHtml(paymentStatusLabel)} (${payment.paidPercent}%)
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Product</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">SKU</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Description</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Size</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Unit</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Piece</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Rate</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}${totalsRowsHtml}</tbody>
      </table>

      ${
        invoice.notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</p>`
          : ''
      }
      ${
        invoice.terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(invoice.terms)}</p>`
          : ''
      }

      <p style="margin-top:20px;">
        <strong>${escapeHtml(COMPANY_DETAILS.name)}</strong><br/>
        ABN: ${escapeHtml(COMPANY_DETAILS.abn)}<br/>
        ${escapeHtml(COMPANY_DETAILS.address)}
      </p>

      <p style="margin-top:12px;">
        <strong>Bank Details</strong><br/>
        Bank: ${escapeHtml(BANK_DETAILS.bank)}<br/>
        Account Name: ${escapeHtml(BANK_DETAILS.accountName)}<br/>
        BSB: ${escapeHtml(BANK_DETAILS.bsb)}<br/>
        Account Number: ${escapeHtml(BANK_DETAILS.accountNumber)}
      </p>

      <p style="margin-top:24px;">Thank you,<br/>${escapeHtml(COMPANY_DETAILS.name)}</p>
    </div>
  `;

  return {
    subject,
    text,
    html,
    isFinalReceipt,
    paymentStatus: payment.paymentStatus,
  };
}

module.exports = {
  buildInvoiceEmail,
};

