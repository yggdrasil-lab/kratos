#!/bin/sh
set -e

# KRATOS_DATABASE_URL is supplied by docker-compose.yml (or the ambient
# environment for local development). Nothing is assembled or read from a file
# here; see README, "The database password".

# Swarm starts services independently, so the database may not be accepting
# connections yet. Retry the migration rather than assuming ordering.
attempt=1
until alembic upgrade head; do
    if [ "$attempt" -ge 30 ]; then
        echo "ERROR: database not reachable after ${attempt} attempts" >&2
        exit 1
    fi
    echo "waiting for database (attempt ${attempt})"
    attempt=$((attempt + 1))
    sleep 2
done

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
