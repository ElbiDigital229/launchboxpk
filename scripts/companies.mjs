// Company job boards pulled into the candidate jobs board (public Greenhouse / Lever / Ashby feeds).
// mode "remote" keeps remote roles only; "all" keeps every role (Gulf employers, mostly on-site);
// "gulf" keeps only roles located in the Gulf. Add a company: find its board name, add a line.
export const COMPANIES = [
  // Remote-first / remote-friendly (US, UK, Canada, Europe, worldwide)
  ['gitlab', 'greenhouse', 'remote'], ['coinbase', 'greenhouse', 'remote'], ['grafanalabs', 'greenhouse', 'remote'],
  ['reddit', 'greenhouse', 'remote'], ['twilio', 'greenhouse', 'remote'], ['stripe', 'greenhouse', 'remote'],
  ['mozilla', 'greenhouse', 'remote'], ['cloudflare', 'greenhouse', 'remote'], ['datadog', 'greenhouse', 'remote'],
  ['monzo', 'greenhouse', 'remote'], ['okx', 'greenhouse', 'remote'], ['dropbox', 'greenhouse', 'remote'],
  ['elastic', 'greenhouse', 'remote'], ['wikimedia', 'greenhouse', 'remote'], ['bitwarden', 'greenhouse', 'remote'],
  ['discord', 'greenhouse', 'remote'], ['canonical', 'greenhouse', 'remote'], ['typeform', 'greenhouse', 'remote'],
  ['netlify', 'greenhouse', 'remote'], ['calendly', 'greenhouse', 'remote'], ['airtable', 'greenhouse', 'remote'],
  ['turing', 'greenhouse', 'remote'], ['intercom', 'greenhouse', 'remote'], ['vercel', 'greenhouse', 'remote'],
  ['notion', 'ashby', 'remote'], ['1password', 'ashby', 'remote'], ['supabase', 'ashby', 'remote'],
  ['pleo', 'ashby', 'remote'], ['snyk', 'ashby', 'remote'], ['webflow', 'ashby', 'remote'], ['oyster', 'ashby', 'remote'],
  ['rain', 'ashby', 'remote'], ['zapier', 'ashby', 'remote'], ['posthog', 'ashby', 'remote'], ['andela', 'ashby', 'remote'],
  ['buffer', 'ashby', 'remote'], ['toptal', 'lever', 'remote'],
  // Gulf employers (on-site roles are useful for people ready to relocate)
  ['careem', 'greenhouse', 'all'], ['tamara', 'greenhouse', 'all'], ['ziina', 'ashby', 'all'], ['lucidmotors', 'greenhouse', 'gulf'],
];
