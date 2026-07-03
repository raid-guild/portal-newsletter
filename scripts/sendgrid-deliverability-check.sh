#!/usr/bin/env bash
set -euo pipefail

SENDGRID_API_KEY="${SENDGRID_API_KEY:-}"
SENDGRID_API_BASE_URL="${SENDGRID_API_BASE_URL:-https://api.sendgrid.com}"
SENDGRID_VALIDATE_DOMAINS="${SENDGRID_VALIDATE_DOMAINS:-false}"

if [[ -z "$SENDGRID_API_KEY" ]]; then
  cat >&2 <<'EOF'
Missing SENDGRID_API_KEY.

Run with:
  SENDGRID_API_KEY='<sendgrid key>' ./scripts/sendgrid-deliverability-check.sh

Or with Railway-injected Portal variables:
  railway run --service Portal-CMS -- ./scripts/sendgrid-deliverability-check.sh
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

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  if [[ -n "$data" ]]; then
    curl -fsS \
      -X "$method" \
      -H "Authorization: Bearer ${SENDGRID_API_KEY}" \
      -H "Content-Type: application/json" \
      "${SENDGRID_API_BASE_URL%/}${path}" \
      --data "$data"
  else
    curl -fsS \
      -X "$method" \
      -H "Authorization: Bearer ${SENDGRID_API_KEY}" \
      "${SENDGRID_API_BASE_URL%/}${path}"
  fi
}

section() {
  printf '\n## %s\n' "$1"
}

mask_email() {
  awk -F@ '{
    if (NF != 2) { print $0; next }
    name=$1
    domain=$2
    if (length(name) <= 2) masked=substr(name,1,1) "***"
    else masked=substr(name,1,2) "***"
    print masked "@" domain
  }'
}

section "API Access"
if account_json="$(api GET /v3/user/account 2>/tmp/sendgrid-account-error.txt)"; then
  echo "$account_json" | jq -r '"account type: " + ((.type // "unknown")|tostring)'
else
  echo "Unable to read /v3/user/account. The key may still work for mail send but lack account read permission."
  cat /tmp/sendgrid-account-error.txt >&2 || true
fi

section "Authenticated Domains"
if domains_json="$(api GET '/v3/whitelabel/domains?limit=100' 2>/tmp/sendgrid-domains-error.txt)"; then
  domain_count="$(echo "$domains_json" | jq 'length')"
  echo "domains found: ${domain_count}"
  echo "$domains_json" | jq -r '
    .[]
    | [
        ("id=" + (.id|tostring)),
        ("domain=" + (.domain // "")),
        ("subdomain=" + (.subdomain // "")),
        ("valid=" + (.valid|tostring)),
        ("default=" + (.default|tostring))
      ]
    | join("  ")
  '

  echo
  echo "DNS record status:"
  echo "$domains_json" | jq -r '
    .[]
    | . as $domain
    | ($domain.dns // {})
    | to_entries[]
    | [
        ($domain.domain // ""),
        .key,
        (.value.host // ""),
        (.value.type // ""),
        ("valid=" + ((.value.valid // false)|tostring))
      ]
    | @tsv
  ' | column -t -s $'\t' || true

  if [[ "$SENDGRID_VALIDATE_DOMAINS" == "true" ]]; then
    echo
    echo "Validation check:"
    echo "$domains_json" | jq -r '.[].id' | while read -r domain_id; do
      [[ -z "$domain_id" || "$domain_id" == "null" ]] && continue
      if validate_json="$(api POST "/v3/whitelabel/domains/${domain_id}/validate" '{}' 2>/tmp/sendgrid-validate-error.txt)"; then
        echo "$validate_json" | jq -r --arg id "$domain_id" '"id=" + $id + " valid=" + ((.valid // false)|tostring)'
      else
        echo "id=${domain_id} validation request failed"
        cat /tmp/sendgrid-validate-error.txt >&2 || true
      fi
    done
  fi
else
  echo "Unable to read authenticated domains. The key may need Sender Authentication read permission."
  cat /tmp/sendgrid-domains-error.txt >&2 || true
fi

section "Verified Senders"
if senders_json="$(api GET '/v3/verified_senders?limit=100' 2>/tmp/sendgrid-senders-error.txt)"; then
  echo "$senders_json" | jq -r '
    (.results // . // [])
    | .[]
    | [
        (.nickname // ""),
        (.from_email // ""),
        ("verified=" + ((.verified // false)|tostring))
      ]
    | @tsv
  ' | while IFS=$'\t' read -r nickname email verified; do
    masked="$(printf '%s\n' "$email" | mask_email)"
    printf '%s  %s  %s\n' "$nickname" "$masked" "$verified"
  done
else
  echo "Unable to read verified senders. The key may need Sender Verification read permission."
  cat /tmp/sendgrid-senders-error.txt >&2 || true
fi

section "Unsubscribe Groups"
if groups_json="$(api GET /v3/asm/groups 2>/tmp/sendgrid-groups-error.txt)"; then
  echo "$groups_json" | jq -r '
    .[]
    | [
        ("id=" + (.id|tostring)),
        ("name=" + (.name // "")),
        ("default=" + ((.is_default // false)|tostring)),
        ("unsubscribes=" + ((.unsubscribes // 0)|tostring))
      ]
    | join("  ")
  '
else
  echo "Unable to read unsubscribe groups. The key may need ASM read permission."
  cat /tmp/sendgrid-groups-error.txt >&2 || true
fi

section "Suppression Accessibility"
for endpoint in \
  '/v3/suppression/bounces?limit=1' \
  '/v3/suppression/blocks?limit=1' \
  '/v3/suppression/invalid_emails?limit=1' \
  '/v3/suppression/spam_reports?limit=1' \
  '/v3/asm/suppressions?limit=1'
do
  if api GET "$endpoint" >/dev/null 2>/tmp/sendgrid-suppression-error.txt; then
    echo "ok     ${endpoint}"
  else
    echo "denied ${endpoint}"
  fi
done

section "Interpretation"
cat <<'EOF'
Minimum pre-send checks:
- At least one authenticated domain should be valid=true for the newsletter From domain.
- The From address used by listmonk should be a verified sender or under an authenticated domain.
- There should be an unsubscribe group or listmonk unsubscribe path for marketing/newsletter sends.
- Suppression endpoints should be accessible if we plan to reconcile bounces/unsubscribes from SendGrid.
EOF
