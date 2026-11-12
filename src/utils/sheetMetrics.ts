import { SheetRow } from '../types';

export const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

export const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/**
 * Returns current date formatted in Thai BE format (DD/MM/YYYY)
 */
export function getCurrentThaiDateString(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

/**
 * Formats a completion or approval percentage without rounding incomplete (<100%)
 * ratios up to 100%. For example, 995/1000 returns "99.5", never "100".
 */
export function formatCompletionPercentage(completed: number, total: number): string {
  if (total <= 0 || completed <= 0) return '0';
  if (completed >= total) return '100';
  const raw = (completed / total) * 100;
  // Never allow an incomplete count to round to 100%
  const capped = Math.min(99.9, Math.round(raw * 10) / 10);
  if (capped <= 0 && raw > 0) return '0.1';
  return Number.isInteger(capped) ? String(capped) : capped.toFixed(1);
}

/**
 * Checks whether a value in the เบอร์หาง (Col E) column is a genuine trailer code
 * rather than a misplaced note/symptom (e.g., "ยางรั่ว", "อื่นๆ").
 */
export function isValidTrailerCode(raw: unknown): boolean {
  const val = String(raw ?? '').trim();
  if (!val || val === '-' || val === 'ไม่มี' || val === 'ไม่มีหาง') return false;
  if (/^(TTL|TRL|TR|TL|T-|หาง)/i.test(val)) return true;
  if (/^\d{2,3}-\d{3,4}$/.test(val)) return true;
  if (/^[A-Z]{1,4}\s*-?\s*\d{1,4}$/i.test(val) && !/^FL/i.test(val)) return true;
  return false;
}

/**
 * Parses a numeric cell safely (stripping commas, currency symbols, and units).
 */
export function parseNumericCell(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (val === null || val === undefined) return 0;
  const cleaned = String(val).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!cleaned) return 0;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Centralized approval status parser for บันทึกงานซ่อม (gid: 944294225).
 * Shared across App.tsx, ManagerApprovalModal.tsx, and MaintenanceCalendarView.tsx.
 */
export function getRowApprovalStatus(row: SheetRow): string {
  const appStatus = (row.values['AI'] ?? '').trim();
  const repairStatus = (row.values['P'] ?? '').trim();
  const inspector = (row.values['AB'] ?? '').trim();
  const replyText = (row.values['AM'] ?? '').trim();

  if (
    appStatus === 'รอตรวจสอบ' ||
    repairStatus === 'รอตรวจสอบ' ||
    (!appStatus && !inspector)
  ) {
    return 'รอตรวจสอบ';
  }
  if (appStatus.includes('ไม่อนุมัติ')) return 'ไม่อนุมัติ';
  if (
    appStatus.includes('อนุมัติ') &&
    !appStatus.includes('ไม่อนุมัติ') &&
    !appStatus.includes('รอ') &&
    !appStatus.includes('ตอบกลับ')
  ) {
    return 'อนุมัติ';
  }
  const isReplied = appStatus.includes('ตอบกลับ') || Boolean(replyText);
  if (isReplied) return 'ตอบกลับข้อมูลเพิ่มเติมแล้ว';
  if (appStatus.includes('ขอข้อมูล')) return 'ขอข้อมูลเพิ่มเติม';
  if (
    !appStatus ||
    appStatus.includes('รออนุมัติ') ||
    appStatus.includes('รอพิจารณา') ||
    appStatus.includes('รอ')
  ) {
    return 'รออนุมัติ';
  }
  return appStatus.replace(/^\d+\.\s*/, '').trim();
}

/**
 * Checks whether a repair row (gid: 944294225) is pending manager approval
 * (passed inspector check and awaiting manager decision).
 */
export function isRowPendingManagerApproval(row: SheetRow): boolean {
  const st = getRowApprovalStatus(row);
  return (
    st === 'รออนุมัติ' ||
    st === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว' ||
    st === 'ขอข้อมูลเพิ่มเติม' ||
    st === 'รอพิจารณา'
  );
}

/**
 * Filters repair rows that are pending manager approval.
 */
export function filterPendingApprovalRows(rows: SheetRow[]): SheetRow[] {
  return rows.filter(isRowPendingManagerApproval);
}

/**
 * Counts how many repair rows are currently pending manager approval.
 */
export function calculatePendingApprovalCount(rows: SheetRow[]): number {
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (isRowPendingManagerApproval(rows[i])) {
      count++;
    }
  }
  return count;
}

export interface ParsedGregorianDate {
  ymd: string;
  year: number;
  month: number;
  day: number;
  timestamp: number;
}

/**
 * Centralized Thai / Gregorian date parser shared across App.tsx,
 * MaintenanceCalendarView.tsx, and FuelMonthlySummaryView.tsx.
 */
export function parseThaiDateToGregorianYmd(
  rawDate: unknown,
  rawMonthCol?: string
): ParsedGregorianDate | null {
  if (!rawDate) return null;
  const trimmed = String(rawDate).trim();
  if (!trimmed || trimmed === '-') return null;

  // 1. Check Date(YYYY, M, D) GViz format
  const gvizMatch = trimmed.match(/^Date\((\d+),\s*(\d+),\s*(\d+)/i);
  if (gvizMatch) {
    let year = parseInt(gvizMatch[1], 10);
    const month = parseInt(gvizMatch[2], 10) + 1;
    const day = parseInt(gvizMatch[3], 10);
    if (year > 2400) year -= 543;
    if (year < 100) year += 2000;
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timestamp = new Date(year, month - 1, day).setHours(0, 0, 0, 0);
    return { ymd, year, month, day, timestamp };
  }

  // 2. Check D/M/YYYY or DD-MM-YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;

    let day = p1;
    let month = p2;

    if (rawMonthCol && p1 <= 12 && p2 <= 31 && p1 !== p2) {
      for (let m = 1; m <= 12; m++) {
        if (
          rawMonthCol.includes(`${m}.`) ||
          rawMonthCol.includes(THAI_MONTHS_FULL[m - 1])
        ) {
          if (p1 === m) {
            month = p1;
            day = p2;
          } else if (p2 === m) {
            month = p2;
            day = p1;
          }
          break;
        }
      }
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const timestamp = new Date(year, month - 1, day).setHours(0, 0, 0, 0);
      return { ymd, year, month, day, timestamp };
    }
  }

  // 3. Check ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    let year = parseInt(isoMatch[1], 10);
    if (year > 2400) year -= 543;
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const timestamp = new Date(year, month - 1, day).setHours(0, 0, 0, 0);
      return { ymd, year, month, day, timestamp };
    }
  }

  return null;
}

export function parseThaiDateToTimestamp(val: string): number | null {
  const parsed = parseThaiDateToGregorianYmd(val);
  return parsed ? parsed.timestamp : null;
}

export interface VehiclePmStatusItem {
  row: SheetRow;
  seq: string;
  dateStr: string;
  vehicleNo: string;
  prevMileage: number;
  currMileage: number;
  diffMileage: number;
  pmCycle: string;
  statusText: string;
  isDue: boolean;
  latestPmRepairRow?: SheetRow;
  latestPmRepairDate?: string;
  latestPmRepairStatus?: string;
}

/**
 * Centralized evaluation of กำหนดรอบPM (gid: 1032541508) cross-referenced with บันทึกงานซ่อม (gid: 944294225).
 */
export function evaluateVehiclePmList(
  pmSheetRows: SheetRow[],
  repairRows: SheetRow[]
): VehiclePmStatusItem[] {
  const latestPmByVehicle = new Map<
    string,
    { row: SheetRow; dateStr: string; status: string; ymd: string }
  >();

  for (let i = 0; i < repairRows.length; i++) {
    const r = repairRows[i];
    const veh = (r.values['D'] ?? '').trim().toUpperCase();
    const rType = (r.values['E'] ?? '').trim();
    const symptom = (r.values['F'] ?? '').trim();
    const isPm =
      rType.includes('PM') ||
      rType.includes('ซ่อมเชิงป้องกัน') ||
      symptom.toUpperCase().includes('PM');
    if (!veh || !isPm) continue;

    const rawDate = (r.values['B'] ?? '').trim();
    const parsed = parseThaiDateToGregorianYmd(rawDate);
    const ymd = parsed?.ymd ?? '';
    const existing = latestPmByVehicle.get(veh);
    if (!existing || ymd >= existing.ymd) {
      latestPmByVehicle.set(veh, {
        row: r,
        dateStr: rawDate,
        status: (r.values['P'] ?? '').trim() || getRowApprovalStatus(r),
        ymd,
      });
    }
  }

  return pmSheetRows
    .map((r): VehiclePmStatusItem | null => {
      const vehicleNo = (r.values['C'] ?? '').trim();
      if (!vehicleNo) return null;
      const seq = (r.values['A'] ?? String(r.rowNumber)).trim();
      const dateStr = (r.values['B'] ?? '').trim();
      const prevMileage = parseNumericCell(r.rawValues['D'] ?? r.values['D']);
      const currMileage = parseNumericCell(r.rawValues['E'] ?? r.values['E']);
      const diffMileage = currMileage > prevMileage ? currMileage - prevMileage : 0;
      const pmCycle = (r.values['F'] ?? '').trim();
      const statusText = (r.values['G'] ?? '').trim();
      const isDue =
        statusText.includes('ครบรอบ') && !statusText.includes('ยังไม่ครบ');

      const latestPm = latestPmByVehicle.get(vehicleNo.toUpperCase());

      return {
        row: r,
        seq,
        dateStr,
        vehicleNo,
        prevMileage,
        currMileage,
        diffMileage,
        pmCycle,
        statusText: statusText || (isDue ? '⚠️ ครบรอบPM' : '❌ ยังไม่ครบกำหนดPM'),
        isDue,
        latestPmRepairRow: latestPm?.row,
        latestPmRepairDate: latestPm?.dateStr,
        latestPmRepairStatus: latestPm?.status,
      };
    })
    .filter((item): item is VehiclePmStatusItem => item !== null)
    .sort((a, b) => {
      if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
      return b.diffMileage - a.diffMileage;
    });
}
