#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

function expandHome(p){
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

const baseDir = expandHome(process.argv[2] || '~/HisabKitab');
const refsDir = path.join(baseDir, 'refs');
const templateDir = path.join(__dirname, '..', '..', 'refs-template');

fs.mkdirSync(refsDir, { recursive: true });

for (const f of fs.readdirSync(templateDir)) {
  const src = path.join(templateDir, f);
  const dst = path.join(refsDir, f);
  if (!fs.existsSync(dst)) {
    fs.copyFileSync(src, dst);
    console.log('Created', dst);
  }
}
console.log('Done.');
