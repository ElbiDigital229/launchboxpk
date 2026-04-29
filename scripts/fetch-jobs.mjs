#!/usr/bin/env node
// Fetch jobs from Apify actors, normalize to a common schema, write to src/data/jobs.json.
// Run from repo root:  APIFY_TOKEN=xxxxx node scripts/fetch-jobs.mjs
//
// Adding a new source = append an entry to SOURCES with the right Apify actor ID
// and a transform() that maps that actor's output to the normalized Job shape.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'data', 'jobs.json');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN env var.');
  process.exit(1);
}

// ---- Source registry --------------------------------------------------------

const SOURCES = [
  {
    id: 'rozee.pk',
    label: 'Rozee.pk',
    actorId: 'RNckuFmfGdoi7fXbx',
    // RozeePk Jobs Scraper expects { keyword, results_wanted }.
    // Run once per keyword to cover the tech surface; results are deduped after.
    searches: [
      { keyword: 'developer', results_wanted: 50 },
      { keyword: 'engineer', results_wanted: 50 },
      { keyword: 'designer', results_wanted: 30 },
      { keyword: 'product manager', results_wanted: 20 },
      { keyword: 'data', results_wanted: 30 },
      { keyword: 'devops', results_wanted: 20 },
    ],
    transform: (item) => ({
      id: `rozee:${item.job_id}`,
      source: 'rozee.pk',
      sourceLabel: 'Rozee.pk',
      sourceId: String(item.job_id ?? ''),
      title: (item.title || '').trim(),
      company: (item.company || '').trim(),
      location: (item.location || '').trim(),
      workMode: inferWorkMode([item.title, item.location].join(' ')),
      type: classifyType([item.contract_type, item.title].join(' ')),
      experience: item.experience || null,
      contractType: item.contract_type || null,
      postedDate: item.date_posted || null,
      url: item.url,
    }),
  },
  // To add a source later:
  // {
  //   id: 'mustakbil.com',
  //   label: 'Mustakbil',
  //   actorId: '...',
  //   searches: [{ keyword: '...' }],
  //   transform: (item) => ({ ... }),
  // },
];

// ---- Helpers ---------------------------------------------------------------

function inferWorkMode(text) {
  const s = String(text || '').toLowerCase();
  if (/\bremote\b/.test(s) || /work\s*from\s*home/.test(s)) return 'remote';
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/on[-\s]?site|in[-\s]?office/.test(s)) return 'on-site';
  return 'unknown';
}

function classifyType(text) {
  const s = String(text || '').toLowerCase();
  if (/intern/.test(s)) return 'Internship';
  if (/contract|freelance/.test(s)) return 'Contract';
  if (/part[-\s]?time/.test(s)) return 'Part-time';
  return 'Full-time';
}

// Apify run-sync-get-dataset-items: runs the actor synchronously and returns dataset items.
// https://docs.apify.com/api/v2#/reference/actors/run-actor-synchronously-and-get-dataset-items
async function runActor(actorId, input) {
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input || {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify ${actorId} failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

function dedupe(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    if (!j || !j.id || seen.has(j.id)) continue;
    seen.add(j.id);
    out.push(j);
  }
  return out;
}

// ---- Main ------------------------------------------------------------------

async function main() {
  const fetchedAt = new Date().toISOString();
  const sourceResults = [];
  const allJobs = [];

  for (const src of SOURCES) {
    console.log(`▶  ${src.id} (actor ${src.actorId})`);
    const queries = Array.isArray(src.searches) && src.searches.length
      ? src.searches
      : [src.input || {}];
    let rawTotal = 0;
    const sourceJobs = [];
    const errors = [];

    for (const q of queries) {
      const label = q.keyword ? `"${q.keyword}"` : '(default)';
      try {
        const items = await runActor(src.actorId, q);
        rawTotal += items.length;
        const mapped = items
          .map((item) => {
            try {
              return src.transform(item);
            } catch (e) {
              console.warn(`  ⚠ skipped item due to transform error: ${e.message}`);
              return null;
            }
          })
          .filter(Boolean)
          .filter((j) => j.title && j.url);
        console.log(`   • ${label}: ${mapped.length} jobs (raw: ${items.length})`);
        sourceJobs.push(...mapped);
      } catch (err) {
        console.error(`   ✗ ${label} failed: ${err.message}`);
        errors.push(`${label}: ${err.message}`);
      }
    }

    const sourceDeduped = dedupe(sourceJobs);
    console.log(`   ✓ ${src.id} total: ${sourceDeduped.length} unique jobs (raw: ${rawTotal})`);
    sourceResults.push({
      id: src.id,
      label: src.label,
      count: sourceDeduped.length,
      ...(errors.length ? { error: errors.join('; ') } : {}),
      fetchedAt,
    });
    allJobs.push(...sourceDeduped);
  }

  const jobs = dedupe(allJobs);

  const payload = {
    fetchedAt,
    sources: sourceResults,
    jobs,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`\n✔ Wrote ${jobs.length} jobs to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
