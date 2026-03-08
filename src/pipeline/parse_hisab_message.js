#!/usr/bin/env node
/* Parse a /hisab message block into daily hisab files.
 *
 * Usage:
 *   node src/pipeline/parse_hisab_message.js --base-dir ~/HisabKitab --in /path/to/hisab.txt
 *   cat hisab.txt | node src/pipeline/parse_hisab_message.js --base-dir ~/HisabKitab
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { DateTime } = require('luxon');

const IST = 'Asia/Kolkata';

function expandHome(p){
  if(!p) return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function parseArgs(argv){
  const args = argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i === -1 ? null : (args[i+1] || null); };
  return {
    baseDir: expandHome(get('--base-dir') || '~/HisabKitab'),
    inFile: expandHome(get('--in') || '')
  };
}

function parseDayHeader(line){
  const m = line.match(/\bDay\s*\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*\)\s*(?:\[[^\]]+\])?\s*$/i);
  if(!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = DateTime.fromObject({ year: y, month: mo, day: d }, { zone: IST });
  if(!dt.isValid) return null;
  return dt.toISODate();
}

function normalizeText(text){
  return text
    .replace(/^\s*\/hisab\s*/i, '')
    .replace(/\s+(?=Day\s*\()/gi, '\n')
    .replace(/\s+(?=[0-9][0-9,]*\s*\/\-)/g, '\n');
}

function main(){
  const { baseDir, inFile } = parseArgs(process.argv);
  let text = '';
  if(inFile && fs.existsSync(inFile)) text = fs.readFileSync(inFile, 'utf8');
  else text = fs.readFileSync(0, 'utf8');

  if(!text || !text.trim()){
    console.error('No input text provided');
    process.exit(2);
  }

  const normalized = normalizeText(text);
  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const byDate = new Map();
  let currentDate = null;

  for(const line of lines){
    const d = parseDayHeader(line);
    if(d){
      currentDate = d;
      if(!byDate.has(currentDate)) byDate.set(currentDate, []);
      continue;
    }

    if(!currentDate){
      // Skip entries before a Day header
      continue;
    }

    byDate.get(currentDate).push(line);
  }

  const hisabDir = path.join(baseDir, 'hisab');
  fs.mkdirSync(hisabDir, { recursive: true });

  const written = [];
  for(const [date, entries] of byDate.entries()){
    const fp = path.join(hisabDir, `${date}.txt`);
    fs.writeFileSync(fp, entries.join('\n') + '\n', 'utf8');
    written.push({ date, file: fp, count: entries.length });
  }

  process.stdout.write(JSON.stringify({ ok: true, files: written }, null, 2) + '\n');
}

main();
