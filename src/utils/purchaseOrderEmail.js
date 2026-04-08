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

function formatCurrency(amount, currency = 'AUD') {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency || 'AUD',
  }).format(num);
}

function buildPurchaseOrderEmail(purchaseOrder) {
  const poNumber = purchaseOrder.poNumber || String(purchaseOrder._id || '');
  const supplierName = purchaseOrder.supplierName || purchaseOrder.supplier?.name || 'Supplier';
  const poDate = formatDate(purchaseOrder.poDate);
  const expectedDelivery = purchaseOrder.expectedDeliveryDate
    ? formatDate(purchaseOrder.expectedDeliveryDate)
    : 'N/A';
  const currency = purchaseOrder.currency || 'AUD';
  const grandTotal = formatCurrency(purchaseOrder.grandTotal, currency);

  const rowsHtml = (purchaseOrder.items || [])
    .map((item) => {
      const productName = escapeHtml(item.productName || item.product?.name || 'Product');
      const qty = Number(item.quantityOrdered) || 0;
      const rate = formatCurrency(item.rate, currency);
      const amount = formatCurrency(item.lineTotal, currency);
      const unitType = escapeHtml(item.unitType || 'Box');
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${productName}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${qty}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:left;">${unitType}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${rate}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${amount}</td>
      </tr>`;
    })
    .join('');

  const notesLine = purchaseOrder.notes ? `\nNotes: ${purchaseOrder.notes}` : '';
  const termsLine = purchaseOrder.terms ? `\nTerms: ${purchaseOrder.terms}` : '';

  const text = [
    `Purchase Order ${poNumber}`,
    `Dear ${supplierName},`,
    '',
    'Please find the purchase order details below.',
    '',
    `PO Number: ${poNumber}`,
    `PO Date: ${poDate}`,
    `Expected Delivery Date: ${expectedDelivery}`,
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(purchaseOrder.items || []).map((item) => {
      const qty = Number(item.quantityOrdered) || 0;
      const name = item.productName || item.product?.name || 'Product';
      const unitType = item.unitType || 'Box';
      const amount = formatCurrency(item.lineTotal, currency);
      return `- ${name}: ${qty} ${unitType} x ${formatCurrency(item.rate, currency)} = ${amount}`;
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
      <h2 style="margin:0 0 16px;">Purchase Order ${escapeHtml(poNumber)}</h2>
      <p>Dear ${escapeHtml(supplierName)},</p>
      <p>Please find the purchase order details below.</p>
      <p>
        <strong>PO Date:</strong> ${escapeHtml(poDate)}<br/>
        <strong>Expected Delivery Date:</strong> ${escapeHtml(expectedDelivery)}<br/>
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Product</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Qty</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Unit</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Rate</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      ${
        purchaseOrder.notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(purchaseOrder.notes)}</p>`
          : ''
      }
      ${
        purchaseOrder.terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(purchaseOrder.terms)}</p>`
          : ''
      }

      <p style="margin-top:24px;">Thank you,<br/>AMP Tiles</p>
    </div>
  `;

  return {
    subject: `Purchase Order ${poNumber} from AMP Tiles`,
    text,
    html,
  };
}

module.exports = {
  buildPurchaseOrderEmail,
};
