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

const DEFAULT_DELIVERY_COST = 295;
const COMPANY_DETAILS = {
  name: 'AMP TILES PTY LTD',
  abn: '14 690 181 858',
  address: 'Unit 15/55 Anderson Road, Smeaton Grange, NSW 2560',
};
const BANK_DETAILS = {
  bank: 'NAB',
  accountName: 'AMP TILES PTY LTD',
  bsb: '082-356',
  accountNumber: '26-722-1347',
};

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

function buildInvoiceEmail(invoice) {
  const invoiceNo = invoice.invoiceNumber || String(invoice._id || '');
  const customerName = invoice.customerName || 'Customer';
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
      const productName = escapeHtml(item.productName || 'Product');
      const qty = Number(item.quantity) || 0;
      const rate = formatCurrency(item.rate);
      const amount = formatCurrency(item.lineTotal);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${productName}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${qty}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${rate}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${amount}</td>
      </tr>`;
    })
    .join('');

  const text = [
    `Invoice ${invoiceNo}`,
    `Dear ${customerName},`,
    '',
    intro,
    '',
    `Invoice Date: ${formatDate(invoice.invoiceDate)}`,
    `Due Date: ${invoice.dueDate ? formatDate(invoice.dueDate) : 'N/A'}`,
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
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Rate</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
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
