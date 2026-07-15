const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Only needed if you upgrade from a static Flow to a dynamic (data-exchange) Flow.
// Generate a keypair with:
//   openssl genrsa -out private.pem 2048
//   openssl rsa -in private.pem -pubout -out public.pem
// Upload public.pem's contents to Meta via the Flow's "Encryption Keys" step.
// Place private.pem in a `keys/` folder at the project root (NOT committed to git).
const PRIVATE_KEY_PATH = path.join(__dirname, '..', '..', 'keys', 'private.pem');

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    throw new Error(
      `Private key not found at ${PRIVATE_KEY_PATH}. Generate one with openssl and place it there if you're using a dynamic Flow.`
    );
  }
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
}

/**
 * Decrypts the incoming Flow request.
 * Meta sends: encrypted_flow_data, encrypted_aes_key, initial_vector (base64).
 * The AES key is RSA-OAEP encrypted; the payload is AES-128-GCM encrypted.
 */
function decryptRequest(body, privateKeyPem) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body;

  const aesKey = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encrypted_aes_key, 'base64')
  );

  const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
  const iv = Buffer.from(initial_vector, 'base64');

  const TAG_LENGTH = 16;
  const encryptedBody = flowDataBuffer.slice(0, -TAG_LENGTH);
  const authTag = flowDataBuffer.slice(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedBody), decipher.final()]);

  return { decryptedBody: JSON.parse(decrypted.toString('utf8')), aesKey, iv };
}

/**
 * Encrypts the response the same way Meta expects: AES-128-GCM using the
 * same AES key, with the IV bitwise-flipped (per Meta's spec).
 */
function encryptResponse(responseObj, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map((b) => ~b & 0xff));

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(responseObj), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([encrypted, authTag]).toString('base64');
}

/**
 * POST /flow-data-endpoint
 * Only hit by Meta if your Flow is configured as "dynamic" (data-exchange).
 * A static Flow (recommended for launch) never calls this route —
 * submissions arrive as a plain nfm_reply on the main /webhook route instead.
 */
router.post('/', async (req, res) => {
  try {
    const privateKeyPem = loadPrivateKey();
    const { decryptedBody, aesKey, iv } = decryptRequest(req.body, privateKeyPem);

    const { screen, data, action } = decryptedBody;

    // Health check ping Meta sends periodically
    if (action === 'ping') {
      const response = encryptResponse({ data: { status: 'active' } }, aesKey, iv);
      return res.send(response);
    }

    // Example: respond to a data request for available pickup dates
    if (action === 'data_exchange') {
      const responsePayload = {
        screen: screen || 'PICKUP',
        data: {
          // Replace with a real availability check against your orders table
          available_dates: ['2026-07-18', '2026-07-19', '2026-07-20'],
        },
      };
      const response = encryptResponse(responsePayload, aesKey, iv);
      return res.send(response);
    }

    return res.sendStatus(400);
  } catch (err) {
    console.error('Error processing Flow data-exchange request:', err);
    return res.sendStatus(421); // Meta expects 421 on decryption/processing failure
  }
});

module.exports = router;
