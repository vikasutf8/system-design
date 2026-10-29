-- =============================================================================
-- Booking write model (arch.md 5.1 + LLD section 4 additions).
-- PostgreSQL is the single source of truth for copies, holds, loans and fines.
-- All booking state changes run inside a transaction with row locks.
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    user_id     UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    role        TEXT NOT NULL,                       -- MEMBER, LIBRARIAN, ADMIN
    status      TEXT NOT NULL DEFAULT 'ACTIVE'
);

-- One row per physical copy. book_id refers to the MongoDB catalog document.
CREATE TABLE IF NOT EXISTS book_copy (
    copy_id     UUID PRIMARY KEY,
    book_id     TEXT NOT NULL,
    status      TEXT NOT NULL,                       -- AVAILABLE, HELD, CHECKED_OUT, LOST, DAMAGED
    version     INT  NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_copy_book_status ON book_copy (book_id, status);

CREATE TABLE IF NOT EXISTS holds (
    hold_id         UUID PRIMARY KEY,
    book_id         TEXT NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(user_id),
    copy_id         UUID REFERENCES book_copy(copy_id),   -- NULL while waitlisted
    status          TEXT NOT NULL,                        -- ACTIVE, QUEUED, FULFILLED, CANCELLED, EXPIRED
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,                          -- set when a copy is assigned
    idempotency_key TEXT NOT NULL,
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_holds_queue  ON holds (book_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_holds_expiry ON holds (status, expires_at);

-- LLD section 4: one open hold per member/book, even under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_hold_per_user_book
    ON holds (user_id, book_id)
    WHERE status IN ('ACTIVE', 'QUEUED');

CREATE TABLE IF NOT EXISTS loans (
    loan_id        UUID PRIMARY KEY,
    copy_id        UUID NOT NULL REFERENCES book_copy(copy_id),
    user_id        UUID NOT NULL REFERENCES users(user_id),
    checked_out_at TIMESTAMPTZ NOT NULL,
    due_at         TIMESTAMPTZ NOT NULL,
    returned_at    TIMESTAMPTZ,
    status         TEXT NOT NULL                          -- OPEN, RETURNED
);
CREATE INDEX IF NOT EXISTS idx_loans_open_due ON loans (status, due_at);
-- LLD section 4: supports the nightly fine accrual query.
CREATE INDEX IF NOT EXISTS idx_loans_overdue ON loans (due_at) WHERE status = 'OPEN';
-- A copy can have only one open loan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_open_copy ON loans (copy_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS fines (
    fine_id      UUID PRIMARY KEY,
    loan_id      UUID UNIQUE NOT NULL REFERENCES loans(loan_id),
    user_id      UUID NOT NULL REFERENCES users(user_id),
    days_overdue INT  NOT NULL,
    amount       NUMERIC(10,2) NOT NULL,
    status       TEXT NOT NULL,                           -- ACCRUING, FINAL, PAID, WAIVED
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox. The relay publishes unpublished rows to Kafka and
-- then stamps published_at. Delivery is at least once.
CREATE TABLE IF NOT EXISTS outbox (
    id           BIGSERIAL PRIMARY KEY,
    topic        TEXT NOT NULL,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

-- =============================================================================
-- Development seed data. These IDs are used by execute.md examples.
-- =============================================================================

INSERT INTO users (user_id, name, email, role, status) VALUES
    ('11111111-1111-4111-8111-111111111111', 'Maya Member',   'maya@example.com',  'MEMBER',    'ACTIVE'),
    ('22222222-2222-4222-8222-222222222222', 'Noah Member',   'noah@example.com',  'MEMBER',    'ACTIVE'),
    ('33333333-3333-4333-8333-333333333333', 'Lena Librarian','lena@example.com',  'LIBRARIAN', 'ACTIVE'),
    ('44444444-4444-4444-8444-444444444444', 'Adam Admin',    'adam@example.com',  'ADMIN',     'ACTIVE')
ON CONFLICT (user_id) DO NOTHING;

-- b-demo-1 has three copies, b-demo-2 has two, b-demo-3 has none (waitlist demo).
INSERT INTO book_copy (copy_id, book_id, status, version) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'b-demo-1', 'AVAILABLE', 0),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'b-demo-1', 'AVAILABLE', 0),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'b-demo-1', 'AVAILABLE', 0),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'b-demo-2', 'AVAILABLE', 0),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'b-demo-2', 'AVAILABLE', 0)
ON CONFLICT (copy_id) DO NOTHING;
