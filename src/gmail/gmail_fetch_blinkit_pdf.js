#!/usr/bin/env node
/* Fetch the most recent Blinkit email (under a label) with a PDF attachment.
 * Saves the PDF under ~/HisabKitab/attachments/blinkit/<messageId>/<filename>
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
    max: Number(get('--max') || 200)
  };
}

async function auth(baseDir){
  const credsPath = path.join(baseDir,'credentials.json');
  const tokenPath = path.join(baseDir,'gmail_token.json');
  const creds = readJson(credsPath);
  const c = creds.installed || creds.web;
  const oAuth2Client = new google.auth.OAuth2(c.client_id, c.client_secret);
  oAuth2Client.setCredentials(readJson(tokenPath));
  return oAuth2Client;
}

function header(headers, name){
  const h = (headers||[]).find(x => (x.name||'').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function findPdfParts(payload){
  const out = [];
  function walk(p){
    if(!p) return;
    const fn = p.filename || '';
    const mt = (p.mimeType || '').toLowerCase();
    const attId = p.body && p.body.attachmentId;
    if(attId && (mt === 'application/pdf' || fn.toLowerCase().endsWith('.pdf'))){
      out.push({ filename: fn || 'attachment.pdf', mimeType: mt, attachmentId: attId });
    }
    for(const part of (p.parts||[])) walk(part);
  }
  walk(payload);
  return out;
}

async function main(){
  const { baseDir, label, max } = parseArgs(process.argv);
  const authClient = await auth(baseDir);
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const lbl = (labelsRes.data.labels || []).find(l => l.name === label);
  if(!lbl) throw new Error(`Label '${label}' not found`);

  const listRes = await gmail.users.messages.list({ userId: 'me', labelIds: [lbl.id], maxResults: max });
  const msgs = listRes.data.messages || [];

  for(const m of msgs){
    const full = await gmail.users.messages.get({ userId:'me', id:m.id, format:'full' });
    const h = full.data.payload?.headers || [];
    const from = header(h,'From');
    const subject = header(h,'Subject');
    const fromLc = (from||'').toLowerCase();
    const subjLc = (subject||'').toLowerCase();

    if(!fromLc.includes('blinkit') && !subjLc.includes('blinkit')) continue;

    const pdfs = findPdfParts(full.data.payload);
    if(!pdfs.length) continue;

    const outDir = path.join(baseDir, 'attachments', 'blinkit', full.data.id);
    fs.mkdirSync(outDir, { recursive: true });

    const saved = [];
    for(const p of pdfs){
      const att = await gmail.users.messages.attachments.get({ userId:'me', messageId: full.data.id, id: p.attachmentId });
      const data = att.data.data.replace(/-/g,'+').replace(/_/g,'/');
      const buf = Buffer.from(data, 'base64');
      const filename = p.filename || 'blinkit.pdf';
      const outPath = path.join(outDir, filename);
      fs.writeFileSync(outPath, buf);
      saved.push(outPath);
    }

    console.log(JSON.stringify({ ok:true, messageId: full.data.id, from, subject, saved }, null, 2));
    return;
  }

  console.log(JSON.stringify({ ok:false, error: 'No Blinkit PDF receipt found in latest labeled messages.' }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
