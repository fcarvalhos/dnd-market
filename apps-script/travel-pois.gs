// Points of interest for the Travel map of The Gilded Ledger.
// Setup: new Google Sheet → Extensions → Apps Script → paste this file → change EDIT_KEY →
// Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → copy the URL
// into POI_API at the top of js/travel.js.
const EDIT_KEY = 'change-me';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('POIs') || ss.insertSheet('POIs');
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  return out_({ pois: rows.filter((r) => r[0] !== '').map((r) => ({ id: String(r[0]), name: String(r[1]), note: String(r[2]), x: Number(r[3]), y: Number(r[4]) })) });
}

function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.key !== EDIT_KEY) return out_({ error: 'Wrong DM key' });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const rows = [['id', 'name', 'note', 'x', 'y']].concat((d.pois || []).map((p) => [p.id, p.name, p.note || '', p.x, p.y]));
    sh.clearContents();
    sh.getRange(1, 1, rows.length, 5).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return doGet();
}
