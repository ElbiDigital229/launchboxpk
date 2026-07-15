# CV Optimizer — Handover / Knowledge Transfer

**Last updated:** 2026-06-11
**Status:** 🔴 **NOT working in production.** Backend is proven-good; the browser cannot reach it. See [The Blocker](#the-blocker).

This doc is written so someone on a fresh Mac can pick this up cold.

---

## 1. What this is

A server-side, Claude-powered CV builder at **https://www.launchboxpk.com/cv-optimizer**.

User answers a short wizard + optionally uploads their existing CV (PDF/image). The app sends it to Claude, which returns a structured resume JSON that the page renders and exports to PDF.

**Hard requirement:** the Anthropic API key must stay **server-side**. It must never appear in the browser bundle, and must never be committed.

---

## 2. Architecture

```
Browser (/cv-optimizer page)
   │  POST JSON { answers, file:{name,type,b64} }
   ▼
[ endpoint — THIS IS THE BROKEN LINK, see §5 ]
   ▼
AWS Lambda  cv-optimizer-generate   (nodejs20.x, 1024MB, 120s timeout)
   │  builds prompt, calls Anthropic
   ▼
Anthropic Messages API — claude-sonnet-4-20250514, max_tokens 4000
   ▼
returns { data: <resume JSON> }
```

### AWS account
**Elbi Digital — `304359596288`**, region **us-east-1**.
⚠️ Older notes said `504359596288` — that is **wrong**. It's `3`04359596288.

### Resources
| Resource | ID / Name | Notes |
|---|---|---|
| Lambda | `cv-optimizer-generate` | nodejs20.x, no npm deps (uses global `fetch`), 1024MB, **120s** timeout |
| Lambda role | `cv-optimizer-generate-role` | |
| API Gateway (HTTP API v2) | `l7690f2dzg` | `POST /api/generate` — **unusable, see §5** |
| Lambda Function URL | AuthType `NONE` | **403s, see §5** |
| CloudFront | `E4FC18X0B6JRG` | has `/api/*` behavior → API Gateway origin |
| WAF (auto-created) | `CreatedByCloudFront-6fd9d6b7` / `fa9e8e06-431f-44fe-9ea9-e97354eed76c` | **blocks bodies >8KB, see §5** |
| S3 bucket | `launchboxpk.com` | static site origin, us-east-1 |

### DNS (Namecheap, NOT Route53 — zero hosted zones in AWS)
- `www.launchboxpk.com` → CNAME → `d2yt06dff05zcy.cloudfront.net` ✅ the real site
- apex `launchboxpk.com` → `192.64.119.142` → **Namecheap parking/masked redirect. Unreliable — cannot reach CloudFront.** Fixing this properly means setting an apex→www redirect at Namecheap.

---

## 3. Repos & local setup

### ⚠️ Two local repos share ONE GitHub remote + ONE S3 bucket
- **`~/launchboxpk-astro`** — **THE LIVE ONE.** Astro rewrite. This is what's on `main`. Workflow: `.github/workflows/actions.yaml`.
- `~/launchboxpk` — original static HTML site. **STALE/abandoned.**
- `~/Platform/launchboxpk` — symlink → the stale one. Ignore.
- `~/launchboxredesign` — empty scaffold. Ignore.

**To change the live site: work in `~/launchboxpk-astro`, push to `main`.**

GitHub: `github.com/ElbiDigital229/launchboxpk`

### Key files
| Path | What |
|---|---|
| `src/pages/cv-optimizer.astro` | The whole frontend (wizard + fetch + PDF export). `ENDPOINT` const ~line 950. |
| `infra/cv-optimizer/lambda/index.js` | Lambda handler |
| `infra/cv-optimizer/lambda/_prompt.js` | `buildContent()` + `parseResumeJSON()` |
| `infra/cv-optimizer/terraform/` | Terraform IaC |
| `infra/cv-optimizer/scripts/add-cloudfront-api-behavior.sh` | wires CloudFront `/api/*` |

### Fresh-Mac setup
```bash
# 1. clone
git clone https://github.com/ElbiDigital229/launchboxpk.git ~/launchboxpk-astro
cd ~/launchboxpk-astro && npm install

# 2. aws cli auth (account 304359596288)
aws configure          # key id = 20 chars starting AKIA ; secret = 40 chars
#   ⚠️ GOTCHA: it's easy to paste these in the WRONG ORDER.
#   If you get "InvalidClientTokenId", you swapped them.
aws sts get-caller-identity     # must print 304359596288

# ~/.aws/config
#   [default]
#   region = us-east-1
#   output = json

# 3. terraform (v1.15.5). brew install may fail on outdated CLT —
#    fallback used here: precompiled binary at ~/.local/bin/terraform
terraform -version
```

### Secrets
- Anthropic key goes in **`infra/cv-optimizer/terraform/secret.auto.tfvars`** (gitignored):
  ```
  anthropic_api_key = "sk-ant-..."
  ```
  or via `TF_VAR_anthropic_api_key`.
- Verify it's ignored: `git check-ignore infra/cv-optimizer/terraform/secret.auto.tfvars`
- Terraform **local state is also gitignored and also contains the key**.
- **Never commit either.**

### IAM
`github-deploy` IAM user normally holds only **S3FullAccess + CloudFrontFullAccess** (its access keys are the GitHub Actions secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

For `terraform apply` it was **temporarily** granted 4 more:
`AWSLambda_FullAccess`, `AmazonAPIGatewayAdministrator`, `IAMFullAccess`, `CloudWatchLogsFullAccess`.

🔧 **Open cleanup task:** remove those 4 to restore least-privilege (re-add if running terraform again).

---

## 4. Deploy

**Frontend** — push to `main`, GitHub Actions does: build → `aws s3 sync` → update CF function → invalidate `E4FC18X0B6JRG`. ~60s.
```bash
cd ~/launchboxpk-astro
npm run build
grep -o "execute-api[^\"']*" dist/cv-optimizer/index.html   # sanity-check endpoint baked in
git add -A && git commit -m "..." && git push origin main
gh run watch
```
⚠️ CloudFront/browser caching means the old page can linger — **hard-refresh** before concluding a fix failed. This burned a lot of time.

**Backend**
```bash
cd infra/cv-optimizer/terraform && terraform apply   # needs AWS creds + the key
# re-wire CloudFront:
scripts/add-cloudfront-api-behavior.sh <apigw-domain> --apply
```

⚠️ Lambda `timeout=120` / `memory=1024` were set **via CLI, not Terraform**. Terraform still has the old values — **a `terraform apply` will revert them.** Reconcile the TF before applying.

---

## 5. THE BLOCKER — read this before touching anything

### ✅ What is PROVEN working
Direct Lambda invoke with a **real 152KB PDF** (`Ahsan Shahzad - CV.pdf`) returns **StatusCode 200** with a fully parsed CV (name, title "Senior Product Manager", email, phone, location). So: **Anthropic key valid, credits funded, PDF vision parsing, prompt, JSON parsing — all good.**

```bash
# reproduce (event shaped as API-GW v2 / Function URL payload):
aws lambda invoke --function-name cv-optimizer-generate \
  --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/lambda_event.json /tmp/out.json
# → {"StatusCode":200}  ; body contains the resume JSON
```
**Measured duration: ~40 seconds** for a real PDF. Output only ~5.3KB (~1500 tokens), so `max_tokens` is NOT the bottleneck — the latency is Claude *reading the PDF*.

### ❌ Why the browser still can't reach it — three separate walls

**Wall 1 — CloudFront WAF blocks the upload (8KB).**
The auto-created WAF has `AWSManagedRulesCommonRuleSet` → its **`SizeRestrictions_BODY` rule rejects any request body >8KB with HTTP 403.** A base64 CV easily exceeds 8KB.
Verified: 4KB body → reaches Lambda; 8KB+ → 403.
→ **Any path through CloudFront is dead for file uploads** unless the WAF rule is excepted/scoped-down for `/api/*`. (WAF = a security setting; changing it needs a human decision.)

**Wall 2 — API Gateway has a hard 30s cap.**
HTTP API integration timeout maxes at **29–30s**. The Lambda needs **~40s**. So the current production path **always** times out:
- `HTTP 500 {"message":"Internal Server Error"}`, CloudWatch shows `Duration: 29000.00 ms  Status: timeout`
- After raising memory to 1024MB it got *worse-looking*: `HTTP 503` at **31.7s**.
Raising Lambda timeout does **nothing** — API Gateway cuts the connection first. **This wall cannot be removed.**

**Wall 3 — Lambda Function URL returns 403 (UNSOLVED).**
The correct fix for Wall 2 is a Function URL (no 30s cap, up to 15min). It was created correctly but **every anonymous request 403s at the auth front door** — requests never reach the Lambda (no CloudWatch entries).

Current state:
```
URL:      https://fqznccw2fpkyflf5ykbnhrooki0azrtn.lambda-url.us-east-1.on.aws/
AuthType: NONE
Policy:   AllowPublicFunctionUrl | lambda:InvokeFunctionUrl | Principal "*"
          Condition: StringEquals lambda:FunctionUrlAuthType = NONE
```
That is the **textbook** AWS public-access config. Response:
```
403 {"Message":"Forbidden. For troubleshooting Function URL authorization issues, see:
     https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html"}
```

**Ruled out:**
- ❌ Propagation — still 403 after **many hours** (and across a full recreate).
- ❌ Org SCP/RCP — `aws organizations describe-organization` → `AWSOrganizationsNotInUseException: Your account is not a member of an organization.` **Standalone account.**
- ❌ Malformed policy — inspected raw JSON, it's correct (`Principal: "*"`, right action, right condition, right resource ARN, unqualified — matches the unqualified URL config).
- ❌ Stale state — deleted + recreated URL config *and* permission (fresh statement id `AllowPublicFunctionUrl`) twice.
- ❌ Lambda broken — direct invoke returns 200.
- ❌ Old AWS CLI — `aws-cli/2.34.24`.
- ❌ Payload size — even a tiny `{"answers":{}}` POST and a bare GET both 403.

**→ Next step when resuming: inspect the Function URL in the AWS Lambda console** (needs interactive login; CLI shows nothing wrong). Look for an account-level public-access guardrail / any banner on the Function URL config page. This is the single thing standing between "broken" and "shipped".

### Why not just use CloudFront → Function URL?
Because CloudFront re-introduces **Wall 1** (the 8KB WAF block), which is the very thing we're bypassing. CloudFront's origin timeout is also 30s by default (raisable to 60s+), so it'd need two changes *and* a WAF exception.

### Remaining options if the Function URL can't be unblocked
1. **Fix the WAF** — add an exception so `SizeRestrictions_BODY` doesn't apply to `/api/*`, **and** raise the CloudFront origin response timeout to 60s. Gets you to 60s (> the 40s needed) via CloudFront. Two prod changes, one of them a security setting.
2. **Async job pattern** — API Gateway returns `202 + jobId` immediately; Lambda writes the result to S3/DynamoDB; browser polls. Defeats both the 30s cap and the WAF (small polling bodies), but the upload itself is still >8KB → still needs a WAF fix or a presigned-S3 direct upload. Most robust, most work.
3. **Shrink the request/latency** — extract PDF text client-side and send text instead of the PDF document block. Cuts body size (dodges the 8KB WAF rule) *and* cuts Claude latency a lot (no vision). Arguably the best real fix; needs a client-side PDF text extractor.

---

## 6. Frontend contract

```js
// src/pages/cv-optimizer.astro  (~line 950)
const ENDPOINT = 'https://l7690f2dzg.execute-api.us-east-1.amazonaws.com/api/generate';

// payload
{
  answers: { ...wizard answers... },
  file: { name, type, b64 } | null    // b64 = raw base64, prefix stripped via r.result.split(',')[1]
}
```
Lambda maps `file.type`:
- `application/pdf` → Claude `document` block
- `image/*` → `image` block
- else → decoded as UTF-8 text

Lambda returns only **200 / 204 / 405 / 500 / 502** — **it never returns 403.**
👉 **Therefore any 403 you see is infrastructure (CloudFront/WAF/API Gateway/Function URL auth), never app code.** This is the single most useful debugging heuristic here.

The page surfaces failures as `Generation service error (<status>)` — that's where the user-visible "(403)" came from.

---

## 7. Git history (relevant)

```
461610f  Fix CV Optimizer file-upload 403: call API Gateway directly   ← current main
344b9e6  fix(cv-optimizer): call backend via absolute www URL off-www
7843437  Merge feat/cv-optimizer: CV Optimizer page + serverless Claude backend
```

⚠️ **Local `main` once diverged badly.** There was an unpushed Aug-2025 commit (`59b7e37 "Fix format"`, author `prototypa`) that was just AstroWind template scaffolding, redundant with `origin/main`, and it caused modify/delete conflicts. Resolved with `git reset --hard origin/main`. **`origin/main` is authoritative — trust it over any local main.**

---

## 8. Open tasks

- [ ] 🔴 **Unblock the Lambda Function URL 403** (console inspection) — or pick option 1/2/3 from §5.
- [ ] Then: point `ENDPOINT` at the Function URL, `npm run build`, push, verify a real upload end-to-end.
- [ ] Reconcile Terraform with the CLI drift (`timeout=120`, `memory=1024`, the Function URL + its permission).
- [ ] Remove the 4 temporary IAM policies from `github-deploy`.
- [ ] Fix apex → www redirect at Namecheap (so bare `launchboxpk.com` works).
- [ ] Anthropic credits are live but finite — top up at console.anthropic.com → Plans & Billing. Symptom of empty: `502 "credit balance too low"`.

---

## 9. Useful commands

```bash
# Is the backend actually fine? (bypasses all networking)
aws lambda invoke --function-name cv-optimizer-generate \
  --cli-binary-format raw-in-base64-out --payload file:///tmp/lambda_event.json /tmp/out.json

# Why did it fail? (timeout vs crash)
aws logs describe-log-streams --log-group-name /aws/lambda/cv-optimizer-generate \
  --order-by LastEventTime --descending --max-items 1 \
  --query "logStreams[0].logStreamName" --output text
aws logs get-log-events --log-group-name /aws/lambda/cv-optimizer-generate \
  --log-stream-name '<stream>' --query "events[*].message" --output text
#   look for:  Status: timeout   |   Duration: 29000.00 ms

# Function URL state
aws lambda get-function-url-config --function-name cv-optimizer-generate
aws lambda get-policy --function-name cv-optimizer-generate --query Policy --output text | python3 -m json.tool

# Recreate public Function URL from scratch
aws lambda delete-function-url-config --function-name cv-optimizer-generate
aws lambda remove-permission --function-name cv-optimizer-generate --statement-id AllowPublicFunctionUrl
aws lambda create-function-url-config --function-name cv-optimizer-generate --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type"],"MaxAge":86400}'
aws lambda add-permission --function-name cv-optimizer-generate \
  --statement-id AllowPublicFunctionUrl --action lambda:InvokeFunctionUrl \
  --principal "*" --function-url-auth-type NONE

# WAF that causes the 8KB block
aws cloudfront get-distribution-config --id E4FC18X0B6JRG --query DistributionConfig.WebACLId --output text

# Is the deployed page actually new? (beat the cache)
curl -s https://www.launchboxpk.com/cv-optimizer/ | grep -o "https://[a-z0-9.-]*\(execute-api\|lambda-url\)[^\"']*"
```

### Build a real test payload
```bash
B64=$(base64 -i "/path/to/CV.pdf")
python3 -c "
import json
b64='''$B64'''.replace('\n','')
payload={'answers':{'name':'Test','location':'Lahore'},
         'file':{'name':'CV.pdf','type':'application/pdf','b64':b64}}
open('/tmp/cvpayload.json','w').write(json.dumps(payload))
event={'version':'2.0','requestContext':{'http':{'method':'POST'}},
       'headers':{'content-type':'application/json'},
       'body':json.dumps(payload),'isBase64Encoded':False}
open('/tmp/lambda_event.json','w').write(json.dumps(event))
"
```

---

## 10. Hard-won lessons

1. **The Lambda never returns 403** → every 403 is infrastructure. Don't debug app code.
2. **Always hard-refresh / verify with `curl`** before believing a deploy didn't work. A cached page cost hours of chasing a fixed bug.
3. **CloudFront WAF silently 403s bodies >8KB.** Nothing in the logs says "WAF". You only find it by bisecting body size.
4. **API Gateway's 30s cap is absolute.** Lambda timeout is irrelevant behind it.
5. **More Lambda memory doesn't speed up Claude** — inference is server-side. 256MB→1024MB changed 29s-timeout to 31.7s-timeout.
6. **Reading a PDF is the latency**, not generating tokens (output was only ~1500 tokens for a 40s call).
7. AWS account is **304359596288** (a 3, not a 5).
8. `aws configure` key order is easy to swap → `InvalidClientTokenId`. Key ID = 20 chars `AKIA...`; secret = 40 chars.
