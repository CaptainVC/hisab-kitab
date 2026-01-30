#!/usr/bin/env node
/* Gmail OAuth (Desktop app) one-time auth.
 * - Reads ~/HisabKitab/credentials.json
 * - Opens browser for consent
 * - Writes ~/HisabKitab/gmail_token.json (chmod 600)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { google } = require('googleapis');

const BASE = path.join(os.homedir(), 'HisabKitab');
const CREDS = path.join(BASE, 'credentials.json');
const TOKEN = path.join(BASE, 'gmail_token.json');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function readJson(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function openBrowser(url) {
  // Use system opener. This should work on Linux desktop; if headless, user can copy/paste.
  const { execSync } = require('child_process');
  try {
    execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(CREDS)) {
    console.error(`Missing ${CREDS}`);
    process.exit(2);
  }

  const creds = readJson(CREDS);
  const c = creds.installed || creds.web;
  if (!c) throw new Error('credentials.json must contain "installed" or "web"');

  const clientId = c.client_id;
  const clientSecret = c.client_secret;

  // We'll use a localhost redirect.
  const port = 53682;
  const redirectUri = `http://localhost:${port}/oauth2callback`;

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('Opening browser for consent...');
  console.log(authUrl);
  const opened = openBrowser(authUrl);
  if (!opened) {
    console.log('\nCould not auto-open a browser. Copy/paste the URL above into your browser.');
  }

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        if (!req.url.startsWith('/oauth2callback')) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const u = new URL(req.url, `http://localhost:${port}`);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');

        if (err) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Authorization failed: ' + err);
          server.close();
          reject(new Error(err));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hisab Kitab: Authorization successful. You can close this tab.');
        server.close();
        resolve(code);
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.listen(port, () => {
      // listening
    });

    server.on('error', reject);
  });

  const tokenResponse = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokenResponse.tokens);

  fs.mkdirSync(BASE, { recursive: true });
  fs.writeFileSync(TOKEN, JSON.stringify(tokenResponse.tokens, null, 2) + '\n', 'utf8');
  try { fs.chmodSync(TOKEN, 0o600); } catch {}

  console.log(`\nSaved token: ${TOKEN}`);
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
