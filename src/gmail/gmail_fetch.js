#!/usr/bin/env node
/* Fetch Gmail messages for the HisabKitab label and dump minimal parsed info.
 * Usage:
 *   node gmail_fetch.js --base-dir ~/HisabKitab --label HisabKitab --max 10
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function readJson(fp){
  return JSON.parse(fs.readFileSync(fp,'utf8'));
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    label: get('--label') || 'HisabKitab',
    max: Number(get('--max') || 10)
  };
}

async function auth(baseDir){
  const credsPath = path.join(baseDir,'credentials.json');
  const tokenPath = path.join(baseDir,'gmail_token.json');
  if(!fs.existsSync(credsPath)) throw new Error('Missing ' + credsPath);
  if(!fs.existsSync(tokenPath)) throw new Error('Missing ' + tokenPath);

  const creds = readJson(credsPath);
  const c = creds.installed || creds.web;
  if(!c) throw new Error('credentials.json must have installed/web');

  // Redirect URI not needed for refresh token usage.
  const oAuth2Client = new google.auth.OAuth2(c.client_id, c.client_secret);
  oAuth2Client.setCredentials(readJson(tokenPath));
  return oAuth2Client;
}

function header(headers, name){
  const h = (headers||[]).find(x => (x.name||'').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

async function main(){
  const { baseDir, label, max } = parseArgs(process.argv);
  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  // Find label id
  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) {
    throw new Error(`Label '${label}' not found. Create it in Gmail or change --label.`);
  }

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [lbl.id],
    maxResults: max
  });

  const msgs = listRes.data.messages || [];
  const out = [];

  for (const m of msgs) {
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From','To','Subject','Date'] });
    const h = full.data.payload?.headers || [];
    out.push({
      id: full.data.id,
      threadId: full.data.threadId,
      internalDate: full.data.internalDate,
      from: header(h,'From'),
      subject: header(h,'Subject'),
      date: header(h,'Date'),
      snippet: full.data.snippet
    });
  }

  const savePath = path.join(baseDir,'gmail_cache.json');
  fs.writeFileSync(savePath, JSON.stringify({ fetchedAt: new Date().toISOString(), label, items: out }, null, 2) + '\n');

  console.log(JSON.stringify({ ok:true, count: out.length, saved: savePath }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
