# Library Management System: Problem Statement

## 1. Problem statement (PS)

Design a backend for a library that lets members search a large book catalog, hold and borrow books, return them, and pay fines for late returns.

The hard parts are:

- Many members act at the same time, and two members must never get the same copy of a book (no double booking).
- Search must stay fast over a catalog of 2 million books.
- The system must stay available and keep p95 latency under 200 ms.

## 2. Scope

**In scope**

- Catalog search and book browsing
- Hold management (place, cancel, expire, waitlist)
- Checkout and return
- Overdue fine calculation

**Out of scope (mentioned in the design, not designed in detail)**

- Payments for fines (assume an external payment provider)
- Multi-branch inventory transfer
- Recommendations and reviews
- E-books and digital lending

## 3. Functional requirements (FR)

| ID | Requirement |
|----|-------------|
| FR1 | **Catalog search:** search books by title, author, ISBN, genre and language; return ranked results. |
| FR2 | **Book browsing:** view book details and see how many copies are available. |
| FR3 | **Catalog management:** librarians create and update book records. |
| FR4 | **Hold management:** a member places a hold on a book. If a copy is free, it is reserved for the member for a limited time. If not, the member joins a waitlist. Members can cancel holds. Unclaimed holds expire and pass to the next member in the waitlist. |
| FR5 | **Checkout and return:** a librarian checks a held copy out to a member with a due date, and checks it back in on return. |
| FR6 | **Overdue fines:** calculate fines for loans returned after the due date, and show members their open fines. |

## 4. Non-functional requirements (NFR)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1 | **Concurrency and isolation:** concurrent hold and checkout requests must never reserve the same copy twice. | Strong isolation on booking writes |
| NFR2 | **Availability** | 99.9% (about 43.8 min downtime per month, 8.76 h per year) |
| NFR3 | **Latency** | p95 under 200 ms for search and booking |
| NFR4 | **Scalability** | Handle a 3x traffic spike without redesign |
| NFR5 | **Durability** | No loss of committed holds, loans or fines |

## 5. Assumptions

- Catalog size: 2 million books (titles).
- Concurrent users: 1,500, each sending about 1 request per second.
- Search and browsing make up about 90% of traffic or more.
- Catalog writes are rare (librarians only).
- A hold stays valid for a configurable time (default 24 hours).
- Fine = overdue days x daily rate, capped at a configurable maximum.
- Reads can tolerate seconds of staleness (search results, availability counts). Booking writes cannot.

## 6. Back-of-envelope estimates

### 6.1 Traffic

| Item | Calculation | Result |
|------|-------------|--------|
| Total load | 1,500 users x 1 req/s | **1,500 RPS** |
| Read traffic (search, browse) | about 90% or more | about 1,350 to 1,450 RPS |
| Booking traffic (hold, checkout, return) | remaining share | **50 to 150 RPS** |
| 3x spike | 1,500 x 3 | about 4,500 RPS (about 4,200 reads, 150 to 450 writes) |

### 6.2 Storage

| Item | Calculation | Result |
|------|-------------|--------|
| Raw catalog | 2M books x about 2 KB | about **4 GB** |
| Elasticsearch index | raw size plus index overhead | about **10 GB** |
| Transactional data (copies, holds, loans, fines) | millions of small rows, hundreds of bytes each | a few GB at most |

One Elasticsearch shard group holds this easily. Replicas are added for availability and read capacity, not for size.

### 6.3 Latency budget (target p95 under 200 ms)

| Path | Hops | Estimate |
|------|------|----------|
| Search | gateway about 10 ms + Elasticsearch 30 to 50 ms | about **60 ms** |
| Booking | gateway about 10 ms + Redis under 1 ms + Postgres write 10 to 20 ms | about **30 ms** |

This leaves about 140 ms for service hops, serialization and retries.

### 6.4 Database concurrency

At the 3x peak, 450 writes/s x 20 ms per write is about 9 concurrent Postgres connections. A single primary with a connection pool is enough.

### 6.5 Availability

99.9% allows about 43.8 minutes of downtime per month. This needs no single point of failure at any tier (gateway, services, databases).

### 6.6 What the numbers tell us

The system is small. Standard components (Postgres, Elasticsearch, Redis, Kafka) cover it. Heavy stream-processing engines such as Spark and Flink are not justified.
