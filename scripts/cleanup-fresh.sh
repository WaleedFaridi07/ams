#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.deploy.yml"
WIPE_VOLUME=false
AUTO_YES=false

for arg in "$@"; do
  case "$arg" in
    --wipe-volume)
      WIPE_VOLUME=true
      ;;
    --yes)
      AUTO_YES=true
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: bash scripts/cleanup-fresh.sh [--wipe-volume] [--yes]"
      exit 1
      ;;
  esac
done

confirm() {
  local prompt="$1"

  if [ "$AUTO_YES" = true ]; then
    return 0
  fi

  read -r -p "$prompt [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

echo "Starting workspace cleanup..."

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Missing compose file: $COMPOSE_FILE"
  exit 1
fi

mkdir -p "$ROOT_DIR/data/uploads"

echo "Removing generated artifacts..."
rm -rf "$ROOT_DIR/data/uploads"/*
rm -f "$ROOT_DIR/openspec/report.html"
rm -rf "$ROOT_DIR/apps/api/dist" "$ROOT_DIR/apps/web/dist"

if [ "$WIPE_VOLUME" = true ]; then
  if confirm "This will remove Docker volumes (full database wipe). Continue?"; then
    echo "Stopping stack and wiping volumes..."
    docker compose -f "$COMPOSE_FILE" down -v
    echo "Starting fresh stack..."
    docker compose -f "$COMPOSE_FILE" up -d --build postgres api web
    echo "Full cleanup completed."
    exit 0
  fi

  echo "Cancelled volume wipe."
  exit 1
fi

if docker compose -f "$COMPOSE_FILE" ps postgres >/dev/null 2>&1; then
  echo "Resetting database rows (keeping seed agents)..."
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U ams -d ams -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE chunks RESTART IDENTITY CASCADE;"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U ams -d ams -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE agent_children RESTART IDENTITY CASCADE;"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U ams -d ams -v ON_ERROR_STOP=1 -c "DELETE FROM agents WHERE id NOT IN ('agent-support-001','agent-product-001');"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U ams -d ams -v ON_ERROR_STOP=1 -c "UPDATE agents SET has_knowledge = FALSE, knowledge_only = FALSE, internet_enabled = TRUE, mcp_enabled = FALSE, mcp_url = NULL, mcp_secret = NULL WHERE id IN ('agent-support-001','agent-product-001');"
else
  echo "Postgres service is not running. Skipped database reset."
  echo "Run: docker compose -f docker-compose.deploy.yml up -d postgres"
fi

echo "Cleanup completed."
echo "- Uploads cleared"
echo "- OpenSpec report removed"
echo "- Build outputs removed"
echo "- DB reset to seeded agents (soft reset)"
