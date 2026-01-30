#!/usr/bin/env node
/* Report what receipts are labeled and which merchant rules match.
 * Usage:
 *   node gmail_receipts_status.js --base-dir ~/HisabKitab --label HisabKitab --max 50
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function readJson(fp, fallback){
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return fallback; }
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1]||null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    label: get('--label') || 'HisabKitab',
    max: Number(get('--max') || 50)
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

  const oAuth2Client = new google.auth.OAuth2(c.client_id, c.client_secret);
  oAuth2Client.setCredentials(readJson(tokenPath));
  return oAuth2Client;
}

function header(headers, name){
  const h = (headers||[]).find(x => (x.name||'').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function ruleMatchesEmail(rule, from, subject){
  if(!rule || !rule.enabled) return false;
  const f=(from||'').toLowerCase();
  const s=(subject||'').toLowerCase();

  const fc = (rule.match?.fromContains || []).some(x => f.includes(String(x).toLowerCase()));
  const sc = (rule.match?.subjectContains || []).some(x => s.includes(String(x).toLowerCase()));

  // if lists are empty, treat as wildcard
  const fromOk = (rule.match?.fromContains?.length ? fc : true);
  const subjOk = (rule.match?.subjectContains?.length ? sc : true);
  return fromOk && subjOk;
}

async function main(){
  const { baseDir, label, max } = parseArgs(process.argv);
  const rules = readJson(path.join(baseDir,'refs','email_merchants.json'), {});

  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) throw new Error(`Label '${label}' not found`);

  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [lbl.id], maxResults: max });
  const msgs = listRes.data.messages || [];

  const counts = {};
  const unknown = [];

  for(const m of msgs){
    const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'metadata', metadataHeaders:['From','Subject','Date'] });
    const h = full.data.payload?.headers || [];
    const from = header(h,'From');
    const subject = header(h,'Subject');

    let matched = null;
    for(const [k, rule] of Object.entries(rules)){
      if(ruleMatchesEmail(rule, from, subject)) { matched = k; break; }
    }
    if(!matched) {
      matched = 'UNKNOWN';
      unknown.push({ from, subject, id: full.data.id });
    }
    counts[matched] = (counts[matched] || 0) + 1;
  }

  const report = {
    ok: true,
    label,
    fetched: msgs.length,
    counts,
    unknownTop: unknown.slice(0, 10)
  };

  const outPath = path.join(baseDir,'receipts_status.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({ ok:true, saved: outPath, ...report }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
