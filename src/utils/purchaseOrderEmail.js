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
  const supplierName = purchaseOrder.supplierName || purchaseOrder.supplier?.name || 'Supplier';
  const text = [
    `Dear ${supplierName},`,
    '',
    'Please find attached our Purchase Order for your review and processing.',
    '',
    'Could you kindly confirm stock availability for the items listed, along with the estimated delivery date? Your prompt confirmation will help us plan accordingly.',
    '',
    'Please let us know if there are any discrepancies or if further information is required.',
    '',
    'Thank you for your support.',
    '',
    'Kind regards,',
    'Prabin',
    'AMP Tiles',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <p>Dear ${escapeHtml(supplierName)},</p>
      <p>Please find attached our Purchase Order for your review and processing.</p>
      <p>Could you kindly confirm stock availability for the items listed, along with the estimated delivery date? Your prompt confirmation will help us plan accordingly.</p>
      <p>Please let us know if there are any discrepancies or if further information is required.</p>
      <p>Thank you for your support.</p>
      <p style="margin-top:24px;">Kind regards,<br/>Prabin<br/>AMP Tiles</p>
    </div>
  `;

  return {
    subject: 'Purchase Order Attached - Stock Confirmation Required',
    text,
    html,
  };
}

module.exports = {
  buildPurchaseOrderEmail,
};
