#!/usr/bin/env bash
set -euo pipefail

LISTMONK_URL="${LISTMONK_URL:-https://portal-newsletter-listmonk-production.up.railway.app}"
LISTMONK_API_USER="${LISTMONK_API_USER:-}"
LISTMONK_API_TOKEN="${LISTMONK_API_TOKEN:-}"
TEST_EMAIL="${TEST_EMAIL:-dekanbrown@odyssy.io}"
FROM_EMAIL="${FROM_EMAIL:-}"
DELETE_TEMPLATE="${DELETE_TEMPLATE:-true}"

if [[ -z "$LISTMONK_API_USER" || -z "$LISTMONK_API_TOKEN" ]]; then
  cat >&2 <<'EOF'
Missing API credentials.

Set:
  LISTMONK_API_USER=<api username>
  LISTMONK_API_TOKEN=<api token>

Create an API user/token in listmonk admin before running this script.
EOF
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

auth=(-u "${LISTMONK_API_USER}:${LISTMONK_API_TOKEN}")
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

template_payload="$(
  jq -n \
    --arg name "Portal Newsletter API Smoke Test ${timestamp}" \
    --arg subject "Portal newsletter API smoke test" \
    '{
      name: $name,
      type: "tx",
      subject: $subject,
      body: "<h1>Portal newsletter API smoke test</h1><p>{{ .Tx.Data.message }}</p><p>Sent at {{ .Tx.Data.timestamp }}.</p>"
    }'
)"

echo "Creating temporary transactional template..."
template_response="$(
  curl -fsS "${auth[@]}" \
    -H "Content-Type: application/json" \
    -X POST "${LISTMONK_URL%/}/api/templates" \
    --data "${template_payload}"
)"

template_id="$(jq -r '.data[0].id // .data.id // empty' <<<"$template_response")"

if [[ -z "$template_id" || "$template_id" == "null" ]]; then
  echo "Unable to read template ID from listmonk response:" >&2
  jq . <<<"$template_response" >&2
  exit 1
fi

tx_payload="$(
  jq -n \
    --arg email "$TEST_EMAIL" \
    --argjson templateID "$template_id" \
    --arg fromEmail "$FROM_EMAIL" \
    --arg timestamp "$timestamp" \
    '{
      subscriber_mode: "external",
      subscriber_emails: [$email],
      template_id: $templateID,
      content_type: "html",
      data: {
        message: "If this arrived, listmonk API, template rendering, and SendGrid SMTP are working.",
        timestamp: $timestamp
      }
    }
    | if $fromEmail != "" then . + {from_email: $fromEmail} else . end'
)"

echo "Sending transactional test email to ${TEST_EMAIL}..."
tx_response="$(
  curl -fsS "${auth[@]}" \
    -H "Content-Type: application/json" \
    -X POST "${LISTMONK_URL%/}/api/tx" \
    --data "${tx_payload}"
)"

jq . <<<"$tx_response"

if [[ "$DELETE_TEMPLATE" == "true" ]]; then
  echo "Deleting temporary template ${template_id}..."
  curl -fsS "${auth[@]}" \
    -X DELETE "${LISTMONK_URL%/}/api/templates/${template_id}" >/dev/null
fi

echo "Done."
