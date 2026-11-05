// POST /api/enquiry  ->  email contact@launchboxpk.com (SES) + save the lead (DynamoDB)
// Runs on nodejs20.x; AWS SDK v3 is built into the runtime, so there are no npm deps.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';

const ses = new SESv2Client({});
const ddb = new DynamoDBClient({});
const TO = process.env.TO_EMAIL || 'contact@launchboxpk.com';
const FROM = process.env.FROM_EMAIL || 'Launchbox Website <website@launchboxpk.com>';
const TABLE = process.env.TABLE || 'launchbox-enquiries';
const PLANS = ['Day Pass', 'Monthly Desk', 'Flexible Desk', 'Dedicated Desk', 'Private Cabin', 'Meeting Room', 'Event', 'Virtual Office', 'Not sure yet'];

const res = (code, body) => ({ statusCode: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const handler = async (event) => {
  if ((event.requestContext?.http?.method || event.httpMethod) !== 'POST') return res(405, { ok: false });
  let d;
  try { d = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '{}')); }
  catch { return res(400, { ok: false, error: 'bad json' }); }

  if (d.website) return res(200, { ok: true });               // honeypot: bots fill the hidden field
  const name = clean(d.name, 80), phone = clean(d.phone, 30), email = clean(d.email, 120);
  const plan = PLANS.includes(d.plan) ? d.plan : 'Not sure yet';
  const msg = String(d.message ?? '').slice(0, 2000).trim(), page = clean(d.page, 120);
  if (!name || phone.replace(/\D/g, '').length < 7) return res(400, { ok: false, error: 'name and phone required' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res(400, { ok: false, error: 'bad email' });

  const id = randomUUID(), at = new Date().toISOString();
  const ip = event.requestContext?.http?.sourceIp || '';
  const wa = 'https://wa.me/' + phone.replace(/\D/g, '').replace(/^0/, '92');

  // 1. save the lead first, so nothing is lost if email fails
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: {
    id: { S: id }, createdAt: { S: at }, name: { S: name }, phone: { S: phone }, email: { S: email || '-' },
    plan: { S: plan }, message: { S: msg || '-' }, page: { S: page || '-' }, ip: { S: ip }, status: { S: 'new' } } }));

  // 2. email the team
  const rows = [['Name', name], ['Phone', phone], ['Email', email || '-'], ['Interested in', plan], ['Message', msg || '-'], ['Page', page || '-'], ['Received', at]];
  const html = `<p><b>New website enquiry</b></p><table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="color:#666">${k}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table><p><a href="${wa}">Reply on WhatsApp</a>${email ? ` · <a href="mailto:${esc(email)}">Reply by email</a>` : ''}</p>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nWhatsApp: ${wa}`;
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM, Destination: { ToAddresses: [TO] }, ReplyToAddresses: email ? [email] : undefined,
      Content: { Simple: { Subject: { Data: `Website enquiry: ${name} (${plan})` }, Body: { Html: { Data: html }, Text: { Data: text } } } } }));
  } catch (e) {
    console.error('SES failed', e);                            // lead is already saved in DynamoDB
    return res(200, { ok: true, id, emailed: false });
  }
  return res(200, { ok: true, id, emailed: true });
};
