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

async function queryGviz(gid: string, tq: string, signal?: AbortSignal): Promise<GvizResponse> {
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

export async function fetchSheetRowCount(gid: string, signal?: AbortSignal): Promise<number> {
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
      dataResponse = await queryGviz(tab.gid, `select * limit ${limit}`, options?.signal);
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
  payload: JobTransferPayload,
  accessToken: string
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
    '', // N
    '', // O
    transactionTimestamp, // P: วันเวลาทำรายการ
    recordId, // Q: รหัสรายการ (ID)
    payload.note || '', // R: หมายเหตุ
    '', // S: ภาพถ่ายที่ 1
    '', // T: ภาพถ่ายที่ 2
    payload.weight > 0 ? payload.weight : '', // U: น้ำหนักสุทธิ
    payload.rounds || 1, // V: จำนวนรอบ
  ];

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
    let errorMsg = `ไม่สามารถบันทึกข้อมูลลง Google Sheets (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      // ignore json parse error
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

  return { recordId, rowNumber };
}

export async function completeJobTransferRecord(
  params: {
    rowNumber: number;
    endTime: string;
    duration: string;
    status?: string;
  },
  accessToken: string
): Promise<void> {
  const finalStatus = params.status || 'ส่งสินค้าเรียบร้อยแล้ว';
  const targetRange = encodeURIComponent(
    `บันทึกการย้ายงาน!K${params.rowNumber}:M${params.rowNumber}`
  );
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${targetRange}?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [[params.endTime, params.duration, finalStatus]],
    }),
  });

  if (!response.ok) {
    let errorMsg = `ไม่สามารถอัปเดตสถานะจบงานลง Google Sheets (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }
}

export async function appendDeliveryPointRecord(
  payload: DeliveryPointPayload,
  accessToken: string
): Promise<void> {
  const rowValues: Array<string> = [
    payload.date, // A: วันที่
    payload.deliveryPoint, // B: จุดส่งสินค้า
    payload.gate, // C: ประตู
  ];

  const range = encodeURIComponent('จุดส่งสินค้า!A:A');
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
    let errorMsg = `ไม่สามารถบันทึกจุดส่งสินค้าลง Google Sheets (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }
}

export async function updateDeliveryPointGate(
  params: {
    deliveryPoint: string;
    oldGate: string;
    newGate: string;
    updatedDate: string;
  },
  accessToken: string
): Promise<void> {
  const readRange = encodeURIComponent('จุดส่งสินค้า!A:C');
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;

  const readRes = await fetch(readUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!readRes.ok) {
    throw new Error(`ไม่สามารถอ่านตำแหน่งแถวของจุดส่งสินค้าได้ (HTTP ${readRes.status})`);
  }

  const readJson = await readRes.json();
  const rows: string[][] = readJson?.values ?? [];

  let matchedIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const pt = (row[1] ?? '').trim();
    const gt = (row[2] ?? '').trim();
    if (pt === params.deliveryPoint.trim() && gt === params.oldGate.trim()) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const pt = (row[1] ?? '').trim();
      if (pt === params.deliveryPoint.trim()) {
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
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [[params.updatedDate, params.deliveryPoint.trim(), params.newGate.trim()]],
    }),
  });

  if (!updateRes.ok) {
    let errorMsg = `ไม่สามารถอัปเดตข้อมูลประตูลง Google Sheets (HTTP ${updateRes.status})`;
    try {
      const errJson = await updateRes.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }
}




