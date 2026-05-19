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

const DEFAULT_DELIVERY_COST = 0;
const DELIVERY_GST_RATE = 10;
const COMPANY_DETAILS = {
  name: 'AMP TILES',
  email: 'sales@amptiles.com.au',
};

function getQuotationAmountSnapshot(quotation) {
  const subtotal = Number(quotation?.subtotal) || 0;
  const discount = Number(quotation?.discount) || 0;
  const tax = Number(quotation?.tax) || 0;
  const baseTotal = subtotal - discount + tax;
  const parsedDelivery = Number(quotation?.deliveryCost);
  const fallbackDelivery = Math.max(0, Math.round((Number(quotation?.grandTotal) - baseTotal) * 100) / 100);
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : DEFAULT_DELIVERY_COST;
  const deliveryGst = Math.round((deliveryCost * DELIVERY_GST_RATE)) / 100;
  const grandTotal = baseTotal + deliveryCost + deliveryGst;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    deliveryGst: Math.round(deliveryGst * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

function getDeliveryAddress(source) {
  return String(source?.deliveryAddress || source?.customerAddress || '').trim();
}

function buildQuotationEmail(quotation) {
  const quoteNo = quotation.quotationNumber || String(quotation._id || '');
  const customerName = quotation.customerName || 'Customer';
  const deliveryAddress = getDeliveryAddress(quotation);
  const quoteDate = formatDate(quotation.quotationDate);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : 'N/A';
  const amounts = getQuotationAmountSnapshot(quotation);
  const grandTotal = formatCurrency(amounts.grandTotal);
  const notes = String(quotation.notes || '').trim();
  const terms = String(quotation.terms || '').trim();

  const text = [
    `Dear ${customerName},`,
    '',
    'Thank you for the opportunity to provide a quotation for your project.',
    '',
    'Please find a summary of your attached quotation details below.',
    '',
    `Quotation Date: ${quoteDate}`,
    `Valid Until: ${validUntil}`,
    `Delivery Address: ${deliveryAddress || 'N/A'}`,
    `Subtotal: ${formatCurrency(amounts.subtotal)}`,
    amounts.discount > 0 ? `Discount: -${formatCurrency(amounts.discount)}` : '',
    amounts.tax > 0 ? `Tax (GST): ${formatCurrency(amounts.tax)}` : '',
    `Delivery Cost: ${formatCurrency(amounts.deliveryCost)}`,
    amounts.deliveryGst > 0
      ? `Delivery GST (${DELIVERY_GST_RATE}%): ${formatCurrency(amounts.deliveryGst)}`
      : '',
    `Grand Total: ${grandTotal}`,
    '',
    notes ? `Notes: ${notes}` : '',
    terms ? `Terms: ${terms}` : '',
    '',
    'From your attached quote you can accept or decline by replying to this email.',
    '',
    'Please do not hesitate to contact us if you have any questions.',
    '',
    'Thank you,',
    COMPANY_DETAILS.name,
    `Email: ${COMPANY_DETAILS.email}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <p>Dear ${escapeHtml(customerName)},</p>
      <p>Thank you for the opportunity to provide a quotation for your project.</p>
      <p>Please find a summary of your attached quotation details below.</p>
      <p>
        <strong>Quotation Date:</strong> ${escapeHtml(quoteDate)}<br/>
        <strong>Valid Until:</strong> ${escapeHtml(validUntil)}<br/>
        <strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress || 'N/A')}<br/>
        <strong>Subtotal:</strong> ${escapeHtml(formatCurrency(amounts.subtotal))}<br/>
        ${
          amounts.discount > 0
            ? `<strong>Discount:</strong> -${escapeHtml(formatCurrency(amounts.discount))}<br/>`
            : ''
        }
        ${
          amounts.tax > 0
            ? `<strong>Tax (GST):</strong> ${escapeHtml(formatCurrency(amounts.tax))}<br/>`
            : ''
        }
        <strong>Delivery Cost:</strong> ${escapeHtml(formatCurrency(amounts.deliveryCost))}<br/>
        ${
          amounts.deliveryGst > 0
            ? `<strong>Delivery GST (${DELIVERY_GST_RATE}%):</strong> ${escapeHtml(formatCurrency(amounts.deliveryGst))}<br/>`
            : ''
        }
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
      </p>
      ${
        notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(notes)}</p>`
          : ''
      }
      ${
        terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(terms)}</p>`
          : ''
      }
      <p>From your attached quote you can accept or decline by replying to this email.</p>
      <p>Please do not hesitate to contact us if you have any questions.</p>
      <p style="margin-top:24px;">
        Thank you,<br/>
        ${escapeHtml(COMPANY_DETAILS.name)}<br/>
        Email: ${escapeHtml(COMPANY_DETAILS.email)}
      </p>
    </div>
  `;

  return {
    subject: `Quotation ${quoteNo} from ${COMPANY_DETAILS.name}`,
    text,
    html,
  };
}

module.exports = {
  buildQuotationEmail,
};
