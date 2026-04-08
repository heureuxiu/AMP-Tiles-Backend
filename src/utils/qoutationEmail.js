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
  const grandTotal = Number.isFinite(Number(quotation?.grandTotal))
    ? Number(quotation.grandTotal)
    : baseTotal + deliveryCost;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

function buildQuotationEmail(quotation) {
  const quoteNo = quotation.quotationNumber || String(quotation._id || '');
  const customerName = quotation.customerName || 'Customer';
  const quoteDate = formatDate(quotation.quotationDate);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : 'N/A';
  const amounts = getQuotationAmountSnapshot(quotation);
  const grandTotal = formatCurrency(amounts.grandTotal);

  const rowsHtml = (quotation.items || [])
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

  const notesLine = quotation.notes ? `\nNotes: ${quotation.notes}` : '';
  const termsLine = quotation.terms ? `\nTerms: ${quotation.terms}` : '';

  const text = [
    `Quotation ${quoteNo}`,
    `Dear ${customerName},`,
    '',
    'Please find your quotation details below.',
    '',
    `Quotation Date: ${quoteDate}`,
    `Valid Until: ${validUntil}`,
    `Subtotal: ${formatCurrency(amounts.subtotal)}`,
    amounts.discount > 0 ? `Discount: -${formatCurrency(amounts.discount)}` : '',
    amounts.tax > 0 ? `Tax (GST): ${formatCurrency(amounts.tax)}` : '',
    `Delivery Cost: ${formatCurrency(amounts.deliveryCost)}`,
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(quotation.items || []).map((item) => {
      const qty = Number(item.quantity) || 0;
      const name = item.productName || 'Product';
      const amount = formatCurrency(item.lineTotal);
      return `- ${name}: ${qty} x ${formatCurrency(item.rate)} = ${amount}`;
    }),
    notesLine,
    termsLine,
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
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <h2 style="margin:0 0 16px;">Quotation ${escapeHtml(quoteNo)}</h2>
      <p>Dear ${escapeHtml(customerName)},</p>
      <p>Please find your quotation details below.</p>
      <p>
        <strong>Quotation Date:</strong> ${escapeHtml(quoteDate)}<br/>
        <strong>Valid Until:</strong> ${escapeHtml(validUntil)}<br/>
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
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
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
        quotation.notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(quotation.notes)}</p>`
          : ''
      }
      ${
        quotation.terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(quotation.terms)}</p>`
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
    subject: `Quotation ${quoteNo} from ${COMPANY_DETAILS.name}`,
    text,
    html,
  };
}

module.exports = {
  buildQuotationEmail,
};
