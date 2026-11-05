import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  DeliveryPointPayload,
  JobTransferPayload,
  SheetColumn,
  SheetDataResult,
  SheetRow,
  SheetTabConfig,
} from '../types';

export const GOOGLE_SHEET_ID = '1Dn72dYdEGz3GBvk3O5n1FN0RCKv5S1IvgLeA5M5RzWc';
export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => {
  provider.addScope(scope);
});

let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

async function getServerCachedToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/google-token');
    if (res.ok) {
      const data = (await res.json()) as {
        accessToken?: string | null;
        expiresAt?: number;
      };
      if (
        data.accessToken &&
        data.expiresAt &&
        data.expiresAt > Date.now() + 30000
      ) {
        cachedAccessToken = data.accessToken;
        cachedTokenExpiresAt = data.expiresAt;
        return data.accessToken;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function saveServerCachedToken(
  token: string,
  expiresInSec = 3500
): Promise<void> {
  cachedAccessToken = token;
  cachedTokenExpiresAt = Date.now() + expiresInSec * 1000;
  try {
    await fetch('/api/google-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, expiresInSec }),
    });
  } catch {
    // ignore
  }
}

export async function ensureGoogleSheetsAccessToken(
  forceNew = false
): Promise<string> {
  if (
    !forceNew &&
    cachedAccessToken &&
    cachedTokenExpiresAt > Date.now() + 30000
  ) {
    return cachedAccessToken;
  }

  if (!forceNew) {
    const serverToken = await getServerCachedToken();
    if (serverToken) {
      return serverToken;
    }
  }

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่สามารถรับสิทธิ์เชื่อมต่อ Google Sheets ได้ กรุณาลองอีกครั้ง');
    }
    await saveServerCachedToken(credential.accessToken, 3500);
    await flushPendingJobTransfersToGoogleSheet(credential.accessToken);
    return credential.accessToken;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `โดเมน ${window.location.hostname} ยังไม่ได้เพิ่มใน Firebase Console -> Authentication -> Settings -> Authorized domains (โปรเจกต์ ${firebaseConfig.projectId})`
      );
    }
    if (code === 'auth/popup-closed-by-user') {
      throw new Error(
        'หน้าต่างยืนยันสิทธิ์ Google ถูกปิดก่อนเสร็จสิ้น กรุณากดยืนยันอีกครั้งเพื่อบันทึกข้อมูลลง Google Sheets'
      );
    }
    throw err instanceof Error
      ? err
      : new Error('ไม่สามารถยืนยันสิทธิ์เชื่อมต่อ Google Sheets ได้');
  }
}

function invalidateCachedToken(): void {
  cachedAccessToken = null;
  cachedTokenExpiresAt = 0;
}

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
    R: 'หมายเหตุ',
    U: 'น้ำหนักสุทธิ',
    V: 'จำนวนรอบ',
  },
  '1295975917': {
    A: 'หมายเลขหางพ่วง',
  },
};

const HIDDEN_COLUMN_IDS: Record<string, Set<string>> = {
  '606634465': new Set(['P', 'Q', 'R', 'S', 'T']),
};

const HIDDEN_COLUMN_LABELS: Record<string, Set<string>> = {
  '606634465': new Set([
    'วันเวลาทำรายการ',
    'รหัสรายการ',
    'ภาพถ่ายที่ 1',
    'ภาพถ่ายที่ 2',
  ]),
};

interface StoredJobTransfer {
  recordId: string;
  rowNumber: number;
  values: Record<string, string>;
  createdAt: string;
  syncedToSheet?: boolean;
}

interface MutationsStore {
  jobTransfers: StoredJobTransfer[];
}

async function fetchMutationsStore(signal?: AbortSignal): Promise<MutationsStore> {
  try {
    const res = await fetch('/api/mutations', { signal });
    if (res.ok) {
      return (await res.json()) as MutationsStore;
    }
  } catch {
    // ignore
  }
  return { jobTransfers: [] };
}

async function postJobTransferRowToGoogleSheetsApi(
  rowValues: Array<string | number>,
  accessToken: string
): Promise<number | null> {
  const range = encodeURIComponent('บันทึกการย้ายงาน!A:A');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [rowValues],
    }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      invalidateCachedToken();
    }
    let errorMsg = `ไม่สามารถบันทึกข้อมูลลง Google Sheets (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  let rowNumber: number | null = null;
  try {
    const resJson = await response.json();
    const updatedRange: string = resJson?.updates?.updatedRange ?? '';
    const match = updatedRange.match(/![A-Z]+(\d+)/i);
    if (match && match[1]) {
      rowNumber = parseInt(match[1], 10);
    }
  } catch {
    // ignore parse error
  }
  return rowNumber;
}

async function flushPendingJobTransfersToGoogleSheet(
  accessToken: string
): Promise<void> {
  try {
    const store = await fetchMutationsStore();
    for (const jt of store.jobTransfers) {
      if (jt.syncedToSheet) continue;
      const v = jt.values;
      const weightNum = Number((v['G'] ?? '0').replace(/,/g, '')) || 0;
      const roundsNum = Number((v['V'] ?? '1').replace(/,/g, '')) || 1;
      const noteText = v['N'] || v['R'] || '';
      const rowValues: Array<string | number> = [
        v['A'] ?? '',
        v['B'] ?? '',
        v['C'] ?? '',
        v['D'] ?? '',
        v['E'] ?? '',
        v['F'] ?? '',
        weightNum,
        v['H'] ?? '',
        v['I'] ?? '',
        v['J'] ?? '',
        v['K'] ?? '',
        v['L'] ?? '',
        v['M'] ?? '',
        noteText,
        '',
        v['P'] ?? `${v['A'] ?? ''} ${v['I'] ?? ''}`.trim(),
        jt.recordId,
        noteText,
        '',
        '',
        weightNum > 0 ? weightNum : '',
        roundsNum,
      ];
      const sheetRowNumber = await postJobTransferRowToGoogleSheetsApi(
        rowValues,
        accessToken
      );
      await fetch('/api/mutations/mark-synced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: jt.recordId,
          sheetRowNumber,
        }),
      });
    }
  } catch {
    // ignore background sync errors
  }
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

  const totalRowsInSheet = await fetchSheetRowCount(tab.gid, options?.signal);

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
    if (HIDDEN_COLUMN_IDS[tab.gid]?.has(col.id)) {
      return;
    }

    const fallbackLabel =
      FALLBACK_COLUMN_LABELS[tab.gid]?.[col.id] ?? promotedHeaderRow[col.id] ?? '';
    const label = (col.label?.trim() || fallbackLabel).trim();

    if (HIDDEN_COLUMN_LABELS[tab.gid]?.has(label)) {
      return;
    }

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

  // In ฐานข้อมูลรถ (gid: 378250263), place employee name column (Col I: ชื่อพนักงานประจำรถ) right after ทะเบียนรถ (Col A)
  if (tab.gid === '378250263') {
    const regIdx = activeColumns.findIndex((c) => c.id === 'A');
    const empIdx = activeColumns.findIndex((c) => c.id === 'I');
    if (regIdx !== -1 && empIdx !== -1 && empIdx !== regIdx + 1) {
      const [empCol] = activeColumns.splice(empIdx, 1);
      const targetIdx = activeColumns.findIndex((c) => c.id === 'A');
      activeColumns.splice(targetIdx + 1, 0, empCol);
    }
  }

  const parsedRows: SheetRow[] = [];

  const colIdxR =
    tab.gid === '606634465' ? rawCols.findIndex((c) => c.id === 'R') : -1;

  rawRows.forEach((r, idx) => {
    const values: Record<string, string> = {};
    const rawValues: Record<string, string | number | null> = {};
    let hasNonEmptyValue = false;

    activeColumns.forEach((col) => {
      const colIdx = rawCols.findIndex((c) => c.id === col.id);
      const cell = colIdx >= 0 ? r.c?.[colIdx] : null;
      let formatted = formatGvizCellValue(cell);
      if (tab.gid === '606634465' && col.id === 'N' && !formatted && colIdxR >= 0) {
        formatted = formatGvizCellValue(r.c?.[colIdxR]);
      }
      values[col.id] = formatted;
      rawValues[col.id] =
        typeof cell?.v === 'number' || typeof cell?.v === 'string'
          ? cell.v
          : formatted || null;
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

  if (tab.reverseOrder) {
    parsedRows.reverse();
  }

  return {
    sheetId: GOOGLE_SHEET_ID,
    gid: tab.gid,
    tabName: tab.name,
    columns: activeColumns,
    rows: parsedRows,
    totalRowsInSheet: Math.max(totalRowsInSheet, parsedRows.length),
    fetchedAt: new Date().toISOString(),
  };
}

export async function appendJobTransferRecord(
  payload: JobTransferPayload
): Promise<{ recordId: string; rowNumber: number | null }> {
  const recordId = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const transactionTimestamp = `${payload.date} ${payload.startTime}`;

  const rowValues: Array<string | number> = [
    payload.date, // A: วันที่
    payload.employeeId, // B: รหัสพนักงาน
    payload.driverName, // C: ชื่อพนักงานขับรถ
    payload.vehicleNumber, // D: เบอร์รถ
    payload.trailerNumber, // E: เบอร์หาง
    payload.productType, // F: ประเภทสินค้า
    payload.weight, // G: น้ำหนัก
    payload.origin, // H: ต้นทาง
    payload.startTime, // I: เวลาเริ่ม
    payload.destination, // J: ปลายทาง
    payload.endTime, // K: เวลาจบ
    payload.duration, // L: เวลาที่ใช้
    payload.status, // M: สถานะ
    payload.note || '', // N: หมายเหตุ
    '', // O
    transactionTimestamp, // P: วันเวลาทำรายการ
    recordId, // Q: รหัสรายการ (ID)
    payload.note || '', // R: หมายเหตุ
    '', // S: ภาพถ่ายที่ 1
    '', // T: ภาพถ่ายที่ 2
    payload.weight > 0 ? payload.weight : '', // U: น้ำหนักสุทธิ
    payload.rounds || 1, // V: จำนวนรอบ
  ];

  let accessToken = await ensureGoogleSheetsAccessToken(false);
  try {
    const rowNumber = await postJobTransferRowToGoogleSheetsApi(
      rowValues,
      accessToken
    );
    return { recordId, rowNumber };
  } catch (err: unknown) {
    // Retry once with fresh popup token if cached token expired
    accessToken = await ensureGoogleSheetsAccessToken(true);
    const rowNumber = await postJobTransferRowToGoogleSheetsApi(
      rowValues,
      accessToken
    );
    return { recordId, rowNumber };
  }
}

export async function completeJobTransferRecord(params: {
  recordId: string;
  rowNumber: number | null;
  endTime: string;
  duration: string;
  status?: string;
}): Promise<void> {
  const finalStatus = params.status || 'ส่งสินค้าเรียบร้อยแล้ว';
  if (!params.rowNumber || params.rowNumber <= 0) {
    throw new Error('ไม่พบหมายเลขแถวของรายการที่จะจบงานใน Google Sheets');
  }

  const executePut = async (token: string) => {
    const targetRange = encodeURIComponent(
      `บันทึกการย้ายงาน!K${params.rowNumber}:M${params.rowNumber}`
    );
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${targetRange}?valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[params.endTime, params.duration, finalStatus]],
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        invalidateCachedToken();
      }
      let errorMsg = `ไม่สามารถอัปเดตสถานะจบงานลง Google Sheets (HTTP ${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }
  };

  let accessToken = await ensureGoogleSheetsAccessToken(false);
  try {
    await executePut(accessToken);
  } catch {
    accessToken = await ensureGoogleSheetsAccessToken(true);
    await executePut(accessToken);
  }
}

export async function appendDeliveryPointRecord(
  payload: DeliveryPointPayload
): Promise<void> {
  const executePost = async (token: string) => {
    const range = encodeURIComponent('จุดส่งสินค้า!A:A');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[payload.date, payload.deliveryPoint, payload.gate]],
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        invalidateCachedToken();
      }
      let errorMsg = `ไม่สามารถบันทึกจุดส่งสินค้าลง Google Sheets (HTTP ${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson?.error?.message) {
          errorMsg = errJson.error.message;
        }
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }
  };

  let accessToken = await ensureGoogleSheetsAccessToken(false);
  try {
    await executePost(accessToken);
  } catch {
    accessToken = await ensureGoogleSheetsAccessToken(true);
    await executePost(accessToken);
  }
}

export async function updateDeliveryPointGate(params: {
  deliveryPoint: string;
  oldGate: string;
  newGate: string;
  updatedDate: string;
}): Promise<void> {
  const executeUpdate = async (token: string) => {
    const readRange = encodeURIComponent('จุดส่งสินค้า!A:C');
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
    const readRes = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!readRes.ok) {
      if (readRes.status === 401 || readRes.status === 403) {
        invalidateCachedToken();
      }
      throw new Error(`ไม่สามารถอ่านตำแหน่งแถวของจุดส่งสินค้าได้ (HTTP ${readRes.status})`);
    }
    const readJson = await readRes.json();
    const rows: string[][] = readJson?.values ?? [];
    let matchedIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (
        (row[1] ?? '').trim() === params.deliveryPoint.trim() &&
        (row[2] ?? '').trim() === params.oldGate.trim()
      ) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex === -1) {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] ?? [];
        if ((row[1] ?? '').trim() === params.deliveryPoint.trim()) {
          matchedIndex = i;
          break;
        }
      }
    }
    if (matchedIndex === -1) {
      throw new Error(`ไม่พบรายการจุดส่งสินค้า "${params.deliveryPoint}" ในชีต`);
    }

    const sheetRowNumber = matchedIndex + 1;
    const updateRange = encodeURIComponent(
      `จุดส่งสินค้า!A${sheetRowNumber}:C${sheetRowNumber}`
    );
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [
          [
            params.updatedDate,
            params.deliveryPoint.trim(),
            params.newGate.trim(),
          ],
        ],
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`ไม่สามารถอัปเดตข้อมูลประตูลง Google Sheets (HTTP ${updateRes.status})`);
    }
  };

  let accessToken = await ensureGoogleSheetsAccessToken(false);
  try {
    await executeUpdate(accessToken);
  } catch {
    accessToken = await ensureGoogleSheetsAccessToken(true);
    await executeUpdate(accessToken);
  }
}

export async function updateVehicleRegistration(params: {
  oldRegistration: string;
  newRegistration: string;
  driverName: string;
  shift: string;
}): Promise<void> {
  const executeUpdate = async (token: string) => {
    const readRange = encodeURIComponent('ฐานข้อมูลรถ!A:L');
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
    const readRes = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!readRes.ok) {
      if (readRes.status === 401 || readRes.status === 403) {
        invalidateCachedToken();
      }
      throw new Error(`ไม่สามารถอ่านตำแหน่งแถวของฐานข้อมูลรถได้ (HTTP ${readRes.status})`);
    }

    const readJson = await readRes.json();
    const rows: string[][] = readJson?.values ?? [];
    let matchedIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      if (
        (row[0] ?? '').trim() === params.oldRegistration.trim() &&
        (row[8] ?? '').trim() === params.driverName.trim() &&
        (row[11] ?? '').trim() === params.shift.trim()
      ) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex === -1) {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] ?? [];
        if ((row[0] ?? '').trim() === params.oldRegistration.trim()) {
          matchedIndex = i;
          break;
        }
      }
    }
    if (matchedIndex === -1) {
      throw new Error(`ไม่พบข้อมูลทะเบียนรถ "${params.oldRegistration}" ในชีต`);
    }

    const sheetRowNumber = matchedIndex + 1;
    const updateRange = encodeURIComponent(`ฐานข้อมูลรถ!A${sheetRowNumber}`);
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[params.newRegistration.trim()]],
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`ไม่สามารถอัปเดตทะเบียนรถลง Google Sheets (HTTP ${updateRes.status})`);
    }
  };

  let accessToken = await ensureGoogleSheetsAccessToken(false);
  try {
    await executeUpdate(accessToken);
  } catch {
    accessToken = await ensureGoogleSheetsAccessToken(true);
    await executeUpdate(accessToken);
  }
}

export async function updateJobTransferNote(params: {
  rowNumber: number;
  date: string;
  driverName: string;
  vehicleNumber: string;
  startTime: string;
  note: string;
}): Promise<void> {
  const executeUpdate = async (token: string) => {
    const startSearchRow = Math.max(2, params.rowNumber - 100);
    const endSearchRow = params.rowNumber + 150;
    const readRange = encodeURIComponent(
      `บันทึกการย้ายงาน!A${startSearchRow}:I${endSearchRow}`
    );
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
    const readRes = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!readRes.ok) {
      if (readRes.status === 401 || readRes.status === 403) {
        invalidateCachedToken();
      }
      throw new Error(`ไม่สามารถอ่านตำแหน่งแถวของบันทึกการย้ายงานได้ (HTTP ${readRes.status})`);
    }

    const readJson = await readRes.json();
    const rows: string[][] = readJson?.values ?? [];
    let exactSheetRow = -1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const dt = (row[0] ?? '').trim();
      const drv = (row[2] ?? '').trim();
      const veh = (row[3] ?? '').trim();
      const st = (row[8] ?? '').trim();
      if (
        dt === params.date.trim() &&
        drv === params.driverName.trim() &&
        veh === params.vehicleNumber.trim() &&
        st === params.startTime.trim()
      ) {
        exactSheetRow = startSearchRow + i;
        break;
      }
    }

    if (exactSheetRow === -1) {
      exactSheetRow = params.rowNumber;
    }

    const updateRange = encodeURIComponent(`บันทึกการย้ายงาน!N${exactSheetRow}`);
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
    const updateRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[params.note.trim()]],
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`ไม่สามารถบันทึกหมายเหตุลง Google Sheets (HTTP ${updateRes.status})`);
    }
  };

  let accessToken = await ensureGoogleSheetsAccessToken(false);
  try {
    await executeUpdate(accessToken);
  } catch {
    accessToken = await ensureGoogleSheetsAccessToken(true);
    await executeUpdate(accessToken);
  }
}
