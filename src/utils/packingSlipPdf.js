const fs = require('fs');
const { readLogoBase64 } = require('./logoResolver');
const { getPuppeteer, launchPuppeteerBrowser } = require('./puppeteerLauncher');

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

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

const SQFT_PER_SQM = 10.764;

function getDisplayQuantity(item) {
  const unitType = String(item?.unitType || '').toLowerCase();
  const coverageSqm = Number(item?.coverageSqm);
  if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
    if (unitType.includes('sqft') || unitType.includes('sq ft') || unitType.includes('sqfeet')) {
      return formatQuantity(coverageSqm * SQFT_PER_SQM);
    }
    if (unitType.includes('sqm') || unitType.includes('sq meter') || unitType.includes('sqmetre')) {
      return formatQuantity(coverageSqm);
    }
  }
  return formatQuantity(item?.quantity ?? 0);
}

function getItemSize(item) {
  const rawSize = item?.product?.size ?? item?.size;
  return rawSize ? String(rawSize) : '';
}

function getItemSku(item) {
  const rawSku = item?.sku ?? item?.product?.sku;
  return rawSku ? String(rawSku) : '';
}

function getLogoBase64() {
  return readLogoBase64();
}

function buildPackingSlipHtml(invoice) {
  const company = {
    name: 'AMP TILES PTY LTD',
    addressLine1: 'Unit 15/55 Anderson Road,',
    addressLine2: 'Smeaton Grange, NSW 2567',
    abn: '14 690 181 858',
  };

  const logoSrc = getLogoBase64();
  const inv = invoice;
  const deliveryAddress = String(inv.deliveryAddress || inv.customerAddress || '').trim();
  const items = inv.items || [];

  const rowsHtml = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.productName || '')}</td>
      <td>${escapeHtml(getItemSku(item))}</td>
      <td>${escapeHtml(getItemSize(item))}</td>
      <td>${escapeHtml(item.unitType || '')}</td>
      <td class="center">${escapeHtml(getDisplayQuantity(item))}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; }

    .page { padding: 28px 32px; max-width: 800px; margin: 0 auto; }

    /* Top section */
    .top-section { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; border-bottom: 2px solid #111; padding-bottom: 14px; }
    .doc-title { font-size: 26px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; color: #111; }
    .doc-subtitle { font-size: 11px; color: #555; margin-top: 3px; letter-spacing: 1px; }
    .logo-company { text-align: right; }
    .logo-company img { height: 48px; margin-bottom: 4px; display: block; margin-left: auto; }
    .company-name { font-size: 13px; font-weight: 700; color: #111; }
    .company-info { font-size: 10px; color: #555; }

    /* Header grid */
    .header-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .header-box { border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; }
    .header-box .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 6px; font-weight: 700; }
    .header-box .value { font-size: 11px; color: #111; line-height: 1.45; }
    .header-box .value strong { font-size: 13px; font-weight: 700; }

    /* Meta table */
    .meta-table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
    .meta-table td { border: 1px solid #ddd; padding: 6px 10px; font-size: 11px; }
    .meta-table .meta-label { background: #f5f5f5; font-weight: 700; width: 180px; color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Items table */
    .items-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #555; margin-bottom: 6px; }
    table.items { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.items thead tr { background: #111; color: #fff; }
    table.items thead th { padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    table.items thead th.center, table.items thead th.right { text-align: center; }
    table.items tbody tr { border-bottom: 1px solid #eee; }
    table.items tbody tr:nth-child(even) { background: #fafafa; }
    table.items tbody td { padding: 8px 10px; vertical-align: top; }
    table.items .center { text-align: center; }

    /* Notes */
    .notes-section { margin-top: 18px; border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; }
    .notes-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: 700; margin-bottom: 4px; }
    .notes-value { font-size: 11px; color: #333; line-height: 1.5; }

    /* Footer */
    .footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 12px; text-align: center; color: #999; font-size: 10px; }

    /* Watermark band */
    .slip-band { background: #111; color: #fff; text-align: center; padding: 6px; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="page">

    <!-- Top Section -->
    <div class="top-section">
      <div>
        <div class="doc-title">PACKING SLIP</div>
        <div class="doc-subtitle">FOR INTERNAL / WAREHOUSE USE ONLY</div>
      </div>
      <div class="logo-company">
        ${logoSrc ? `<img src="${logoSrc}" alt="AMP Tiles Logo" />` : `<div class="company-name">${escapeHtml(company.name)}</div>`}
        <div class="company-name">${escapeHtml(company.name)}</div>
        <div class="company-info">${escapeHtml(company.addressLine1)} ${escapeHtml(company.addressLine2)}</div>
        <div class="company-info">ABN: ${escapeHtml(company.abn)}</div>
      </div>
    </div>

    <div class="slip-band">&#9632; warehouse / packing use only &#9632;</div>

    <!-- Meta info -->
    <table class="meta-table">
      <tr>
        <td class="meta-label">Invoice / Slip No.</td>
        <td>${escapeHtml(inv.invoiceNumber || '')}</td>
        <td class="meta-label">Date</td>
        <td>${formatDate(inv.invoiceDate)}</td>
      </tr>
      <tr>
        <td class="meta-label">Customer Name</td>
        <td>${escapeHtml(inv.customerName || '')}</td>
        <td class="meta-label">Phone</td>
        <td>${escapeHtml(inv.customerPhone || '-')}</td>
      </tr>
      ${deliveryAddress ? `
      <tr>
        <td class="meta-label">Delivery Address</td>
        <td colspan="3">${escapeHtml(deliveryAddress)}</td>
      </tr>` : ''}
    </table>

    <!-- Items -->
    <div class="items-title">Items to Pack</div>
    <table class="items">
      <thead>
        <tr>
          <th>Product</th>
          <th>SKU</th>
          <th>Size</th>
          <th>Unit</th>
          <th class="center">Qty</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    ${inv.notes ? `
    <div class="notes-section">
      <div class="notes-label">Notes</div>
      <div class="notes-value">${escapeHtml(inv.notes)}</div>
    </div>` : ''}

    <div class="footer">
      Packing Slip &mdash; ${escapeHtml(inv.invoiceNumber || '')} &mdash; ${escapeHtml(company.name)} &mdash; CONFIDENTIAL
    </div>
  </div>
</body>
</html>`;
}

async function generatePackingSlipPdf(invoice) {
  const html = buildPackingSlipHtml(invoice);
  const puppeteer = getPuppeteer();
  const browser = await launchPuppeteerBrowser(puppeteer);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    // Normalize to Node Buffer so HTTP response sends valid binary PDF bytes.
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

module.exports = { generatePackingSlipPdf };
