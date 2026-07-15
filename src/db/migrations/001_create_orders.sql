CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_phone VARCHAR(20) NOT NULL,
    category VARCHAR(50),
    item_name VARCHAR(255),
    quantity INTEGER,
    custom_message TEXT,
    pickup_date VARCHAR(20),
    status VARCHAR(30) NOT NULL DEFAULT 'received',
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders (customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
