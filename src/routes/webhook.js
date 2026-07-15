const express = require('express');
const router = express.Router();

const verifySignature = require('../services/verifySignature');
const { sendTextMessage, sendFlowTemplate } = require('../services/whatsapp');
const { saveOrder } = require('../services/orders');
const { notifyKitchen } = require('../services/notify');

/**
 * GET /webhook
 * One-time verification handshake Meta performs when you save the
 * Callback URL in the App Dashboard.
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified successfully.');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/**
 * POST /webhook
 * Receives all message events: inbound text, button replies, and
 * Flow submissions (nfm_reply).
 */
router.post('/', async (req, res) => {
  // Respond fast — Meta expects a quick 200 regardless of processing outcome.
  res.sendStatus(200);

  if (!verifySignature(req)) {
    console.warn('Rejected webhook payload: invalid signature.');
    return;
  }

  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages) return;

    const msg = entry.messages[0];
    const from = msg.from;

    // Case 1: customer submitted the order Flow
    if (msg.type === 'interactive' && msg.interactive?.type === 'nfm_reply') {
      const orderData = JSON.parse(msg.interactive.nfm_reply.response_json);
      const order = await saveOrder(orderData, from);

      await sendTextMessage(
        from,
        `🎂 Order confirmed! ${order.item_name} x${order.quantity}, ready ${order.pickup_date}. We'll message you when it's baking!`
      );

      await notifyKitchen(order);
      return;
    }

    // Case 2: free text — trigger the Flow if the customer mentions "order"
    if (msg.type === 'text') {
      const body = msg.text.body || '';
      if (/order/i.test(body)) {
        await sendFlowTemplate(from);
      } else {
        await sendTextMessage(
          from,
          "Hi! 👋 Type 'order' to start a new order, or ask us anything about our menu."
        );
      }
      return;
    }
  } catch (err) {
    console.error('Error processing webhook payload:', err);
  }
});

module.exports = router;
