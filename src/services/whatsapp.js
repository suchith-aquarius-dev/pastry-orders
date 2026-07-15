const axios = require('axios');

const GRAPH_API_VERSION = 'v20.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

const client = axios.create({
  baseURL: `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Send a plain text message.
 */
async function sendTextMessage(to, body) {
  try {
    await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  } catch (err) {
    console.error('Failed to send text message:', err.response?.data || err.message);
  }
}

/**
 * Send the approved template message that opens the order Flow.
 * The template must already be approved in WhatsApp Manager and configured
 * with a Flow button.
 */
async function sendFlowTemplate(to) {
  const templateName = process.env.ORDER_FLOW_TEMPLATE_NAME;
  const flowId = process.env.ORDER_FLOW_ID;

  try {
    await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components: [
          {
            type: 'button',
            sub_type: 'flow',
            index: '0',
            parameters: [
              {
                type: 'action',
                action: {
                  flow_token: 'unused', // replace with a per-session token if you need to correlate sessions
                  flow_id: flowId,
                },
              },
            ],
          },
        ],
      },
    });
  } catch (err) {
    console.error('Failed to send flow template:', err.response?.data || err.message);
  }
}

module.exports = {
  sendTextMessage,
  sendFlowTemplate,
};
