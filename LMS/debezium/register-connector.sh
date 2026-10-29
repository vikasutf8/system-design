#!/bin/sh
# Registers the Debezium MongoDB source connector once Kafka Connect is ready.
set -eu

CONNECT_URL="http://kafka-connect:8083"
CONNECTOR_NAME="lms-catalog-connector"

echo "waiting for Kafka Connect at ${CONNECT_URL} ..."
until curl -sf "${CONNECT_URL}/" >/dev/null; do
  sleep 3
done

if curl -sf "${CONNECT_URL}/connectors/${CONNECTOR_NAME}" >/dev/null; then
  echo "connector ${CONNECTOR_NAME} already exists"
  exit 0
fi

echo "registering ${CONNECTOR_NAME} ..."
curl -sf -X POST \
  -H "Content-Type: application/json" \
  --data @/debezium/catalog-connector.json \
  "${CONNECT_URL}/connectors"

echo
echo "connector registered"
