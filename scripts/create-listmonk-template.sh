#!/usr/bin/env bash
set -euo pipefail

LISTMONK_URL="${LISTMONK_URL:-https://updates.raidguild.org}"
LISTMONK_API_USER="${LISTMONK_API_USER:-}"
LISTMONK_API_TOKEN="${LISTMONK_API_TOKEN:-}"
TEMPLATE_NAME="${TEMPLATE_NAME:-RaidGuild Updates}"
TEMPLATE_TYPE="${TEMPLATE_TYPE:-campaign}"
TEMPLATE_FILE="${TEMPLATE_FILE:-templates/raidguild-updates.html}"

if [[ -z "$LISTMONK_API_USER" || -z "$LISTMONK_API_TOKEN" ]]; then
  cat >&2 <<'EOF'
Missing API credentials.

Set:
  LISTMONK_API_USER=<api username>
  LISTMONK_API_TOKEN=<api token>
EOF
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Template file not found: $TEMPLATE_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Missing required command: jq" >&2
  exit 1
fi

payload="$(
  jq -n \
    --arg name "$TEMPLATE_NAME" \
    --arg type "$TEMPLATE_TYPE" \
    --rawfile body "$TEMPLATE_FILE" \
    '{
      name: $name,
      type: $type,
      body: $body
    }'
)"

curl -fsS \
  -u "${LISTMONK_API_USER}:${LISTMONK_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST "${LISTMONK_URL%/}/api/templates" \
  --data "$payload" | jq .
