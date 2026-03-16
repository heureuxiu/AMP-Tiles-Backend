const nodemailer = require('nodemailer');

let cachedTransporter = null;

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  return {
    host,
    port,
    user,
    pass,
    secure: toBool(process.env.SMTP_SECURE),
    fromEmail: process.env.SMTP_FROM_EMAIL || user,
    fromName: process.env.SMTP_FROM_NAME || 'AMP Tiles',
    replyTo: process.env.SMTP_REPLY_TO || undefined,
  };
}

function isMailerConfigured() {
  const cfg = getSmtpConfig();
  return Boolean(cfg.host && cfg.port && cfg.user && cfg.pass && cfg.fromEmail);
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const cfg = getSmtpConfig();
  if (!isMailerConfigured()) {
    throw new Error(
      'Email service is not configured. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.'
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  return cachedTransporter;
}

async function sendEmail({ to, subject, text, html }) {
  const cfg = getSmtpConfig();
  const transporter = getTransporter();

  const fromValue = cfg.fromName
    ? `${cfg.fromName} <${cfg.fromEmail}>`
    : cfg.fromEmail;

  return transporter.sendMail({
    from: fromValue,
    to,
    subject,
    text,
    html,
    replyTo: cfg.replyTo,
  });
}

module.exports = {
  isMailerConfigured,
  sendEmail,
};
