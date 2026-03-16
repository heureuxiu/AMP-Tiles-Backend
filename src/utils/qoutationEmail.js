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

function buildQuotationEmail(quotation) {
  const quoteNo = quotation.quotationNumber || String(quotation._id || '');
  const customerName = quotation.customerName || 'Customer';
  const quoteDate = formatDate(quotation.quotationDate);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : 'N/A';
  const grandTotal = formatCurrency(quotation.grandTotal);

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
    'Thank you,',
    'AMP Tiles',
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

      <p style="margin-top:24px;">Thank you,<br/>AMP Tiles</p>
    </div>
  `;

  return {
    subject: `Quotation ${quoteNo} from AMP Tiles`,
    text,
    html,
  };
}

module.exports = {
  buildQuotationEmail,
};
