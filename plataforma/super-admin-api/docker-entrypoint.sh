#!/bin/sh
set -e

# Optional: Run database migrations on startup
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "[GymOS API] Running database migrations..."
    alembic upgrade head || echo "[GymOS API] Warning: Alembic migration completed or skipped."
fi

# Execute the main container command
echo "[GymOS API] Starting server: $@"
exec "$@"
