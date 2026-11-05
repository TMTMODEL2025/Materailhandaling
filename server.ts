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
}

interface StoredDeliveryPoint {
  id: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
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

interface MutationsStore {
  jobTransfers: StoredJobTransfer[];
  deliveryPoints: StoredDeliveryPoint[];
  deliveryPointEdits: StoredDeliveryPointEdit[];
  vehicleRegEdits: StoredVehicleRegEdit[];
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
