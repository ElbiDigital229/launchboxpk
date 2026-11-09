// Builds the feed for www.launchboxpk.com/job-portal: remote jobs from the free Arbeitnow API
// (German job board), written to one JSON file the page loads. Run hourly by
// .github/workflows/jobs-feed.yaml, so visitors never call Arbeitnow themselves.
import { writeFileSync } from 'node:fs';

const API = 'https://www.arbeitnow.com/api/job-board-api';
const MAX_PAGES = 10;
const REMOTE = /remote|home.?office/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = [];
for (let p = 1; p <= MAX_PAGES; p++) {
  const r = await fetch(`${API}?page=${p}`, { headers: { 'user-agent': 'launchboxpk.com jobs board' } });
  if (!r.ok) throw new Error(`Arbeitnow page ${p}: HTTP ${r.status}`);
  const d = await r.json();
  all.push(...(d.data || []));
  if (!d.data?.length || !d.links?.next) break;
  await sleep(1500);
}

const seen = new Set();
const jobs = all
  .filter((j) => j.remote || (j.tags || []).some((t) => REMOTE.test(t)) || REMOTE.test(j.location || ''))
  .filter((j) => !seen.has(j.slug) && seen.add(j.slug))
  .map(({ slug, title, company_name, location, remote, url, tags, job_types, created_at, description }) =>
    ({ slug, title, company_name, location, remote, url, tags, job_types, created_at, description }));

// Fail loudly: an empty feed must not replace a good one.
if (jobs.length < 20) throw new Error(`only ${jobs.length} remote jobs out of ${all.length}; not publishing`);

writeFileSync(process.argv[2] || 'jobs-data.json', JSON.stringify({ fetchedAt: Date.now(), scanned: all.length, jobs }));
console.log(`${jobs.length} remote jobs out of ${all.length} scanned`);
