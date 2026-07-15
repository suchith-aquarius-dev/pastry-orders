const db = require('../db');

/**
 * Save a submitted Flow order into the database.
 * `orderData` is the parsed JSON from the Flow's nfm_reply response.
 */
async function saveOrder(orderData, customerPhone) {
  const { category, item_name, quantity, custom_message, pickup_date } = orderData;

  const result = await db.query(
    `INSERT INTO orders
      (customer_phone, category, item_name, quantity, custom_message, pickup_date, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      customerPhone,
      category || null,
      item_name || null,
      quantity ? parseInt(quantity, 10) : null,
      custom_message || null,
      pickup_date || null,
      JSON.stringify(orderData),
    ]
  );

  return result.rows[0];
}

async function updateOrderStatus(orderId, status) {
  const result = await db.query(
    `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, orderId]
  );
  return result.rows[0];
}

async function getOrderById(orderId) {
  const result = await db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  return result.rows[0];
}

async function getRecentOrders(limit = 20) {
  const result = await db.query(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

module.exports = {
  saveOrder,
  updateOrderStatus,
  getOrderById,
  getRecentOrders,
};
