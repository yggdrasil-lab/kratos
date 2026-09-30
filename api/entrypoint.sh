#!/bin/sh
set -e

# The database password arrives as a Swarm secret. Assembling the URL here keeps
# the credential out of the image, the compose file, and the repository.
if [ -n "$KRATOS_POSTGRES_PASSWORD_FILE" ] && [ -f "$KRATOS_POSTGRES_PASSWORD_FILE" ]; then
    KRATOS_DB_PASSWORD="$(cat "$KRATOS_POSTGRES_PASSWORD_FILE")"
    export KRATOS_DATABASE_URL="postgresql+psycopg://kratos:${KRATOS_DB_PASSWORD}@kratos-db:5432/kratos"
fi

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
