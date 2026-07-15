const crypto = require('crypto');

/**
 * Verifies that an incoming webhook request actually came from Meta,
 * using the X-Hub-Signature-256 header and your app secret.
 */
function verifySignature(req) {
  const signature = req.get('X-Hub-Signature-256');
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!signature || !appSecret || !req.rawBody) {
    // If you haven't set WHATSAPP_APP_SECRET yet (e.g. during local dev),
    // this will fail closed. Set the env var to enable verification.
    console.warn('Missing signature, app secret, or raw body — rejecting request.');
    return false;
  }

  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

module.exports = verifySignature;
