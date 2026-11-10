// Builds the jobs board shown to signed-in candidates on www.launchboxpk.com/job-portal/account.
// Sources: Arbeitnow (German companies) + public company job boards (scripts/companies.mjs).
// Writes <out>/jobs.json (the list) and <out>/jobs-ad-<n>.json (the ad text, loaded when a job is opened).
// Run hourly by .github/workflows/jobs-feed.yaml.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { salary } from './salary.mjs';
import { COMPANIES } from './companies.mjs';

const OUT = process.argv[2] || 'jobs-out';
const UA = { 'user-agent': 'launchboxpk.com jobs board' };
const BUCKETS = 16, MAX_AD = 15000, PER_COMPANY = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unesc = (h) => (h || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const plain = (h) => unesc(unesc(h)).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const getJson = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); };

// ── Reading where a job can be done ──
const REGION = {
  de: /germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|dach\b/i,
  eu: /europe|\beu\b|emea|amsterdam|netherlands|paris|france|dublin|ireland|madrid|barcelona|spain|lisbon|portugal|warsaw|poland|stockholm|sweden|copenhagen|denmark|austria|vienna|switzerland|zurich|zürich|italy|milan|belgium|prague|czech|finland|norway|romania|bucharest|greece|athens/i,
  uk: /united kingdom|\buk\b|london|england|scotland|wales|manchester|edinburgh|britain|cambridge|bristol/i,
  us: /united states|\busa?\b|u\.s\.|new york|nyc|san francisco|bay area|seattle|austin|boston|chicago|denver|los angeles|atlanta|miami|washington|north america|americas|\bamer\b|silicon valley|palo alto|mountain view|\b(ca|ny|tx|wa|ma|co|il|fl|ga|or|az|ut|nc|va|pa|mi|mn)\b(?=,|\s|$)/i,
  ca: /canada|toronto|vancouver|montreal|montréal|ottawa|calgary|edmonton|waterloo/i,
  me: /uae|u\.a\.e|united arab emirates|dubai|abu dhabi|sharjah|saudi|ksa|riyadh|jeddah|dammam|king abdullah|qatar|doha|bahrain|manama|kuwait|oman|muscat|egypt|cairo|jordan|amman|middle east|mena\b|gcc/i,
  asia: /\bapac\b|asia|pakistan|india|bangalore|bengaluru|singapore|philippines|manila|indonesia|malaysia|vietnam|japan|tokyo|korea|australia|sydney|melbourne|new zealand/i,
  africa: /africa|nigeria|lagos|kenya|nairobi|ghana|morocco|tunisia|rwanda|uganda|south africa|cape town|johannesburg/i,
  latam: /latam|latin america|brazil|mexico|argentina|colombia|chile|peru|são paulo|sao paulo/i,
};
const WW_LOC = /anywhere|worldwide|global|remote\s*$|^remote$|fully remote$/i;
const WW_TXT = /\b(work from anywhere|remote worldwide|worldwide remote|anywhere in the world|global(ly)? remote|from any country|location[- ]independent|weltweit)\b/i;
const RES_TXT = /(must|need to|required to|should) (be )?(based|located|reside|live|residing)[^.]{0,40}(united states|\bus\b|usa|uk|united kingdom|canada|germany|europe|\beu\b)|(authori[sz]ed|eligible|legally able) to work in (the )?(united states|us|usa|uk|united kingdom|canada|germany|eu)|(based|located|resident|residence|living|wohnsitz|wohnhaft|work permit|arbeitserlaubnis)[^.]{0,60}(germany|deutschland|\beu\b|european union)/i;
const DE_W = /\b(und|wir|sie|die|der|das|mit|für|deine|ihre|bei|unser|erfahrung)\b/gi;
const EN_W = /\b(and|we|you|the|with|for|your|our|experience|team)\b/gi;
const HYB = /\bhybrid\b|\d\s*(tage|days)\s*(pro woche|per week|a week|\/woche)|\bvor ort\b|\boffice days\b|\bim büro\b/i;

function classify({ title, location, text, remote, defaultRegion }) {
  const loc = location || '';
  let regions = Object.keys(REGION).filter((k) => REGION[k].test(loc));
  if (regions.includes('de')) regions = [...new Set([...regions, 'eu'])];
  if (!regions.length && defaultRegion) regions = [defaultRegion];
  const s = text.slice(0, 1500);
  const lang = (s.match(DE_W) || []).length > (s.match(EN_W) || []).length ? 'de' : 'en';
  const resOnly = RES_TXT.test(text) || /\((germany|deutschland|dach|us|usa|uk|canada)\)/i.test(title);
  // Worldwide only when the location names no single country/region ("globally remote company" blurbs don't count)
  const openLoc = !regions.length || /anywhere|worldwide|\bglobal\b/i.test(loc);
  const worldwide = !resOnly && openLoc && (WW_TXT.test(text) || WW_LOC.test(loc.trim()) || /anywhere|worldwide|\bglobal\b/i.test(loc));
  const isRemote = remote || /remote|home.?office|anywhere/i.test(loc + ' ' + title);
  const localRole = /werkstudent|praktik|minijob|geringf|azubi|ausbildung|teilzeit/i.test(title);
  // "Open to Pakistan": worldwide, or remote with Asia/EMEA in the location, or remote with no country named and no residency rule
  const pkOpen = worldwide || (isRemote && !resOnly && !localRole && lang === 'en' &&
    (/pakistan|\bapac\b|\basia\b|emea|\bglobal\b|anywhere|worldwide/i.test(loc) || regions.length === 0));
  return {
    regions: worldwide ? [...new Set([...regions, 'ww'])] : regions,
    lang, resOnly, worldwide, pkOpen, remote: isRemote,
    hybrid: HYB.test(text) || /hybrid/i.test(loc) || !isRemote,
  };
}

const jobs = [], ads = Array.from({ length: BUCKETS }, () => ({}));
const idOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
function add(src, { key, title, company, location, url, created, html, remote, tags = [], pay, defaultRegion }) {
  const text = plain(html);
  const id = idOf(src + ':' + key);
  const c = classify({ title, location, text, remote, defaultRegion });
  jobs.push({ id, source: src, title, company, location: location || (c.remote ? 'Remote' : ''), created, tags: tags.slice(0, 6),
    salary: pay ?? salary(text), ...c });
  ads[parseInt(id.slice(0, 4), 16) % BUCKETS][id] = { html: unesc(html).slice(0, MAX_AD), url };
}

// ── Arbeitnow (German companies) ──
let arbeitnow = 0;
for (let p = 1; p <= 10; p++) {
  const d = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`);
  for (const j of d.data || []) {
    if (!(j.remote || (j.tags || []).some((t) => /remote|home.?office/i.test(t)) || /remote|home.?office/i.test(j.location || ''))) continue;
    add('arbeitnow', { key: j.slug, title: j.title, company: j.company_name, location: j.location, url: j.url, created: j.created_at,
      html: j.description, remote: j.remote, tags: j.tags, defaultRegion: 'de' });
    arbeitnow++;
  }
  if (!d.data?.length || !d.links?.next) break;
  await sleep(1500);
}

// ── Company job boards ──
const periodOf = (i) => (/hour/i.test(i) ? 'hour' : /month/i.test(i) ? 'month' : 'year');
const okCur = (c) => (['USD', 'EUR', 'GBP', 'CHF'].includes(c) ? c : null);
const failed = [];
for (const [board, ats, mode] of COMPANIES) {
  try {
    let list = [];
    if (ats === 'greenhouse') {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
      const name = d.jobs?.[0]?.company_name || board;
      list = (d.jobs || []).map((j) => ({ key: String(j.id), title: j.title, company: j.company_name || name, location: j.location?.name || '',
        url: j.absolute_url, created: Math.floor(Date.parse(j.first_published || j.updated_at) / 1000), html: j.content,
        remote: /remote/i.test(j.location?.name || '') }));
    } else if (ats === 'lever') {
      const d = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
      list = d.map((j) => ({ key: j.id, title: j.text, company: board[0].toUpperCase() + board.slice(1), location: j.categories?.location || '',
        url: j.hostedUrl, created: Math.floor(j.createdAt / 1000),
        html: (j.description || '') + (j.lists || []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join('') + (j.additional || ''),
        remote: j.workplaceType === 'remote', tags: [j.categories?.team].filter(Boolean),
        pay: j.salaryRange && okCur(j.salaryRange.currency) ? { min: j.salaryRange.min, max: j.salaryRange.max, currency: j.salaryRange.currency, period: periodOf(j.salaryRange.interval || '') } : undefined }));
    } else {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
      list = (d.jobs || []).filter((j) => j.isListed !== false).map((j) => {
        const comp = j.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
        return { key: j.id, title: j.title, company: d.apiVersion && j.organizationName || board[0].toUpperCase() + board.slice(1),
          location: [j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean).join(' · '),
          url: j.jobUrl, created: Math.floor(Date.parse(j.publishedAt) / 1000), html: j.descriptionHtml, remote: !!j.isRemote,
          tags: [j.department].filter(Boolean),
          pay: comp && okCur(comp.currencyCode) && comp.minValue ? { min: comp.minValue, max: comp.maxValue || comp.minValue, currency: comp.currencyCode, period: periodOf(comp.interval || '') } : undefined };
      });
    }
    if (mode === 'remote') list = list.filter((j) => j.remote);
    if (mode === 'gulf') list = list.filter((j) => REGION.me.test(j.location));
    list.sort((a, b) => b.created - a.created).slice(0, PER_COMPANY).forEach((j) => add(ats, { ...j, defaultRegion: mode === 'remote' ? undefined : 'me' }));
  } catch (e) {
    failed.push(`${board}: ${e.message}`);
  }
  await sleep(300);
}

// Fail loudly: an empty or broken feed must not replace a good one.
if (arbeitnow < 20 || jobs.length < 200) throw new Error(`only ${jobs.length} jobs (${arbeitnow} Arbeitnow); not publishing`);

jobs.sort((a, b) => b.created - a.created);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/jobs.json`, JSON.stringify({ fetchedAt: Date.now(), buckets: BUCKETS, jobs }));
ads.forEach((a, i) => writeFileSync(`${OUT}/jobs-ad-${i}.json`, JSON.stringify(a)));
const count = (f) => jobs.filter(f).length;
console.log(`${jobs.length} jobs (${arbeitnow} Arbeitnow, ${jobs.length - arbeitnow} company boards); ${count((j) => j.salary)} with salary; ` +
  ['de', 'eu', 'uk', 'us', 'ca', 'me', 'asia', 'ww'].map((r) => `${r} ${count((j) => j.regions.includes(r))}`).join(', ') + `; open to PK ${count((j) => j.pkOpen)}`);
if (failed.length) console.log('skipped:', failed.join(' | '));
