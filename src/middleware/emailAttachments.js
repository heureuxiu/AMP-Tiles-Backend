const path = require('path');
const multer = require('multer');

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xlsx', '.jpg', '.jpeg', '.png']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);

function isAllowedAttachment(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension) && ALLOWED_MIME_TYPES.has(file.mimetype);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE,
    files: MAX_ATTACHMENT_COUNT,
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedAttachment(file)) {
      cb(null, true);
      return;
    }

    cb(new Error('Unsupported attachment type. Allowed: PDF, DOC, DOCX, XLSX, JPG, JPEG, PNG.'));
  },
});

function uploadEmailAttachments(req, res, next) {
  upload.array('attachments', MAX_ATTACHMENT_COUNT)(req, res, (error) => {
    if (!error) {
      if (typeof req.body?.payload === 'string') {
        try {
          req.body = JSON.parse(req.body.payload);
        } catch {
          res.status(400).json({
            success: false,
            message: 'Invalid attachment payload.',
          });
          return;
        }
      }
      next();
      return;
    }

    const isMulterError = error instanceof multer.MulterError;
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Each attachment must be 10 MB or smaller.'
        : error.code === 'LIMIT_FILE_COUNT'
          ? `You can attach up to ${MAX_ATTACHMENT_COUNT} files.`
          : error.message || 'Failed to upload attachments.';

    res.status(isMulterError ? 400 : 415).json({
      success: false,
      message,
    });
  });
}

function buildEmailAttachments(files = []) {
  return files.map((file) => ({
    filename: file.originalname,
    content: file.buffer,
    contentType: file.mimetype,
  }));
}

module.exports = {
  uploadEmailAttachments,
  buildEmailAttachments,
};
