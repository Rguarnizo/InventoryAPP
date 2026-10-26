#!/bin/sh
set -e
alembic upgrade head
python -m app.bootstrap
exec "$@"
