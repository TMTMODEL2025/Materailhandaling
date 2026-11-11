import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = path.join('/tmp', 'sheet-mutations.json');
const GOOGLE_SHEET_ID = '1Dn72dYdEGz3GBvk3O5n1FN0RCKv5S1IvgLeA5M5RzWc';

const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbz8e9-5I7UphS_hZvyh5YhC_v6yWSe7e7VFRK3BIKqEihMGab4RsOlQwll5sk_WlQZi/exec';
const STALE_APPS_SCRIPT_ID =
  'AKfycbx1OQXBULrG89F0pde3wXPPcmgYUQyO09r1Y5gDQQg';

function normalizeUrl(raw?: string): string {
  if (!raw) return DEFAULT_APPS_SCRIPT_URL;
  let url = raw.trim();
  if (!url.startsWith('https://script.google.com/')) return DEFAULT_APPS_SCRIPT_URL;
  if (url.includes(STALE_APPS_SCRIPT_ID)) return DEFAULT_APPS_SCRIPT_URL;
  const match = url.match(/\/macros\/s\/([^/?#]+)/);
  if (match && match[1] && match[1].length < 60) {
    return DEFAULT_APPS_SCRIPT_URL;
  }
  if (url.includes('/dev')) {
    url = url.split('/dev').join('/exec');
  }
  return url;
}

function readStore(): Record<string, any> {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        jobTransfers: Array.isArray(parsed.jobTransfers) ? parsed.jobTransfers : [],
        deliveryPoints: Array.isArray(parsed.deliveryPoints) ? parsed.deliveryPoints : [],
        deliveryPointEdits: Array.isArray(parsed.deliveryPointEdits) ? parsed.deliveryPointEdits : [],
        vehicleRegEdits: Array.isArray(parsed.vehicleRegEdits) ? parsed.vehicleRegEdits : [],
        vehicleFieldEdits: Array.isArray(parsed.vehicleFieldEdits) ? parsed.vehicleFieldEdits : [],
        jobTransferNoteEdits: Array.isArray(parsed.jobTransferNoteEdits) ? parsed.jobTransferNoteEdits : [],
        repairRequests: Array.isArray(parsed.repairRequests) ? parsed.repairRequests : [],
        repairApprovals: Array.isArray(parsed.repairApprovals) ? parsed.repairApprovals : [],
        repairInspections: Array.isArray(parsed.repairInspections) ? parsed.repairInspections : [],
        repairPhotoEdits: Array.isArray(parsed.repairPhotoEdits) ? parsed.repairPhotoEdits : [],
        repairDetailEdits: Array.isArray(parsed.repairDetailEdits) ? parsed.repairDetailEdits : [],
        repairReplyEdits: Array.isArray(parsed.repairReplyEdits) ? parsed.repairReplyEdits : [],
        repairFinancialEdits: Array.isArray(parsed.repairFinancialEdits) ? parsed.repairFinancialEdits : [],
        fuelRecords: Array.isArray(parsed.fuelRecords) ? parsed.fuelRecords : [],
        tireStockEdits: Array.isArray(parsed.tireStockEdits) ? parsed.tireStockEdits : [],
        googleAccessToken: parsed.googleAccessToken,
        googleTokenExpiresAt: parsed.googleTokenExpiresAt,
        googleScriptUrl: parsed.googleScriptUrl,
        appsheetDriveFolderId: parsed.appsheetDriveFolderId,
      };
    }
  } catch {
    // ignore
  }
  return {
    jobTransfers: [],
    deliveryPoints: [],
    deliveryPointEdits: [],
    vehicleRegEdits: [],
    vehicleFieldEdits: [],
    jobTransferNoteEdits: [],
    repairRequests: [],
    repairApprovals: [],
    repairInspections: [],
    repairPhotoEdits: [],
    repairDetailEdits: [],
    repairReplyEdits: [],
    repairFinancialEdits: [],
    fuelRecords: [],
    tireStockEdits: [],
  };
}

function writeStore(store: Record<string, any>): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

const sheetProxyCache = new Map<string, { data: string; expiresAt: number }>();

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

app.get('/api/mutations', (_req, res) => {
  res.json(readStore());
});

app.post('/api/webhook-proxy', async (req, res) => {
  try {
    const { scriptUrl, payload } = req.body ?? {};
    const targetUrl = normalizeUrl(typeof scriptUrl === 'string' ? scriptUrl : undefined);
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload ?? {}),
      redirect: 'follow',
    });
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      sheetProxyCache.clear();
      res.json(json);
    } catch {
      res.json({ ok: response.ok, rawText: text });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/sheet-proxy', async (req, res) => {
  try {
    const gid = typeof req.query.gid === 'string' ? req.query.gid.trim() : '0';
    const tq = typeof req.query.tq === 'string' ? req.query.tq.trim() : '';
    const cacheKey = `${gid}::${tq}`;
    const now = Date.now();
    const cached = sheetProxyCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      res.setHeader('Content-Type', 'application/json;charset=utf-8');
      res.send(cached.data);
      return;
    }

    const params = new URLSearchParams({
      tqx: 'out:json',
      gid,
      _t: String(now),
    });
    if (tq) params.set('tq', tq);
    const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      res.status(response.status).json({ error: `Google Sheets HTTP ${response.status}` });
      return;
    }
    const text = await response.text();
    sheetProxyCache.set(cacheKey, {
      data: text,
      expiresAt: now + 60000,
    });
    res.setHeader('Content-Type', 'application/json;charset=utf-8');
    res.send(text);
  } catch (err) {
    res.status(504).json({ error: String(err) });
  }
});

app.get('/api/drive-photo', async (req, res) => {
  try {
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const filename = typeof req.query.filename === 'string' ? req.query.filename.trim() : '';
    const folderName = typeof req.query.folderName === 'string' ? req.query.folderName.trim() : '';
    const folderIdParam = typeof req.query.folderId === 'string' ? req.query.folderId.trim() : '';
    const scriptUrlParam =
      typeof req.query.scriptUrl === 'string' ? req.query.scriptUrl.trim() : undefined;
    if (!filename && !action) {
      res.status(400).json({ success: false, message: 'No filename or action provided' });
      return;
    }
    const store = readStore();
    const effectiveFolderId = folderIdParam || store.appsheetDriveFolderId || '';
    const targetUrl = normalizeUrl(
      scriptUrlParam ||
        store.googleScriptUrl ||
        process.env.VITE_GOOGLE_SCRIPT_URL ||
        DEFAULT_APPS_SCRIPT_URL
    );
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (filename) params.set('filename', filename);
    if (folderName) params.set('folderName', folderName);
    if (effectiveFolderId) params.set('folderId', effectiveFolderId);
    const sep = targetUrl.includes('?') ? '&' : '?';
    const reqUrl = `${targetUrl}${sep}${params.toString()}`;
    const response = await fetch(reqUrl, { redirect: 'follow' });
    const text = await response.text();
    res.json(JSON.parse(text));
  } catch (err) {
    res.status(502).json({ success: false, error: String(err) });
  }
});

app.get('/api/script-url', (_req, res) => {
  const store = readStore();
  const candidate =
    store.googleScriptUrl ?? process.env.VITE_GOOGLE_SCRIPT_URL ?? DEFAULT_APPS_SCRIPT_URL;
  res.json({
    scriptUrl: normalizeUrl(candidate),
    driveFolderId: store.appsheetDriveFolderId ?? '',
  });
});

app.post('/api/script-url', (req, res) => {
  const store = readStore();
  const { scriptUrl, driveFolderId } = req.body ?? {};
  if (typeof scriptUrl === 'string') {
    store.googleScriptUrl = normalizeUrl(scriptUrl);
  }
  if (typeof driveFolderId === 'string') {
    store.appsheetDriveFolderId = driveFolderId.trim();
  }
  writeStore(store);
  res.json({
    ok: true,
    scriptUrl: store.googleScriptUrl,
    driveFolderId: store.appsheetDriveFolderId ?? '',
  });
});

app.get('/api/google-token', (_req, res) => {
  const store = readStore();
  if (
    store.googleAccessToken &&
    store.googleTokenExpiresAt &&
    store.googleTokenExpiresAt > Date.now() + 30000
  ) {
    res.json({
      accessToken: store.googleAccessToken,
      expiresAt: store.googleTokenExpiresAt,
    });
    return;
  }
  res.json({ accessToken: null, expiresAt: 0 });
});

app.post('/api/google-token', (req, res) => {
  const store = readStore();
  const { accessToken, expiresInSec } = req.body ?? {};
  if (typeof accessToken === 'string' && accessToken.trim()) {
    const ttl = typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : 3500;
    store.googleAccessToken = accessToken.trim();
    store.googleTokenExpiresAt = Date.now() + ttl * 1000;
    writeStore(store);
  }
  res.json({ ok: true });
});

app.post('/api/mutations/mark-synced', (req, res) => {
  const store = readStore();
  const { recordId, repairId, sheetRowNumber } = req.body ?? {};
  let changed = false;
  if (typeof recordId === 'string' && recordId && Array.isArray(store.jobTransfers)) {
    for (const jt of store.jobTransfers) {
      if (jt.recordId === recordId) {
        jt.syncedToSheet = true;
        if (typeof sheetRowNumber === 'number' && sheetRowNumber > 0) {
          jt.rowNumber = sheetRowNumber;
        }
        changed = true;
      }
    }
  }
  if (typeof repairId === 'string' && repairId && Array.isArray(store.repairRequests)) {
    for (const rr of store.repairRequests) {
      if (rr.id === repairId) {
        rr.syncedToSheet = true;
        if (typeof sheetRowNumber === 'number' && sheetRowNumber > 0) {
          rr.rowNumber = sheetRowNumber;
        }
        changed = true;
      }
    }
  }
  if (changed) writeStore(store);
  res.json({ ok: true });
});

app.post('/api/mutations/job-transfer', (req, res) => {
  const store = readStore();
  const body = req.body ?? {};
  const recordId =
    typeof body.recordId === 'string' && body.recordId.trim()
      ? body.recordId.trim()
      : Math.random().toString(16).slice(2, 10);
  const baseRowNumber =
    typeof body.baseRowNumber === 'number' && body.baseRowNumber > 0
      ? body.baseRowNumber
      : 56278;
  let rowNumber =
    typeof body.rowNumber === 'number' && body.rowNumber > 0
      ? body.rowNumber
      : baseRowNumber + (store.jobTransfers?.length || 0) + 1;

  if (!Array.isArray(store.jobTransfers)) store.jobTransfers = [];
  const maxExistingRow = store.jobTransfers.reduce(
    (max: number, j: any) => (j.recordId !== recordId ? Math.max(max, j.rowNumber || 0) : max),
    0
  );
  if (store.jobTransfers.some((j: any) => j.recordId !== recordId && j.rowNumber === rowNumber)) {
    rowNumber = Math.max(rowNumber, maxExistingRow) + 1;
  }

  const values = body.values ?? {};
  const entry = {
    recordId,
    rowNumber,
    values,
    createdAt: new Date().toISOString(),
    syncedToSheet: Boolean(body.syncedToSheet),
  };

  const existingIdx = store.jobTransfers.findIndex((j: any) => j.recordId === recordId);
  if (existingIdx >= 0) {
    store.jobTransfers[existingIdx] = entry;
  } else {
    store.jobTransfers.push(entry);
  }
  writeStore(store);
  sheetProxyCache.clear();

  res.json({ recordId, rowNumber, entry });
});

app.put('/api/mutations/job-transfer/:recordId', (req, res) => {
  const store = readStore();
  const { recordId } = req.params;
  const {
    rowNumber,
    endTime,
    duration,
    status,
    date,
    driverName,
    vehicleNumber,
    startTime,
    origin,
    destination,
    productType,
  } = req.body ?? {};

  let updated = false;
  if (!Array.isArray(store.jobTransfers)) store.jobTransfers = [];
  for (const item of store.jobTransfers) {
    if (
      (recordId && item.recordId === recordId) ||
      (typeof rowNumber === 'number' && rowNumber > 0 && item.rowNumber === rowNumber)
    ) {
      if (typeof endTime === 'string') item.values['K'] = endTime;
      if (typeof duration === 'string') item.values['L'] = duration;
      if (typeof status === 'string') item.values['M'] = status;
      item.createdAt = new Date().toISOString();
      updated = true;
    }
  }

  if (!updated && (recordId || (typeof rowNumber === 'number' && rowNumber > 0))) {
    store.jobTransfers.push({
      recordId: recordId || `row_${rowNumber}_${Date.now()}`,
      rowNumber: typeof rowNumber === 'number' && rowNumber > 0 ? rowNumber : 0,
      values: {
        A: typeof date === 'string' ? date : '',
        C: typeof driverName === 'string' ? driverName : '',
        D: typeof vehicleNumber === 'string' ? vehicleNumber : '',
        F: typeof productType === 'string' ? productType : '',
        H: typeof origin === 'string' ? origin : '',
        I: typeof startTime === 'string' ? startTime : '',
        J: typeof destination === 'string' ? destination : '',
        K: typeof endTime === 'string' ? endTime : '',
        L: typeof duration === 'string' ? duration : '',
        M: typeof status === 'string' ? status : 'ส่งสินค้าเรียบร้อยแล้ว',
        Q: recordId || '',
      },
      createdAt: new Date().toISOString(),
      syncedToSheet: true,
    });
    updated = true;
  }

  writeStore(store);
  sheetProxyCache.clear();
  res.json({ ok: true, updated });
});

app.post('/api/mutations/fuel-record', (req, res) => {
  const store = readStore();
  const { id, rowNumber, values, syncedToSheet } = req.body ?? {};
  const recId = String(id ?? '').trim() || `fuel-${Date.now()}`;
  if (!Array.isArray(store.fuelRecords)) store.fuelRecords = [];
  const rn = typeof rowNumber === 'number' ? rowNumber : store.fuelRecords.length + 1;
  const entry = {
    id: recId,
    rowNumber: rn,
    values: typeof values === 'object' && values ? values : {},
    createdAt: new Date().toISOString(),
    syncedToSheet: Boolean(syncedToSheet),
  };
  const existingIdx = store.fuelRecords.findIndex((f: any) => f.id === recId);
  if (existingIdx >= 0) {
    store.fuelRecords[existingIdx] = entry;
  } else {
    store.fuelRecords.push(entry);
  }
  writeStore(store);
  sheetProxyCache.clear();
  res.json({ ok: true, id: recId, rowNumber: rn });
});

app.post('/api/mutations/tire-stock', (req, res) => {
  const store = readStore();
  const {
    rowNumber,
    tireCode,
    tireName,
    receivedQty,
    issuedQty,
    balanceQty,
    alertText,
    updateNote,
    syncedToSheet,
  } = req.body ?? {};
  const code = String(tireCode ?? '').trim();
  const rn = typeof rowNumber === 'number' ? rowNumber : 0;
  if (!Array.isArray(store.tireStockEdits)) store.tireStockEdits = [];
  const existingIdx = store.tireStockEdits.findIndex(
    (item: any) => (code && String(item.tireCode ?? '').trim() === code) || (rn > 0 && item.rowNumber === rn)
  );
  const entry = {
    rowNumber: rn,
    tireCode: code,
    tireName: String(tireName ?? '').trim(),
    receivedQty: Number(receivedQty) || 0,
    issuedQty: Number(issuedQty) || 0,
    balanceQty: Number(balanceQty) || 0,
    alertText: String(alertText ?? '').trim(),
    updateNote: String(updateNote ?? '').trim(),
    updatedAt: new Date().toISOString(),
    syncedToSheet: Boolean(syncedToSheet),
  };
  if (existingIdx >= 0) {
    store.tireStockEdits[existingIdx] = entry;
  } else {
    store.tireStockEdits.push(entry);
  }
  writeStore(store);
  sheetProxyCache.clear();
  res.json({ ok: true, edit: entry });
});

app.put('/api/mutations/vehicle-registration', (req, res) => {
  const store = readStore();
  const { oldRegistration, newRegistration, driverName, shift } = req.body ?? {};
  const oldReg = String(oldRegistration ?? '').trim();
  const newReg = String(newRegistration ?? '').trim();
  if (!oldReg || !newReg) {
    res.status(400).json({ error: 'กรุณาระบุทะเบียนรถ' });
    return;
  }
  if (!Array.isArray(store.vehicleRegEdits)) store.vehicleRegEdits = [];
  const existingIdx = store.vehicleRegEdits.findIndex(
    (e: any) =>
      e.oldRegistration === oldReg &&
      (!driverName || e.driverName === String(driverName).trim())
  );
  const entry = {
    oldRegistration: oldReg,
    newRegistration: newReg,
    driverName: String(driverName ?? '').trim(),
    shift: String(shift ?? '').trim(),
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    store.vehicleRegEdits[existingIdx] = entry;
  } else {
    store.vehicleRegEdits.push(entry);
  }
  writeStore(store);
  sheetProxyCache.clear();
  res.json({ ok: true });
});

app.put('/api/mutations/vehicle-field', (req, res) => {
  const store = readStore();
  const { rowNumber, colId, newValue } = req.body ?? {};
  const rn = typeof rowNumber === 'number' ? rowNumber : Number(rowNumber) || 0;
  const cid = String(colId ?? '').trim().toUpperCase();
  const val = String(newValue ?? '').trim();

  if (rn <= 0 || !cid) {
    res.status(400).json({ error: 'ข้อมูลแถวหรือคอลัมน์ไม่ครบถ้วน' });
    return;
  }

  if (!Array.isArray(store.vehicleFieldEdits)) store.vehicleFieldEdits = [];
  const existingIdx = store.vehicleFieldEdits.findIndex(
    (e: any) => e.rowNumber === rn && e.colId === cid
  );
  const entry = {
    rowNumber: rn,
    colId: cid,
    value: val,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    store.vehicleFieldEdits[existingIdx] = entry;
  } else {
    store.vehicleFieldEdits.push(entry);
  }

  writeStore(store);
  sheetProxyCache.clear();
  res.json({ ok: true, entry });
});

app.all('*', (_req, res) => {
  res.json({ ok: true });
});

export default app;
