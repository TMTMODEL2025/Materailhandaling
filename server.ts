import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'sheet-mutations.json');

interface StoredJobTransfer {
  recordId: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface StoredDeliveryPoint {
  id: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface StoredDeliveryPointEdit {
  deliveryPoint: string;
  oldGate: string;
  newGate: string;
  updatedDate: string;
  updatedAt: string;
}

interface StoredVehicleRegEdit {
  oldRegistration: string;
  newRegistration: string;
  driverName: string;
  shift: string;
  updatedAt: string;
}

interface StoredJobTransferNoteEdit {
  rowNumber: number;
  date: string;
  driverName: string;
  vehicleNumber: string;
  startTime: string;
  note: string;
  updatedAt: string;
}

interface StoredRepairRequest {
  id: string;
  rowNumber: number;
  sequenceNo: string;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface StoredRepairApproval {
  rowNumber: number;
  sequenceNo: string;
  approvalStatus: string;
  approverName: string;
  approvalDate: string;
  approvalTime: string;
  repairStatus?: string;
  note?: string;
  updatedAt: string;
}

interface MutationsStore {
  jobTransfers: StoredJobTransfer[];
  deliveryPoints: StoredDeliveryPoint[];
  deliveryPointEdits: StoredDeliveryPointEdit[];
  vehicleRegEdits: StoredVehicleRegEdit[];
  jobTransferNoteEdits: StoredJobTransferNoteEdit[];
  repairRequests: StoredRepairRequest[];
  repairApprovals: StoredRepairApproval[];
  googleAccessToken?: string;
  googleTokenExpiresAt?: number;
  googleScriptUrl?: string;
}

function readStore(): MutationsStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<MutationsStore>;
      return {
        jobTransfers: Array.isArray(parsed.jobTransfers) ? parsed.jobTransfers : [],
        deliveryPoints: Array.isArray(parsed.deliveryPoints) ? parsed.deliveryPoints : [],
        deliveryPointEdits: Array.isArray(parsed.deliveryPointEdits)
          ? parsed.deliveryPointEdits
          : [],
        vehicleRegEdits: Array.isArray(parsed.vehicleRegEdits)
          ? parsed.vehicleRegEdits
          : [],
        jobTransferNoteEdits: Array.isArray(parsed.jobTransferNoteEdits)
          ? parsed.jobTransferNoteEdits
          : [],
        repairRequests: Array.isArray(parsed.repairRequests) ? parsed.repairRequests : [],
        repairApprovals: Array.isArray(parsed.repairApprovals) ? parsed.repairApprovals : [],
        googleAccessToken:
          typeof parsed.googleAccessToken === 'string'
            ? parsed.googleAccessToken
            : undefined,
        googleTokenExpiresAt:
          typeof parsed.googleTokenExpiresAt === 'number'
            ? parsed.googleTokenExpiresAt
            : undefined,
        googleScriptUrl:
          typeof parsed.googleScriptUrl === 'string'
            ? parsed.googleScriptUrl
            : undefined,
      };
    }
  } catch (err) {
    console.error('Error reading mutations store:', err);
  }
  return {
    jobTransfers: [],
    deliveryPoints: [],
    deliveryPointEdits: [],
    vehicleRegEdits: [],
    jobTransferNoteEdits: [],
    repairRequests: [],
    repairApprovals: [],
  };
}

function writeStore(store: MutationsStore): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing mutations store:', err);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/mutations', (_req, res) => {
    const store = readStore();
    res.json(store);
  });

  app.get('/api/script-url', (_req, res) => {
    const store = readStore();
    res.json({ scriptUrl: store.googleScriptUrl ?? process.env.VITE_GOOGLE_SCRIPT_URL ?? null });
  });

  app.post('/api/script-url', (req, res) => {
    const store = readStore();
    const { scriptUrl } = req.body ?? {};
    if (typeof scriptUrl === 'string') {
      store.googleScriptUrl = scriptUrl.trim();
      writeStore(store);
    }
    res.json({ ok: true, scriptUrl: store.googleScriptUrl });
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
      const ttl =
        typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : 3500;
      store.googleAccessToken = accessToken.trim();
      store.googleTokenExpiresAt = Date.now() + ttl * 1000;
      writeStore(store);
    }
    res.json({ ok: true });
  });

  app.post('/api/mutations/mark-synced', (req, res) => {
    const store = readStore();
    const { recordId, sheetRowNumber } = req.body ?? {};
    if (typeof recordId === 'string') {
      for (const jt of store.jobTransfers) {
        if (jt.recordId === recordId) {
          jt.syncedToSheet = true;
          if (typeof sheetRowNumber === 'number' && sheetRowNumber > 0) {
            jt.rowNumber = sheetRowNumber;
          }
        }
      }
      writeStore(store);
    }
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
        : 22990;
    const rowNumber = baseRowNumber + store.jobTransfers.length + 1;

    const values: Record<string, string> = body.values ?? {};
    const entry: StoredJobTransfer = {
      recordId,
      rowNumber,
      values,
      createdAt: new Date().toISOString(),
    };

    store.jobTransfers.push(entry);
    writeStore(store);

    res.json({ recordId, rowNumber, entry });
  });

  app.put('/api/mutations/job-transfer/:recordId', (req, res) => {
    const store = readStore();
    const { recordId } = req.params;
    const { rowNumber, endTime, duration, status } = req.body ?? {};

    let updated = false;
    for (const item of store.jobTransfers) {
      if (
        item.recordId === recordId ||
        (typeof rowNumber === 'number' && item.rowNumber === rowNumber)
      ) {
        if (typeof endTime === 'string') item.values['K'] = endTime;
        if (typeof duration === 'string') item.values['L'] = duration;
        if (typeof status === 'string') item.values['M'] = status;
        updated = true;
        break;
      }
    }

    writeStore(store);
    res.json({ ok: true, updated });
  });

  app.post('/api/mutations/delivery-point', (req, res) => {
    const store = readStore();
    const body = req.body ?? {};
    const id = Math.random().toString(16).slice(2, 10);
    const baseRowNumber =
      typeof body.baseRowNumber === 'number' && body.baseRowNumber > 0
        ? body.baseRowNumber
        : 25;
    const rowNumber = baseRowNumber + store.deliveryPoints.length + 1;

    const values: Record<string, string> = body.values ?? {};
    const entry: StoredDeliveryPoint = {
      id,
      rowNumber,
      values,
      createdAt: new Date().toISOString(),
    };

    store.deliveryPoints.push(entry);
    writeStore(store);

    res.json({ id, rowNumber, entry });
  });

  app.put('/api/mutations/delivery-point-gate', (req, res) => {
    const store = readStore();
    const { deliveryPoint, oldGate, newGate, updatedDate } = req.body ?? {};
    const pt = String(deliveryPoint ?? '').trim();
    const og = String(oldGate ?? '').trim();
    const ng = String(newGate ?? '').trim();
    const dt = String(updatedDate ?? '').trim();

    if (!pt || !ng) {
      res.status(400).json({ error: 'ข้อมูลจุดส่งสินค้าหรือประตูไม่ครบถ้วน' });
      return;
    }

    // Update if it was a newly created deliveryPoint
    for (const dp of store.deliveryPoints) {
      if ((dp.values['B'] ?? '').trim() === pt) {
        dp.values['C'] = ng;
        if (dt) dp.values['A'] = dt;
      }
    }

    const existingIdx = store.deliveryPointEdits.findIndex(
      (e) => e.deliveryPoint === pt
    );
    const editEntry: StoredDeliveryPointEdit = {
      deliveryPoint: pt,
      oldGate: og,
      newGate: ng,
      updatedDate: dt,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.deliveryPointEdits[existingIdx] = editEntry;
    } else {
      store.deliveryPointEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.put('/api/mutations/vehicle-registration', (req, res) => {
    const store = readStore();
    const { oldRegistration, newRegistration, driverName, shift } = req.body ?? {};
    const oldReg = String(oldRegistration ?? '').trim();
    const newReg = String(newRegistration ?? '').trim();
    const drv = String(driverName ?? '').trim();
    const shf = String(shift ?? '').trim();

    if (!oldReg || !newReg) {
      res.status(400).json({ error: 'ข้อมูลทะเบียนรถไม่ครบถ้วน' });
      return;
    }

    // Chain edits if a previously edited vehicle registration is edited again
    const chainedIdx = store.vehicleRegEdits.findIndex(
      (e) => e.newRegistration === oldReg && e.driverName === drv && e.shift === shf
    );

    if (chainedIdx >= 0) {
      store.vehicleRegEdits[chainedIdx].newRegistration = newReg;
      store.vehicleRegEdits[chainedIdx].updatedAt = new Date().toISOString();
    } else {
      store.vehicleRegEdits.push({
        oldRegistration: oldReg,
        newRegistration: newReg,
        driverName: drv,
        shift: shf,
        updatedAt: new Date().toISOString(),
      });
    }

    writeStore(store);
    res.json({ ok: true });
  });

  app.put('/api/mutations/job-transfer-note', (req, res) => {
    const store = readStore();
    const { rowNumber, date, driverName, vehicleNumber, startTime, note } =
      req.body ?? {};
    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const dt = String(date ?? '').trim();
    const drv = String(driverName ?? '').trim();
    const veh = String(vehicleNumber ?? '').trim();
    const st = String(startTime ?? '').trim();
    const nt = String(note ?? '').trim();

    for (const jt of store.jobTransfers) {
      if (
        (jt.values['A'] ?? '').trim() === dt &&
        (jt.values['C'] ?? '').trim() === drv &&
        (jt.values['D'] ?? '').trim() === veh &&
        (jt.values['I'] ?? '').trim() === st
      ) {
        jt.values['N'] = nt;
        jt.values['R'] = nt;
      }
    }

    const existingIdx = store.jobTransferNoteEdits.findIndex(
      (e) =>
        e.date === dt &&
        e.driverName === drv &&
        e.vehicleNumber === veh &&
        e.startTime === st
    );

    const editEntry: StoredJobTransferNoteEdit = {
      rowNumber: rn,
      date: dt,
      driverName: drv,
      vehicleNumber: veh,
      startTime: st,
      note: nt,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.jobTransferNoteEdits[existingIdx] = editEntry;
    } else {
      store.jobTransferNoteEdits.push(editEntry);
    }

    writeStore(store);
    res.json({ ok: true, edit: editEntry });
  });

  app.post('/api/mutations/repair-request', (req, res) => {
    const store = readStore();
    const body = req.body ?? {};
    const id =
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : Math.random().toString(16).slice(2, 10);
    const rowNumber =
      typeof body.rowNumber === 'number' && body.rowNumber > 0
        ? body.rowNumber
        : 4270 + store.repairRequests.length;
    const sequenceNo = String(body.sequenceNo ?? rowNumber - 1);
    const values: Record<string, string> = body.values ?? {};

    const entry: StoredRepairRequest = {
      id,
      rowNumber,
      sequenceNo,
      values,
      createdAt: new Date().toISOString(),
      syncedToSheet: Boolean(body.syncedToSheet),
    };

    store.repairRequests.push(entry);
    writeStore(store);

    res.json({ ok: true, entry });
  });

  app.put('/api/mutations/repair-approval', (req, res) => {
    const store = readStore();
    const {
      rowNumber,
      sequenceNo,
      approvalStatus,
      approverName,
      approvalDate,
      approvalTime,
      repairStatus,
      note,
    } = req.body ?? {};

    const rn = typeof rowNumber === 'number' ? rowNumber : 0;
    const seq = String(sequenceNo ?? '').trim();
    const status = String(approvalStatus ?? '').trim();
    const approver = String(approverName ?? '').trim();
    const appDate = String(approvalDate ?? '').trim();
    const appTime = String(approvalTime ?? '').trim();
    const repStatus = String(repairStatus ?? '').trim();
    const nt = String(note ?? '').trim();

    for (const reqItem of store.repairRequests) {
      if (
        (seq && reqItem.sequenceNo === seq) ||
        (rn > 0 && reqItem.rowNumber === rn)
      ) {
        reqItem.values['AE'] = approver;
        reqItem.values['AF'] = appDate;
        reqItem.values['AG'] = appTime;
        reqItem.values['AI'] = status;
        if (repStatus) reqItem.values['P'] = repStatus;
        if (nt) reqItem.values['AH'] = nt;
      }
    }

    const existingIdx = store.repairApprovals.findIndex(
      (a) => (seq && a.sequenceNo === seq) || (rn > 0 && a.rowNumber === rn)
    );

    const approvalEntry: StoredRepairApproval = {
      rowNumber: rn,
      sequenceNo: seq,
      approvalStatus: status,
      approverName: approver,
      approvalDate: appDate,
      approvalTime: appTime,
      repairStatus: repStatus || undefined,
      note: nt || undefined,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      store.repairApprovals[existingIdx] = approvalEntry;
    } else {
      store.repairApprovals.push(approvalEntry);
    }

    writeStore(store);
    res.json({ ok: true, approval: approvalEntry });
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
