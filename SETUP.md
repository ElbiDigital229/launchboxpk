# launchboxpk.com — How Everything Is Configured

**Last verified:** 2026-07-15 (every fact below was checked against the live repo / AWS, not memory)

Coworking-space site for Launchbox (DHA Lahore). This doc explains the whole setup end-to-end: git, hosting, deploy, the jobs pipeline, and the CV Optimizer.

> For the CV Optimizer's deep debugging history, see [`infra/cv-optimizer/HANDOVER.md`](infra/cv-optimizer/HANDOVER.md).

---

## 1. TL;DR — the stack

```
GitHub (ElbiDigital229/launchboxpk, branch main)
   │  push → GitHub Actions "Deploy to S3"
   │  npm ci → npm run build (Astro static)
   ▼
S3 bucket  launchboxpk.com   (us-east-1, static-website hosting)
   ▼
CloudFront E4FC18X0B6JRG  + CF Function launchboxpk-url-rewrite  + WAF
   ▼
www.launchboxpk.com   (DNS at Namecheap, NOT Route53)
```

Astro **static** site (`output: 'static'`) — no server runtime. The only dynamic piece is the CV Optimizer, which calls a Lambda.

---

## 2. Git

**Remote:** `https://github.com/ElbiDigital229/launchboxpk.git`
**Default/production branch:** `main` — pushing to it deploys to production.

### ⚠️ Four local repos, easy to confuse
| Path | Status |
|---|---|
| **`~/launchboxpk-astro`** | ✅ **THE LIVE ONE.** Astro rewrite. This is `main`. Work here. |
| `~/launchboxpk` | ❌ Original static HTML site (`build.py`, `main.yml`). Stale/abandoned. |
| `~/Platform/launchboxpk` | ❌ symlink → the stale one. Ignore. |
| `~/launchboxredesign` | ❌ empty Vite scaffold. Abandoned. |

Both `~/launchboxpk-astro` and `~/launchboxpk` point at the **same GitHub remote and same S3 bucket** — that's the trap. Only the Astro one is current.

### Branches
- `main` — production
- `feat/cv-optimizer` — merged (7843437)
- `astro-migration`, `astro-clean` — historical migration work
- `origin/feat/curated-internships` — unmerged, remote-only

### ⚠️ Local `main` once diverged
There was an unpushed Aug-2025 commit (`59b7e37 "Fix format"`, author `prototypa`) — just AstroWind template scaffolding, redundant with `origin/main` — which caused modify/delete conflicts. Resolved with `git reset --hard origin/main`.
**`origin/main` is authoritative. Trust it over any local main.**

### Frequent bot commits
The jobs scraper auto-commits `chore(jobs): refresh from scrapers` to `main` every 6h as `launchbox-bot`. **Always `git pull --rebase origin main` before pushing** — otherwise your push is rejected.

---

## 3. Site build (Astro)

**Template:** AstroWind (`@onwidget/astrowind`) — Astro 5 + Tailwind. Node 20.

```bash
npm install
npm run dev      # local dev
npm run build    # → dist/
npm run check    # astro check + eslint + prettier
npm run fix      # autofix eslint + prettier
```

**Config:** `astro.config.ts` — `output: 'static'`, alias `~` → `./src`.
Integrations: tailwind, sitemap, mdx, astro-icon (tabler + flat-color-icons), **astro-compress** (CSS/HTML/JS), partytown (disabled — `hasExternalScripts = false`), and the custom `astrowind` vendor integration reading **`src/config.yaml`**.

### Pages
| Route | File |
|---|---|
| `/` | `src/pages/index.astro` |
| `/about`, `/services`, `/pricing`, `/faq`, `/contact`, `/book-visit`, `/our-community` | matching `.astro` |
| `/coworking-space-lahore`, `/coworking-dha-lahore` | SEO landing pages |
| `/jobs` | `src/pages/jobs.astro` — renders `src/data/jobs.json` |
| **`/cv-optimizer`** | `src/pages/cv-optimizer.astro` — the Claude CV tool |
| `/[...blog]/…` | blog index / category / post pages |
| `/privacy`, `/terms` | markdown |
| `/rss.xml`, `/404` | |

Blog posts live in `src/data/post/`. Site-wide settings (nav, SEO, analytics) come from `src/config.yaml`.

### Repo layout
```
src/{assets,components,content,data,layouts,pages,utils}
vendor/integration      # custom astrowind integration
scripts/fetch-jobs.mjs  # jobs scraper
infra/cv-optimizer/     # Lambda + Terraform for the CV tool
cloudfront-function.js  # CF URL-rewrite function (deployed by CI)
public/                 # static passthrough
```
Unused leftovers from the template: `Dockerfile`, `docker-compose.yml`, `nginx/`, `netlify.toml`, `vercel.json`. **We deploy to S3+CloudFront — these are not used.**

---

## 4. Hosting

### AWS account
**Elbi Digital — `304359596288`**, region **us-east-1**.
⚠️ Old notes said `504359596288`. That's **wrong** — it's a **3**.

### DNS — Namecheap (Route53 has ZERO hosted zones)
- Registered at Namecheap, expires 2026-11-02, BasicDNS (`dns1/dns2.registrar-servers.com`)
- `www.launchboxpk.com` → CNAME → `d2yt06dff05zcy.cloudfront.net` ✅ **the real site**
- apex `launchboxpk.com` → `192.64.119.142` → ⚠️ **Namecheap parking/masked redirect. Does not properly reach CloudFront.** Open task: set a real apex→www redirect at Namecheap.

### S3
Bucket **`launchboxpk.com`**, us-east-1, **static-website hosting** (origin is the *website* endpoint `launchboxpk.com.s3-website-us-east-1.amazonaws.com`, not the REST endpoint).

### CloudFront — `E4FC18X0B6JRG`
- **Aliases:** `launchboxpk.com`, `www.launchboxpk.com`
- **Default root:** `index.html`
- **Origins:**
  | Id | Domain |
  |---|---|
  | `launchboxpk.com.s3-website-us-east-1.amazonaws.com-mn4qnxnbtwl` | S3 website endpoint |
  | `cv-optimizer-apigw` | `l7690f2dzg.execute-api.us-east-1.amazonaws.com` |
- **Default behavior** → S3 origin, with CF Function `launchboxpk-url-rewrite` attached
- **`/api/*` behavior** → `cv-optimizer-apigw`, **no function attached** (deliberate — the rewrite must not mangle API paths)

### CloudFront Function — `launchboxpk-url-rewrite`
Source: `cloudfront-function.js` (repo root). Makes Astro's `dist/` clean URLs work:
1. strips trailing slash → 301
2. `/` → `/index.html`
3. anything with a file extension → passthrough
4. everything else → `+ /index.html`

**CI redeploys and republishes this function on every push** — so edit `cloudfront-function.js` in the repo, never in the console (console edits get overwritten).

### ⚠️ WAF — `CreatedByCloudFront-6fd9d6b7`
ARN: `arn:aws:wafv2:us-east-1:304359596288:global/webacl/CreatedByCloudFront-6fd9d6b7/fa9e8e06-431f-44fe-9ea9-e97354eed76c`

Auto-created with the distribution. Runs `AWSManagedRulesCommonRuleSet`, whose **`SizeRestrictions_BODY` rule 403s any request body >8KB**. Applies to the **whole distribution**, including `/api/*`.
👉 This is what breaks CV file uploads through CloudFront. Nothing logs "WAF" — you only find it by bisecting body size.

---

## 5. Deploy — GitHub Actions

Two workflows in `.github/workflows/`.

### `actions.yaml` — "Deploy to S3"
**Triggers:** push to `main` · `workflow_run` after "Fetch jobs" completes · manual `workflow_dispatch`.

> The `workflow_run` chain exists because pushes made with the default `GITHUB_TOKEN` don't fire `push` triggers (GitHub's anti-loop rule). It only deploys if the Fetch jobs run actually succeeded.

**Steps:** checkout → Node 20 (npm cache) → `npm ci` → `npm run build` → configure AWS creds → then:
1. `aws s3 sync dist/_astro s3://launchboxpk.com/_astro` — `max-age=31536000, immutable` (hashed assets)
2. `aws s3 sync dist/ s3://launchboxpk.com --delete --exclude "_astro/*"` — `max-age=300, must-revalidate`
3. Update **and publish** the `launchboxpk-url-rewrite` CF function from `cloudfront-function.js`
4. `aws cloudfront create-invalidation --distribution-id E4FC18X0B6JRG --paths "/*"`

Runtime ~60s.

### `fetch-jobs.yaml` — "Fetch jobs"
Cron `0 */6 * * *` (every 6h) + manual. Runs `node scripts/fetch-jobs.mjs` with `APIFY_TOKEN`, commits `src/data/jobs.json` as `launchbox-bot` if changed, pushes to `main` → chains a deploy.

### GitHub secrets
| Secret | Used by |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `github-deploy` IAM user — deploy workflow |
| `APIFY_TOKEN` | jobs scraper |

### Deploying by hand
```bash
cd ~/launchboxpk-astro
git pull --rebase origin main     # bot commits often
npm run build
git add -A && git commit -m "..." && git push origin main
gh run watch
```
⚠️ **Caching lies to you.** After a deploy, verify with `curl` rather than trusting the browser — a cached page once cost hours of debugging an already-fixed bug:
```bash
curl -s https://www.launchboxpk.com/cv-optimizer/ | grep -o "https://[a-z0-9.-]*\(execute-api\|lambda-url\)[^\"']*"
```

---

## 6. Jobs pipeline (`/jobs`)

`scripts/fetch-jobs.mjs` pulls from **Apify** actors, normalizes to a common `Job` shape, dedupes, writes `src/data/jobs.json`.

**Source registry** — currently one source; adding another = append to `SOURCES` with an actor id + a `transform()`:
```js
{ id: 'rozee.pk', label: 'Rozee.pk', actorId: 'RNckuFmfGdoi7fXbx',
  searches: [ {keyword:'developer',results_wanted:50}, {keyword:'engineer',...},
              'designer', 'product manager', 'data', 'devops' ],
  transform: item => ({ id:`rozee:${item.job_id}`, title, company, location,
                        workMode: inferWorkMode(...), type: classifyType(...), url, ... }) }
```

### 🔴 The jobs feed is currently EMPTY and silently failing
`src/data/jobs.json` right now:
```json
{ "fetchedAt": "2026-07-15T08:24:15.123Z",
  "sources": [{ "id": "rozee.pk", "count": 0, ... }],
  "jobs": [] }
```
The workflow reports **success** every 6h while scraping **zero jobs**. Counts across history:

| Date | jobs |
|---|---|
| 2026-07-05 → 07-11 | **0** |
| 2026-07-11 → 07-12 | 147, 164, 193, 145 ✅ *(briefly worked)* |
| 2026-07-12 → 07-15 | **0** |

So it **flaps** — mostly broken, occasionally works. Likely the Apify actor (`RNckuFmfGdoi7fXbx`) failing/rate-limiting/returning nothing, or token/quota. **The `/jobs` page is empty in production.**

👉 The scraper exits 0 on an empty result, so CI is green and nobody notices. **It should fail loudly (or alert) when a source returns 0.**

---

## 7. CV Optimizer (`/cv-optimizer`)

Claude-powered CV builder. Wizard + optional CV upload → Claude → structured resume JSON → rendered + PDF export.
**Hard rule:** the Anthropic key stays server-side. Never in the browser, never committed.

```
browser → [endpoint] → Lambda cv-optimizer-generate → Anthropic → resume JSON
```

| Resource | Value |
|---|---|
| Lambda | `cv-optimizer-generate` — nodejs20.x, **1024MB, 120s**, no npm deps (global `fetch`) |
| Role | `cv-optimizer-generate-role` |
| API Gateway (HTTP v2) | `l7690f2dzg` — `POST /api/generate` |
| Lambda Function URL | AuthType `NONE` |
| Model | `claude-sonnet-4-20250514`, max_tokens 4000 |

**Code:** `infra/cv-optimizer/lambda/index.js` (handler) + `_prompt.js` (`buildContent`, `parseResumeJSON`). Terraform in `infra/cv-optimizer/terraform/`.

### 🔴 Status: NOT working in production
The backend is **proven good** — a direct Lambda invoke with a real 152KB PDF returns 200 and a fully parsed CV (~40s). The browser just can't reach it. Three walls:
1. **CloudFront WAF** 403s bodies >8KB → kills uploads through CloudFront.
2. **API Gateway hard 30s cap** < the ~40s Claude needs to read a PDF → the live path always times out.
3. **Lambda Function URL 403s** on public access despite a textbook-correct config → the fix is blocked. Propagation and org-SCP ruled out; needs AWS console inspection.

**Key heuristic:** the Lambda only ever returns 200/204/405/500/502 — **any 403 is infrastructure, never app code.**

Full detail + repro commands + ruled-out hypotheses: **[`infra/cv-optimizer/HANDOVER.md`](infra/cv-optimizer/HANDOVER.md)**.

---

## 8. Secrets & IAM

### Anthropic key
- Lives in **`infra/cv-optimizer/terraform/secret.auto.tfvars`** (`anthropic_api_key = "sk-ant-..."`) or `TF_VAR_anthropic_api_key`.
- Ignored via **`infra/cv-optimizer/.gitignore`** (not the root one): `terraform/*.tfvars`, `terraform/*.tfstate*`, `terraform/build/`, `scripts/*.backup.json`.
- ✅ **Verified:** the real key has **never** been committed — every `sk-ant-` in git history is a `sk-ant-...` placeholder in docs.
- ⚠️ Terraform **local state also contains the key in plaintext** and is gitignored. Don't commit it; don't copy it around carelessly.
- Needs credits — `502 "credit balance too low"` is the symptom. Top up at console.anthropic.com → Plans & Billing.

### `github-deploy` IAM user
Its access keys are the GitHub Actions secrets. Baseline: **S3FullAccess + CloudFrontFullAccess**.

Temporarily granted for `terraform apply`, **still attached** — 🔧 remove to restore least-privilege:
`AWSLambda_FullAccess`, `AmazonAPIGatewayAdministrator`, `IAMFullAccess`, `CloudWatchLogsFullAccess`

---

## 9. Fresh-Mac setup

```bash
git clone https://github.com/ElbiDigital229/launchboxpk.git ~/launchboxpk-astro
cd ~/launchboxpk-astro && npm install && npm run dev

aws configure                    # account 304359596288
aws sts get-caller-identity      # must print 304359596288
```
`~/.aws/config`:
```ini
[default]
region = us-east-1
output = json
```
⚠️ **`aws configure` key-order gotcha:** Access Key ID = **20 chars, starts `AKIA`**; Secret = **40 chars**. Pasting them swapped gives `InvalidClientTokenId` — this actually happened and cost time.

For backend work: Terraform v1.15.5. `brew install` may fail on outdated Command Line Tools — the fallback used here was a precompiled binary at `~/.local/bin/terraform`. Then drop the Anthropic key into `infra/cv-optimizer/terraform/secret.auto.tfvars`.

---

## 10. Open tasks

- [ ] 🔴 **CV Optimizer is down** — unblock the Lambda Function URL 403 (see HANDOVER.md §5).
- [ ] 🔴 **Jobs feed is empty** — Apify `rozee.pk` actor returns 0; make the scraper fail loudly instead of committing an empty list.
- [ ] Reconcile Terraform drift — Lambda `timeout=120`/`memory=1024` + the Function URL were set **via CLI, not Terraform**; a `terraform apply` will revert them.
- [ ] Remove the 4 temporary IAM policies from `github-deploy`.
- [ ] Fix apex → www redirect at Namecheap.
- [ ] Consider deleting the stale `~/launchboxpk` repo + `~/Platform/launchboxpk` symlink to stop the confusion.

---

## 11. Gotchas worth knowing

1. **`~/launchboxpk-astro` is the live repo** — the other three are traps pointing at the same remote/bucket.
2. **Pull --rebase before pushing** — the bot commits to `main` every 6h.
3. **Verify deploys with `curl`, not the browser.** Caching will show you a stale page.
4. **CloudFront WAF silently 403s bodies >8KB.** Invisible in logs.
5. **API Gateway's 30s cap is absolute** — Lambda timeout is irrelevant behind it.
6. **More Lambda memory doesn't speed up Claude** — inference is server-side (256MB→1024MB just moved a 29s timeout to a 31.7s one).
7. **CI overwrites the CloudFront function** — edit `cloudfront-function.js` in the repo, not the console.
8. **The account is 304359596288** (a 3, not a 5).
9. **`/api/*` must not have the URL-rewrite function attached** — it would mangle API paths.
10. **Green CI ≠ working feature.** The jobs scraper has been "succeeding" while scraping nothing for most of July.
