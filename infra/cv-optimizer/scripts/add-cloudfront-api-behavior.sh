#!/usr/bin/env bash
###############################################################################
# add-cloudfront-api-behavior.sh
#
# Wires the existing production CloudFront distribution's /api/* path to the
# CV Optimizer API Gateway, so the browser calls a SAME-ORIGIN URL
# (https://www.launchboxpk.com/api/generate) and CloudFront forwards it to the
# HTTP API. This keeps the Anthropic key server-side and avoids CORS.
#
# It does TWO things to the live distribution config:
#   1. Adds a new custom origin  -> the API Gateway hostname
#   2. Adds a new cache behavior -> PathPattern "/api/*" targeting that origin,
#      with caching effectively disabled, POST/OPTIONS allowed, and (critically)
#      NO CloudFront Function attached. The site's viewer-request function
#      rewrites extensionless URIs to /index.html; attaching it here would
#      corrupt /api/generate. So /api/* must bypass it.
#
# SAFETY:
#   - Dry-run by default. It prints the proposed new config and writes it to a
#     file, but does NOT call update-distribution unless you pass --apply.
#   - Always backs up the current live config first.
#   - Idempotent-ish: refuses to add a second "/api/*" behavior if one exists.
#
# REQUIREMENTS: awscli v2, jq. AWS creds with cloudfront:GetDistributionConfig
# and cloudfront:UpdateDistribution for the distribution below.
#
# USAGE:
#   ./add-cloudfront-api-behavior.sh <api-gateway-domain>
#   ./add-cloudfront-api-behavior.sh <api-gateway-domain> --apply
#
#   <api-gateway-domain> is the hostname ONLY (no https://, no path), e.g.
#   abc123.execute-api.us-east-1.amazonaws.com
#   (Terraform prints it as output "api_gateway_domain".)
###############################################################################
set -euo pipefail

DISTRIBUTION_ID="E4FC18X0B6JRG"   # launchboxpk.com production distribution
PATH_PATTERN="/api/*"
ORIGIN_ID="cv-optimizer-apigw"

API_DOMAIN="${1:-}"
APPLY="${2:-}"

if [[ -z "$API_DOMAIN" ]]; then
  echo "ERROR: missing API Gateway domain." >&2
  echo "Usage: $0 <api-gateway-domain> [--apply]" >&2
  echo "Example: $0 abc123.execute-api.us-east-1.amazonaws.com" >&2
  exit 1
fi

if [[ "$API_DOMAIN" == http*://* || "$API_DOMAIN" == */* ]]; then
  echo "ERROR: pass the HOSTNAME only — no scheme, no path." >&2
  echo "  bad : https://abc123.execute-api.us-east-1.amazonaws.com/api/generate" >&2
  echo "  good: abc123.execute-api.us-east-1.amazonaws.com" >&2
  exit 1
fi

command -v jq  >/dev/null || { echo "ERROR: jq is required." >&2; exit 1; }
command -v aws >/dev/null || { echo "ERROR: awscli is required." >&2; exit 1; }

TS="$(date +%Y%m%d-%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="${SCRIPT_DIR}/dist-config-${DISTRIBUTION_ID}-${TS}.backup.json"
NEWCONF="${SCRIPT_DIR}/dist-config-${DISTRIBUTION_ID}-${TS}.new.json"

echo "==> Fetching current distribution config for ${DISTRIBUTION_ID} ..."
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" > "$BACKUP"
ETAG="$(jq -r '.ETag' "$BACKUP")"
echo "    Backed up live config -> ${BACKUP}  (ETag ${ETAG})"

# Guard: don't double-add the behavior.
if jq -e --arg p "$PATH_PATTERN" \
     '.DistributionConfig.CacheBehaviors.Items[]? | select(.PathPattern == $p)' \
     "$BACKUP" >/dev/null; then
  echo "==> A behavior for '${PATH_PATTERN}' already exists. Nothing to do." >&2
  exit 0
fi

echo "==> Building proposed config (adds origin '${ORIGIN_ID}' + '${PATH_PATTERN}' behavior) ..."

# The CachingDisabled managed policy id is a well-known constant across all
# accounts. AllViewerExceptHostHeader forwards body + querystring + needed
# headers to a custom origin without breaking the API Gateway host routing.
CACHE_POLICY_DISABLED="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ORIGIN_REQUEST_ALLVIEWER_EXCEPT_HOST="b689b0a8-53d0-40ab-baf2-68738e2966ac"

jq \
  --arg domain "$API_DOMAIN" \
  --arg oid "$ORIGIN_ID" \
  --arg pp "$PATH_PATTERN" \
  --arg cpd "$CACHE_POLICY_DISABLED" \
  --arg orp "$ORIGIN_REQUEST_ALLVIEWER_EXCEPT_HOST" \
  '
  .DistributionConfig
  # --- add the custom origin (API Gateway) ---------------------------------
  | .Origins.Items += [{
      "Id": $oid,
      "DomainName": $domain,
      "OriginPath": "",
      "CustomHeaders": { "Quantity": 0 },
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "https-only",
        "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] },
        "OriginReadTimeout": 30,
        "OriginKeepaliveTimeout": 5
      },
      "ConnectionAttempts": 3,
      "ConnectionTimeout": 10,
      "OriginShield": { "Enabled": false }
    }]
  | .Origins.Quantity = (.Origins.Items | length)
  # --- prepend the /api/* behavior (ordered behaviors match top-down) ------
  | .CacheBehaviors.Items = ([{
      "PathPattern": $pp,
      "TargetOriginId": $oid,
      "ViewerProtocolPolicy": "redirect-to-https",
      "AllowedMethods": {
        "Quantity": 7,
        "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
        "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] }
      },
      "Compress": false,
      "SmoothStreaming": false,
      "FieldLevelEncryptionId": "",
      "CachePolicyId": $cpd,
      "OriginRequestPolicyId": $orp,
      "LambdaFunctionAssociations": { "Quantity": 0 },
      "FunctionAssociations": { "Quantity": 0 }
    }] + (.CacheBehaviors.Items // []))
  | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
  ' "$BACKUP" > "$NEWCONF"

echo "    Proposed config written -> ${NEWCONF}"
echo
echo "    Summary of changes:"
echo "      + origin   : ${ORIGIN_ID} -> ${API_DOMAIN} (https-only, 30s read timeout)"
echo "      + behavior : ${PATH_PATTERN} -> ${ORIGIN_ID} (caching disabled, POST allowed, NO function attached)"
echo

if [[ "$APPLY" != "--apply" ]]; then
  cat <<EOF
==> DRY RUN. Nothing was changed on the live distribution.
    Review ${NEWCONF}, then re-run with --apply to push it:

      $0 ${API_DOMAIN} --apply

EOF
  exit 0
fi

echo "==> APPLYING update to distribution ${DISTRIBUTION_ID} (ETag ${ETAG}) ..."
aws cloudfront update-distribution \
  --id "$DISTRIBUTION_ID" \
  --if-match "$ETAG" \
  --distribution-config "file://${NEWCONF}" \
  --query 'Distribution.Status' --output text

cat <<EOF

==> Update submitted. CloudFront will redeploy (typically a few minutes).
    Verify once Status is 'Deployed':

      curl -i -X OPTIONS https://www.launchboxpk.com/api/generate
      # then exercise the real flow from the /cv-optimizer page

    To roll back, re-apply the backup config:
      aws cloudfront update-distribution --id ${DISTRIBUTION_ID} \\
        --if-match <current-etag> \\
        --distribution-config "file://${BACKUP}#.DistributionConfig"
    (the backup file wraps config under .DistributionConfig — extract it with jq first)
EOF
