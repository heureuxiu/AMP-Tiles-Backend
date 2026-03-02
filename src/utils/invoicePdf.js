// Lazy-load puppeteer so server can start even if not installed yet
function getPuppeteer() {
  try {
    return require('puppeteer');
  } catch (e) {
    throw new Error(
      'puppeteer is not installed. Run: npm install puppeteer (in the server folder, with dev server stopped)'
    );
  }
}

function escapeHtml(text) {
  if (text == null) return '';
  const s = String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function buildInvoiceHtml(invoice, companyInfo = {}) {
  const company = {
    name: companyInfo.name || 'AMP Tiles Australia',
    address: companyInfo.address || '456 Business Park Drive, Melbourne VIC 3000',
    phone: companyInfo.phone || '+61 3 9999 8888',
    email: companyInfo.email || 'info@amptiles.com.au',
    abn: companyInfo.abn || '12 345 678 901',
  };

  const inv = invoice;
  const items = (inv.items || []).map(
    (item) => `
    <tr>
      <td class="product">${escapeHtml(item.productName)}</td>
      <td class="unit">${escapeHtml(item.unitType || '')}</td>
      <td class="qty">${escapeHtml(item.quantity)}</td>
      <td class="rate">${formatCurrency(item.rate)}</td>
      <td class="amount">${formatCurrency(item.lineTotal)}</td>
    </tr>`
  ).join('');

  const subtotal = inv.subtotal ?? (inv.items || []).reduce((s, i) => s + (i.lineTotal || 0), 0);
  const discountAmount = inv.discountAmount ?? inv.discount ?? 0;
  const tax = inv.tax ?? 0;
  const grandTotal = inv.grandTotal ?? subtotal - discountAmount + tax;
  const afterDiscount = subtotal - discountAmount;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; color: #1a1a1a; margin: 0; padding: 40px; line-height: 1.4; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e5e5e5; padding-bottom: 24px; margin-bottom: 32px; }
    .company h1 { margin: 0; font-size: 24px; color: #c7a864; }
    .company p { margin: 4px 0; color: #555; font-size: 13px; }
    .invoice-title { text-align: right; }
    .invoice-title h2 { margin: 0 0 8px 0; font-size: 22px; }
    .bill-to { margin-bottom: 32px; }
    .bill-to h4 { margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
    .bill-to .name { font-weight: 600; font-size: 15px; }
    .bill-to p { margin: 4px 0; color: #444; font-size: 13px; }
    .meta { text-align: right; margin-bottom: 32px; }
    .meta-row { display: flex; justify-content: flex-end; gap: 12px; margin: 6px 0; font-size: 13px; }
    .meta-row .label { color: #666; }
    .meta-row .value { font-weight: 500; min-width: 120px; }
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    table.items th { text-align: left; padding: 12px 8px; border-bottom: 2px solid #333; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #444; }
    table.items th.unit { min-width: 60px; }
    table.items th.qty, table.items th.rate, table.items th.amount { text-align: right; }
    table.items td { padding: 12px 8px; border-bottom: 1px solid #e5e5e5; }
    table.items td.unit { font-size: 12px; color: #555; }
    table.items td.qty, table.items td.rate, table.items td.amount { text-align: right; }
    table.items .product { font-weight: 500; }
    .totals { margin-left: auto; width: 280px; }
    .totals .row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; }
    .totals .row.subtotal { border-bottom: 1px solid #e5e5e5; }
    .totals .row.grand { border-top: 2px solid #333; margin-top: 8px; padding-top: 12px; font-size: 18px; font-weight: 700; }
    .totals .row.grand .value { color: #8b5cf6; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e5e5e5; text-align: center; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company">
      <h1>${escapeHtml(company.name)}</h1>
      <p>${escapeHtml(company.address)}</p>
      <p>Phone: ${escapeHtml(company.phone)}</p>
      <p>Email: ${escapeHtml(company.email)}</p>
      <p>ABN: ${escapeHtml(company.abn)}</p>
    </div>
    <div class="invoice-title">
      <h2>INVOICE</h2>
    </div>
  </div>

  <div style="display: flex; justify-content: space-between; gap: 40px; flex-wrap: wrap;">
    <div class="bill-to">
      <h4>Bill To</h4>
      <p class="name">${escapeHtml(inv.customerName)}</p>
      ${inv.customerAddress ? `<p>${escapeHtml(inv.customerAddress)}</p>` : ''}
      ${inv.customerPhone ? `<p>${escapeHtml(inv.customerPhone)}</p>` : ''}
      ${inv.customerEmail ? `<p>${escapeHtml(inv.customerEmail)}</p>` : ''}
    </div>
    <div class="meta">
      <div class="meta-row"><span class="label">Invoice Number:</span><span class="value">${escapeHtml(inv.invoiceNumber)}</span></div>
      <div class="meta-row"><span class="label">Invoice Date:</span><span class="value">${formatDate(inv.invoiceDate)}</span></div>
      ${inv.dueDate ? `<div class="meta-row"><span class="label">Due Date:</span><span class="value">${formatDate(inv.dueDate)}</span></div>` : ''}
      ${inv.quotation && inv.quotation.quotationNumber ? `<div class="meta-row"><span class="label">Quote Ref:</span><span class="value">${escapeHtml(inv.quotation.quotationNumber)}</span></div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th class="product">Product</th>
        <th class="unit">Unit</th>
        <th class="qty">Qty</th>
        <th class="rate">Rate</th>
        <th class="amount">Amount</th>
      </tr>
    </thead>
    <tbody>${items}</tbody>
  </table>

  <div class="totals">
    <div class="row subtotal"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
    ${discountAmount > 0 ? `<div class="row"><span>Discount</span><span>-${formatCurrency(discountAmount)}</span></div>` : ''}
    ${tax > 0 ? `<div class="row"><span>Tax (GST)</span><span>${formatCurrency(tax)}</span></div>` : ''}
    <div class="row grand"><span>TOTAL</span><span class="value">${formatCurrency(grandTotal)}</span></div>
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>This is a computer-generated invoice and does not require a signature.</p>
  </div>
</body>
</html>`;
}

/**
 * Generate PDF buffer for an invoice document (plain object with invoice fields).
 * @param {Object} invoice - Invoice document (e.g. from Invoice.findById().lean() or toObject())
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(invoice) {
  const puppeteer = getPuppeteer();
  const html = buildInvoiceHtml(invoice);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generateInvoicePdf, buildInvoiceHtml };
