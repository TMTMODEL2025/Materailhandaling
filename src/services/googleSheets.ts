import {
  DeliveryPointPayload,
  JobTransferPayload,
  SheetColumn,
  SheetDataResult,
  SheetRow,
  SheetTabConfig,
} from '../types';

export const GOOGLE_SHEET_ID = '1Dn72dYdEGz3GBvk3O5n1FN0RCKv5S1IvgLeA5M5RzWc';

export const SHEET_TABS: SheetTabConfig[] = [
  {
    gid: '606634465',
    name: 'บันทึกการย้ายงาน',
    category: 'งานขนส่ง',
    description: 'รายการเคลื่อนย้ายสินค้าภายในโรงงานแบบเรียลไทม์',
    reverseOrder: true,
    defaultLimit: 250,
  },
  {
    gid: '944294225',
    name: 'บันทึกงานซ่อม',
    category: 'งานซ่อมบำรุง',
    description: 'รายการแจ้งซ่อม สถานะคิวซ่อม และการอนุมัติงานซ่อมบำรุง',
    reverseOrder: true,
    defaultLimit: 250,
  },
  {
    gid: '378250263',
    name: 'ฐานข้อมูลรถ',
    category: 'ทะเบียนรถ',
    description: 'ข้อมูลรถโฟร์คลิฟท์ รถหัวลาก พนักงานประจำรถ และพื้นที่ปฏิบัติงาน',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1733355146',
    name: 'บันทึกน้ำมัน',
    category: 'เชื้อเพลิง',
    description: 'ประวัติการรับเข้าและเบิกจ่ายน้ำมันเชื้อเพลิง ดีเซล/เบนซิน',
    reverseOrder: true,
    defaultLimit: 250,
  },
  {
    gid: '1031154414',
    name: 'STOCK ยาง',
    category: 'คลังอะไหล่',
    description: 'รายการสต็อกยางนอก ยางใน ยอดรับเข้า เบิกออก และคงเหลือ',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1032541508',
    name: 'กำหนดรอบPM',
    category: 'งานซ่อมบำรุง',
    description: 'ตารางติดตามเลขไมล์และสถานะครบรอบการบำรุงรักษาเชิงป้องกัน (PM)',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1156877149',
    name: 'จุดส่งสินค้า',
    category: 'งานขนส่ง',
    description: 'ข้อมูลจุดส่งสินค้าและประตูเข้า-ออกประจำวัน',
    reverseOrder: false,
    defaultLimit: 200,
  },
  {
    gid: '1295975917',
    name: 'ฐานข้อมูลหาง',
    category: 'ทะเบียนรถ',
    description: 'รายการหมายเลขหางพ่วงทั้งหมดในระบบ',
    reverseOrder: false,
    defaultLimit: 200,
  },
];

const FALLBACK_COLUMN_LABELS: Record<string, Record<string, string>> = {
  '606634465': {
    P: 'วันเวลาทำรายการ',
    Q: 'รหัสรายการ',
    R: 'หมายเหตุ',
    S: 'ภาพถ่ายที่ 1',
    T: 'ภาพถ่ายที่ 2',
    U: 'น้ำหนักสุทธิ',
    V: 'จำนวนรอบ',
  },
  '1295975917': {
    A: 'หมายเลขหางพ่วง',
  },
};

const LOCAL_STORAGE_KEY = 'tmt_sheet_mutations_v1';

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

function getLocalMutations(): MutationsStore {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MutationsStore>;
      return {
        jobTransfers: Array.isArray(parsed.jobTransfers) ? parsed.jobTransfers : [],
        deliveryPoints: Array.isArray(parsed.deliveryPoints)
          ? parsed.deliveryPoints
          : [],
        deliveryPointEdits: Array.isArray(parsed.deliveryPointEdits)
          ? parsed.deliveryPointEdits
          : [],
        vehicleRegEdits: Array.isArray(parsed.vehicleRegEdits)
          ? parsed.vehicleRegEdits
          : [],
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    jobTransfers: [],
    deliveryPoints: [],
    deliveryPointEdits: [],
    vehicleRegEdits: [],
  };
}

function saveLocalMutations(store: MutationsStore): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors
  }
}

async function fetchMutationsStore(signal?: AbortSignal): Promise<MutationsStore> {
  try {
    const res = await fetch('/api/mutations', { signal });
    if (res.ok) {
      const data = (await res.json()) as MutationsStore;
      saveLocalMutations(data);
      return data;
    }
  } catch {
    // fallback to localStorage if offline or static
  }
  return getLocalMutations();
}

interface GvizCell {
  v?: string | number | boolean | null;
  f?: string | null;
}

interface GvizRow {
  c: Array<GvizCell | null>;
}

interface GvizCol {
  id: string;
  label: string;
  type: string;
}

interface GvizResponse {
  status: string;
  table: {
    cols: GvizCol[];
    rows: GvizRow[];
    parsedNumHeaders?: number;
  };
}

function parseGvizJson(rawText: string): GvizResponse {
  const startIdx = rawText.indexOf('{');
  const endIdx = rawText.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('รูปแบบข้อมูลตอบกลับจาก Google Sheets ไม่ถูกต้อง');
  }
  return JSON.parse(rawText.substring(startIdx, endIdx + 1)) as GvizResponse;
}

function formatGvizCellValue(cell: GvizCell | null | undefined): string {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null && String(cell.f).trim() !== '') {
    return String(cell.f).trim();
  }
  if (cell.v === undefined || cell.v === null) return '';
  const raw = String(cell.v).trim();
  const dateMatch = raw.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (dateMatch) {
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) + 1;
    const day = Number(dateMatch[3]);
    if (year === 1899 && month === 12 && day === 30 && dateMatch[4] !== undefined) {
      const hh = String(dateMatch[4]).padStart(2, '0');
      const mm = String(dateMatch[5]).padStart(2, '0');
      const ss = String(dateMatch[6]).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }
    return `${day}/${month}/${year}`;
  }
  return raw;
}

async function queryGviz(
  gid: string,
  tq: string,
  signal?: AbortSignal
): Promise<GvizResponse> {
  const params = new URLSearchParams({
    tqx: 'out:json',
    gid,
    tq,
    _t: String(Date.now()),
  });
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?${params.toString()}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`ไม่สามารถเชื่อมต่อ Google Sheets (HTTP ${response.status})`);
  }
  const text = await response.text();
  return parseGvizJson(text);
}

export async function fetchSheetRowCount(
  gid: string,
  signal?: AbortSignal
): Promise<number> {
  try {
    const res = await queryGviz(gid, 'select count(A)', signal);
    const val = res.table?.rows?.[0]?.c?.[0]?.v;
    return typeof val === 'number' ? val : 0;
  } catch {
    return 0;
  }
}

export async function fetchSheetTabData(
  tab: SheetTabConfig,
  options?: {
    limit?: number;
    remoteSearchQuery?: string;
    signal?: AbortSignal;
  }
): Promise<SheetDataResult> {
  const limit = options?.limit ?? tab.defaultLimit ?? 250;
  const search = options?.remoteSearchQuery?.trim() ?? '';

  const [totalRowsInSheet, mutations] = await Promise.all([
    fetchSheetRowCount(tab.gid, options?.signal),
    fetchMutationsStore(options?.signal),
  ]);

  let dataResponse: GvizResponse;
  let rowOffset = 0;

  if (search.length > 0 && totalRowsInSheet > limit) {
    const metaRes = await queryGviz(tab.gid, 'select * limit 1', options?.signal);
    const stringCols = (metaRes.table?.cols ?? []).filter(
      (c) => c.type === 'string' && (c.label || FALLBACK_COLUMN_LABELS[tab.gid]?.[c.id])
    );

    if (stringCols.length > 0) {
      const escaped = search.replace(/'/g, "\\'").toLowerCase();
      const whereClause = stringCols
        .map((c) => `lower(${c.id}) contains '${escaped}'`)
        .join(' or ');
      const searchTq = `select * where ${whereClause} limit ${limit}`;
      dataResponse = await queryGviz(tab.gid, searchTq, options?.signal);
    } else {
      dataResponse = await queryGviz(
        tab.gid,
        `select * limit ${limit}`,
        options?.signal
      );
    }
  } else if (tab.reverseOrder && totalRowsInSheet > limit) {
    rowOffset = Math.max(0, totalRowsInSheet - limit);
    dataResponse = await queryGviz(
      tab.gid,
      `select * offset ${rowOffset}`,
      options?.signal
    );
  } else {
    dataResponse = await queryGviz(
      tab.gid,
      `select * limit ${limit}`,
      options?.signal
    );
  }

  const rawCols = dataResponse.table?.cols ?? [];
  let rawRows = dataResponse.table?.rows ?? [];

  const hasAnyColLabel = rawCols.some((c) => c.label && c.label.trim() !== '');
  const promotedHeaderRow: Record<string, string> = {};

  if (!hasAnyColLabel && rawRows.length > 0) {
    const firstRow = rawRows[0];
    firstRow.c.forEach((cell, idx) => {
      const colId = rawCols[idx]?.id;
      const cellText = formatGvizCellValue(cell);
      if (colId && cellText) {
        promotedHeaderRow[colId] = cellText;
      }
    });
    rawRows = rawRows.slice(1);
  }

  const activeColumns: SheetColumn[] = [];
  rawCols.forEach((col, colIndex) => {
    const fallbackLabel =
      FALLBACK_COLUMN_LABELS[tab.gid]?.[col.id] ?? promotedHeaderRow[col.id] ?? '';
    const label = (col.label?.trim() || fallbackLabel).trim();

    const hasDataInRows = rawRows.some((r) => {
      const cell = r.c?.[colIndex];
      return formatGvizCellValue(cell) !== '';
    });

    if (label !== '' && (col.label?.trim() !== '' || hasDataInRows)) {
      activeColumns.push({
        id: col.id,
        label,
        type: col.type || 'string',
      });
    }
  });

  const parsedRows: SheetRow[] = [];

  rawRows.forEach((r, idx) => {
    const values: Record<string, string> = {};
    const rawValues: Record<string, string | number | null> = {};
    let hasNonEmptyValue = false;

    activeColumns.forEach((col) => {
      const colIdx = rawCols.findIndex((c) => c.id === col.id);
      const cell = colIdx >= 0 ? r.c?.[colIdx] : null;
      const formatted = formatGvizCellValue(cell);
      values[col.id] = formatted;
      rawValues[col.id] =
        typeof cell?.v === 'number' || typeof cell?.v === 'string' ? cell.v : null;
      if (formatted !== '') {
        hasNonEmptyValue = true;
      }
    });

    if (hasNonEmptyValue) {
      parsedRows.push({
        rowNumber: rowOffset + idx + 1,
        values,
        rawValues,
      });
    }
  });

  // Merge mutations for บันทึกการย้ายงาน (gid: 606634465)
  if (tab.gid === '606634465' && mutations.jobTransfers.length > 0) {
    const maxSheetRow =
      parsedRows.reduce((max, r) => Math.max(max, r.rowNumber), totalRowsInSheet) ||
      totalRowsInSheet;

    mutations.jobTransfers.forEach((jt, idx) => {
      const matchesSearch =
        !search ||
        Object.values(jt.values).some((v) =>
          v.toLowerCase().includes(search.toLowerCase())
        );
      if (matchesSearch) {
        const rawVals: Record<string, string | number | null> = {};
        Object.entries(jt.values).forEach(([k, v]) => {
          if (k === 'G' || k === 'U' || k === 'V') {
            const num = Number(v.replace(/,/g, ''));
            rawVals[k] = Number.isNaN(num) ? v : num;
          } else {
            rawVals[k] = v;
          }
        });
        parsedRows.push({
          rowNumber: Math.max(jt.rowNumber, maxSheetRow + idx + 1),
          values: { ...jt.values },
          rawValues: rawVals,
        });
      }
    });
  }

  // Merge mutations for จุดส่งสินค้า (gid: 1156877149)
  if (tab.gid === '1156877149') {
    if (mutations.deliveryPoints.length > 0) {
      const maxSheetRow =
        parsedRows.reduce((max, r) => Math.max(max, r.rowNumber), totalRowsInSheet) ||
        totalRowsInSheet;

      mutations.deliveryPoints.forEach((dp, idx) => {
        parsedRows.push({
          rowNumber: Math.max(dp.rowNumber, maxSheetRow + idx + 1),
          values: { ...dp.values },
          rawValues: { ...dp.values },
        });
      });
    }

    if (mutations.deliveryPointEdits.length > 0) {
      mutations.deliveryPointEdits.forEach((edit) => {
        for (const row of parsedRows) {
          if ((row.values['B'] ?? '').trim() === edit.deliveryPoint.trim()) {
            row.values['C'] = edit.newGate;
            row.rawValues['C'] = edit.newGate;
            if (edit.updatedDate) {
              row.values['A'] = edit.updatedDate;
              row.rawValues['A'] = edit.updatedDate;
            }
          }
        }
      });
    }
  }

  // Merge mutations for ฐานข้อมูลรถ (gid: 378250263)
  if (tab.gid === '378250263' && mutations.vehicleRegEdits.length > 0) {
    mutations.vehicleRegEdits.forEach((edit) => {
      let matched = false;
      for (const row of parsedRows) {
        const reg = (row.values['A'] ?? '').trim();
        const drv = (row.values['I'] ?? '').trim();
        const shf = (row.values['L'] ?? '').trim();
        if (
          reg === edit.oldRegistration.trim() &&
          drv === edit.driverName.trim() &&
          shf === edit.shift.trim()
        ) {
          row.values['A'] = edit.newRegistration;
          row.rawValues['A'] = edit.newRegistration;
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (const row of parsedRows) {
          const reg = (row.values['A'] ?? '').trim();
          if (reg === edit.oldRegistration.trim()) {
            row.values['A'] = edit.newRegistration;
            row.rawValues['A'] = edit.newRegistration;
            break;
          }
        }
      }
    });
  }

  if (tab.reverseOrder) {
    parsedRows.reverse();
  }

  const addedRowsCount =
    tab.gid === '606634465'
      ? mutations.jobTransfers.length
      : tab.gid === '1156877149'
        ? mutations.deliveryPoints.length
        : 0;

  return {
    sheetId: GOOGLE_SHEET_ID,
    gid: tab.gid,
    tabName: tab.name,
    columns: activeColumns,
    rows: parsedRows,
    totalRowsInSheet: Math.max(totalRowsInSheet + addedRowsCount, parsedRows.length),
    fetchedAt: new Date().toISOString(),
  };
}

export async function appendJobTransferRecord(
  payload: JobTransferPayload
): Promise<{ recordId: string; rowNumber: number }> {
  const recordId = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const transactionTimestamp = `${payload.date} ${payload.startTime}`;

  const values: Record<string, string> = {
    A: payload.date,
    B: payload.employeeId,
    C: payload.driverName,
    D: payload.vehicleNumber,
    E: payload.trailerNumber,
    F: payload.productType,
    G: String(payload.weight),
    H: payload.origin,
    I: payload.startTime,
    J: payload.destination,
    K: payload.endTime,
    L: payload.duration,
    M: payload.status,
    P: transactionTimestamp,
    Q: recordId,
    R: payload.note || '',
    S: '',
    T: '',
    U: payload.weight > 0 ? String(payload.weight) : '',
    V: String(payload.rounds || 1),
  };

  const baseRowNumber = await fetchSheetRowCount('606634465');

  try {
    const res = await fetch('/api/mutations/job-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId, baseRowNumber, values }),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        recordId: data.recordId || recordId,
        rowNumber: data.rowNumber || baseRowNumber + 1,
      };
    }
  } catch {
    // fallback to localStorage
  }

  const local = getLocalMutations();
  const rowNumber = baseRowNumber + local.jobTransfers.length + 1;
  local.jobTransfers.push({
    recordId,
    rowNumber,
    values,
    createdAt: new Date().toISOString(),
  });
  saveLocalMutations(local);

  return { recordId, rowNumber };
}

export async function completeJobTransferRecord(params: {
  recordId: string;
  rowNumber: number | null;
  endTime: string;
  duration: string;
  status?: string;
}): Promise<void> {
  const finalStatus = params.status || 'ส่งสินค้าเรียบร้อยแล้ว';

  try {
    const res = await fetch(
      `/api/mutations/job-transfer/${encodeURIComponent(params.recordId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowNumber: params.rowNumber,
          endTime: params.endTime,
          duration: params.duration,
          status: finalStatus,
        }),
      }
    );
    if (res.ok) {
      return;
    }
  } catch {
    // fallback to localStorage
  }

  const local = getLocalMutations();
  for (const item of local.jobTransfers) {
    if (
      item.recordId === params.recordId ||
      (params.rowNumber !== null && item.rowNumber === params.rowNumber)
    ) {
      item.values['K'] = params.endTime;
      item.values['L'] = params.duration;
      item.values['M'] = finalStatus;
      break;
    }
  }
  saveLocalMutations(local);
}

export async function appendDeliveryPointRecord(
  payload: DeliveryPointPayload
): Promise<void> {
  const values: Record<string, string> = {
    A: payload.date,
    B: payload.deliveryPoint,
    C: payload.gate,
  };

  const baseRowNumber = await fetchSheetRowCount('1156877149');

  try {
    const res = await fetch('/api/mutations/delivery-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRowNumber, values }),
    });
    if (res.ok) {
      return;
    }
  } catch {
    // fallback to localStorage
  }

  const local = getLocalMutations();
  local.deliveryPoints.push({
    id: Math.random().toString(16).slice(2, 10),
    rowNumber: baseRowNumber + local.deliveryPoints.length + 1,
    values,
    createdAt: new Date().toISOString(),
  });
  saveLocalMutations(local);
}

export async function updateDeliveryPointGate(params: {
  deliveryPoint: string;
  oldGate: string;
  newGate: string;
  updatedDate: string;
}): Promise<void> {
  try {
    const res = await fetch('/api/mutations/delivery-point-gate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return;
    }
  } catch {
    // fallback to localStorage
  }

  const local = getLocalMutations();
  const pt = params.deliveryPoint.trim();
  for (const dp of local.deliveryPoints) {
    if ((dp.values['B'] ?? '').trim() === pt) {
      dp.values['C'] = params.newGate.trim();
      dp.values['A'] = params.updatedDate.trim();
    }
  }
  const existingIdx = local.deliveryPointEdits.findIndex(
    (e) => e.deliveryPoint === pt
  );
  const editEntry: StoredDeliveryPointEdit = {
    deliveryPoint: pt,
    oldGate: params.oldGate.trim(),
    newGate: params.newGate.trim(),
    updatedDate: params.updatedDate.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    local.deliveryPointEdits[existingIdx] = editEntry;
  } else {
    local.deliveryPointEdits.push(editEntry);
  }
  saveLocalMutations(local);
}

export async function updateVehicleRegistration(params: {
  oldRegistration: string;
  newRegistration: string;
  driverName: string;
  shift: string;
}): Promise<void> {
  try {
    const res = await fetch('/api/mutations/vehicle-registration', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return;
    }
  } catch {
    // fallback to localStorage
  }

  const local = getLocalMutations();
  const oldReg = params.oldRegistration.trim();
  const newReg = params.newRegistration.trim();
  const drv = params.driverName.trim();
  const shf = params.shift.trim();

  const chainedIdx = local.vehicleRegEdits.findIndex(
    (e) => e.newRegistration === oldReg && e.driverName === drv && e.shift === shf
  );
  if (chainedIdx >= 0) {
    local.vehicleRegEdits[chainedIdx].newRegistration = newReg;
    local.vehicleRegEdits[chainedIdx].updatedAt = new Date().toISOString();
  } else {
    local.vehicleRegEdits.push({
      oldRegistration: oldReg,
      newRegistration: newReg,
      driverName: drv,
      shift: shf,
      updatedAt: new Date().toISOString(),
    });
  }
  saveLocalMutations(local);
}
