#!/usr/bin/env node
/* Apply Gmail label to messages matching refs/email_merchants.json rules.
 *
 * This helps keep order emails under the HisabKitab label so existing parsers work.
 *
 * Usage:
 *   node src/gmail/apply_label_rules.js --base-dir ~/HisabKitab \
 *     --after 2024-01-01 --before 2026-02-01 \
 *     --merchants DOMINOS,REDBUS,DISTRICT \
 *     --dry-run true
 *
 * Then:
 *   node src/gmail/apply_label_rules.js ... --dry-run false
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { google } = require('googleapis');

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i=args.indexOf(k); return i===-1?null:(args[i+1] ?? null); };
  const dry = (get('--dry-run') || 'true').toLowerCase();
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    after: get('--after') || '2024-01-01',
    before: get('--before') || '2026-02-01',
    merchants: (get('--merchants') || '').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),
    dryRun: dry !== 'false',
    maxPerMerchant: Number(get('--max-per-merchant') || 2000),
    batch: Number(get('--batch') || 200)
  };
}

function readJson(fp){
  return JSON.parse(fs.readFileSync(fp,'utf8'));
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

function buildQueryForMerchant(key, mc, after, before){
  const afterQ = after.replace(/-/g,'/');
  const beforeQ = before.replace(/-/g,'/');
  const parts = [`after:${afterQ}`, `before:${beforeQ}`];

  const froms = mc?.match?.fromContains || [];
  const subs = mc?.match?.subjectContains || [];

  if(froms.length){
    const ors = froms.map(s => `from:${String(s).replace(/\s+/g,'')}`);
    parts.push('(' + ors.join(' OR ') + ')');
  }

  if(subs.length){
    // Use subject: to reduce false positives now that we are labeling.
    const ors = subs.map(s => `subject:(${String(s)})`);
    parts.push('(' + ors.join(' OR ') + ')');
  }

  // for pdf parsers, at least require an attachment
  if(mc?.parser?.type === 'pdf') parts.push('has:attachment');

  return parts.join(' ');
}

async function ensureLabel(gmail, name){
  const labelsRes = await gmail.users.labels.list({ userId:'me' });
  const existing = (labelsRes.data.labels || []).find(l => l.name === name);
  if(existing) return existing.id;
  const created = await gmail.users.labels.create({ userId:'me', requestBody: { name, labelListVisibility:'labelShow', messageListVisibility:'show' } });
  return created.data.id;
}

async function main(){
  const cfg = parseArgs(process.argv);
  const merchantCfg = readJson(path.join(cfg.baseDir,'refs','email_merchants.json'));

  const authClient = await auth(cfg.baseDir);
  const gmail = google.gmail({ version:'v1', auth: authClient });

  const labelName = 'HisabKitab';
  const labelId = await ensureLabel(gmail, labelName);

  const targets = cfg.merchants.length ? cfg.merchants : Object.keys(merchantCfg);

  const report = [];

  for(const key of targets){
    const mc = merchantCfg[key];
    if(!mc || mc.enabled === false) continue;

    const q = buildQueryForMerchant(key, mc, cfg.after, cfg.before);

    let pageToken = undefined;
    let matched = 0;
    let labeled = 0;

    while(matched < cfg.maxPerMerchant){
      const maxResults = Math.min(cfg.batch, cfg.maxPerMerchant - matched);
      const listRes = await gmail.users.messages.list({ userId:'me', q, maxResults, pageToken });
      const msgs = listRes.data.messages || [];
      pageToken = listRes.data.nextPageToken;
      if(!msgs.length) break;

      matched += msgs.length;

      if(!cfg.dryRun){
        for(const m of msgs){
          await gmail.users.messages.modify({
            userId:'me',
            id: m.id,
            requestBody: { addLabelIds: [labelId], removeLabelIds: [] }
          });
          labeled++;
        }
      }

      if(!pageToken) break;
    }

    report.push({ merchant: key, query: q, matched, labeled: cfg.dryRun ? 0 : labeled, dryRun: cfg.dryRun });
  }

  process.stdout.write(JSON.stringify({ ok:true, dryRun: cfg.dryRun, after: cfg.after, before: cfg.before, label: labelName, report }, null, 2) + '\n');
}

main().catch(e=>{ console.error(e); process.exit(1); });
