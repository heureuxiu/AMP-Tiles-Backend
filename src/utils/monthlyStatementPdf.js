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

function formatNumber(value) {
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function truncate(value, length = 18) {
  const text = String(value || '').trim();
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 3))}...`;
}

function getCompanyInfo() {
  return {
    name: 'AMP TILES PTY LTD',
    tradingName: 'AMP TILES',
    addressLine1: 'Unit 15/55 Anderson Road',
    addressLine2: 'SMEATON GRANGE',
    addressLine3: 'NSW 2567',
    country: 'AUSTRALIA',
    abn: '14 690 181 858',
    bank: 'NAB',
    accountName: 'AMP TILES PTY LTD',
    bsb: '082-356',
    accountNumber: '26-722-1347',
  };
}

function getCustomerAddressLines(customer) {
  return String(customer.address || '')
    .split(',')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildActivityRows(statement) {
  const rows = [];
  let runningBalance = 0;

  (statement.invoices || []).forEach((invoice) => {
    const invoiceAmount = Number(invoice.total) || 0;
    const paidAmount = Number(invoice.paid) || 0;
    runningBalance += invoiceAmount;

    rows.push({
      date: invoice.date,
      activity: `Invoice # ${invoice.invoiceNumber}`,
      reference: invoice.reference || statement.customer?.name || '',
      dueDate: invoice.dueDate,
      invoiceAmount,
      paymentAmount: 0,
      balance: runningBalance,
      isLink: true,
    });

    if (paidAmount > 0) {
      runningBalance -= paidAmount;
      rows.push({
        date: invoice.paidDate || invoice.date,
        activity: `Payment on Invoice # ${invoice.invoiceNumber}`,
        reference: invoice.invoiceNumber,
        dueDate: '',
        invoiceAmount: 0,
        paymentAmount: paidAmount,
        balance: runningBalance,
      });
    }
  });

  if (rows.length === 0 && (statement.quotations || []).length > 0) {
    (statement.quotations || []).forEach((quotation) => {
      rows.push({
        date: quotation.date,
        activity: `Quotation # ${quotation.quotationNumber}`,
        reference: quotation.status,
        dueDate: quotation.validUntil,
        invoiceAmount: 0,
        paymentAmount: 0,
        balance: runningBalance,
      });
    });
  }

  return rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function buildActivityRowsHtml(rows) {
  if (rows.length === 0) {
    return `
      <tr class="empty-row">
        <td colspan="7">No transaction activity found for this period.</td>
      </tr>
    `;
  }

  return rows.map((row) => `
    <tr>
      <td>${escapeHtml(formatDate(row.date))}</td>
      <td class="activity">${row.isLink ? `<span class="link">${escapeHtml(row.activity)}</span>` : escapeHtml(row.activity)}</td>
      <td>${escapeHtml(truncate(row.reference))}</td>
      <td>${escapeHtml(formatDate(row.dueDate))}</td>
      <td class="right">${row.invoiceAmount ? formatNumber(row.invoiceAmount) : ''}</td>
      <td class="right">${row.paymentAmount ? formatNumber(row.paymentAmount) : ''}</td>
      <td class="right">${formatNumber(row.balance)}</td>
    </tr>
  `).join('');
}

function buildMonthlyStatementHtml(statement) {
  const logoSrc = readLogoBase64();
  const customer = statement.customer || {};
  const company = getCompanyInfo();
  const rows = buildActivityRows(statement);
  const totalDue = Number(statement.totals?.outstandingTotal) || 0;
  const currentDue = 0;
  const overdue = totalDue;

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      @page { size: A4; margin: 0; }
      body {
        margin: 0;
        background: #ffffff;
        color: #101010;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 13px;
        line-height: 1.32;
      }
      .page {
        min-height: 1122px;
        padding: 66px 52px 38px;
        position: relative;
      }
      .top-logo {
        position: absolute;
        right: 66px;
        top: 34px;
        text-align: right;
      }
      .top-logo img {
        width: 184px;
        max-height: 82px;
        object-fit: contain;
      }
      .fallback-logo {
        color: #0f172a;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: .04em;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.5fr .7fr .85fr;
        gap: 28px;
        margin-top: 135px;
        align-items: start;
      }
      h1 {
        margin: 0;
        font-size: 48px;
        font-weight: 400;
        letter-spacing: 0;
        line-height: 1.05;
        white-space: nowrap;
      }
      .customer-name {
        margin-top: 18px;
        text-align: center;
        font-size: 15px;
        letter-spacing: .02em;
        text-transform: uppercase;
      }
      .meta {
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 16px;
        row-gap: 5px;
        font-size: 15px;
      }
      .meta .label { font-weight: 700; }
      .company {
        font-size: 15px;
        text-transform: uppercase;
      }
      .company div { margin-bottom: 3px; }
      .activity-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 150px;
        table-layout: fixed;
      }
      .activity-table th {
        border-bottom: 1.5px solid #171717;
        padding: 0 10px 11px 0;
        text-align: left;
        font-size: 16px;
        font-weight: 700;
      }
      .activity-table td {
        border-bottom: 1px solid #dddddd;
        padding: 8px 10px 8px 0;
        vertical-align: top;
        font-size: 15px;
      }
      .activity-table tr:last-child td { border-bottom: none; }
      .activity-table .date { width: 105px; }
      .activity-table .activity-col { width: 265px; }
      .activity-table .ref { width: 120px; }
      .activity-table .due { width: 110px; }
      .activity-table .amount { width: 132px; }
      .activity-table .payment { width: 112px; }
      .activity-table .balance { width: 125px; }
      .activity { line-height: 1.18; }
      .link {
        color: #0077b6;
        text-decoration: underline;
      }
      .right { text-align: right; }
      .empty-row td {
        color: #666666;
        text-align: center;
        padding: 20px 0;
      }
      .balance-line {
        border-top: 2px solid #171717;
        margin-top: 16px;
        padding-top: 17px;
        display: flex;
        justify-content: flex-end;
        align-items: baseline;
        gap: 20px;
        font-size: 25px;
      }
      .balance-line .label { font-weight: 400; }
      .balance-line .amount { font-weight: 700; }
      .bank {
        margin-top: 18px;
        font-size: 15px;
      }
      .bank div { margin-bottom: 4px; }
      .payment-advice {
        position: absolute;
        left: 52px;
        right: 52px;
        bottom: 46px;
        border-top: 2px dashed #171717;
        padding-top: 22px;
      }
      .scissors {
        position: absolute;
        left: 8px;
        top: -14px;
        background: #fff;
        padding-right: 10px;
        font-size: 22px;
        line-height: 1;
      }
      .advice-grid {
        display: grid;
        grid-template-columns: .9fr 1fr;
        gap: 72px;
      }
      .advice-title {
        margin: 0 0 6px;
        font-size: 42px;
        line-height: 1;
        font-weight: 400;
        letter-spacing: 0;
      }
      .to-block {
        margin-left: 56px;
        font-size: 15px;
      }
      .summary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 15px;
      }
      .summary-table th,
      .summary-table td {
        text-align: left;
        padding: 8px 0;
        border-bottom: 1px solid #d4d4d4;
      }
      .summary-table th { font-weight: 700; }
      .amount-line {
        margin-top: 16px;
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 8px;
        align-items: end;
        font-size: 15px;
      }
      .amount-line .label { font-weight: 700; }
      .write-line {
        border-bottom: 1.5px solid #171717;
        height: 24px;
      }
      .hint {
        grid-column: 2;
        color: #777777;
        font-size: 12px;
        padding-top: 3px;
      }
      .footer {
        position: absolute;
        left: 52px;
        right: 52px;
        bottom: 22px;
        font-size: 11px;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="top-logo">
        ${logoSrc ? `<img src="${logoSrc}" alt="AMP Tiles" />` : `<div class="fallback-logo">${escapeHtml(company.tradingName)}</div>`}
      </div>

      <section class="hero">
        <div>
          <h1>STATEMENT - Activity</h1>
          <div class="customer-name">${escapeHtml(customer.name)}</div>
        </div>

        <div class="meta">
          <div class="label">From Date</div>
          <div>${escapeHtml(formatDate(statement.dateRange?.start))}</div>
          <div class="label">To Date</div>
          <div>${escapeHtml(formatDate(statement.dateRange?.end))}</div>
          <div class="label" style="padding-top:10px;">ABN</div>
          <div style="padding-top:10px;">${escapeHtml(company.abn)}</div>
        </div>

        <div class="company">
          <div>${escapeHtml(company.name)}</div>
          <div>${escapeHtml(company.addressLine1)}</div>
          <div>${escapeHtml(company.addressLine2)}</div>
          <div>${escapeHtml(company.addressLine3)}</div>
          <div>${escapeHtml(company.country)}</div>
        </div>
      </section>

      <table class="activity-table">
        <thead>
          <tr>
            <th class="date">Date</th>
            <th class="activity-col">Activity</th>
            <th class="ref">Reference</th>
            <th class="due">Due Date</th>
            <th class="amount right">Invoice Amount</th>
            <th class="payment right">Payments</th>
            <th class="balance right">Balance AUD</th>
          </tr>
        </thead>
        <tbody>
          ${buildActivityRowsHtml(rows)}
        </tbody>
      </table>

      <div class="balance-line">
        <span class="label">BALANCE DUE AUD</span>
        <span class="amount">${formatNumber(totalDue)}</span>
      </div>

      <section class="bank">
        <div>Account Name: ${escapeHtml(company.accountName)}</div>
        <div>BSB Number: ${escapeHtml(company.bsb)}</div>
        <div>Account Number: ${escapeHtml(company.accountNumber)}</div>
      </section>

      <section class="payment-advice">
        <div class="scissors">&#9986;</div>
        <div class="advice-grid">
          <div>
            <h2 class="advice-title">PAYMENT ADVICE</h2>
            <div class="to-block">
              <div>To: ${escapeHtml(company.name)}</div>
              <div>${escapeHtml(company.addressLine1)}</div>
              <div>${escapeHtml(company.addressLine2)}</div>
              <div>${escapeHtml(company.addressLine3)}</div>
              <div>${escapeHtml(company.country)}</div>
            </div>
          </div>
          <div>
            <table class="summary-table">
              <tbody>
                <tr>
                  <th>Customer</th>
                  <td>${escapeHtml(customer.name)}</td>
                </tr>
                <tr>
                  <th>Overdue<br><span style="font-weight:400">${formatNumber(overdue)}</span></th>
                  <th>Current<br><span style="font-weight:400">${formatNumber(currentDue)}</span></th>
                  <th>Total AUD Due<br><span style="font-weight:400">${formatNumber(totalDue)}</span></th>
                </tr>
              </tbody>
            </table>
            <div class="amount-line">
              <div class="label">Amount Enclosed</div>
              <div class="write-line"></div>
              <div class="hint">Enter the amount you are paying above</div>
            </div>
          </div>
        </div>
      </section>

      <div class="footer">
        ABN&nbsp; ${escapeHtml(company.abn)}. &nbsp; Registered Office: ${escapeHtml(company.addressLine1)}, ${escapeHtml(company.addressLine2)}, ${escapeHtml(company.addressLine3)}, Australia.
      </div>
    </main>
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
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generateMonthlyStatementPdf, buildMonthlyStatementHtml };
