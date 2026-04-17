#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${API_PORT:-3111}"
API_BASE_URL="http://localhost:${API_PORT}"

curl_call() {
  if [[ -n "${API_ACCESS_KEY:-}" ]]; then
    curl -sS -H "x-api-key: ${API_ACCESS_KEY}" "$@"
    return
  fi

  curl -sS "$@"
}

cd "$ROOT_DIR"

PORT="$API_PORT" npm run dev -w api > /tmp/ams-smoke-api.log 2>&1 &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
  wait "$API_PID" 2>/dev/null || true
}

trap cleanup EXIT
sleep 5

curl_call -o /tmp/ams-smoke-health.json -w "%{http_code}" "${API_BASE_URL}/health" | grep -q "200"

CREATE_CODE=$(curl_call -o /tmp/ams-smoke-create.json -w "%{http_code}" \
  -X POST "${API_BASE_URL}/agents" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Agent","description":"for smoke checks","goal":"validate e2e","systemPrompt":"Return concise output.","outputMode":"text","hasKnowledge":true}')

if [[ "$CREATE_CODE" != "201" ]]; then
  echo "smoke failed: create agent status=$CREATE_CODE"
  exit 1
fi

AGENT_ID=$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("/tmp/ams-smoke-create.json","utf8"));process.stdout.write(d.agent.id);')

UPLOAD_CODE=$(curl_call -o /tmp/ams-smoke-upload.json -w "%{http_code}" \
  -X POST "${API_BASE_URL}/files/upload" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"${AGENT_ID}\",\"fileName\":\"smoke.txt\",\"content\":\"password reset via settings and email code\"}")

if [[ "$UPLOAD_CODE" != "201" ]]; then
  echo "smoke failed: upload status=$UPLOAD_CODE"
  exit 1
fi

CHAT_CODE=$(curl_call -o /tmp/ams-smoke-chat.json -w "%{http_code}" \
  -X POST "${API_BASE_URL}/chat" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"${AGENT_ID}\",\"message\":\"password reset\",\"useKnowledge\":true}")

if [[ "$CHAT_CODE" != "200" ]]; then
  echo "smoke failed: chat status=$CHAT_CODE"
  exit 1
fi

echo "smoke:e2e passed"
