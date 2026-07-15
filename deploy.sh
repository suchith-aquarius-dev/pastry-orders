#!/bin/bash
# Simple manual deploy script — run this on the Droplet after pushing to GitHub.
set -e

echo "Pulling latest code..."
git pull origin main

echo "Installing dependencies..."
npm install --omit=dev

echo "Restarting app with PM2..."
pm2 restart pastry-webhook || pm2 start ecosystem.config.js

echo "Done. Recent logs:"
pm2 logs pastry-webhook --lines 20 --nostream
