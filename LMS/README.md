# Library Management System (LMS)

A NestJS monolith that implements the design in `arch.md` and `LLD.md`. PostgreSQL is
the booking write model, MongoDB is the catalog source of truth, Debezium streams
catalog changes to Kafka, and Elasticsearch serves search. The whole stack runs with
one Docker Compose command.

## Architecture at a glance

```
Client
  |
  v
NestJS monolith (:3000)
  |- Booking  -> PostgreSQL (holds, loans, fines, outbox)
  |- Catalog  -> MongoDB (books)
  |- Search   -> Elasticsearch + Redis cache
  |- Outbox relay -> Kafka (hold.events, loan.events)
  |- Notification consumer <- Kafka
  |- Catalog indexer <- Kafka <- Debezium <- MongoDB change stream

MongoDB -> Debezium (Kafka Connect) -> catalog.lms.books -> NestJS indexer -> Elasticsearch
```

Key properties:

- Holds are allocated with `FOR UPDATE SKIP LOCKED`, so two members can never get the
  same copy.
- Booking state and the outbox event are written in the same PostgreSQL transaction.
- Debezium publishes every catalog change from the MongoDB replica-set oplog/change
  stream; the app never dual-writes MongoDB and Elasticsearch.
- The Elasticsearch indexer commits Kafka offsets only after ES accepts the document.
  Failures are retried and then sent to `catalog.books.dlq`.
- Search reads go to Elasticsearch and are cached in Redis for 45 seconds.
- Notifications are at-least-once with Redis `SET NX` idempotency.

## Services and ports

| Service | Container | Host port | Purpose |
|---------|-----------|-----------|---------|
| API | `lms-app` | `3000` | NestJS HTTP API, workers, schedulers, Swagger |
| PostgreSQL | `lms-postgres` | `5432` | Booking write model + outbox |
| MongoDB | `lms-mongo` | `27017` | Catalog source of truth (replica set `rs0`) |
| Redis | `lms-redis` | `6379` | Availability/search cache + notification dedupe |
| Elasticsearch | `lms-elasticsearch` | `9200` | Derived search index (alias `books`) |
| Kafka | `lms-kafka` | `29092` | Outbox events + Debezium CDC (external listener) |
| Kafka Connect | `lms-kafka-connect` | `8083` | Debezium MongoDB connector |

One-shot jobs run at startup and exit `0` by design, so they do not appear in
`docker ps`:

| Job | Purpose |
|-----|---------|
| `lms-mongo-init` | Initiates MongoDB replica set `rs0` and waits for primary |
| `lms-mongo-seed` | Seeds demo catalog documents (idempotent upserts) |
| `lms-kafka-init` | Creates Kafka topics (idempotent) |
| `lms-connector-init` | Registers the Debezium connector (idempotent) |

Kafka topics:

| Topic | Partitions | Producer |
|-------|------------|----------|
| `hold.events` | 3 | Outbox relay |
| `loan.events` | 3 | Outbox relay |
| `catalog.lms.books` | 3 | Debezium |
| `catalog.books.dlq` | 1 | ES indexer (failures) |

## Repository layout

```
src/
  main.ts                 API bootstrap, Swagger at /docs
  app.module.ts           Composition root (Postgres, Mongo, guards, filter)
  common/                 Config, auth, DB, Redis, Kafka, ES, health, availability
  booking/                Holds, loans, fines, outbox relay, schedulers, admin jobs
  catalog/                MongoDB catalog, Debezium -> ES indexer, reindex/alias swap
  search/                 Elasticsearch query API with Redis cache
  notification/           Kafka consumer with idempotent delivery
init/
  postgres/01-schema.sql  Schema, constraints, seed users and copies
  mongo/01-catalog.js     Idempotent demo catalog seed
  kafka/topics.sh         Topic creation
debezium/
  catalog-connector.json  Debezium MongoDB connector config
  register-connector.sh   Registers the connector and waits for Connect
docker-compose.yml        Full local stack
.env.dev                  Single development environment file
```

## Prerequisites

- Docker Desktop (tested with Docker 29.x, Apple Silicon macOS)
- At least 4 GB assigned to Docker; 6 GB recommended (Elasticsearch + Kafka)
- Node.js 20+ only if you want to run the app on the host instead of Docker

## Quick start

From the project root:

```bash
docker compose up -d --build
```

First boot takes roughly 1-3 minutes: MongoDB elects a primary, Kafka starts,
Elasticsearch becomes healthy, then Debezium snapshots the catalog.

Check status:

```bash
docker compose ps
```

Expected long-running services are healthy: `lms-app`, `lms-postgres`, `lms-mongo`,
`lms-redis`, `lms-elasticsearch`, `lms-kafka`, `lms-kafka-connect`.

## Verify the stack

```bash
# Application health (all dependencies must be "up")
curl -s localhost:3000/health

# Debezium connector must be RUNNING
curl -s localhost:8083/connectors/lms-catalog-connector/status

# All three demo books must be indexed
curl -s 'localhost:9200/books/_count'

# Consumer groups must have one member each and lag 0
docker exec lms-kafka kafka-consumer-groups \
  --bootstrap-server kafka:9092 --describe --group es-indexer
```

Swagger UI: <http://localhost:3000/docs>

## Seed data

| Book id | Title | Copies |
|---------|-------|--------|
| `b-demo-1` | Designing Data-Intensive Applications | 3 |
| `b-demo-2` | Clean Code | 2 |
| `b-demo-3` | Introduction to Algorithms | 0 (waitlist demo) |

| Role | Name | User id |
|------|------|---------|
| MEMBER | Maya Member | `11111111-1111-4111-8111-111111111111` |
| MEMBER | Noah Member | `22222222-2222-4222-8222-222222222222` |
| LIBRARIAN | Lena Librarian | `33333333-3333-4333-8333-333333333333` |
| ADMIN | Adam Admin | `44444444-4444-4444-8444-444444444444` |

## Dev token (local authentication)

`POST /auth/dev-token` mints a JWT for a seeded user. It mimics an external identity
provider and is disabled when `NODE_ENV=production`.

In Swagger:

1. Open <http://localhost:3000/docs>.
2. `auth` -> `POST /auth/dev-token` -> Try it out.
3. Enter one of the user ids above and Execute.
4. Copy `token`, click Authorize, paste the token without the `Bearer ` prefix.

CLI:

```bash
curl -s -X POST localhost:3000/auth/dev-token \
  -H 'content-type: application/json' \
  -d '{"userId":"11111111-1111-4111-8111-111111111111"}'
```

Use the token as `Authorization: Bearer <token>`.

## API summary

| Method | Path | Roles |
|--------|------|-------|
| POST | `/auth/dev-token` | Public (non-production) |
| GET | `/auth/me` | Any authenticated |
| GET | `/search?q=&page=&size=` | MEMBER, LIBRARIAN, ADMIN |
| GET | `/books/:bookId` | MEMBER, LIBRARIAN, ADMIN |
| POST | `/holds` (requires `Idempotency-Key`) | MEMBER |
| DELETE | `/holds/:holdId` | MEMBER, LIBRARIAN, ADMIN |
| POST | `/loans` | LIBRARIAN, ADMIN |
| POST | `/loans/walk-in` | LIBRARIAN, ADMIN |
| POST | `/loans/:loanId/return` | LIBRARIAN, ADMIN |
| GET | `/users/me/loans` | MEMBER, LIBRARIAN, ADMIN |
| GET | `/users/me/holds` | MEMBER, LIBRARIAN, ADMIN |
| GET | `/users/me/fines` | MEMBER, LIBRARIAN, ADMIN |
| POST | `/catalog/books` | LIBRARIAN, ADMIN |
| PUT | `/catalog/books/:bookId` | LIBRARIAN, ADMIN |
| DELETE | `/catalog/books/:bookId` | LIBRARIAN, ADMIN |
| POST | `/catalog/books/:bookId/copies` | LIBRARIAN, ADMIN |
| POST | `/admin/reindex` | ADMIN |
| POST | `/admin/jobs/hold-expiry` | ADMIN |
| POST | `/admin/jobs/fine-accrual` | ADMIN |
| POST | `/admin/outbox/flush` | ADMIN |
| GET | `/health`, `/health/live` | Public |

`POST /holds` returns `201 ACTIVE` when a copy was allocated and `202 QUEUED` when the
member was added to the waitlist. Reusing the same `Idempotency-Key` replays the
original response.

## End-to-end checks

Booking path:

```bash
TOKEN=$(curl -s -X POST localhost:3000/auth/dev-token \
  -H 'content-type: application/json' \
  -d '{"userId":"11111111-1111-4111-8111-111111111111"}' | jq -r .token)

curl -s -X POST localhost:3000/holds \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: demo-hold-1' \
  -d '{"bookId":"b-demo-2"}'
```

Catalog CDC path:

```bash
ADMIN=$(curl -s -X POST localhost:3000/auth/dev-token \
  -H 'content-type: application/json' \
  -d '{"userId":"44444444-4444-4444-8444-444444444444"}' | jq -r .token)

curl -s -X POST localhost:3000/catalog/books \
  -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"bookId":"b-readme-1","isbn":"9780000000001","title":"README Demo","authors":["LMS"]}'

# After a moment, Debezium -> Kafka -> indexer should make it searchable
curl -s 'localhost:3000/search?q=README' -H "authorization: Bearer $ADMIN"
```

If Elasticsearch is ever out of sync, rebuild from MongoDB without downtime:

```bash
curl -s -X POST localhost:3000/admin/reindex -H "authorization: Bearer $ADMIN"
```

## Run the app on the host (optional)

The containers stay up; stop only the app container so port 3000 is free and there is
exactly one consumer/scheduler instance:

```bash
docker compose stop app

DATABASE_URL='postgresql://lms:lms@localhost:5432/lms' \
MONGO_URI='mongodb://localhost:27017/lms?directConnection=true' \
REDIS_URL='redis://localhost:6379' \
KAFKA_BROKERS='localhost:29092' \
ELASTICSEARCH_NODE='http://localhost:9200' \
npm run start:dev
```

Why the overrides:

| Variable | Docker value | Host value | Reason |
|----------|--------------|------------|--------|
| `DATABASE_URL` | `postgres:5432` | `localhost:5432` | Docker service names do not resolve on the host |
| `MONGO_URI` | `mongo:27017?replicaSet=rs0` | `localhost:27017?directConnection=true` | The replica set advertises `mongo:27017`, which the host cannot resolve |
| `REDIS_URL` | `redis:6379` | `localhost:6379` | Same DNS reason |
| `KAFKA_BROKERS` | `kafka:9092` | `localhost:29092` | Only the EXTERNAL listener is published to the host |
| `ELASTICSEARCH_NODE` | `elasticsearch:9200` | `localhost:9200` | Same DNS reason |

Notes:

- `@nestjs/config` is configured with `envFilePath: ['.env.dev', '.env']`; earlier
  files take precedence, so a local `.env` will not override `.env.dev`. Inline
  environment variables (above) do override because `process.env` wins.
- Do not run the host app and `lms-app` at the same time: they share Kafka consumer
  group ids and schedulers, which splits partitions and duplicates work.
- If you keep `lms-app` running and only change the port, set `PORT=3001`; Swagger is
  then at <http://localhost:3001/docs>.
- Kill any stale `nest start --watch` process before starting a new one.

Return to the containerized app:

```bash
docker compose up -d app
```

## Configuration

All settings live in `.env.dev`; Docker Compose passes it to the app via `env_file`.
The most useful values:

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `HOLD_TTL_HOURS` | `24` | Hold expiry window |
| `LOAN_PERIOD_DAYS` | `14` | Loan due date |
| `DAILY_FINE_RATE` | `0.50` | Fine per day |
| `MAX_FINE` | `20.00` | Fine cap |
| `MAX_ACTIVE_HOLDS_PER_USER` | `5` | Hold limit |
| `BLOCK_HOLDS_ABOVE_FINE` | `10.00` | Fine threshold that blocks holds |
| `AVAILABILITY_TTL_SECONDS` | `60` | Availability cache TTL |
| `SEARCH_CACHE_TTL_SECONDS` | `45` | Search cache TTL |
| `ES_BOOKS_ALIAS` | `books` | Read/write alias |
| `ES_BOOKS_INDEX` | `books_v1` | Physical index behind the alias |

Change a value in `.env.dev` and recreate the app:

```bash
docker compose up -d --force-recreate app
```

## Common commands

```bash
# Follow logs
docker compose logs -f app
docker compose logs -f kafka-connect

# Rebuild and restart only the app
docker compose up -d --build --force-recreate app

# Stop everything but keep data
docker compose down

# Stop everything and delete all data (full clean reset)
docker compose down -v --remove-orphans
docker compose up -d --build

# Build / typecheck / unit tests on the host
npm run build
npm run typecheck
npm test
```

`npm test` currently runs 10 unit tests covering copy allocation, hold state
transitions, and the daily-rate fine policy.

## Troubleshooting and known fixes

| Symptom | Cause | Fix applied / guidance |
|---------|-------|------------------------|
| `getaddrinfo ENOTFOUND postgres/mongo/redis/kafka/elasticsearch` | Running the app on the host with Docker service names | Use the host overrides above, or run the app in Compose |
| `MongoServerSelectionError` on the host | Replica set advertises `mongo:27017` | Add `?directConnection=true` to the host `MONGO_URI` |
| Mongo seed fails with `not primary` | Init script ran before replica-set election | `mongo-init` now initiates the set, waits for primary, then `mongo-seed` runs |
| `mongo-seed` exits with duplicate `_id` | Seed was not idempotent | Seed uses `replaceOne(..., { upsert: true })` |
| `kafka-init` exits `127` or `1` | YAML preserved newlines inside a quoted command | Topic creation moved to `init/kafka/topics.sh` |
| `mongo-seed` connects to `127.0.0.1` | Compose argv splitting swallowed the URI | Explicit argv command with `directConnection=true` |
| App stays `health: starting` | Healthcheck used `localhost` (`::1`); Node binds IPv4 | Healthcheck uses `127.0.0.1` |
| Endless Kafka group rebalances / many members | KafkaJS `consumer.run()` resolves immediately; loops re-created consumers | Consumers park on a stop signal until shutdown |
| `EADDRINUSE :::3000` on host | `lms-app` already publishes port 3000 | `docker compose stop app` or set `PORT=3001` |
| ES count is lower right after startup | Debezium snapshot and indexing are asynchronous | Wait a few seconds, then recheck `books/_count` |
| `books` alias missing after a failed boot | Initial index creation did not run | Restart `app`; use `POST /admin/reindex` if needed |
| Duplicate notifications / jobs | Two app instances (container + host) | Run only one app instance |

The one-shot containers exiting with code `0` is normal. They are jobs, not daemons.

## Design documents

- `arch.md` - architecture, scaling, failure modes
- `LLD.md` - low-level design, APIs, schemas, load targets
- `problem.md` - original requirements

## Current status

- All seven long-running services start healthy with `docker compose up -d --build`.
- Debezium connector is `RUNNING`; all three seed books are indexed in Elasticsearch.
- Search, holds, loans, returns, fines, admin jobs, outbox relay, CDC indexing, and
  notifications are implemented.
- Unit tests pass; `npm run build` and `npm run typecheck` pass.
- k6 load-test scripts are not included in this repository yet.
