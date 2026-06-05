# CV Optimizer — backend infrastructure

Server-side backend for the `/cv-optimizer` page. The browser makes **one**
network call — `POST /api/generate` — and this backend forwards it to Claude.

**Why a backend at all?** The Anthropic API key must never reach the browser.
The page is served as a static file from S3/CloudFront, so the Claude call runs
in a Lambda behind API Gateway, with the key stored as a Lambda environment
variable. The browser never sees it.

```
browser ──POST /api/generate──▶ CloudFront (/api/* behavior)
                                     │
                                     ▼
                          API Gateway (HTTP API v2)
                                     │
                                     ▼
                         Lambda  cv-optimizer-generate
                                     │  ANTHROPIC_API_KEY (env)
                                     ▼
                          api.anthropic.com/v1/messages
```

## Layout

```
infra/cv-optimizer/
├── lambda/                     Lambda source (no npm deps; Node 20 global fetch)
│   ├── index.js                handler — adapts POST /api/generate to Claude
│   ├── _prompt.js              VERBATIM copy of cv-tailor api/_prompt.js (guardrails live here)
│   └── package.json
├── terraform/                  IaC for Lambda + IAM + HTTP API Gateway
│   ├── main.tf                 the resources (NEW only — does not touch prod CloudFront/S3)
│   ├── variables.tf            aws_region, anthropic_api_key (sensitive)
│   └── outputs.tf              api_invoke_url, api_gateway_domain, ...
├── scripts/
│   └── add-cloudfront-api-behavior.sh   wires prod CloudFront /api/* → this API (dry-run by default)
├── .gitignore                  protects tfstate / tfvars / build zip / config backups
└── README.md
```

## What this manages — and what it deliberately does NOT

**Manages (new, self-contained resources):** the Lambda, its IAM execution
role, and a standalone HTTP API Gateway with `POST` + `OPTIONS /api/generate`.

**Does NOT manage:** the existing production CloudFront distribution
(`E4FC18X0B6JRG`) or the `launchboxpk.com` S3 bucket. Those predate this work
and importing them into Terraform is risky. Wiring CloudFront's `/api/*` path to
the new API Gateway is therefore a separate, explicit step done with the
`scripts/add-cloudfront-api-behavior.sh` helper (see below).

## Deploy

> Run these under **your own** AWS credentials. Nothing here is auto-applied.

### 1. Provision the Lambda + API Gateway (Terraform)

```bash
cd infra/cv-optimizer/terraform

# Provide the key via env var — NEVER a committed tfvars file.
export TF_VAR_anthropic_api_key="sk-ant-...your-key..."
# optional: export TF_VAR_aws_region="us-east-1"   (default is us-east-1)

terraform init
terraform plan      # review: 1 Lambda, 1 IAM role + attachment, 1 HTTP API, 2 routes, 1 stage, 1 permission
terraform apply
```

Note the outputs, especially:

```bash
terraform output api_gateway_domain        # e.g. abc123.execute-api.us-east-1.amazonaws.com
terraform output api_generate_endpoint     # the full https URL of the POST endpoint
```

You can smoke-test the API directly before touching CloudFront:

```bash
curl -i -X POST "$(terraform output -raw api_generate_endpoint)" \
  -H 'Content-Type: application/json' \
  -d '{"answers":{"role":"Barista","seniority":"1-2 years","name":"Test"}}'
```

### 2. Wire CloudFront `/api/*` → API Gateway (same-origin)

This adds a custom origin + a `/api/*` cache behavior to the **live** prod
distribution so the browser can call `https://www.launchboxpk.com/api/generate`
(same-origin, no CORS). The behavior is created **without** the URL-rewrite
CloudFront Function — that function appends `/index.html` to extensionless URIs
and would corrupt `/api/generate`, so `/api/*` must bypass it.

```bash
cd infra/cv-optimizer/scripts

# Dry run first — prints the proposed config, backs up the current one, applies nothing:
./add-cloudfront-api-behavior.sh "$(cd ../terraform && terraform output -raw api_gateway_domain)"

# Review the printed *.new.json, then apply for real:
./add-cloudfront-api-behavior.sh "$(cd ../terraform && terraform output -raw api_gateway_domain)" --apply
```

The script refuses to add a second `/api/*` behavior if one already exists, and
writes a timestamped backup of the live config before any change.

### 3. Verify end-to-end

Once CloudFront status is `Deployed`:

```bash
curl -i -X OPTIONS https://www.launchboxpk.com/api/generate     # expect 204
```

Then open `https://www.launchboxpk.com/cv-optimizer`, run the question flow, and
confirm a resume is generated. Check the browser Network tab: the only backend
call is `POST /api/generate`, and **no Anthropic key appears anywhere** in the
request or page source.

## Security notes

- `ANTHROPIC_API_KEY` lives only as a Lambda env var. It is never in client
  code, never in the repo, never sent to the browser.
- Provide it to Terraform via `TF_VAR_anthropic_api_key` at apply time. The
  `.gitignore` here blocks `*.tfvars` and `*.tfstate*` so the resolved key can't
  be committed (state stores it in plaintext).
- The unrelated `.env` previously found in `~/Platform/cv-tailor/` is **not**
  part of this package and was left untouched. If that key may have been
  exposed, rotate it.

## Rollback

- **CloudFront:** re-apply the timestamped `*.backup.json` the script wrote (see
  the rollback hint printed at the end of an `--apply` run).
- **Lambda / API Gateway:** `terraform destroy` removes only the resources this
  module created; it cannot touch the prod distribution or bucket.
