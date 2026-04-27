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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function getPurchaseOrderAmountSnapshot(purchaseOrder) {
  const subtotal =
    Number(purchaseOrder?.subtotal) ||
    (purchaseOrder?.items || []).reduce((sum, item) => sum + (Number(item?.lineTotal) || 0), 0);
  const tax = Number(purchaseOrder?.tax) || 0;
  const parsedDelivery = Number(purchaseOrder?.deliveryCost);
  const fallbackDelivery = Math.max(
    0,
    roundMoney(Number(purchaseOrder?.grandTotal) - subtotal - tax)
  );
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : 0;
  const grandTotal = Number.isFinite(Number(purchaseOrder?.grandTotal))
    ? Number(purchaseOrder.grandTotal)
    : subtotal + tax + deliveryCost;

  return {
    subtotal: roundMoney(subtotal),
    tax: roundMoney(tax),
    deliveryCost: roundMoney(deliveryCost),
    grandTotal: roundMoney(grandTotal),
  };
}

function getPurchaseOrderItemDetails(item) {
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
    quantity: Number(item?.quantityOrdered) || 0,
    rate: Number(item?.rate) || 0,
    amount: Number(item?.lineTotal) || 0,
  };
}

function buildPurchaseOrderEmail(purchaseOrder) {
  const poNumber = purchaseOrder.poNumber || String(purchaseOrder._id || '');
  const supplierName = purchaseOrder.supplierName || purchaseOrder.supplier?.name || 'Supplier';
  const poDate = formatDate(purchaseOrder.poDate);
  const expectedDelivery = purchaseOrder.expectedDeliveryDate
    ? formatDate(purchaseOrder.expectedDeliveryDate)
    : 'N/A';
  const currency = purchaseOrder.currency || 'AUD';
  const amounts = getPurchaseOrderAmountSnapshot(purchaseOrder);
  const grandTotal = formatCurrency(amounts.grandTotal, currency);

  const rowsHtml = (purchaseOrder.items || [])
    .map((item) => {
      const details = getPurchaseOrderItemDetails(item);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.productName)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.sku)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.description)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.size)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:left;">${escapeHtml(details.unit)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${details.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.rate, currency)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.amount, currency)}</td>
      </tr>`;
    })
    .join('');
  const totalsRowsHtml = [
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Subtotal</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(
        formatCurrency(amounts.subtotal, currency)
      )}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Tax (GST)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(
        formatCurrency(amounts.tax, currency)
      )}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery Cost</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(
        formatCurrency(amounts.deliveryCost, currency)
      )}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Grand Total</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">${escapeHtml(
        grandTotal
      )}</td>
    </tr>`,
  ].join('');

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
    `Subtotal: ${formatCurrency(amounts.subtotal, currency)}`,
    `Tax (GST): ${formatCurrency(amounts.tax, currency)}`,
    `Delivery Cost: ${formatCurrency(amounts.deliveryCost, currency)}`,
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(purchaseOrder.items || []).map((item) => {
      const details = getPurchaseOrderItemDetails(item);
      return `- ${details.productName} | SKU: ${details.sku} | Desc: ${details.description} | Size: ${details.size} | Unit: ${details.unit} | Qty: ${details.quantity} | Rate: ${formatCurrency(details.rate, currency)} | Amount: ${formatCurrency(details.amount, currency)}`;
    }),
    '',
    'Please see attached purchase order PDF for your records.',
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
        <strong>Subtotal:</strong> ${escapeHtml(
          formatCurrency(amounts.subtotal, currency)
        )}<br/>
        <strong>Tax (GST):</strong> ${escapeHtml(
          formatCurrency(amounts.tax, currency)
        )}<br/>
        <strong>Delivery Cost:</strong> ${escapeHtml(
          formatCurrency(amounts.deliveryCost, currency)
        )}<br/>
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
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


