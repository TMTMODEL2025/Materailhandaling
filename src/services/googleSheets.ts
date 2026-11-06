import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
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

// In-memory OAuth token cache (never required for normal app usage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

onAuthStateChanged(auth, (user: User | null) => {
  if (!user && !isSigningIn) {
    cachedAccessToken = null;
    cachedTokenExpiresAt = 0;
  }
});

const APPS_SCRIPT_URL_STORAGE_KEY = 'gsheets_apps_script_url_v1';
const LOCAL_MUTATIONS_STORAGE_KEY = 'gsheets_local_mutations_v2';

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbz8e9-5I7UphS_hZvyh5YhC_v6yWSe7e7VFRK3BIKqEihMGab4RsOlQwll5sk_WlQZi/exec';

let configuredAppsScriptUrl: string =
  (import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined)?.trim() ||
  DEFAULT_APPS_SCRIPT_URL;

try {
  const savedUrl = localStorage.getItem(APPS_SCRIPT_URL_STORAGE_KEY)?.trim();
  if (savedUrl && savedUrl.startsWith('https://script.google.com/')) {
    configuredAppsScriptUrl = savedUrl;
  } else if (!savedUrl) {
    localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, DEFAULT_APPS_SCRIPT_URL);
  }
} catch {
  // ignore storage errors
}

export function getConfiguredAppsScriptUrl(): string {
  return configuredAppsScriptUrl || DEFAULT_APPS_SCRIPT_URL;
}

export async function saveConfiguredAppsScriptUrl(url: string): Promise<void> {
  const clean = url.trim();
  configuredAppsScriptUrl = clean;
  try {
    if (clean) {
      localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(APPS_SCRIPT_URL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }

  void fetch('/api/script-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptUrl: clean }),
  }).catch(() => {
    // ignore on static hosting
  });

  if (clean && clean.startsWith('https://script.google.com/')) {
    try {
      await callAppsScriptWebhook(clean, {
        action: 'registerWebhookUrl',
        url: clean,
      });
    } catch {
      // ignore if script doesn't support registerWebhookUrl yet
    }
    void flushPendingMutationsToGoogleSheet();
  }
}

export const GOOGLE_APPS_SCRIPT_CODE = `// โค้ดสำหรับเชื่อมต่อ Google Sheets แบบไม่ต้องยืนยันสิทธิ์ล็อกอิน (No-Login)
// วิธีติดตั้งเพียงครั้งเดียว:
// 1. เปิดไฟล์ Google Sheet -> เมนู "ส่วนขยาย (Extensions)" -> "Apps Script"
// 2. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดนี้ลงไป กดบันทึก (Ctrl+S)
// 3. กดปุ่ม "การทำให้ใช้งานได้ (Deploy)" มุมขวาบน -> "การทำให้ใช้งานได้รายการใหม่ (New deployment)"
// 4. เลือกประเภทเป็น "เว็บแอป (Web app)"
//    - ดำเนินการในฐานะ (Execute as): เลือก "ฉัน (Me)"
//    - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): เลือก "ทุกคน (Anyone)"
// 5. กด "การทำให้ใช้งานได้ (Deploy)" แล้วคัดลอก URL ของเว็บแอปมาวางในแอป 1 ครั้ง (หรือกดเรียกใช้ฟังก์ชัน เชื่อมต่ออัตโนมัติ ด้านล่าง)

const SHEET_ID = '${GOOGLE_SHEET_ID}';
const DRIVE_FOLDER_ID = '1y9_CzTkunm85vparUxDGg_lvCH0sa6P0';

function saveBase64ImageToDrive(base64Data, prefix) {
  if (!base64Data || typeof base64Data !== 'string') return '';
  if (base64Data.indexOf('http') === 0) return base64Data;
  if (base64Data.indexOf('data:image') !== 0) return base64Data;

  try {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var parts = base64Data.split(',');
    var contentType = parts[0].split(':')[1].split(';')[0];
    var decoded = Utilities.base64Decode(parts[1]);
    var ext = contentType.indexOf('png') >= 0 ? 'png' : 'jpg';
    var fileName = (prefix || 'repair') + '_' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000) + '.' + ext;
    var blob = Utilities.newBlob(decoded, contentType, fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch (err) {
    return '';
  }
}

function เชื่อมต่ออัตโนมัติ() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const url = ScriptApp.getService().getUrl();
  if (url) {
    const dpSheet = ss.getSheetByName('จุดส่งสินค้า');
    if (dpSheet) {
      dpSheet.getRange('D1').setValue(url);
    }
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    const ss = SpreadsheetApp.openById(SHEET_ID);

    if (action === 'registerWebhookUrl') {
      const dpSheet = ss.getSheetByName('จุดส่งสินค้า');
      if (dpSheet && body.url) {
        dpSheet.getRange('D1').setValue(String(body.url).trim());
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'appendJobTransfer') {
      const sheet = ss.getSheetByName('บันทึกการย้ายงาน');
      const rowValues = body.rowValues || [];
      sheet.appendRow(rowValues);
      const rowNumber = sheet.getLastRow();
      return jsonResponse({ ok: true, rowNumber: rowNumber });
    }

    if (action === 'completeJobTransfer') {
      const sheet = ss.getSheetByName('บันทึกการย้ายงาน');
      const lastRow = sheet.getLastRow();
      let targetRow = Number(body.rowNumber) || 0;
      const recordId = String(body.recordId || '').trim();

      if (recordId && lastRow >= 2) {
        const startRow = Math.max(2, lastRow - 300);
        const numRows = lastRow - startRow + 1;
        const ids = sheet.getRange(startRow, 17, numRows, 1).getValues();
        for (let i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0] || '').trim() === recordId) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        sheet.getRange(targetRow, 11, 1, 3).setValues([[
          body.endTime || '',
          body.duration || '',
          body.status || 'ส่งสินค้าเรียบร้อยแล้ว'
        ]]);
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'appendDeliveryPoint') {
      const sheet = ss.getSheetByName('จุดส่งสินค้า');
      sheet.appendRow([body.date || '', body.deliveryPoint || '', body.gate || '']);
      return jsonResponse({ ok: true, rowNumber: sheet.getLastRow() });
    }

    if (action === 'updateDeliveryPointGate') {
      const sheet = ss.getSheetByName('จุดส่งสินค้า');
      const rows = sheet.getDataRange().getValues();
      const pt = String(body.deliveryPoint || '').trim();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1] || '').trim() === pt) {
          sheet.getRange(i + 1, 1, 1, 3).setValues([[
            body.updatedDate || rows[i][0],
            pt,
            String(body.newGate || '').trim()
          ]]);
          break;
        }
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'updateVehicleRegistration') {
      const sheet = ss.getSheetByName('ฐานข้อมูลรถ');
      const rows = sheet.getDataRange().getValues();
      const oldReg = String(body.oldRegistration || '').trim();
      const newReg = String(body.newRegistration || '').trim();
      const drv = String(body.driverName || '').trim();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() === oldReg && (!drv || String(rows[i][8] || '').trim() === drv)) {
          sheet.getRange(i + 1, 1).setValue(newReg);
          break;
        }
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'updateJobTransferNote') {
      const sheet = ss.getSheetByName('บันทึกการย้ายงาน');
      const lastRow = sheet.getLastRow();
      let targetRow = Number(body.rowNumber) || 0;
      const startRow = Math.max(2, (targetRow || lastRow) - 150);
      const endRow = Math.min(lastRow, (targetRow || lastRow) + 150);
      if (endRow >= startRow) {
        const data = sheet.getRange(startRow, 1, endRow - startRow + 1, 9).getValues();
        for (let i = 0; i < data.length; i++) {
          if (
            String(data[i][2] || '').trim() === String(body.driverName || '').trim() &&
            String(data[i][3] || '').trim() === String(body.vehicleNumber || '').trim() &&
            String(data[i][8] || '').trim() === String(body.startTime || '').trim()
          ) {
            targetRow = startRow + i;
            break;
          }
        }
      }
      if (targetRow >= 2) {
        sheet.getRange(targetRow, 14).setValue(String(body.note || '').trim());
        sheet.getRange(targetRow, 18).setValue(String(body.note || '').trim());
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'appendRepairRequest') {
      const sheet = ss.getSheetByName('บันทึกงานซ่อม');
      const rowValues = body.rowValues || [];
      const photoUrls = [];
      for (let j = 0; j < 9; j++) {
        const val = rowValues[16 + j];
        if (val && typeof val === 'string' && val.indexOf('data:image') === 0) {
          const driveUrl = saveBase64ImageToDrive(val, 'repair_' + (rowValues[6] || rowValues[0] || 'photo') + '_' + (j + 1));
          rowValues[16 + j] = driveUrl || val;
          photoUrls.push(driveUrl || val);
        } else {
          photoUrls.push(val || '');
        }
      }
      sheet.appendRow(rowValues);
      const rowNumber = sheet.getLastRow();
      return jsonResponse({ ok: true, rowNumber: rowNumber, photoUrls: photoUrls });
    }

    if (action === 'approveRepairRequest') {
      const sheet = ss.getSheetByName('บันทึกงานซ่อม');
      const lastRow = sheet.getLastRow();
      let targetRow = Number(body.rowNumber) || 0;
      const sequenceNo = String(body.sequenceNo || '').trim();

      if (sequenceNo && lastRow >= 2) {
        const startRow = Math.max(2, lastRow - 300);
        const numRows = lastRow - startRow + 1;
        const seqData = sheet.getRange(startRow, 1, numRows, 1).getValues();
        for (let i = seqData.length - 1; i >= 0; i--) {
          if (String(seqData[i][0] || '').trim() === sequenceNo) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        if (body.approverName) sheet.getRange(targetRow, 31).setValue(String(body.approverName).trim());
        if (body.approvalDate) sheet.getRange(targetRow, 32).setValue(String(body.approvalDate).trim());
        if (body.approvalTime) sheet.getRange(targetRow, 33).setValue(String(body.approvalTime).trim());
        if (body.note) sheet.getRange(targetRow, 34).setValue(String(body.note).trim());
        if (body.approvalStatus) sheet.getRange(targetRow, 35).setValue(String(body.approvalStatus).trim());
        if (body.repairStatus) sheet.getRange(targetRow, 16).setValue(String(body.repairStatus).trim());
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'updateRepairPhotos') {
      const sheet = ss.getSheetByName('บันทึกงานซ่อม');
      const lastRow = sheet.getLastRow();
      let targetRow = Number(body.rowNumber) || 0;
      const sequenceNo = String(body.sequenceNo || '').trim();
      const repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        const startRow = Math.max(2, lastRow - 300);
        const numRows = lastRow - startRow + 1;
        const checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (let i = checkData.length - 1; i >= 0; i--) {
          const rowSeq = String(checkData[i][0] || '').trim();
          const rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      const photoUrls = [];
      if (targetRow >= 2 && Array.isArray(body.photos)) {
        for (let j = 0; j < 9; j++) {
          let p = body.photos[j];
          if (p !== undefined && p !== null) {
            if (typeof p === 'string' && p.indexOf('data:image') === 0) {
              const driveUrl = saveBase64ImageToDrive(p, 'repair_' + (repairRequestNo || sequenceNo || targetRow) + '_' + (j + 1));
              p = driveUrl || p;
            }
            sheet.getRange(targetRow, 17 + j).setValue(String(p || ''));
            photoUrls.push(String(p || ''));
          } else {
            photoUrls.push('');
          }
        }
      }
      return jsonResponse({ ok: true, rowNumber: targetRow, photoUrls: photoUrls });
    }

    if (action === 'updateRepairAdditionalDetails') {
      const sheet = ss.getSheetByName('บันทึกงานซ่อม');
      const lastRow = sheet.getLastRow();
      let targetRow = Number(body.rowNumber) || 0;
      const sequenceNo = String(body.sequenceNo || '').trim();
      const repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        const startRow = Math.max(2, lastRow - 300);
        const numRows = lastRow - startRow + 1;
        const checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (let i = checkData.length - 1; i >= 0; i--) {
          const rowSeq = String(checkData[i][0] || '').trim();
          const rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        // AK is column 37 (1-based)
        sheet.getRange(targetRow, 37).setValue(String(body.additionalDetails || '').trim());
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    if (action === 'updateRepairReplyDetails') {
      const sheet = ss.getSheetByName('บันทึกงานซ่อม');
      const lastRow = sheet.getLastRow();
      let targetRow = Number(body.rowNumber) || 0;
      const sequenceNo = String(body.sequenceNo || '').trim();
      const repairRequestNo = String(body.repairRequestNo || '').trim();

      if ((repairRequestNo || sequenceNo) && lastRow >= 2) {
        const startRow = Math.max(2, lastRow - 300);
        const numRows = lastRow - startRow + 1;
        const checkData = sheet.getRange(startRow, 1, numRows, 7).getValues();
        for (let i = checkData.length - 1; i >= 0; i--) {
          const rowSeq = String(checkData[i][0] || '').trim();
          const rowReqNo = String(checkData[i][6] || '').trim();
          if ((repairRequestNo && rowReqNo === repairRequestNo) || (sequenceNo && rowSeq === sequenceNo)) {
            targetRow = startRow + i;
            break;
          }
        }
      }

      if (targetRow >= 2) {
        // AM is column 39 (1-based)
        sheet.getRange(targetRow, 39).setValue(String(body.replyDetails || '').trim());
        if (body.replyDetails && String(body.replyDetails).trim() !== '') {
          // AI is column 35 (1-based)
          sheet.getRange(targetRow, 35).setValue('4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว');
        }
      }
      return jsonResponse({ ok: true, rowNumber: targetRow });
    }

    return jsonResponse({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

export const DRIVE_FOLDER_ID = '1y9_CzTkunm85vparUxDGg_lvCH0sa6P0';

export function extractDriveFileId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const lh3Match = trimmed.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (lh3Match) return lh3Match[1];
  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch) return fileDMatch[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  const openMatch = trimmed.match(/open\?id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];
  return null;
}

export function formatDriveImageUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  const fileId = extractDriveFileId(trimmed);
  if (fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }
  return trimmed;
}

export function getDriveThumbnailUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  const fileId = extractDriveFileId(trimmed);
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  }
  return trimmed;
}

async function callAppsScriptWebhook(
  scriptUrl: string,
  payload: Record<string, unknown>
): Promise<{
  ok?: boolean;
  rowNumber?: number | null;
  error?: string;
  photoUrls?: string[];
}> {
  const response = await fetch(scriptUrl, {
    method: 'POST',
    headers: {
      // Use text/plain to avoid CORS preflight (OPTIONS) rejection on Google Apps Script
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Apps Script HTTP ${response.status}`);
  }

  try {
    const data = (await response.json()) as {
      ok?: boolean;
      rowNumber?: number | null;
      error?: string;
      photoUrls?: string[];
    };
    return data;
  } catch {
    return { ok: true };
  }
}

// Auto-discover Apps Script URL and backend cached token on startup (non-blocking)
void (async () => {
  try {
    const [tokenRes, scriptRes] = await Promise.allSettled([
      fetch('/api/google-token'),
      fetch('/api/script-url'),
    ]);

    if (tokenRes.status === 'fulfilled' && tokenRes.value.ok) {
      const data = (await tokenRes.value.json()) as {
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
      }
    }

    if (scriptRes.status === 'fulfilled' && scriptRes.value.ok) {
      const sData = (await scriptRes.value.json()) as {
        scriptUrl?: string | null;
      };
      if (
        sData.scriptUrl &&
        sData.scriptUrl.startsWith('https://script.google.com/') &&
        !configuredAppsScriptUrl
      ) {
        configuredAppsScriptUrl = sData.scriptUrl.trim();
        try {
          localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, configuredAppsScriptUrl);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore on static hosting
  }

  // Also check cell D1 of จุดส่งสินค้า (gid: 1156877149) for auto-discovered Apps Script URL
  if (!configuredAppsScriptUrl) {
    try {
      const gviz = await queryGviz('1156877149', 'select D limit 1');
      const colLabel = gviz.table?.cols?.[0]?.label?.trim() ?? '';
      const firstCell = String(gviz.table?.rows?.[0]?.c?.[0]?.v ?? '').trim();
      const candidate = colLabel.startsWith('https://script.google.com/')
        ? colLabel
        : firstCell.startsWith('https://script.google.com/')
          ? firstCell
          : '';
      if (candidate) {
        configuredAppsScriptUrl = candidate;
        try {
          localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, candidate);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  if (configuredAppsScriptUrl || cachedAccessToken) {
    void flushPendingMutationsToGoogleSheet();
  }
})();

export async function connectAdminGoogleAccountOnce(): Promise<string> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('ไม่สามารถรับสิทธิ์เชื่อมต่อ Google Sheets ได้');
    }
    cachedAccessToken = credential.accessToken;
    cachedTokenExpiresAt = Date.now() + 3500 * 1000;
    void fetch('/api/google-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: credential.accessToken,
        expiresInSec: 3500,
      }),
    }).catch(() => {});
    void flushPendingMutationsToGoogleSheet();
    return credential.accessToken;
  } finally {
    isSigningIn = false;
  }
}

function getSilentAccessToken(): string | null {
  if (cachedAccessToken && cachedTokenExpiresAt > Date.now() + 30000) {
    return cachedAccessToken;
  }
  return null;
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
  '944294225': {
    A: 'ลำดับ',
    B: 'วันที่แจ้งซ่อม',
    C: 'เวลาแจ้งซ่อม',
    D: 'เบอร์รถ',
    E: 'ประเภทการซ่อม',
    F: 'อาการเสีย',
    G: 'เลขที่ขอซ่อม',
    H: 'เลขที่แจ้งซ่อม SAP',
    I: 'กำหนดการ',
    J: 'วันที่ซ่อมเสร็จ',
    K: 'ระยะเวลาซ่อม',
    L: 'เลขที่ PR',
    M: 'เลขที่ใบกำกับภาษี',
    N: 'ค่าอะไหล่',
    O: 'ค่าแรง',
    P: 'สถานะ',
    Q: 'รูปถ่ายที่ 1',
    R: 'รูปถ่ายที่ 2',
    S: 'รูปถ่ายที่ 3',
    T: 'รูปถ่ายที่ 4',
    U: 'รูปถ่ายที่ 5',
    V: 'รูปถ่ายที่ 6',
    W: 'รูปถ่ายที่ 7',
    X: 'รูปถ่ายที่ 8',
    Y: 'รูปถ่ายที่ 9',
    Z: 'ใบกำกับภาษี',
    AA: 'ผู้แจ้งซ่อม',
    AB: 'ผู้ตรวจสอบ',
    AC: 'วันที่ตรวจสอบ',
    AD: 'เวลาตรวจสอบ',
    AE: 'ผู้อนุมัติ',
    AF: 'วันที่อนุมัติ',
    AG: 'เวลาอนุมัติ',
    AH: 'หมายเหตุ',
    AI: 'สถานะการอนุมัติ',
    AJ: 'ID',
    AK: 'รายละเอียดเพิ่มเติม',
    AL: 'สถานะการเปลี่ยนแปลง',
    AM: 'ตอบกลับข้อมูลเพิ่มเติม',
  },
  '1295975917': {
    A: 'หมายเลขหางพ่วง',
  },
};

const HIDDEN_COLUMN_IDS: Record<string, Set<string>> = {
  '606634465': new Set(['P', 'Q', 'R', 'S', 'T', 'U', 'V']),
  '1156877149': new Set(['D', 'Z']),
  '944294225': new Set([
    'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y',
    'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH',
    'AJ', 'AK', 'AL', 'AM',
  ]),
};

const HIDDEN_COLUMN_LABELS: Record<string, Set<string>> = {
  '606634465': new Set([
    'วันเวลาทำรายการ',
    'รหัสรายการ',
    'ภาพถ่ายที่ 1',
    'ภาพถ่ายที่ 2',
    'น้ำหนักสุทธิ',
    'จำนวนรอบ',
  ]),
  '944294225': new Set([
    'เลขที่แจ้งซ่อม SAP',
    'กำหนดการ',
    'วันที่ซ่อมเสร็จ',
    'ระยะเวลาซ่อม',
    'เลขที่ PR',
    'เลขที่ใบกำกับภาษี',
    'ค่าอะไหล่',
    'ค่าแรง',
    'รูปถ่ายที่ 1',
    'รูปถ่ายที่ 2',
    'รูปถ่ายที่ 3',
    'รูปถ่ายที่ 4',
    'รูปถ่ายที่ 5',
    'รูปถ่ายที่ 6',
    'รูปถ่ายที่ 7',
    'รูปถ่ายที่ 8',
    'รูปถ่ายที่ 9',
    'ภาพถ่ายที่ 1',
    'ภาพถ่ายที่ 2',
    'ภาพถ่ายที่ 3',
    'ภาพถ่ายที่ 4',
    'ภาพถ่ายที่ 5',
    'ภาพถ่ายที่ 6',
    'ภาพถ่ายที่ 7',
    'ภาพถ่ายที่ 8',
    'ภาพถ่ายที่ 9',
    'ใบกำกับภาษี',
    'ผู้แจ้งซ่อม',
    'ผู้ตรวจสอบ',
    'วันที่ตรวจสอบ',
    'เวลาตรวจสอบ',
    'ผู้อนุมัติ',
    'วันที่อนุมัติ',
    'เวลาอนุมัติ',
    'หมายเหตุ',
    'ID',
    'id',
    'สถานะการเปลี่ยนแปลง',
    'รายละเอียดเพิ่มเติม',
    'ตอบกลับข้อมูลเพิ่มเติม',
  ]),
};

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

interface StoredRepairPhotoEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  photos: string[];
  updatedAt: string;
}

interface StoredRepairDetailEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  additionalDetails: string;
  updatedAt: string;
}

interface StoredRepairReplyEdit {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  replyDetails: string;
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
  repairPhotoEdits: StoredRepairPhotoEdit[];
  repairDetailEdits: StoredRepairDetailEdit[];
  repairReplyEdits: StoredRepairReplyEdit[];
}

function createEmptyMutationsStore(): MutationsStore {
  return {
    jobTransfers: [],
    deliveryPoints: [],
    deliveryPointEdits: [],
    vehicleRegEdits: [],
    jobTransferNoteEdits: [],
    repairRequests: [],
    repairApprovals: [],
    repairPhotoEdits: [],
    repairDetailEdits: [],
    repairReplyEdits: [],
  };
}

function readLocalMutationsStore(): MutationsStore {
  try {
    localStorage.removeItem('gsheets_local_mutations_v1');
    const raw = localStorage.getItem(LOCAL_MUTATIONS_STORAGE_KEY);
    if (!raw) return createEmptyMutationsStore();
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
      jobTransferNoteEdits: Array.isArray(parsed.jobTransferNoteEdits)
        ? parsed.jobTransferNoteEdits
        : [],
      repairRequests: Array.isArray(parsed.repairRequests)
        ? parsed.repairRequests
        : [],
      repairApprovals: Array.isArray(parsed.repairApprovals)
        ? parsed.repairApprovals
        : [],
      repairPhotoEdits: Array.isArray(parsed.repairPhotoEdits)
        ? parsed.repairPhotoEdits
        : [],
      repairDetailEdits: Array.isArray(parsed.repairDetailEdits)
        ? parsed.repairDetailEdits
        : [],
      repairReplyEdits: Array.isArray(parsed.repairReplyEdits)
        ? parsed.repairReplyEdits
        : [],
    };
  } catch {
    return createEmptyMutationsStore();
  }
}

function writeLocalMutationsStore(store: MutationsStore): void {
  try {
    localStorage.setItem(LOCAL_MUTATIONS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors
  }
}

async function fetchCombinedMutationsStore(
  signal?: AbortSignal
): Promise<MutationsStore> {
  const local = readLocalMutationsStore();
  try {
    const res = await fetch('/api/mutations', { signal });
    if (res.ok) {
      const remote = (await res.json()) as Partial<MutationsStore>;
      const mergedJobMap = new Map<string, StoredJobTransfer>();
      (remote.jobTransfers ?? []).forEach((jt) => mergedJobMap.set(jt.recordId, jt));
      local.jobTransfers.forEach((jt) => {
        const existing = mergedJobMap.get(jt.recordId);
        mergedJobMap.set(jt.recordId, existing ? { ...existing, ...jt, values: { ...existing.values, ...jt.values } } : jt);
      });

      const mergedDpMap = new Map<string, StoredDeliveryPoint>();
      (remote.deliveryPoints ?? []).forEach((dp) => mergedDpMap.set(dp.id, dp));
      local.deliveryPoints.forEach((dp) => mergedDpMap.set(dp.id, dp));

      const mergedDpEditMap = new Map<string, StoredDeliveryPointEdit>();
      (remote.deliveryPointEdits ?? []).forEach((e) =>
        mergedDpEditMap.set(e.deliveryPoint, e)
      );
      local.deliveryPointEdits.forEach((e) =>
        mergedDpEditMap.set(e.deliveryPoint, e)
      );

      const mergedVehEdits = [
        ...(remote.vehicleRegEdits ?? []),
        ...local.vehicleRegEdits.filter(
          (l) =>
            !(remote.vehicleRegEdits ?? []).some(
              (r) =>
                r.oldRegistration === l.oldRegistration &&
                r.newRegistration === l.newRegistration
            )
        ),
      ];

      const mergedNoteMap = new Map<string, StoredJobTransferNoteEdit>();
      (remote.jobTransferNoteEdits ?? []).forEach((e) =>
        mergedNoteMap.set(`${e.date}|${e.driverName}|${e.vehicleNumber}|${e.startTime}`, e)
      );
      local.jobTransferNoteEdits.forEach((e) =>
        mergedNoteMap.set(`${e.date}|${e.driverName}|${e.vehicleNumber}|${e.startTime}`, e)
      );

      const mergedRepReqMap = new Map<string, StoredRepairRequest>();
      (remote.repairRequests ?? []).forEach((r) => mergedRepReqMap.set(r.id, r));
      local.repairRequests.forEach((r) => mergedRepReqMap.set(r.id, r));

      const mergedRepAppMap = new Map<string, StoredRepairApproval>();
      (remote.repairApprovals ?? []).forEach((a) =>
        mergedRepAppMap.set(a.sequenceNo || String(a.rowNumber), a)
      );
      local.repairApprovals.forEach((a) =>
        mergedRepAppMap.set(a.sequenceNo || String(a.rowNumber), a)
      );

      const mergedPhotoEditMap = new Map<string, StoredRepairPhotoEdit>();
      (remote.repairPhotoEdits ?? []).forEach((p) =>
        mergedPhotoEditMap.set(
          p.sequenceNo || p.repairRequestNo || String(p.rowNumber),
          p
        )
      );
      local.repairPhotoEdits.forEach((p) =>
        mergedPhotoEditMap.set(
          p.sequenceNo || p.repairRequestNo || String(p.rowNumber),
          p
        )
      );

      const mergedDetailEditMap = new Map<string, StoredRepairDetailEdit>();
      (remote.repairDetailEdits ?? []).forEach((d) =>
        mergedDetailEditMap.set(
          d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
          d
        )
      );
      (local.repairDetailEdits ?? []).forEach((d) =>
        mergedDetailEditMap.set(
          d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
          d
        )
      );

      const mergedReplyEditMap = new Map<string, StoredRepairReplyEdit>();
      (remote.repairReplyEdits ?? []).forEach((d) =>
        mergedReplyEditMap.set(
          d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
          d
        )
      );
      (local.repairReplyEdits ?? []).forEach((d) =>
        mergedReplyEditMap.set(
          d.sequenceNo || d.repairRequestNo || String(d.rowNumber),
          d
        )
      );

      return {
        jobTransfers: Array.from(mergedJobMap.values()),
        deliveryPoints: Array.from(mergedDpMap.values()),
        deliveryPointEdits: Array.from(mergedDpEditMap.values()),
        vehicleRegEdits: mergedVehEdits,
        jobTransferNoteEdits: Array.from(mergedNoteMap.values()),
        repairRequests: Array.from(mergedRepReqMap.values()),
        repairApprovals: Array.from(mergedRepAppMap.values()),
        repairPhotoEdits: Array.from(mergedPhotoEditMap.values()),
        repairDetailEdits: Array.from(mergedDetailEditMap.values()),
        repairReplyEdits: Array.from(mergedReplyEditMap.values()),
      };
    }
  } catch {
    // ignore fetch error on static hosting
  }
  return local;
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
    throw new Error(`Google Sheets API HTTP ${response.status}`);
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

export async function flushPendingMutationsToGoogleSheet(): Promise<void> {
  try {
    const store = await fetchCombinedMutationsStore();
    const scriptUrl = getConfiguredAppsScriptUrl();
    const token = getSilentAccessToken();
    if (!scriptUrl && !token) return;

    const localStore = readLocalMutationsStore();
    let localChanged = false;

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

      let sheetRowNumber: number | null = null;
      if (scriptUrl) {
        const res = await callAppsScriptWebhook(scriptUrl, {
          action: 'appendJobTransfer',
          rowValues,
        });
        sheetRowNumber = res.rowNumber ?? null;
      } else if (token) {
        sheetRowNumber = await postJobTransferRowToGoogleSheetsApi(rowValues, token);
      }

      jt.syncedToSheet = true;
      if (sheetRowNumber && sheetRowNumber > 0) {
        jt.rowNumber = sheetRowNumber;
      }

      const localItem = localStore.jobTransfers.find(
        (item) => item.recordId === jt.recordId
      );
      if (localItem) {
        localItem.syncedToSheet = true;
        if (sheetRowNumber && sheetRowNumber > 0) {
          localItem.rowNumber = sheetRowNumber;
        }
        localChanged = true;
      }

      void fetch('/api/mutations/mark-synced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: jt.recordId,
          sheetRowNumber,
        }),
      }).catch(() => {});
    }

    if (localChanged) {
      writeLocalMutationsStore(localStore);
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

  const [totalRowsInSheet, mutationsStore] = await Promise.all([
    fetchSheetRowCount(tab.gid, options?.signal),
    fetchCombinedMutationsStore(options?.signal),
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

  // Auto-discover Apps Script URL if present in column D of จุดส่งสินค้า
  if (tab.gid === '1156877149' && !configuredAppsScriptUrl) {
    const colD = rawCols.find((c) => c.id === 'D');
    if (colD?.label?.trim().startsWith('https://script.google.com/')) {
      configuredAppsScriptUrl = colD.label.trim();
      try {
        localStorage.setItem(APPS_SCRIPT_URL_STORAGE_KEY, configuredAppsScriptUrl);
      } catch {
        // ignore
      }
    }
  }

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

  const allColumns: SheetColumn[] = [];
  const activeColumns: SheetColumn[] = [];
  rawCols.forEach((col, colIndex) => {
    const fallbackLabel =
      FALLBACK_COLUMN_LABELS[tab.gid]?.[col.id] ?? promotedHeaderRow[col.id] ?? '';
    const label = (col.label?.trim() || fallbackLabel).trim();

    if (label.startsWith('https://script.google.com/')) {
      return;
    }

    const hasDataInRows = rawRows.some((r) => {
      const cell = r.c?.[colIndex];
      return formatGvizCellValue(cell) !== '';
    });

    if (label !== '' && (col.label?.trim() !== '' || fallbackLabel !== '' || hasDataInRows)) {
      const colObj: SheetColumn = {
        id: col.id,
        label,
        type: col.type || 'string',
      };
      allColumns.push(colObj);

      const isHiddenById = HIDDEN_COLUMN_IDS[tab.gid]?.has(col.id);
      const isHiddenByLabel =
        HIDDEN_COLUMN_LABELS[tab.gid]?.has(label) ||
        HIDDEN_COLUMN_LABELS[tab.gid]?.has(label.trim()) ||
        Array.from(HIDDEN_COLUMN_LABELS[tab.gid] || []).some(
          (hLabel) => hLabel.trim().toLowerCase() === label.trim().toLowerCase()
        );

      if (!isHiddenById && !isHiddenByLabel) {
        activeColumns.push(colObj);
      }
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
  const colIdxQ =
    tab.gid === '606634465' ? rawCols.findIndex((c) => c.id === 'Q') : -1;

  const existingRecordIds = new Set<string>();

  rawRows.forEach((r, idx) => {
    const values: Record<string, string> = {};
    const rawValues: Record<string, string | number | null> = {};
    let hasNonEmptyValue = false;

    if (colIdxQ >= 0) {
      const qVal = formatGvizCellValue(r.c?.[colIdxQ]);
      if (qVal) existingRecordIds.add(qVal);
    }

    allColumns.forEach((col) => {
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

  // Overlay local/backend mutations so records are immediately visible without login
  if (tab.gid === '606634465') {
    for (const jt of mutationsStore.jobTransfers) {
      const existingRow = parsedRows.find(
        (r) =>
          (r.values['A'] ?? '').trim() === (jt.values['A'] ?? '').trim() &&
          (r.values['C'] ?? '').trim() === (jt.values['C'] ?? '').trim() &&
          (r.values['D'] ?? '').trim() === (jt.values['D'] ?? '').trim() &&
          (r.values['I'] ?? '').trim() === (jt.values['I'] ?? '').trim()
      );
      if (existingRow) {
        if (jt.values['K']) existingRow.values['K'] = jt.values['K'];
        if (jt.values['L']) existingRow.values['L'] = jt.values['L'];
        if (jt.values['M']) existingRow.values['M'] = jt.values['M'];
        if (jt.values['N']) existingRow.values['N'] = jt.values['N'];
      } else if (!existingRecordIds.has(jt.recordId) && !search) {
        const rowNumber =
          jt.rowNumber && jt.rowNumber > totalRowsInSheet
            ? jt.rowNumber
            : totalRowsInSheet + parsedRows.length + 1;
        parsedRows.push({
          rowNumber,
          values: { ...jt.values },
          rawValues: {
            ...jt.values,
            G: Number(jt.values['G'] ?? 0) || 0,
          },
        });
      }
    }

    for (const noteEdit of mutationsStore.jobTransferNoteEdits) {
      const target = parsedRows.find(
        (r) =>
          (r.values['A'] ?? '').trim() === noteEdit.date &&
          (r.values['C'] ?? '').trim() === noteEdit.driverName &&
          (r.values['D'] ?? '').trim() === noteEdit.vehicleNumber &&
          (r.values['I'] ?? '').trim() === noteEdit.startTime
      );
      if (target) {
        target.values['N'] = noteEdit.note;
      }
    }
  } else if (tab.gid === '1156877149') {
    for (const dp of mutationsStore.deliveryPoints) {
      const exists = parsedRows.some(
        (r) => (r.values['B'] ?? '').trim() === (dp.values['B'] ?? '').trim()
      );
      if (!exists) {
        parsedRows.push({
          rowNumber: parsedRows.length + 1,
          values: { ...dp.values },
          rawValues: { ...dp.values },
        });
      }
    }
    for (const edit of mutationsStore.deliveryPointEdits) {
      const target = parsedRows.find(
        (r) => (r.values['B'] ?? '').trim() === edit.deliveryPoint
      );
      if (target) {
        target.values['C'] = edit.newGate;
        if (edit.updatedDate) target.values['A'] = edit.updatedDate;
      }
    }
  } else if (tab.gid === '378250263') {
    for (const edit of mutationsStore.vehicleRegEdits) {
      const target = parsedRows.find(
        (r) =>
          (r.values['A'] ?? '').trim() === edit.oldRegistration &&
          (!edit.driverName || (r.values['I'] ?? '').trim() === edit.driverName)
      );
      if (target) {
        target.values['A'] = edit.newRegistration;
      }
    }
  } else if (tab.gid === '944294225') {
    for (const req of mutationsStore.repairRequests) {
      const exists = parsedRows.some(
        (r) =>
          (r.values['A'] ?? '').trim() === req.sequenceNo ||
          (r.values['B'] ?? '').trim() === req.values['B'] &&
          (r.values['D'] ?? '').trim() === req.values['D'] &&
          (r.values['F'] ?? '').trim() === req.values['F']
      );
      if (!exists && !search) {
        parsedRows.push({
          rowNumber: req.rowNumber,
          values: { ...req.values },
          rawValues: { ...req.values, A: Number(req.sequenceNo) || req.rowNumber },
        });
      }
    }
    for (const app of mutationsStore.repairApprovals) {
      const target = parsedRows.find(
        (r) =>
          (app.sequenceNo && (r.values['A'] ?? '').trim() === app.sequenceNo) ||
          (app.rowNumber > 0 && r.rowNumber === app.rowNumber)
      );
      if (target) {
        target.values['AE'] = app.approverName;
        target.values['AF'] = app.approvalDate;
        target.values['AG'] = app.approvalTime;
        target.values['AI'] = app.approvalStatus;
        if (app.repairStatus) target.values['P'] = app.repairStatus;
        if (app.note) target.values['AH'] = app.note;
      }
    }
    for (const pe of mutationsStore.repairPhotoEdits) {
      const target = parsedRows.find(
        (r) =>
          (pe.sequenceNo && (r.values['A'] ?? '').trim() === pe.sequenceNo) ||
          (pe.repairRequestNo && (r.values['G'] ?? '').trim() === pe.repairRequestNo) ||
          (pe.rowNumber > 0 && r.rowNumber === pe.rowNumber)
      );
      if (target) {
        const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
        pe.photos.slice(0, 9).forEach((photo, idx) => {
          target.values[photoCols[idx]] = photo;
        });
      }
    }
    if (Array.isArray(mutationsStore.repairDetailEdits)) {
      for (const de of mutationsStore.repairDetailEdits) {
        const target = parsedRows.find(
          (r) =>
            (de.sequenceNo && (r.values['A'] ?? '').trim() === de.sequenceNo) ||
            (de.repairRequestNo && (r.values['G'] ?? '').trim() === de.repairRequestNo) ||
            (de.rowNumber > 0 && r.rowNumber === de.rowNumber)
        );
        if (target) {
          target.values['AK'] = de.additionalDetails;
        }
      }
    }
    if (Array.isArray(mutationsStore.repairReplyEdits)) {
      for (const re of mutationsStore.repairReplyEdits) {
        const target = parsedRows.find(
          (r) =>
            (re.sequenceNo && (r.values['A'] ?? '').trim() === re.sequenceNo) ||
            (re.repairRequestNo && (r.values['G'] ?? '').trim() === re.repairRequestNo) ||
            (re.rowNumber > 0 && r.rowNumber === re.rowNumber)
        );
        if (target) {
          target.values['AM'] = re.replyDetails;
          if (re.replyDetails && re.replyDetails.trim() !== '') {
            target.values['AI'] = '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว';
          }
        }
      }
    }
  }

  if (tab.reverseOrder) {
    parsedRows.reverse();
  }

  return {
    sheetId: GOOGLE_SHEET_ID,
    gid: tab.gid,
    tabName: tab.name,
    columns: activeColumns,
    allColumns,
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

  const valuesMap: Record<string, string> = {
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
    N: payload.note || '',
    P: transactionTimestamp,
    Q: recordId,
    R: payload.note || '',
    S: '',
    T: '',
    U: payload.weight > 0 ? String(payload.weight) : '',
    V: String(payload.rounds || 1),
  };

  let rowNumber: number | null = null;
  let syncedToSheet = false;

  // 1. Try Google Apps Script Webhook (No-Login Direct Google Sheet Write)
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'appendJobTransfer',
        rowValues,
      });
      if (res.ok !== false) {
        rowNumber = res.rowNumber ?? null;
        syncedToSheet = true;
      }
    } catch {
      // fall through to silent token or local store
    }
  }

  // 2. Try silent cached OAuth token (without opening any login popup!)
  if (!syncedToSheet) {
    const token = getSilentAccessToken();
    if (token) {
      try {
        rowNumber = await postJobTransferRowToGoogleSheetsApi(rowValues, token);
        syncedToSheet = true;
      } catch {
        // fall through to local/server persistence
      }
    }
  }

  // 3. Always persist to local & backend store so mobile user never hits an auth error
  const fallbackRowNumber = rowNumber ?? 56085 + Math.floor(Math.random() * 500);
  const localStore = readLocalMutationsStore();
  localStore.jobTransfers.push({
    recordId,
    rowNumber: fallbackRowNumber,
    values: valuesMap,
    createdAt: new Date().toISOString(),
    syncedToSheet,
  });
  writeLocalMutationsStore(localStore);

  try {
    const res = await fetch('/api/mutations/job-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordId,
        baseRowNumber: fallbackRowNumber - 1,
        values: valuesMap,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { rowNumber?: number };
      if (!rowNumber && data.rowNumber) {
        rowNumber = data.rowNumber;
      }
      if (syncedToSheet) {
        void fetch('/api/mutations/mark-synced', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId, sheetRowNumber: rowNumber }),
        }).catch(() => {});
      }
    }
  } catch {
    // ignore on static hosting
  }

  return { recordId, rowNumber: rowNumber ?? fallbackRowNumber };
}

export async function completeJobTransferRecord(params: {
  recordId: string;
  rowNumber: number | null;
  endTime: string;
  duration: string;
  status?: string;
}): Promise<void> {
  const finalStatus = params.status || 'ส่งสินค้าเรียบร้อยแล้ว';

  // 1. Update local store immediately
  const localStore = readLocalMutationsStore();
  for (const item of localStore.jobTransfers) {
    if (
      item.recordId === params.recordId ||
      (params.rowNumber && item.rowNumber === params.rowNumber)
    ) {
      item.values['K'] = params.endTime;
      item.values['L'] = params.duration;
      item.values['M'] = finalStatus;
    }
  }
  writeLocalMutationsStore(localStore);

  // 2. Update backend store
  void fetch(`/api/mutations/job-transfer/${encodeURIComponent(params.recordId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rowNumber: params.rowNumber,
      endTime: params.endTime,
      duration: params.duration,
      status: finalStatus,
    }),
  }).catch(() => {});

  // 3. Write directly to Google Sheet via Apps Script Webhook (No-Login)
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'completeJobTransfer',
        recordId: params.recordId,
        rowNumber: params.rowNumber,
        endTime: params.endTime,
        duration: params.duration,
        status: finalStatus,
      });
      return;
    } catch {
      // fall through
    }
  }

  // 4. Write via silent cached token if available (No popup)
  const token = getSilentAccessToken();
  if (token && params.rowNumber && params.rowNumber > 0) {
    try {
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
      if (!response.ok && (response.status === 401 || response.status === 403)) {
        invalidateCachedToken();
      }
    } catch {
      // ignore
    }
  }
}

export async function appendDeliveryPointRecord(
  payload: DeliveryPointPayload
): Promise<void> {
  const localStore = readLocalMutationsStore();
  localStore.deliveryPoints.push({
    id: Math.random().toString(16).slice(2, 10),
    rowNumber: 30 + localStore.deliveryPoints.length,
    values: {
      A: payload.date,
      B: payload.deliveryPoint,
      C: payload.gate,
    },
    createdAt: new Date().toISOString(),
  });
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/delivery-point', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: {
        A: payload.date,
        B: payload.deliveryPoint,
        C: payload.gate,
      },
    }),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'appendDeliveryPoint',
        date: payload.date,
        deliveryPoint: payload.deliveryPoint,
        gate: payload.gate,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const range = encodeURIComponent('จุดส่งสินค้า!A:A');
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[payload.date, payload.deliveryPoint, payload.gate]],
        }),
      });
    } catch {
      // ignore
    }
  }
}

export async function updateDeliveryPointGate(params: {
  deliveryPoint: string;
  oldGate: string;
  newGate: string;
  updatedDate: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredDeliveryPointEdit = {
    deliveryPoint: params.deliveryPoint.trim(),
    oldGate: params.oldGate.trim(),
    newGate: params.newGate.trim(),
    updatedDate: params.updatedDate.trim(),
    updatedAt: new Date().toISOString(),
  };
  const existingIdx = localStore.deliveryPointEdits.findIndex(
    (e) => e.deliveryPoint === editEntry.deliveryPoint
  );
  if (existingIdx >= 0) {
    localStore.deliveryPointEdits[existingIdx] = editEntry;
  } else {
    localStore.deliveryPointEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/delivery-point-gate', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateDeliveryPointGate',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const readRange = encodeURIComponent('จุดส่งสินค้า!A:C');
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
      const readRes = await fetch(readUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (readRes.ok) {
        const readJson = await readRes.json();
        const rows: string[][] = readJson?.values ?? [];
        let matchedIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if ((rows[i]?.[1] ?? '').trim() === params.deliveryPoint.trim()) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex !== -1) {
          const sheetRowNumber = matchedIndex + 1;
          const updateRange = encodeURIComponent(
            `จุดส่งสินค้า!A${sheetRowNumber}:C${sheetRowNumber}`
          );
          const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
          await fetch(updateUrl, {
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
        }
      }
    } catch {
      // ignore
    }
  }
}

export async function updateVehicleRegistration(params: {
  oldRegistration: string;
  newRegistration: string;
  driverName: string;
  shift: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  localStore.vehicleRegEdits.push({
    oldRegistration: params.oldRegistration.trim(),
    newRegistration: params.newRegistration.trim(),
    driverName: params.driverName.trim(),
    shift: params.shift.trim(),
    updatedAt: new Date().toISOString(),
  });
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/vehicle-registration', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateVehicleRegistration',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const readRange = encodeURIComponent('ฐานข้อมูลรถ!A:L');
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${readRange}`;
      const readRes = await fetch(readUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (readRes.ok) {
        const readJson = await readRes.json();
        const rows: string[][] = readJson?.values ?? [];
        let matchedIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if ((rows[i]?.[0] ?? '').trim() === params.oldRegistration.trim()) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex !== -1) {
          const sheetRowNumber = matchedIndex + 1;
          const updateRange = encodeURIComponent(`ฐานข้อมูลรถ!A${sheetRowNumber}`);
          const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
          await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              values: [[params.newRegistration.trim()]],
            }),
          });
        }
      }
    } catch {
      // ignore
    }
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
  const localStore = readLocalMutationsStore();
  const editEntry: StoredJobTransferNoteEdit = {
    rowNumber: params.rowNumber,
    date: params.date.trim(),
    driverName: params.driverName.trim(),
    vehicleNumber: params.vehicleNumber.trim(),
    startTime: params.startTime.trim(),
    note: params.note.trim(),
    updatedAt: new Date().toISOString(),
  };
  const existingIdx = localStore.jobTransferNoteEdits.findIndex(
    (e) =>
      e.date === editEntry.date &&
      e.driverName === editEntry.driverName &&
      e.vehicleNumber === editEntry.vehicleNumber &&
      e.startTime === editEntry.startTime
  );
  if (existingIdx >= 0) {
    localStore.jobTransferNoteEdits[existingIdx] = editEntry;
  } else {
    localStore.jobTransferNoteEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/job-transfer-note', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateJobTransferNote',
        ...params,
      });
      return;
    } catch {
      // fall through
    }
  }

  const token = getSilentAccessToken();
  if (token) {
    try {
      const updateRange = encodeURIComponent(`บันทึกการย้ายงาน!N${params.rowNumber}`);
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[params.note.trim()]],
        }),
      });
    } catch {
      // ignore
    }
  }
}

export async function appendRepairRecord(
  payload: import('../types').RepairRequestPayload
): Promise<{ id: string; rowNumber: number; sequenceNo: string }> {
  const id = Math.random().toString(16).slice(2, 10);
  const count = await fetchSheetRowCount('944294225');
  const sequenceNo = String(count > 0 ? count + 1 : 4268);
  const rowNumber = count > 0 ? count + 1 : 4268;

  // Row values mapping 38 columns (A - AL)
  const rowValues: Array<string | number> = new Array(38).fill('');
  rowValues[0] = Number(sequenceNo) || sequenceNo; // A: ลำดับ
  rowValues[1] = payload.date; // B: วันที่แจ้งซ่อม
  rowValues[2] = payload.time; // C: เวลาแจงซ่อม
  rowValues[3] = payload.vehicleNumber; // D: เบอร์รถ
  rowValues[4] = payload.repairType; // E: ประเภทการซ่อม
  rowValues[5] = payload.symptoms; // F: อาการ
  rowValues[6] = payload.repairRequestNo || ''; // G: เลขที่ขอซ่อม
  rowValues[15] = 'รอคิวซ่อม'; // P: สถานะ
  // Q to Y: รูปถ่ายที่ 1 - 9 (indices 16 to 24)
  const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
  if (Array.isArray(payload.photos)) {
    payload.photos.slice(0, 9).forEach((photo, idx) => {
      rowValues[16 + idx] = photo;
    });
  }
  rowValues[26] = payload.reporterName; // AA: ผู้แจ้งซ่อม
  rowValues[33] = payload.note || ''; // AH: หมายเหตุ
  rowValues[34] = '2.⚠️รอพิจารณา'; // AI: สถานะการอนุมัติ
  rowValues[35] = id; // AJ: ID

  const valuesMap: Record<string, string> = {
    A: sequenceNo,
    B: payload.date,
    C: payload.time,
    D: payload.vehicleNumber,
    E: payload.repairType,
    F: payload.symptoms,
    G: payload.repairRequestNo || '',
    P: 'รอคิวซ่อม',
    AA: payload.reporterName,
    AH: payload.note || '',
    AI: '2.⚠️รอพิจารณา',
    AJ: id,
  };

  if (Array.isArray(payload.photos)) {
    payload.photos.slice(0, 9).forEach((photo, idx) => {
      valuesMap[photoCols[idx]] = photo;
    });
  }

  let syncedToSheet = false;
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'appendRepairRequest',
        rowValues,
      });
      if (res.ok !== false) {
        syncedToSheet = true;
        if (Array.isArray(res.photoUrls) && res.photoUrls.length > 0) {
          res.photoUrls.forEach((url, idx) => {
            if (url) {
              valuesMap[photoCols[idx]] = url;
            }
          });
        }
      }
    } catch {
      // ignore
    }
  }

  const token = getSilentAccessToken();
  if (!syncedToSheet && token) {
    try {
      const range = encodeURIComponent('บันทึกงานซ่อม!A:A');
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [rowValues] }),
      });
      syncedToSheet = true;
    } catch {
      // ignore
    }
  }

  const localStore = readLocalMutationsStore();
  localStore.repairRequests.push({
    id,
    rowNumber,
    sequenceNo,
    values: valuesMap,
    createdAt: new Date().toISOString(),
    syncedToSheet,
  });
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/repair-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      rowNumber,
      sequenceNo,
      values: valuesMap,
      syncedToSheet,
    }),
  }).catch(() => {});

  return { id, rowNumber, sequenceNo };
}

export async function approveRepairRecord(
  payload: import('../types').RepairApprovalPayload
): Promise<void> {
  const localStore = readLocalMutationsStore();
  const existingIdx = localStore.repairApprovals.findIndex(
    (a) =>
      (payload.sequenceNo && a.sequenceNo === payload.sequenceNo) ||
      (payload.rowNumber > 0 && a.rowNumber === payload.rowNumber)
  );

  const approvalEntry = {
    rowNumber: payload.rowNumber,
    sequenceNo: payload.sequenceNo,
    approvalStatus: payload.approvalStatus,
    approverName: payload.approverName,
    approvalDate: payload.approvalDate,
    approvalTime: payload.approvalTime,
    repairStatus: payload.repairStatus,
    note: payload.note,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    localStore.repairApprovals[existingIdx] = approvalEntry;
  } else {
    localStore.repairApprovals.push(approvalEntry);
  }
  writeLocalMutationsStore(localStore);

  void fetch('/api/mutations/repair-approval', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'approveRepairRequest',
        ...payload,
      });
      return;
    } catch {
      // ignore
    }
  }

  const token = getSilentAccessToken();
  if (token && payload.rowNumber > 0) {
    try {
      const updateRange = encodeURIComponent(`บันทึกงานซ่อม!AE${payload.rowNumber}:AI${payload.rowNumber}`);
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[
            payload.approverName,
            payload.approvalDate,
            payload.approvalTime,
            payload.note || '',
            payload.approvalStatus,
          ]],
        }),
      });

      if (payload.repairStatus) {
        const statusRange = encodeURIComponent(`บันทึกงานซ่อม!P${payload.rowNumber}`);
        const statusUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${statusRange}?valueInputOption=USER_ENTERED`;
        await fetch(statusUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [[payload.repairStatus]],
          }),
        });
      }
    } catch {
      // ignore
    }
  }
}

export async function updateRepairPhotos(
  payload: import('../types').RepairPhotoUpdatePayload
): Promise<void> {
  const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];

  // 1. Update local store
  const localStore = readLocalMutationsStore();
  for (const reqItem of localStore.repairRequests) {
    if (
      (payload.sequenceNo && reqItem.sequenceNo === payload.sequenceNo) ||
      (payload.repairRequestNo && reqItem.values['G'] === payload.repairRequestNo) ||
      (payload.rowNumber > 0 && reqItem.rowNumber === payload.rowNumber)
    ) {
      payload.photos.slice(0, 9).forEach((photo, idx) => {
        reqItem.values[photoCols[idx]] = photo;
      });
    }
  }

  const existingIdx = localStore.repairPhotoEdits.findIndex(
    (p) =>
      (payload.sequenceNo && p.sequenceNo === payload.sequenceNo) ||
      (payload.repairRequestNo && p.repairRequestNo === payload.repairRequestNo) ||
      (payload.rowNumber > 0 && p.rowNumber === payload.rowNumber)
  );

  const editEntry: StoredRepairPhotoEdit = {
    rowNumber: payload.rowNumber,
    sequenceNo: payload.sequenceNo,
    repairRequestNo: payload.repairRequestNo,
    photos: payload.photos,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    localStore.repairPhotoEdits[existingIdx] = editEntry;
  } else {
    localStore.repairPhotoEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  // 2. Persist to server store
  void fetch('/api/mutations/repair-photos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  // 3. Webhook update on existing row
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      const res = await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairPhotos',
        ...payload,
      });
      if (res.ok !== false && Array.isArray(res.photoUrls) && res.photoUrls.length > 0) {
        const updatedUrls = res.photoUrls;
        for (const reqItem of localStore.repairRequests) {
          if (
            (payload.sequenceNo && reqItem.sequenceNo === payload.sequenceNo) ||
            (payload.repairRequestNo && reqItem.values['G'] === payload.repairRequestNo) ||
            (payload.rowNumber > 0 && reqItem.rowNumber === payload.rowNumber)
          ) {
            updatedUrls.slice(0, 9).forEach((photo, idx) => {
              if (photo) reqItem.values[photoCols[idx]] = photo;
            });
          }
        }
        if (existingIdx >= 0) {
          localStore.repairPhotoEdits[existingIdx].photos = updatedUrls;
        }
        writeLocalMutationsStore(localStore);
      }
      return;
    } catch {
      // ignore
    }
  }

  // 4. Update via Google Sheets API (if token available) on exact existing row
  const token = getSilentAccessToken();
  if (token && payload.rowNumber > 0) {
    try {
      const updateRange = encodeURIComponent(`บันทึกงานซ่อม!Q${payload.rowNumber}:Y${payload.rowNumber}`);
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      const rowValues: string[] = new Array(9).fill('');
      payload.photos.slice(0, 9).forEach((photo, idx) => {
        rowValues[idx] = photo;
      });

      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [rowValues],
        }),
      });
    } catch {
      // ignore
    }
  }
}

export async function updateRepairAdditionalDetails(params: {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  additionalDetails: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredRepairDetailEdit = {
    rowNumber: params.rowNumber,
    sequenceNo: params.sequenceNo.trim(),
    repairRequestNo: params.repairRequestNo?.trim() || '',
    additionalDetails: params.additionalDetails.trim(),
    updatedAt: new Date().toISOString(),
  };

  for (const reqItem of localStore.repairRequests) {
    if (
      (params.sequenceNo && reqItem.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && reqItem.values['G'] === params.repairRequestNo) ||
      (params.rowNumber > 0 && reqItem.rowNumber === params.rowNumber)
    ) {
      reqItem.values['AK'] = params.additionalDetails.trim();
    }
  }

  if (!localStore.repairDetailEdits) {
    localStore.repairDetailEdits = [];
  }

  const existingIdx = localStore.repairDetailEdits.findIndex(
    (e) =>
      (params.sequenceNo && e.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && e.repairRequestNo === params.repairRequestNo) ||
      (params.rowNumber > 0 && e.rowNumber === params.rowNumber)
  );

  if (existingIdx >= 0) {
    localStore.repairDetailEdits[existingIdx] = editEntry;
  } else {
    localStore.repairDetailEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  // 2. Persist to server store
  void fetch('/api/mutations/repair-details', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  // 3. Webhook update on existing row
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairAdditionalDetails',
        ...params,
      });
      return;
    } catch {
      // ignore
    }
  }

  // 4. Update via Google Sheets API (if token available) on exact existing row
  const token = getSilentAccessToken();
  if (token && params.rowNumber > 0) {
    try {
      const updateRange = encodeURIComponent(`บันทึกงานซ่อม!AK${params.rowNumber}`);
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[params.additionalDetails.trim()]],
        }),
      });
    } catch {
      // ignore
    }
  }
}

export async function updateRepairReplyDetails(params: {
  rowNumber: number;
  sequenceNo: string;
  repairRequestNo?: string;
  replyDetails: string;
}): Promise<void> {
  const localStore = readLocalMutationsStore();
  const editEntry: StoredRepairReplyEdit = {
    rowNumber: params.rowNumber,
    sequenceNo: params.sequenceNo.trim(),
    repairRequestNo: params.repairRequestNo?.trim() || '',
    replyDetails: params.replyDetails.trim(),
    updatedAt: new Date().toISOString(),
  };

  for (const reqItem of localStore.repairRequests) {
    if (
      (params.sequenceNo && reqItem.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && reqItem.values['G'] === params.repairRequestNo) ||
      (params.rowNumber > 0 && reqItem.rowNumber === params.rowNumber)
    ) {
      reqItem.values['AM'] = params.replyDetails.trim();
      if (params.replyDetails.trim()) {
        reqItem.values['AI'] = '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว';
      }
    }
  }

  if (!localStore.repairReplyEdits) {
    localStore.repairReplyEdits = [];
  }

  const existingIdx = localStore.repairReplyEdits.findIndex(
    (e) =>
      (params.sequenceNo && e.sequenceNo === params.sequenceNo) ||
      (params.repairRequestNo && e.repairRequestNo === params.repairRequestNo) ||
      (params.rowNumber > 0 && e.rowNumber === params.rowNumber)
  );

  if (existingIdx >= 0) {
    localStore.repairReplyEdits[existingIdx] = editEntry;
  } else {
    localStore.repairReplyEdits.push(editEntry);
  }
  writeLocalMutationsStore(localStore);

  // 2. Persist to server store
  void fetch('/api/mutations/repair-reply', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {});

  // 3. Webhook update on existing row
  const scriptUrl = getConfiguredAppsScriptUrl();
  if (scriptUrl) {
    try {
      await callAppsScriptWebhook(scriptUrl, {
        action: 'updateRepairReplyDetails',
        ...params,
      });
      return;
    } catch {
      // ignore
    }
  }

  // 4. Update via Google Sheets API (if token available) on exact existing row
  const token = getSilentAccessToken();
  if (token && params.rowNumber > 0) {
    try {
      const updateRange = encodeURIComponent(`บันทึกงานซ่อม!AM${params.rowNumber}`);
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${updateRange}?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[params.replyDetails.trim()]],
        }),
      });

      if (params.replyDetails.trim()) {
        const statusRange = encodeURIComponent(`บันทึกงานซ่อม!AI${params.rowNumber}`);
        const statusUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEET_ID}/values/${statusRange}?valueInputOption=USER_ENTERED`;
        await fetch(statusUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [['4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว']],
          }),
        });
      }
    } catch {
      // ignore
    }
  }
}


