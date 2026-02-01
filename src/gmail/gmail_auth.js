#!/usr/bin/env node
/* Gmail OAuth helper for HisabKitab.
 * Generates/updates ~/HisabKitab/gmail_token.json with requested scopes.
 *
 * Step 1: print auth URL
 *   node src/gmail/gmail_auth.js --base-dir ~/HisabKitab --scopes gmail.modify
 *
 * Step 2: exchange code + save token
 *   node src/gmail/gmail_auth.js --base-dir ~/HisabKitab --scopes gmail.modify --code "4/0A..."
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
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    code: get('--code') || null,
    scopes: (get('--scopes') || 'gmail.readonly').split(',').map(s=>s.trim()).filter(Boolean)
  };
}

function resolveScopes(short){
  const set = new Set();
  for(const s of short){
    if(s === 'gmail.modify') set.add('https://www.googleapis.com/auth/gmail.modify');
    else if(s === 'gmail.readonly') set.add('https://www.googleapis.com/auth/gmail.readonly');
    else if(/^https:\/\//.test(s)) set.add(s);
    else set.add(s);
  }
  return [...set];
}

function readJson(fp){
  return JSON.parse(fs.readFileSync(fp,'utf8'));
}

function saveJson(fp, obj){
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function main(){
  const cfg = parseArgs(process.argv);
  const credsPath = path.join(cfg.baseDir, 'credentials.json');
  const tokenPath = path.join(cfg.baseDir, 'gmail_token.json');

  if(!fs.existsSync(credsPath)) {
    console.error('Missing credentials.json at ' + credsPath);
    process.exit(2);
  }

  const creds = readJson(credsPath);
  const c = creds.installed || creds.web;
  if(!c) {
    console.error('credentials.json must include "installed" or "web"');
    process.exit(2);
  }

  // Pick a redirect URI.
  // Many desktop creds include http://localhost
  const redirectUri = (c.redirect_uris && c.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob';

  const oAuth2Client = new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri);
  const scopes = resolveScopes(cfg.scopes);

  if(!cfg.code){
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes
    });
    console.log(JSON.stringify({
      ok: true,
      step: 'open_url_then_rerun_with_code',
      tokenPath,
      scopes,
      authUrl
    }, null, 2));
    return;
  }

  const { tokens } = await oAuth2Client.getToken(cfg.code);
  // Preserve scope field as a single string like other scripts expect
  if(tokens.scope == null) tokens.scope = scopes.join(' ');
  saveJson(tokenPath, tokens);

  console.log(JSON.stringify({ ok: true, saved: tokenPath, scope: tokens.scope, expiry_date: tokens.expiry_date }, null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); });
