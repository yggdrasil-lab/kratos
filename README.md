# Kratos

Workout application delivered as a progressive web app, backed by its own
Postgres database and a FastAPI service.

One codebase, installs to the home screen on both iOS and Android.

## Status

Bootstrap. The repository holds the decided stack and a working skeleton of the
v1 domain — catalogue, plan, and log — with the specified database schema applied
through a migration. Features are added from here.

## Layout

```
api/      FastAPI service, SQLAlchemy 2.0 models, Alembic migrations
web/      React + TypeScript + Vite PWA client
scripts/  Shared deploy scripts (ops-scripts submodule)
```

## Domain

Three groups, in the order data arrives:

| Group     | Tables                                 | Question it answers     |
|-----------|----------------------------------------|-------------------------|
| Catalogue | `exercise`                             | What can be performed?  |
| Plan      | `routine`, `routine_item`              | What do I intend to do? |
| Log       | `session`, `session_item`, `set_entry` | What did I actually do? |

Derived values — volume, estimated 1RM, last performance — are database views
(`v_set`, `v_e1rm`, `v_session_volume`, `v_exercise_last`), never stored columns.

## Running the API

```bash
docker compose -f docker-compose.dev.yml up -d db
cd api
cp ../.env.example .env
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
```

OpenAPI is served at `/docs`; the schema at `/openapi.json`. Every route declares
a response model, so `/openapi.json` stays a usable contract.

## Running the web client

```bash
cd web
npm install
npm run dev
```

The dev server proxies `/api` to `http://localhost:8000`.

## Tests

The API tests need a real Postgres, because the value of this schema is in its
views and its constraints — a SQLite substitute would verify neither.

```bash
cd api
pytest
```

The suite starts a throwaway Postgres server and applies the migrations to it, so
no service needs to be running first. Point it at an existing instance instead
with `KRATOS_TEST_DATABASE_URL`.

## Configuration

Environment variables carry the `KRATOS_` prefix — see `.env.example`.

## Deployment

Runs on the Gaia swarm as the stack `kratos`, behind the fleet's Traefik
instance, and is published at `kratos.${DOMAIN_NAME}`.

### Services

| Service     | Image                     | Published             |
|-------------|---------------------------|-----------------------|
| `kratos-db` | `postgres:16-alpine`      | internal only         |
| `kratos-api`| `${REGISTRY_PREFIX}kratos-api` | via Traefik at `/api` |
| `kratos-web`| `${REGISTRY_PREFIX}kratos-web` | via Traefik at `/`   |

All three join the external `aether-net` overlay, which is how Traefik reaches
them; none publishes a host port. The database is reachable as `kratos-db` on
that network and is never exposed publicly.

### Routing

Traefik rules are declared as service labels in `docker-compose.yml`:

- `kratos-web` matches `Host(\`kratos.${DOMAIN_NAME}\`)`. The nginx image serves
  the built client and falls back to `index.html` for client-side routes.
- `kratos-api` matches the same host with `PathPrefix(\`/api\`)`. Traefik prefers
  the more specific rule, so `/api/*` reaches the API and everything else reaches
  the client. A `stripprefix` middleware removes `/api` before forwarding, since
  the service itself serves unprefixed routes.

Both routers sit behind the `authelia` forward-auth middleware and terminate TLS
with the `cloudflare` certificate resolver.

### Secrets and the database password

The Postgres password is never written into the repository, the image, or a
compose file. The workflow pipes it through `scripts/ensure_secret.sh`, which
creates a content-hashed swarm secret and returns its name. That name reaches the
stack as `KRATOS_POSTGRES_PASSWORD_NAME`.

At container start, `api/entrypoint.sh` reads the secret file, assembles
`KRATOS_DATABASE_URL`, waits for the database to accept connections, runs
`alembic upgrade head`, and only then starts the API. Migrations therefore run on
every deploy, and a database that is not ready yet is retried rather than treated
as a failure.

The database stores its data on a bind mount, because Swarm cannot resolve
relative paths. Create the directory on the node once, before the first deploy:

```bash
./setup_host.sh
```

Run this **on the Gaia host by hand, not from the deploy workflow.** The
self-hosted runner is itself a container — it mounts only the Docker socket and
its own workspace, so a host path like `/opt/kratos/data` does not exist inside
it, and an `mkdir` there either fails or silently creates nothing. It is
deliberately kept out of `deploy.yml` for that reason.

### Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml` on the `gaia` runner.
It logs in to the registry, ensures the secret, builds both images, pushes them,
and deploys the stack. To run it by hand, the same entrypoint works on the host:

```bash
./scripts/deploy.sh "kratos" docker-compose.yml
```

### Repository configuration

The workflow reads one repository variable and two secrets. They are set on the
repository, not in the code:

| Name                     | Kind     | Purpose                                  |
|--------------------------|----------|------------------------------------------|
| `DOMAIN_NAME`            | variable | apex domain used in the Traefik host rule |
| `REGISTRY_USERNAME`      | secret   | registry login                            |
| `REGISTRY_RAW_PASSWORD`  | secret   | registry login                            |
| `POSTGRES_PASSWORD`      | secret   | becomes the `kratos_postgres_password_*` swarm secret |

`STACK_NAME` is set by `scripts/deploy.sh` from its argument (`kratos`), so the
images are tagged `kratos`. `REGISTRY_PREFIX` and `KRATOS_DB_MOUNT_PATH` are
optional: without the prefix the images stay local and are not pushed, and the
mount path falls back to `/opt/kratos/data`.
