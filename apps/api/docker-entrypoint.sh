#!/bin/sh
set -e

sh ./migrate.sh

echo "[startup] Starting API server..."
exec node apps/api/dist/index.js
