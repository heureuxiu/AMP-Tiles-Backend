const { readLogoBase64 } = require('./logoResolver');
const { getPuppeteer, launchPuppeteerBrowser } = require('./puppeteerLauncher');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

function buildMonthlyStatementHtml(statement) {
  const logoSrc = readLogoBase64();
  const customer = statement.customer || {};
  const totals = statement.totals || {};
  const company = {
    name: 'AMP TILES PTY LTD',
    addressLine1: 'Unit 15/55 Anderson Road',
    addressLine2: 'SMEATON GRANGE NSW 2567',
    country: 'AUSTRALIA',
    abn: '14 690 181 858',
  };

  const invoiceRows = (statement.invoices || [])
    .map((invoice) => `
      <tr>
        <td>${escapeHtml(invoice.invoiceNumber)}</td>
        <td>${escapeHtml(formatDate(invoice.date))}</td>
        <td>${escapeHtml(invoice.status)}</td>
        <td class="right">${formatMoney(invoice.subtotal)}</td>
        <td class="right">${formatMoney(invoice.gst)}</td>
        <td class="right">${formatMoney(invoice.delivery)}</td>
        <td class="right">${formatMoney(invoice.total)}</td>
        <td class="right">${formatMoney(invoice.paid)}</td>
        <td class="right">${formatMoney(invoice.outstanding)}</td>
      </tr>
    `)
    .join('');

  const productRows = (statement.productSummary || [])
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.productName)}</td>
        <td>${escapeHtml(item.size || '')}</td>
        <td>${escapeHtml(item.unitType || '')}</td>
        <td class="right">${formatQuantity(item.quantity)}</td>
        <td class="right">${formatQuantity(item.boxes)}</td>
        <td class="right">${formatQuantity(item.coverageSqm)}</td>
        <td class="right">${formatQuantity(item.coverageSqft)}</td>
        <td class="right">${formatMoney(item.unitPrice)}</td>
        <td class="right">${formatMoney(item.total)}</td>
      </tr>
    `)
    .join('');

  const quotationRows = (statement.quotations || [])
    .map((quotation) => `
      <tr>
        <td>${escapeHtml(quotation.quotationNumber)}</td>
        <td>${escapeHtml(formatDate(quotation.date))}</td>
        <td>${escapeHtml(quotation.status)}</td>
        <td class="right">${formatMoney(quotation.total)}</td>
      </tr>
    `)
    .join('');

  const emptyMessage = statement.totalInvoiceCount === 0 && statement.totalQuotationCount === 0
    ? '<div class="empty">No transactions found for this month.</div>'
    : '';

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 30px; font-family: Arial, Helvetica, sans-serif; color: #171717; font-size: 12px; line-height: 1.4; }
      .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #171717; padding-bottom: 16px; margin-bottom: 18px; }
      .title { font-size: 26px; font-weight: 800; letter-spacing: .3px; margin-bottom: 5px; }
      .muted { color: #525252; }
      .company { text-align: right; font-size: 11px; }
      .company img { height: 54px; margin-bottom: 6px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 16px 0; }
      .box { border: 1px solid #d4d4d4; border-radius: 6px; padding: 12px; }
      .box h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: .4px; }
      .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; }
      .metric { border: 1px solid #d4d4d4; border-radius: 6px; padding: 10px; }
      .metric .label { color: #525252; font-size: 10px; text-transform: uppercase; }
      .metric .value { font-size: 15px; font-weight: 700; margin-top: 3px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; }
      th, td { border: 1px solid #d4d4d4; padding: 6px; vertical-align: top; }
      th { background: #f5f5f5; text-align: left; font-size: 10px; text-transform: uppercase; }
      .right { text-align: right; }
      .section { margin-top: 18px; }
      .section h2 { font-size: 15px; margin: 0 0 6px; }
      .payment { margin-left: auto; width: 310px; }
      .payment td:first-child { font-weight: 600; }
      .payment .grand td { font-size: 14px; font-weight: 800; background: #f5f5f5; }
      .empty { border: 1px dashed #a3a3a3; border-radius: 6px; padding: 18px; text-align: center; color: #525252; margin: 16px 0; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <div class="title">Monthly Statement</div>
        <div class="muted">${escapeHtml(statement.monthLabel)} (${escapeHtml(formatDate(statement.dateRange?.start))} - ${escapeHtml(formatDate(statement.dateRange?.end))})</div>
      </div>
      <div class="company">
        ${logoSrc ? `<img src="${logoSrc}" alt="AMP Tiles" />` : ''}
        <div><strong>${escapeHtml(company.name)}</strong></div>
        <div>${escapeHtml(company.addressLine1)}</div>
        <div>${escapeHtml(company.addressLine2)}</div>
        <div>${escapeHtml(company.country)}</div>
        <div>ABN: ${escapeHtml(company.abn)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Customer Details</h3>
        <div><strong>${escapeHtml(customer.name)}</strong></div>
        <div>${escapeHtml(customer.phone || '')}</div>
        <div>${escapeHtml(customer.email || '')}</div>
        <div>${escapeHtml(customer.address || '')}</div>
        ${customer.abn ? `<div>ABN: ${escapeHtml(customer.abn)}</div>` : ''}
      </div>
      <div class="box">
        <h3>Statement Summary</h3>
        <div>Invoices: <strong>${statement.totalInvoiceCount}</strong></div>
        <div>Quotations: <strong>${statement.totalQuotationCount}</strong></div>
        <div>Transactions: <strong>${statement.transactionCount}</strong></div>
        <div>Generated: <strong>${escapeHtml(formatDate(new Date()))}</strong></div>
      </div>
    </div>

    <div class="summary">
      <div class="metric"><div class="label">Grand Total</div><div class="value">${formatMoney(totals.grandTotal)}</div></div>
      <div class="metric"><div class="label">Paid</div><div class="value">${formatMoney(totals.paidTotal)}</div></div>
      <div class="metric"><div class="label">Outstanding</div><div class="value">${formatMoney(totals.outstandingTotal)}</div></div>
      <div class="metric"><div class="label">GST</div><div class="value">${formatMoney(totals.gstTotal)}</div></div>
    </div>

    ${emptyMessage}

    <div class="section">
      <h2>Invoice Breakdown</h2>
      <table>
        <thead>
          <tr><th>Invoice</th><th>Date</th><th>Status</th><th class="right">Subtotal</th><th class="right">GST</th><th class="right">Delivery</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Outstanding</th></tr>
        </thead>
        <tbody>${invoiceRows || '<tr><td colspan="9" class="right">No invoices for this month.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Product / Tile Summary</h2>
      <table>
        <thead>
          <tr><th>Product</th><th>Size</th><th>Unit</th><th class="right">Qty</th><th class="right">Boxes</th><th class="right">Sqm</th><th class="right">Sqft</th><th class="right">Unit Price</th><th class="right">Total</th></tr>
        </thead>
        <tbody>${productRows || '<tr><td colspan="9" class="right">No products sold for this month.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Quotation Breakdown</h2>
      <table>
        <thead>
          <tr><th>Quotation</th><th>Date</th><th>Status</th><th class="right">Total</th></tr>
        </thead>
        <tbody>${quotationRows || '<tr><td colspan="4" class="right">No quotations for this month.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section payment">
      <table>
        <tbody>
          <tr><td>Subtotal before GST</td><td class="right">${formatMoney(totals.subtotalBeforeGst)}</td></tr>
          <tr><td>Discount</td><td class="right">-${formatMoney(totals.discountTotal)}</td></tr>
          <tr><td>Delivery</td><td class="right">${formatMoney(totals.deliveryTotal)}</td></tr>
          <tr><td>GST</td><td class="right">${formatMoney(totals.gstTotal)}</td></tr>
          <tr class="grand"><td>Grand Total</td><td class="right">${formatMoney(totals.grandTotal)}</td></tr>
          <tr><td>Paid Amount</td><td class="right">${formatMoney(totals.paidTotal)}</td></tr>
          <tr class="grand"><td>Outstanding</td><td class="right">${formatMoney(totals.outstandingTotal)}</td></tr>
        </tbody>
      </table>
    </div>
  </body>
  </html>`;
}

async function generateMonthlyStatementPdf(statement) {
  const puppeteer = getPuppeteer();
  const html = buildMonthlyStatementHtml(statement);
  let browser;
  try {
    browser = await launchPuppeteerBrowser(puppeteer);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18px', right: '18px', bottom: '18px', left: '18px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generateMonthlyStatementPdf, buildMonthlyStatementHtml };
