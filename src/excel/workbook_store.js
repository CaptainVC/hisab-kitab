/* Quarterly workbook + monthly sheet storage (Hisab Kitab).
 *
 * Convention:
 * - Workbook: HK_YYYY_QN.xlsx (calendar quarters)
 *   Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec
 * - Sheet: MMM-YYYY (e.g., Jan-2026)
 * - Each sheet has the same header row.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { DateTime } = require('luxon');

const IST = 'Asia/Kolkata';

function monthSheetName(dt) {
  // dt: Luxon DateTime
  return dt.toFormat('LLL-yyyy'); // Jan-2026
}

function quarterOfMonth(month) {
  return Math.floor((month - 1) / 3) + 1;
}

function quarterWorkbookName(dt) {
  const q = quarterOfMonth(dt.month);
  return `HK_${dt.year}_Q${q}.xlsx`;
}

function readWorkbookIfExists(fp) {
  if (!fs.existsSync(fp)) return null;
  return XLSX.readFile(fp);
}

function ensureWorkbook(fp) {
  const wb = readWorkbookIfExists(fp);
  if (wb) return wb;
  return XLSX.utils.book_new();
}

function ensureSheetWithHeaders(wb, sheetName, headers) {
  if (wb.Sheets[sheetName]) {
    // Ensure header row exists; if missing, rewrite with headers.
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) {
      wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet([headers]);
    }
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

function readSheetRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows;
}

function appendRowsToSheet(wb, sheetName, rows, headers) {
  const existing = readSheetRows(wb, sheetName);
  const combined = existing.concat(
    rows.map(r => {
      const o = {};
      for (const h of headers) o[h] = r[h] ?? '';
      return o;
    })
  );
  const newWs = XLSX.utils.json_to_sheet(combined, { header: headers });
  wb.Sheets[sheetName] = newWs;
  if (!wb.SheetNames.includes(sheetName)) wb.SheetNames.push(sheetName);
}

function normalizeToISTDate(dateStr) {
  const dt = DateTime.fromISO(dateStr, { zone: IST });
  if (!dt.isValid) return null;
  return dt.startOf('day');
}

function groupByQuarterAndMonth(rows) {
  const m = new Map();
  for (const r of rows) {
    const dt = normalizeToISTDate(r.date);
    if (!dt) continue;
    const wbName = quarterWorkbookName(dt);
    const sheet = monthSheetName(dt);
    const key = `${wbName}::${sheet}`;
    if (!m.has(key)) m.set(key, { wbName, sheet, rows: [] });
    m.get(key).rows.push(r);
  }
  return Array.from(m.values());
}

function storeAppend({ baseDir, headers, rows }) {
  const groups = groupByQuarterAndMonth(rows);
  const outputs = [];

  for (const g of groups) {
    const fp = path.join(baseDir, g.wbName);
    const wb = ensureWorkbook(fp);
    ensureSheetWithHeaders(wb, g.sheet, headers);
    appendRowsToSheet(wb, g.sheet, g.rows, headers);
    XLSX.writeFile(wb, fp);
    outputs.push({ workbook: fp, sheet: g.sheet, appended: g.rows.length });
  }

  return outputs;
}

module.exports = {
  IST,
  monthSheetName,
  quarterWorkbookName,
  ensureWorkbook,
  ensureSheetWithHeaders,
  appendRowsToSheet,
  readSheetRows,
  groupByQuarterAndMonth,
  storeAppend
};
