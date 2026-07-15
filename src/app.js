const express = require('express');

const webhookRoutes = require('./routes/webhook');
const flowEndpointRoutes = require('./routes/flowEndpoint');

const app = express();

// IMPORTANT: keep raw body available for signature verification in webhook.js
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Simple health check — useful for confirming Nginx/PM2/DO are wired correctly
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/webhook', webhookRoutes);
app.use('/flow-data-endpoint', flowEndpointRoutes);

module.exports = app;
