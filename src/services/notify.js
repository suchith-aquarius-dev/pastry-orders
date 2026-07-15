const axios = require('axios');

/**
 * Post a new order alert to a Slack channel via an Incoming Webhook.
 * If SLACK_WEBHOOK_URL isn't set, this just logs to console instead —
 * handy for local testing before you wire up Slack.
 */
async function notifyKitchen(order) {
  const text = `🎂 *New order #${order.id}*\nItem: ${order.item_name} x${order.quantity}\nPickup: ${order.pickup_date}\nNote: ${order.custom_message || '-'}\nPhone: ${order.customer_phone}`;

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.log('[notifyKitchen] SLACK_WEBHOOK_URL not set. Order details:\n', text);
    return;
  }

  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text });
  } catch (err) {
    console.error('Failed to notify kitchen via Slack:', err.response?.data || err.message);
  }
}

module.exports = { notifyKitchen };
