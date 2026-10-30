#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
SHOW_ID="${2:-load-$(date +%s)}"
REQUESTS="${3:-100}"
CONCURRENCY="${4:-50}"
SEAT_TYPE="${SEAT_TYPE:-PREMIUM}"

URL="$BASE_URL/api/availability?showId=${SHOW_ID}&seatType=${SEAT_TYPE}"

for tool in curl jq xargs; do
  command -v "$tool" >/dev/null 2>&1 || {
    printf 'Missing required tool: %s\n' "$tool" >&2
    exit 1
  }
done

curl -sf "$BASE_URL/actuator/health" >/dev/null || {
  printf 'Application is not healthy at %s\n' "$BASE_URL" >&2
  exit 1
}

metric_count() {
  curl -s "$BASE_URL/actuator/metrics/$1" \
    | jq -r '([.measurements[] | select(.statistic == "COUNT") | .value][0] // 0) | floor'
}

run_burst() {
  local label="$1"
  local before_leader before_hit before_miss
  local after_leader after_hit after_miss

  before_leader=$(metric_count availability.coalesced.leader)
  before_hit=$(metric_count availability.cache.hit)
  before_miss=$(metric_count availability.cache.miss)

  printf '\n%s: %s requests, %s concurrent users\n' "$label" "$REQUESTS" "$CONCURRENCY"
  seq 1 "$REQUESTS" | xargs -P "$CONCURRENCY" -I{} curl -s -o /dev/null "$URL"

  after_leader=$(metric_count availability.coalesced.leader)
  after_hit=$(metric_count availability.cache.hit)
  after_miss=$(metric_count availability.cache.miss)

  printf 'DB fetches (new in-flight futures): %s\n' "$((after_leader - before_leader))"
  printf 'Cache hits: %s\n' "$((after_hit - before_hit))"
  printf 'Cache misses: %s\n' "$((after_miss - before_miss))"
}

run_burst "Cold-cache burst"

printf '\nWaiting 8 seconds for the cache TTL to expire...\n'
sleep 8

run_burst "Burst after cache expiry"
