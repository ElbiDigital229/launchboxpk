# launchboxpk.com — How Everything Is Configured

**Last verified:** 2026-07-15 — every fact below was checked against the live repo and AWS, not written from memory.

This repo is the **Launchbox website rewrite**: the coworking-space site for Launchbox (DHA Phase 5, Lahore), migrated from a hand-written static HTML site to Astro + Tailwind, plus the marketing, SEO, analytics, and free-tool work built on top of it.

The CV Optimizer is **one feature** of this site — see §8. It gets a disproportionate amount of debugging ink in [`infra/cv-optimizer/HANDOVER.md`](infra/cv-optimizer/HANDOVER.md) because it's currently broken, not because it's the point of the repo.

---

## 1. The business & the site

**Launchbox** — coworking space, First Floor, 38-A CCA, Sector C, DHA Phase 5, Lahore 54000.
Phone `+92 307 0555515` · `contact@launchboxpk.com` · Instagram/Facebook `@launchboxpk` · WhatsApp `wa.me/923070555515`

Audience: freelancers, remote teams, small startups in Lahore. The site's job is to get people to **book a visit** or **message on WhatsApp** — most CTAs funnel to one of those.

The free tools (Jobs board, CV Optimizer) exist as **top-of-funnel lead magnets** — draw in Pakistani freelancers/jobseekers, then convert to coworking members.

---

## 2. The rewrite — what happened, in order

338 commits, but **307 are automated `chore(jobs)` bot commits**. The real history is ~31 commits:

| Commit | What |
|---|---|
| `1335c07` | **Migrate launchboxpk.com to Astro + Tailwind (AstroWind base)** ← the rewrite itself |
| `11ef65c` | ci: restore S3 deploy workflow for Astro build |
| `814fd22` | fix(cf): rewrite clean URLs to `<path>/index.html` for Astro dist |
| `a215b6e` `818a324` `9979a1e` `73218e6` | **Analytics**: re-enable GA4 from the pre-migration site, track conversion clicks, disable partytown so gtag actually runs, expose `window.gtag` fallback |
| `26e6956` | pricing: sharpen WhatsApp funnel — pre-filled CTAs, social proof, mid-page banner |
| `edcfa89` `2b4fa72` `17cf0db` | **SEO**: fix `astrowind.vercel.app` leak, LocalBusiness/FAQ schema, `llms.txt`, cache headers, Article+Breadcrumb schema, Organization+WebSite, `llms-full.txt` |
| `c39bd80` | analytics: Facebook Pixel + domain verification |
| `3addb76` | blog: add 10 new posts with images |
| `6371103` `b672a38` `8809996` `f81cf5d` `a6785d1` | **Jobs board**: Apify-powered, keyword-input fix, deploy chaining, sidebar filters, multi-select/city/URL-state filters |
| `c59c40a` `c197d14` `61eacb7` | **Brand**: primary blue → green, tuned to Spotify-ish green `#1AA34A` |
| `de438ca` `d8be97a` `805a888` `2f6b50d` | **CV Optimizer**: page + nav entry, Lambda backend + Terraform + CloudFront routing, Tools dropdown |
| `344b9e6` `461610f` | CV Optimizer 403 firefighting (unresolved — see §8) |
| `de8d14c` `ebccf0e` | docs |

Themes: migrate → make deploys/URLs work → recover analytics → SEO hard → content → build free tools → brand polish.

---

## 3. Git

**Remote:** `https://github.com/ElbiDigital229/launchboxpk.git` · **production branch:** `main` (push = deploy).

### ⚠️ Four local repos, easy to confuse
| Path | Status |
|---|---|
| **`~/launchboxpk-astro`** | ✅ **THE LIVE ONE.** The Astro rewrite. Work here. |
| `~/launchboxpk` | ❌ The **pre-rewrite** static HTML site (`build.py`, `main.yml`). Superseded. |
| `~/Platform/launchboxpk` | ❌ symlink → the stale one. |
| `~/launchboxredesign` | ❌ empty Vite scaffold. Abandoned. |

They point at the **same GitHub remote and same S3 bucket** — that's the trap. Only the Astro one is current.

**Branches:** `main` (prod) · `feat/cv-optimizer` (merged) · `astro-migration`, `astro-clean` (migration history) · `origin/feat/curated-internships` (unmerged, remote-only).

### ⚠️ Two git hazards
1. **Local `main` once diverged** — an unpushed Aug-2025 commit (`59b7e37 "Fix format"`, author `prototypa`, just AstroWind scaffolding) caused modify/delete conflicts. Fixed with `git reset --hard origin/main`. **`origin/main` is authoritative.**
2. **The bot pushes to `main` every 6h** (`chore(jobs): refresh from scrapers` as `launchbox-bot`). **Always `git pull --rebase origin main` before pushing.**

---

## 4. The site itself

**Template:** AstroWind (`@onwidget/astrowind`) — Astro 5 + Tailwind. Node 20. `output: 'static'` — no server runtime.

```bash
npm install && npm run dev     # local
npm run build                  # → dist/
npm run check                  # astro check + eslint + prettier
npm run fix                    # autofix
```

### `src/config.yaml` — site-wide settings (read by the `vendor/integration` astrowind integration)
- **Site:** Launchbox · `https://www.launchboxpk.com` · `trailingSlash: false`
- **SEO:** title template `%s | Launchbox`, default "Launchbox — Coworking space in DHA Phase 5, Lahore", OG image `launchbox-hero.png`, `summary_large_image`, Google site verification
- **Blog:** enabled, 6/page, permalink `/blog/%slug%`, categories on, **tags off**, related posts (4)
- **Analytics:** GA4 `G-G1KP223X6B`, `partytown: false` ← deliberate; partytown broke gtag
- **UI:** `theme: 'dark'` (dark by default)

### `src/navigation.ts` — header + footer
Header: **Spaces** ▾ (Coworking Space Lahore / Coworking DHA Lahore / Services) · **Pricing** · **Tools** ▾ (Jobs / CV Optimizer) · **Blogs** · **FAQ** · **Community** · **About** · **Contact** · CTA **Book a visit**.
Footer: Spaces · Resources · **Free Resources** · Contact (phone/email/address/Maps) · socials.

⚠️ **Three footer "Free Resources" links are dead placeholders (`href: '#'`)**: **Job Finder**, **Upwork Bidder**, **Company Registration**. Only CV Optimizer is real — and it's currently broken (§8).

### Pages
| Route | Notes |
|---|---|
| `/` | homepage |
| `/pricing` `/services` `/about` `/faq` `/contact` `/book-visit` `/our-community` | core marketing |
| `/coworking-space-lahore` `/coworking-dha-lahore` | SEO landing pages |
| `/jobs` | renders `src/data/jobs.json` (§7) |
| `/cv-optimizer` | the Claude CV tool (§8) |
| `/[...blog]/…` | blog index / category / posts |
| `/privacy` `/terms` `/rss.xml` `/404` | |

### Components
- `widgets/` — page sections: Hero/Hero2/HeroText, Features×3, Steps×2, Pricing, Testimonials, Stats, FAQs, Contact, CallToAction, Content, Header, Footer, BlogLatestPosts, BlogHighlightedPosts
- `ui/` — primitives: Button, Form, Headline, ItemGrid, Timeline, Background, WidgetWrapper, DListItem
- `common/` — Metadata/CommonMeta, **Analytics + AnalyticsTracker + FacebookPixel**, SiteSchema/BlogPostSchema, ToggleTheme/ToggleMenu, Image, SocialShare, SiteVerification

### Content
**25 blog posts** in `src/data/post/` — coworking Lahore, freelancing in Pakistan, remote work, Upwork, gig economy, productivity. All SEO plays for the Lahore coworking/freelancer market. Collections configured in `src/content/config.ts`.

### Unused template leftovers
`Dockerfile`, `docker-compose.yml`, `nginx/`, `netlify.toml`, `vercel.json` — **we deploy to S3+CloudFront.** These are AstroWind baggage.

---

## 5. Hosting

**AWS account: Elbi Digital `304359596288`**, us-east-1.
⚠️ Old notes said `504359596288` — **wrong**, it's a **3**.

### DNS — Namecheap (Route53 has ZERO hosted zones)
- Expires 2026-11-02, BasicDNS (`dns1/dns2.registrar-servers.com`)
- `www.launchboxpk.com` → CNAME → `d2yt06dff05zcy.cloudfront.net` ✅ **the real site**
- apex `launchboxpk.com` → `192.64.119.142` → ⚠️ **Namecheap parking/masked redirect — does not properly reach CloudFront.** Open task: real apex→www redirect.

### S3
Bucket **`launchboxpk.com`**, us-east-1, **static-website hosting** — CloudFront's origin is the *website* endpoint (`launchboxpk.com.s3-website-us-east-1.amazonaws.com`), not the REST endpoint.

### CloudFront `E4FC18X0B6JRG`
- Aliases: `launchboxpk.com`, `www.launchboxpk.com` · default root `index.html`
- Origins: S3 website endpoint · `cv-optimizer-apigw` → `l7690f2dzg.execute-api.us-east-1.amazonaws.com`
- Default behavior → S3, with CF Function `launchboxpk-url-rewrite`
- `/api/*` behavior → `cv-optimizer-apigw`, **no function attached** (deliberate — the rewrite would mangle API paths)

### CF Function `launchboxpk-url-rewrite`
Source: `cloudfront-function.js` (repo root). Makes Astro clean URLs work: trailing slash → 301 · `/` → `/index.html` · has extension → passthrough · else → `+ /index.html`.
⚠️ **CI republishes this on every push** — edit the repo file, never the console.

### ⚠️ WAF `CreatedByCloudFront-6fd9d6b7`
`arn:aws:wafv2:us-east-1:304359596288:global/webacl/CreatedByCloudFront-6fd9d6b7/fa9e8e06-431f-44fe-9ea9-e97354eed76c`
Auto-created. Runs `AWSManagedRulesCommonRuleSet` → **`SizeRestrictions_BODY` 403s any body >8KB**, across the **whole distribution** including `/api/*`. Nothing logs "WAF" — you only find it by bisecting body size. This is what breaks CV uploads.

---

## 6. Deploy — GitHub Actions

### `actions.yaml` — "Deploy to S3"
Triggers: push to `main` · `workflow_run` after "Fetch jobs" · manual.
> The `workflow_run` chain exists because pushes made with the default `GITHUB_TOKEN` don't fire `push` triggers (GitHub's anti-loop rule). Only deploys if Fetch jobs succeeded.

checkout → Node 20 → `npm ci` → `npm run build` → AWS creds → then:
1. `s3 sync dist/_astro → s3://launchboxpk.com/_astro` · `max-age=31536000, immutable`
2. `s3 sync dist/ → s3://launchboxpk.com --delete --exclude "_astro/*"` · `max-age=300, must-revalidate`
3. update + publish the CF function from `cloudfront-function.js`
4. invalidate `E4FC18X0B6JRG` `/*`

~60s.

### `fetch-jobs.yaml` — "Fetch jobs"
Cron `0 */6 * * *` + manual → `node scripts/fetch-jobs.mjs` with `APIFY_TOKEN` → commits `src/data/jobs.json` as `launchbox-bot` → chains a deploy.

### Secrets
| Secret | Used by |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `github-deploy` IAM user (deploy) |
| `APIFY_TOKEN` | jobs scraper |

### Deploying by hand
```bash
cd ~/launchboxpk-astro
git pull --rebase origin main     # bot commits often
npm run build
git add -A && git commit -m "..." && git push origin main && gh run watch
```
⚠️ **Caching lies.** Verify with `curl`, not the browser — a cached page once cost hours debugging an already-fixed bug.

---

## 7. Jobs board (`/jobs`)

`scripts/fetch-jobs.mjs` → Apify actors → normalize → dedupe → `src/data/jobs.json`.
Adding a source = append to `SOURCES` with an actor id + `transform()`. Currently one: **Rozee.pk**, actor `RNckuFmfGdoi7fXbx`, fanned out across keywords (developer, engineer, designer, product manager, data, devops).

### 🔴 The jobs board is EMPTY — and it's a regression
`src/data/jobs.json` right now: `"jobs": []`, `count: 0`. The workflow reports **success** every 6h while scraping **nothing**.

| Date | jobs |
|---|---|
| 2026-07-05 → 07-11 | **0** |
| 2026-07-11 → 07-12 | 147, 164, 193, 145 ✅ |
| 2026-07-12 → 07-15 | **0** |

**This exact failure was already fixed once** — `b672a38 fix(jobs): pass keyword input to Rozee.pk actor (was returning 0 results)` (Apr 2026): the actor needs `{keyword, results_wanted}`; an empty input returned 0 items. The `searches[]` schema is still in the code, so either the actor changed its input contract again, or it's failing/rate-limiting/quota-ing.

👉 **Root problem: the scraper exits 0 on an empty result**, so CI is green and nobody notices. It should fail loudly when a source returns 0.

---

## 8. CV Optimizer (`/cv-optimizer`) — one feature, currently down

Claude-powered CV builder: wizard + optional CV upload → Claude → structured resume JSON → rendered + PDF export. **Hard rule:** the Anthropic key stays server-side, never in the browser, never committed.

| Resource | Value |
|---|---|
| Lambda | `cv-optimizer-generate` — nodejs20.x, 1024MB, 120s, no npm deps |
| API Gateway | `l7690f2dzg` — `POST /api/generate` |
| Function URL | AuthType `NONE` |
| Model | `claude-sonnet-4-20250514`, max_tokens 4000 |

Code: `infra/cv-optimizer/lambda/{index.js,_prompt.js}` · Terraform: `infra/cv-optimizer/terraform/`

### 🔴 Status: not working in production
The backend is **proven good** — a direct Lambda invoke with a real 152KB PDF returns 200 and a fully parsed CV (~40s). The browser can't reach it. Three walls:
1. **CloudFront WAF** 403s bodies >8KB → kills uploads through CloudFront.
2. **API Gateway hard 30s cap** < the ~40s Claude needs to read a PDF → the live path always times out.
3. **Lambda Function URL 403s** on public access despite textbook-correct config → the fix is blocked. Propagation and org-SCP ruled out; needs console inspection.

**Key heuristic:** the Lambda only ever returns 200/204/405/500/502 — **any 403 is infrastructure, never app code.**

Full detail, repro commands, ruled-out hypotheses: **[`infra/cv-optimizer/HANDOVER.md`](infra/cv-optimizer/HANDOVER.md)**.

---

## 9. Secrets & IAM

### Anthropic key
- `infra/cv-optimizer/terraform/secret.auto.tfvars` (`anthropic_api_key = "sk-ant-..."`) or `TF_VAR_anthropic_api_key`
- Ignored via **`infra/cv-optimizer/.gitignore`** (not the root one): `terraform/*.tfvars`, `terraform/*.tfstate*`, `terraform/build/`, `scripts/*.backup.json`
- ✅ **Verified: the real key was never committed** — every `sk-ant-` in git history is a `sk-ant-...` placeholder in docs
- ⚠️ Terraform **local state holds the key in plaintext** (gitignored)
- Needs credits — `502 "credit balance too low"` is the symptom

### `github-deploy` IAM user
Keys = the GitHub Actions secrets. Baseline **S3FullAccess + CloudFrontFullAccess**.
Temporarily granted for `terraform apply` and 🔧 **still attached**: `AWSLambda_FullAccess`, `AmazonAPIGatewayAdministrator`, `IAMFullAccess`, `CloudWatchLogsFullAccess`.

---

## 10. Fresh-Mac setup

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
⚠️ **`aws configure` key-order gotcha:** Access Key ID = **20 chars, `AKIA…`**; Secret = **40 chars**. Swapping them → `InvalidClientTokenId`. This actually happened.

Backend work: Terraform v1.15.5 (`brew install` may fail on outdated Command Line Tools — fallback was a precompiled binary at `~/.local/bin/terraform`), then the Anthropic key into `secret.auto.tfvars`.

---

## 11. Open tasks

- [ ] 🔴 **Jobs board empty** — Apify actor returning 0 (a regression of `b672a38`); make the scraper fail loudly instead of committing an empty list
- [ ] 🔴 **CV Optimizer down** — unblock the Function URL 403 (HANDOVER.md §5)
- [ ] Three dead footer links (`Job Finder`, `Upwork Bidder`, `Company Registration` → `#`) — build or remove
- [ ] Terraform drift — Lambda `timeout=120`/`memory=1024` + Function URL were set **via CLI, not Terraform**; `terraform apply` will revert them
- [ ] Remove the 4 temporary IAM policies from `github-deploy`
- [ ] Fix apex → www redirect at Namecheap
- [ ] Delete the stale `~/launchboxpk` + `~/Platform/launchboxpk` symlink to stop the confusion

---

## 12. Gotchas

1. **`~/launchboxpk-astro` is live** — the other three repos are traps on the same remote/bucket.
2. **`git pull --rebase` before pushing** — the bot commits every 6h.
3. **Verify deploys with `curl`, not the browser.** Caching will show you a stale page.
4. **CloudFront WAF silently 403s bodies >8KB.** Invisible in logs.
5. **API Gateway's 30s cap is absolute** — Lambda timeout is irrelevant behind it.
6. **More Lambda memory doesn't speed up Claude** — inference is server-side (256MB→1024MB moved a 29s timeout to a 31.7s one).
7. **CI overwrites the CloudFront function** — edit `cloudfront-function.js`, not the console.
8. **`partytown` is off on purpose** — it broke gtag; don't "fix" it.
9. **`/api/*` must not have the URL-rewrite function attached.**
10. **The account is 304359596288** (a 3, not a 5).
11. **Green CI ≠ working feature.** The jobs scraper has "succeeded" while scraping nothing for most of July.
