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
const DELIVERY_GST_RATE = 10;
const COMPANY_DETAILS = {
  name: 'AMP TILES',
  email: 'accounts@amptiles.com.au',
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
  const deliveryGst = Math.round((deliveryCost * DELIVERY_GST_RATE)) / 100;
  const grandTotal = baseTotal + deliveryCost + deliveryGst;
  const gstTotal = taxAmount + deliveryGst;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    deliveryGst: Math.round(deliveryGst * 100) / 100,
    gstTotal: Math.round(gstTotal * 100) / 100,
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

function buildInvoiceEmail(invoice) {
  const invoiceNo = invoice.invoiceNumber || String(invoice._id || '');
  const deliveryAddress = getDeliveryAddress(invoice);
  const payment = getPaymentSnapshot(invoice);

  const paymentStatusLabel =
    payment.paymentStatus === 'paid'
      ? 'Paid'
      : payment.paymentStatus === 'partially_paid'
        ? 'Partially Paid'
        : 'Unpaid';
  const isFinalReceipt = payment.paymentStatus === 'paid';
  const introMessage = isFinalReceipt
    ? 'Thank you for the payment.'
    : 'Thank you for accepting our quote.';
  const summaryMessage = isFinalReceipt
    ? 'Please find below a summary of the attached invoice for your reference.'
    : 'Please find below a summary of the attached invoice for your reference. We kindly request that payment be made by the due date stated on the invoice.';

  const text = [
    'Dear Customer,',
    '',
    introMessage,
    '',
    summaryMessage,
    '',
    `Invoice Date: ${formatDate(invoice.invoiceDate)}`,
    `Due Date: ${invoice.dueDate ? formatDate(invoice.dueDate) : 'N/A'}`,
    `Delivery Address: ${deliveryAddress || 'N/A'}`,
    `Subtotal: ${formatCurrency(payment.amounts.subtotal)}`,
    `Delivery Cost: ${formatCurrency(payment.amounts.deliveryCost)}`,
    `GST: ${formatCurrency(payment.amounts.gstTotal)}`,
    `Grand Total: ${formatCurrency(payment.amounts.grandTotal)}`,
    `Amount Received: ${formatCurrency(payment.paidCents / 100)}`,
    `Outstanding: ${formatCurrency(payment.remainingCents / 100)}`,
    `Payment Status: ${paymentStatusLabel} (${payment.paidPercent}%)`,
    '',
    'Should you have any questions regarding the invoice or require any further information, please do not hesitate to contact us.',
    '',
    'Thank you for your business and continued support.',
    '',
    'Thank you,',
    COMPANY_DETAILS.name,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.45;">
      <p>Dear Customer,</p>
      <p>${escapeHtml(introMessage)}</p>
      <p>${escapeHtml(summaryMessage)}</p>
      <p>
        <strong>Invoice Date:</strong> ${escapeHtml(formatDate(invoice.invoiceDate))}<br/>
        <strong>Due Date:</strong> ${escapeHtml(invoice.dueDate ? formatDate(invoice.dueDate) : 'N/A')}<br/>
        <strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress || 'N/A')}<br/>
        <strong>Subtotal:</strong> ${escapeHtml(formatCurrency(payment.amounts.subtotal))}<br/>
        <strong>Delivery Cost:</strong> ${escapeHtml(formatCurrency(payment.amounts.deliveryCost))}<br/>
        <strong>GST:</strong> ${escapeHtml(formatCurrency(payment.amounts.gstTotal))}<br/>
        <strong>Grand Total:</strong> ${escapeHtml(formatCurrency(payment.amounts.grandTotal))}<br/>
        <strong>Amount Received:</strong> ${escapeHtml(formatCurrency(payment.paidCents / 100))}<br/>
        <strong>Outstanding:</strong> ${escapeHtml(formatCurrency(payment.remainingCents / 100))}<br/>
        <strong>Payment Status:</strong> ${escapeHtml(paymentStatusLabel)} (${payment.paidPercent}%)
      </p>
      <p>Should you have any questions regarding the invoice or require any further information, please do not hesitate to contact us.</p>
      <p>Thank you for your business and continued support.</p>
      <p style="margin-top:24px;">
        Thank you,<br/>
        ${escapeHtml(COMPANY_DETAILS.name)}
      </p>
    </div>
  `;

  return {
    subject: `Invoice ${invoiceNo} from ${COMPANY_DETAILS.name}`,
    text,
    html,
    isFinalReceipt,
    paymentStatus: payment.paymentStatus,
  };
}

module.exports = {
  buildInvoiceEmail,
};
