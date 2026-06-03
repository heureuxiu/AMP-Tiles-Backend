const nodemailer = require('nodemailer');

let cachedTransporter = null;

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
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
    replyTo: process.env.SMTP_REPLY_TO || user,
  };
}

function isMailerConfigured() {
  const cfg = getSmtpConfig();

  return Boolean(
    cfg.host &&
    cfg.port &&
    cfg.user &&
    cfg.pass &&
    cfg.fromEmail
  );
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
    secure: cfg.secure, // true for 465, false for 587
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    logger: true,
    debug: true,
  });

  return cachedTransporter;
}

async function verifyMailer() {
  const transporter = getTransporter();

  try {
    await transporter.verify();
    console.log('SMTP server is ready to send emails');
    return true;
  } catch (error) {
    console.error('SMTP verification failed:', {
      message: error.message,
      code: error.code,
      command: error.command,
    });

    throw error;
  }
}

async function sendEmail({ to, subject, text, html }) {
  const cfg = getSmtpConfig();
  const transporter = getTransporter();

  const fromValue = cfg.fromName
    ? `"${cfg.fromName}" <${cfg.fromEmail}>`
    : cfg.fromEmail;

  try {
    const info = await transporter.sendMail({
      from: fromValue,
      to,
      subject,
      text,
      html,
      replyTo: cfg.replyTo,
    });

    console.log('Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Email sending failed:', {
      message: error.message,
      code: error.code,
      command: error.command,
    });

    throw error;
  }
}

module.exports = {
  isMailerConfigured,
  verifyMailer,
  sendEmail,
};
