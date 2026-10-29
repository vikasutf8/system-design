#!/bin/bash
# Explicit topic creation so consumers never race topic auto-creation.
set -euo pipefail

for topic in hold.events loan.events catalog.lms.books; do
  kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists \
    --topic "$topic" --partitions 3 --replication-factor 1
done

kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists \
  --topic catalog.books.dlq --partitions 1 --replication-factor 1

echo 'kafka topics ready'
