import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  SlidersHorizontal,
  ExternalLink,
  AlertCircle,
  Plus,
  CheckCircle2,
  Menu,
  Pencil,
  Check,
  Link2,
  Wrench,
  CheckCircle,
  Calendar,
  Camera,
  Eye,
  Home,
  Fuel,
  Scale,
  Truck,
  Repeat,
  Coins,
  Clock,
  Droplet,
  Bell,
  Users,
  MapPin,
  BarChart3,
  AlertTriangle,
  PackagePlus,
  PackageMinus,
  Disc,
  ChevronsUpDown,
  Layers,
  PlusCircle,
  FileText,
} from 'lucide-react';
import {
  GOOGLE_SHEET_ID,
  SHEET_TABS,
  fetchSheetTabData,
  updateDeliveryPointGate,
  updateVehicleRegistration,
  updateVehicleField,
  updateJobTransferNote,
  updateRepairAdditionalDetails,
  updateRepairReplyDetails,
  updateRepairFinancialDetails,
  inspectRepairRecord,
  isPhotoValue,
  flushPendingMutationsToGoogleSheet,
  completeJobTransferRecord,
  extractTireSafetyStock,
  parseTireNumericCell,
  isTireLowStock,
  fetchEmployeeAccounts,
  buildVehicleDriverOptions,
  matchVehicleDriverOption,
  assignVehicleDriver,
  EmployeeAccountRecord,
  VehicleDriverOption,
  KNOWN_DRIVER_EMP_CODES,
  normalizeDriverNameKey,
} from './services/googleSheets';
import { SheetColumn, SheetDataResult, SheetRow, SheetTabConfig } from './types';
import { RecordDetailModal } from './components/RecordDetailModal';
import {
  JobTransferModal,
  removeStoredActiveJobsByMatches,
  getCurrentTimeString,
  calculateDurationString,
} from './components/JobTransferModal';
import { DeliveryPointModal } from './components/DeliveryPointModal';
import { SheetWebhookModal } from './components/SheetWebhookModal';
import { RepairRequestModal } from './components/RepairRequestModal';
import { ManagerApprovalModal } from './components/ManagerApprovalModal';
import { AttachRepairPhotosModal } from './components/AttachRepairPhotosModal';
import { FuelRecordModal } from './components/FuelRecordModal';
import { TireStockModal } from './components/TireStockModal';
import { FuelCharts } from './components/FuelCharts';
import { FuelMonthlySummaryView } from './components/FuelMonthlySummaryView';
import { JobTransferStatsView } from './components/JobTransferStatsView';
import { EmployeeManagementView } from './components/EmployeeManagementView';
import { MaintenanceCalendarView } from './components/MaintenanceCalendarView';
import { DrivePhotoImg } from './components/DrivePhotoImg';
import { PWAInstallButton } from './components/PWAInstallButton';
import { APP_VERSION } from './version';
import { showSuccessToast } from './utils/swal';
import {
  formatCompletionPercentage,
  parseThaiDateToTimestamp,
  getRowApprovalStatus,
  calculatePendingApprovalCount,
  parseNumericCell,
} from './utils/sheetMetrics';

const PAGE_SIZE = 30;

function isDurationExceeding20Minutes(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return false;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds > 20 * 60;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds > 20 * 60;
  }
  return false;
}

function parseIsoInputDateToTimestamp(isoDate: string): number | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
}

const REPAIR_STATUS_GROUP_ORDER: string[] = [
  'รอตรวจสอบ',
  'รออนุมัติ',
  'ขอข้อมูลเพิ่มเติม',
  'ตอบกลับข้อมูลเพิ่มเติมแล้ว',
  'อนุมัติ',
  'ไม่อนุมัติ',
];

function getRowJobTransferStatus(row: SheetRow, columns?: SheetColumn[]): string {
  const statusCol = columns?.find(
    (c) =>
      c.label.trim() === 'สถานะ' ||
      c.label.trim().toUpperCase() === 'STATUS' ||
      c.id === 'M'
  );
  const raw =
    (statusCol ? row.values[statusCol.id] : row.values['M']) ??
    row.values['M'] ??
    row.values['STATUS'] ??
    row.values['สถานะ'] ??
    '';
  const trimmed = raw.trim();
  if (trimmed) {
    return trimmed;
  }
  const hasStartData = Boolean(
    (row.values['A'] ?? '').trim() ||
      (row.values['C'] ?? '').trim() ||
      (row.values['D'] ?? '').trim() ||
      (row.values['I'] ?? '').trim()
  );
  if (hasStartData) {
    return 'อยู่ระว่างการส่ง';
  }
  return 'ไม่ระบุสถานะ';
}

function isJobTransferInTransitStatus(statusText: string): boolean {
  const s = statusText.trim();
  return (
    s.includes('อยู่ระว่าง') ||
    s.includes('อยู่ระหว่าง') ||
    s.includes('ระว่าง') ||
    s.includes('ระหว่าง') ||
    s.includes('กำลัง')
  );
}

function getJobTransferRowKey(row: SheetRow): string {
  const recId = (row.values['Q'] ?? '').trim();
  if (recId) return `rec:${recId}`;
  return `row:${row.rowNumber}|${(row.values['A'] ?? '').trim()}|${(row.values['C'] ?? '').trim()}|${(row.values['D'] ?? '').trim()}|${(row.values['I'] ?? '').trim()}|${(row.values['F'] ?? '').trim()}|${(row.values['H'] ?? '').trim()}`;
}

function renderJobTransferStatusBadge(statusText: string): React.ReactNode {
  const s = statusText.trim();
  if (isJobTransferInTransitStatus(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100/90 px-2.5 py-0.5 text-xs font-bold text-amber-900 whitespace-nowrap">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        <span>{s}</span>
      </span>
    );
  }
  if (s.includes('เรียบร้อย') || s.includes('สำเร็จ')) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100/90 px-2.5 py-0.5 text-xs font-bold text-emerald-900 whitespace-nowrap">
        <span className="h-2 w-2 rounded-full bg-emerald-600" />
        <span>{s}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
      <span>{s || '-'}</span>
    </span>
  );
}

function getRowVehicleShift(row: SheetRow, columns?: SheetColumn[]): string {
  const shiftCol = columns?.find(
    (c) => c.label.trim() === 'กะทำงาน' || c.label.trim() === 'กะ'
  );
  const raw = (shiftCol ? row.values[shiftCol.id] : row.values['L']) ?? row.values['L'] ?? '';
  const trimmed = raw.trim();
  return trimmed ? `กะ: ${trimmed}` : 'ไม่ระบุกะทำงาน';
}

function getRowTireItemGroup(row: SheetRow, columns?: SheetColumn[]): string {
  const itemCol = columns?.find((c) => c.label.trim() === 'รายการ' || c.id === 'B');
  const raw = (itemCol ? row.values[itemCol.id] : row.values['B']) ?? row.values['B'] ?? '';
  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized || 'ไม่ระบุรายการยาง';
}

function getRowFuelStatus(row: SheetRow, columns?: SheetColumn[]): string {
  const inColId = columns?.find((c) => c.label.includes('รับเข้า'))?.id ?? 'E';
  const outColId = columns?.find((c) => c.label.includes('จ่ายออก'))?.id ?? 'G';

  const inRaw = row.rawValues[inColId] ?? row.rawValues['E'];
  const inVal =
    typeof inRaw === 'number'
      ? inRaw
      : parseFloat(String(row.values[inColId] ?? row.values['E'] ?? '').replace(/,/g, '').trim());

  if (!Number.isNaN(inVal) && inVal > 0) {
    return 'รับเข้า';
  }

  const outRaw = row.rawValues[outColId] ?? row.rawValues['G'];
  const outVal =
    typeof outRaw === 'number'
      ? outRaw
      : parseFloat(String(row.values[outColId] ?? row.values['G'] ?? '').replace(/,/g, '').trim());

  if (!Number.isNaN(outVal) && outVal > 0) {
    return 'เบิกออก';
  }

  const statusCol = columns?.find(
    (c) => c.label.trim().toUpperCase() === 'STATUS' || c.id === 'S'
  );
  const raw =
    (statusCol ? row.values[statusCol.id] : row.values['S']) ??
    row.values['S'] ??
    row.values['STATUS'] ??
    '';
  const trimmed = raw.trim();
  if (trimmed.includes('รับเข้า')) return 'รับเข้า';
  if (trimmed.includes('เบิก') || trimmed.includes('จ่าย')) return 'เบิกออก';
  return trimmed || 'เบิกออก';
}

interface StatusGroupHeaderTheme {
  rowClass: string;
  chevronClass: string;
  titleClass: string;
  countClass: string;
  actionClass: string;
}

function getStatusGroupHeaderTheme(status: string, gid: string): StatusGroupHeaderTheme {
  const s = status.trim();

  if (s.includes('รับเข้า')) {
    return {
      rowClass:
        'bg-gradient-to-r from-emerald-600/15 via-emerald-500/10 to-teal-500/5 hover:from-emerald-600/25 hover:via-emerald-500/15 border-y border-emerald-200/90',
      chevronClass: 'bg-emerald-600 text-white shadow-xs',
      titleClass: 'text-emerald-950',
      countClass: 'bg-emerald-600 text-white shadow-2xs',
      actionClass: 'text-emerald-700',
    };
  }

  if (s.includes('เบิกออก') || s.includes('จ่ายออก')) {
    return {
      rowClass:
        'bg-gradient-to-r from-amber-500/20 via-amber-400/12 to-orange-400/5 hover:from-amber-500/30 hover:via-amber-400/20 border-y border-amber-300/90',
      chevronClass: 'bg-amber-500 text-white shadow-xs',
      titleClass: 'text-amber-950',
      countClass: 'bg-amber-600 text-white shadow-2xs',
      actionClass: 'text-amber-800',
    };
  }

  // บันทึกงานซ่อม (gid: 944294225) & บันทึกการย้ายงาน (gid: 606634465)
  if (
    s === 'อนุมัติ' ||
    s.includes('ส่งสินค้าเรียบร้อย') ||
    s.includes('เรียบร้อย') ||
    s.includes('สำเร็จ') ||
    s.includes('ซ่อมเสร็จ')
  ) {
    return {
      rowClass:
        'bg-gradient-to-r from-emerald-600/15 via-emerald-500/10 to-teal-500/5 hover:from-emerald-600/25 hover:via-emerald-500/15 border-y border-emerald-200/90',
      chevronClass: 'bg-emerald-600 text-white shadow-xs',
      titleClass: 'text-emerald-950',
      countClass: 'bg-emerald-600 text-white shadow-2xs',
      actionClass: 'text-emerald-700',
    };
  }

  if (s === 'รอตรวจสอบ') {
    return {
      rowClass:
        'bg-gradient-to-r from-sky-600/15 via-sky-500/10 to-blue-500/5 hover:from-sky-600/25 hover:via-sky-500/15 border-y border-sky-200/90',
      chevronClass: 'bg-sky-600 text-white shadow-xs',
      titleClass: 'text-sky-950',
      countClass: 'bg-sky-600 text-white shadow-2xs',
      actionClass: 'text-sky-700',
    };
  }

  if (
    s === 'รออนุมัติ' ||
    s === 'รอพิจารณา' ||
    s.includes('อยู่ระหว่าง') ||
    s.includes('อยู่ระว่าง') ||
    s.includes('ระหว่าง') ||
    s.includes('ระว่าง') ||
    s.includes('กำลังส่ง') ||
    s.includes('กำลังย้าย') ||
    s.includes('ย้าย') ||
    s.includes('กำลัง') ||
    s.includes('ส่ง') ||
    s.includes('กำลังดำเนินการ') ||
    s.includes('กำลังซ่อม') ||
    s.includes('รอคิว') ||
    s.includes('รออะไหล่')
  ) {
    return {
      rowClass:
        'bg-gradient-to-r from-amber-500/20 via-amber-400/12 to-orange-400/5 hover:from-amber-500/30 hover:via-amber-400/20 border-y border-amber-300/90',
      chevronClass: 'bg-amber-500 text-white shadow-xs',
      titleClass: 'text-amber-950',
      countClass: 'bg-amber-600 text-white shadow-2xs',
      actionClass: 'text-amber-800',
    };
  }

  if (s === 'ขอข้อมูลเพิ่มเติม' || s.includes('ข้อมูลเพิ่มเติม')) {
    if (s.includes('ตอบกลับ')) {
      return {
        rowClass:
          'bg-gradient-to-r from-indigo-600/15 via-indigo-500/10 to-cyan-500/5 hover:from-indigo-600/25 hover:via-indigo-500/15 border-y border-indigo-200/90',
        chevronClass: 'bg-indigo-600 text-white shadow-xs',
        titleClass: 'text-indigo-950',
        countClass: 'bg-indigo-600 text-white shadow-2xs',
        actionClass: 'text-indigo-700',
      };
    }
    return {
      rowClass:
        'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-purple-500/5 hover:from-violet-600/25 hover:via-violet-500/15 border-y border-violet-200/90',
      chevronClass: 'bg-violet-600 text-white shadow-xs',
      titleClass: 'text-violet-950',
      countClass: 'bg-violet-600 text-white shadow-2xs',
      actionClass: 'text-violet-700',
    };
  }

  if (s === 'ไม่อนุมัติ' || s.includes('ยกเลิก') || s.includes('ไม่ผ่าน')) {
    return {
      rowClass:
        'bg-gradient-to-r from-rose-600/15 via-rose-500/10 to-red-500/5 hover:from-rose-600/25 hover:via-rose-500/15 border-y border-rose-200/90',
      chevronClass: 'bg-rose-600 text-white shadow-xs',
      titleClass: 'text-rose-950',
      countClass: 'bg-rose-600 text-white shadow-2xs',
      actionClass: 'text-rose-700',
    };
  }

  if (gid === '606634465' || gid === '944294225') {
    return {
      rowClass:
        'bg-gradient-to-r from-blue-600/15 via-indigo-500/10 to-sky-500/5 hover:from-blue-600/25 hover:via-indigo-500/15 border-y border-blue-200/90',
      chevronClass: 'bg-blue-600 text-white shadow-xs',
      titleClass: 'text-blue-950',
      countClass: 'bg-blue-600 text-white shadow-2xs',
      actionClass: 'text-blue-700',
    };
  }

  return {
    rowClass:
      'bg-gradient-to-r from-slate-200/80 via-slate-100/90 to-slate-50 hover:from-slate-200 hover:via-slate-200/70 border-y border-slate-200',
    chevronClass: 'bg-slate-700 text-white shadow-xs',
    titleClass: 'text-slate-900',
    countClass: 'bg-slate-700 text-white shadow-2xs',
    actionClass: 'text-slate-600',
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<SheetTabConfig>(SHEET_TABS[0]);
  const [sheetData, setSheetData] = useState<SheetDataResult | null>(null);
  const [showJobTransferStats, setShowJobTransferStats] = useState<boolean>(false);
  const [showEmployeeManagement, setShowEmployeeManagement] = useState<boolean>(false);
  const [showMaintenanceCalendar, setShowMaintenanceCalendar] = useState<boolean>(false);
  const [repairTabRows, setRepairTabRows] = useState<SheetRow[]>([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [groupPages, setGroupPages] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedColumnId, setSelectedColumnId] = useState<string>('ALL');
  const [quickFilterValue, setQuickFilterValue] = useState<string>('ALL');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [rowLimit, setRowLimit] = useState<number>(SHEET_TABS[0].defaultLimit ?? 250);
  const [deepSearchTerm, setDeepSearchTerm] = useState<string>('');

  // Auto-refresh interval in seconds (0 = off, default 90s to avoid 429 rate limit)
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(90);

  // Sorting & Pagination
  const [sortConfig, setSortConfig] = useState<{
    colId: string;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Selected row for detail modal
  const [selectedRow, setSelectedRow] = useState<SheetRow | null>(null);

  // Job Transfer & Delivery Point creation modals
  const [isJobModalOpen, setIsJobModalOpen] = useState<boolean>(false);
  const [isDeliveryPointModalOpen, setIsDeliveryPointModalOpen] = useState<boolean>(false);
  const [isFuelModalOpen, setIsFuelModalOpen] = useState<boolean>(false);
  const [fuelViewMode, setFuelViewMode] = useState<'summary' | 'rawTable'>('summary');
  const [isTireModalOpen, setIsTireModalOpen] = useState<boolean>(false);
  const [tireModalInitType, setTireModalInitType] = useState<'IN' | 'OUT'>('OUT');
  const [tireModalInitCode, setTireModalInitCode] = useState<string>('');
  const [tireLowStockOnly, setTireLowStockOnly] = useState<boolean>(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState<boolean>(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState<boolean>(false);
  const [attachingPhotoRow, setAttachingPhotoRow] = useState<SheetRow | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  // Accordion toggle state for sidebar menus with submenus (hidden by default)
  const [expandedSidebarSubmenus, setExpandedSidebarSubmenus] = useState<Record<string, boolean>>({});

  // Selection & batch completion state for in-transit rows in บันทึกการย้ายงาน (gid: 606634465)
  const [selectedInTransitKeys, setSelectedInTransitKeys] = useState<Set<string>>(new Set());
  const [batchFinishConfirmRows, setBatchFinishConfirmRows] = useState<SheetRow[] | null>(null);
  const [isBatchFinishingTable, setIsBatchFinishingTable] = useState<boolean>(false);

  // Inline editing state for จุดส่งสินค้า -> คอลัมน์ ประตู, ฐานข้อมูลรถ -> คอลัมน์ ทะเบียนรถ, และ บันทึกงานซ่อม -> คอลัมน์ รายละเอียดเพิ่มเติม / ตอบกลับข้อมูลเพิ่มเติม
  const [editingGateRowNumber, setEditingGateRowNumber] = useState<number | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingGateValue, setEditingGateValue] = useState<string>('');
  const [confirmingGateRowNumber, setConfirmingGateRowNumber] = useState<number | null>(
    null
  );
  const [isUpdatingGate, setIsUpdatingGate] = useState<boolean>(false);

  // Employee accounts from Account sheet for "ชื่อพนักงานประจำรถ" Dropdown in ฐานข้อมูลรถ
  const [employeeAccounts, setEmployeeAccounts] = useState<EmployeeAccountRecord[]>([]);
  const [updatingDriverRowNumber, setUpdatingDriverRowNumber] = useState<number | null>(null);
  const vehicleDriverOptions = useMemo<VehicleDriverOption[]>(
    () => buildVehicleDriverOptions(employeeAccounts),
    [employeeAccounts]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchEmployeeAccounts()
        .then((accounts) => {
          if (!cancelled && accounts.length > 0) {
            setEmployeeAccounts(accounts);
          }
        })
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.35);
    gain2.gain.setValueAtTime(0.35, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);
  } catch {
    // ignore
  }
}

  const [notificationPermission, setNotificationPermission] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default'
  );
  const [newRepairToast, setNewRepairToast] = useState<{
    vehicle: string;
    symptom: string;
    reporter: string;
  } | null>(null);

  const seenRepairIdsRef = useRef<Set<string>>(new Set());
  const isInitialRepairLoadRef = useRef<boolean>(true);

  const urlBase64ToUint8Array = useCallback((base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }, []);

  const registerAndSubscribeWebPush = useCallback(async (): Promise<{
    subscribed: boolean;
    subscriptionJson?: PushSubscriptionJSON;
  }> => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return { subscribed: false };
    }

    try {
      const existingReg = await navigator.serviceWorker.getRegistration('/');
      const reg =
        existingReg ??
        (await navigator.serviceWorker.register('/push-sw.js', { scope: '/' }));
      await navigator.serviceWorker.ready;

      if (!('pushManager' in reg)) {
        return { subscribed: false };
      }

      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) return { subscribed: false };
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) return { subscribed: false };

      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      const subJson = subscription.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subJson,
          userAgent: navigator.userAgent,
        }),
      });

      return { subscribed: true, subscriptionJson: subJson };
    } catch {
      return { subscribed: false };
    }
  }, [urlBase64ToUint8Array]);

  const handleUpdateRepairRows = useCallback((rows: SheetRow[]) => {
    setRepairTabRows(rows);
    setPendingApprovalCount(calculatePendingApprovalCount(rows));

    if (rows.length === 0) return;

    if (isInitialRepairLoadRef.current) {
      rows.forEach((r) => {
        const key = String(r.values['A'] || r.rowNumber);
        seenRepairIdsRef.current.add(key);
      });
      isInitialRepairLoadRef.current = false;
    } else {
      const newItems: SheetRow[] = [];
      rows.forEach((r) => {
        const key = String(r.values['A'] || r.rowNumber);
        if (!seenRepairIdsRef.current.has(key)) {
          seenRepairIdsRef.current.add(key);
          newItems.push(r);
        }
      });

      if (newItems.length > 0) {
        const latestNew = newItems[0];
        const vehicle =
          latestNew.values['D'] ||
          latestNew.values['O'] ||
          latestNew.values['vehicleNumber'] ||
          'ไม่ระบุเบอร์รถ';
        const symptom =
          latestNew.values['F'] ||
          latestNew.values['symptoms'] ||
          latestNew.values['E'] ||
          'แจ้งซ่อมใหม่';
        const reporter =
          latestNew.values['AA'] || latestNew.values['reporterName'] || '';

        setNewRepairToast({ vehicle, symptom, reporter });
        playNotificationChime();

        if ('Notification' in window && Notification.permission === 'granted') {
          const title = `🔔 มีรายการแจ้งซ่อมใหม่! (${vehicle})`;
          const body = `อาการ: ${symptom}${reporter ? ` | ผู้แจ้ง: ${reporter}` : ''}`;
          try {
            if ('serviceWorker' in navigator) {
              void navigator.serviceWorker.ready.then((reg) => {
                void reg.showNotification(title, {
                  body,
                  icon: '/pwa-192x192.png',
                  badge: '/pwa-192x192.png',
                  tag: `repair-${latestNew.rowNumber}`,
                });
              });
            } else {
              new Notification(title, {
                body,
                icon: '/pwa-192x192.png',
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }, []);

  const handleToggleMobileNotifications = async () => {
    if (!('Notification' in window)) {
      setError('เบราว์เซอร์นี้ไม่รองรับระบบการแจ้งเตือนบนหน้าจอ');
      return;
    }

    try {
      const res = await Notification.requestPermission();
      setNotificationPermission(res);
      if (res === 'granted') {
        playNotificationChime();
        const { subscribed, subscriptionJson } = await registerAndSubscribeWebPush();

        if (subscribed) {
          await fetch('/api/push/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subscriptionJson }),
          }).catch(() => {});
          setSaveSuccessMsg(
            'เปิดระบบแจ้งเตือนพื้นหลัง (Web Push) สำเร็จ แม้ปิดแอปหรือล็อกหน้าจอก็จะได้รับการแจ้งเตือน'
          );
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        } else {
          const title = '🔔 เปิดการแจ้งเตือนงานซ่อมเรียบร้อย';
          const body =
            'ระบบจะส่งการแจ้งเตือนเด้งไปที่หน้าจอมือถือทันทีเมื่อมีรายการแจ้งซ่อมใหม่';
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            void reg.showNotification(title, { body, icon: '/pwa-192x192.png' });
          } else {
            new Notification(title, { body, icon: '/pwa-192x192.png' });
          }
        }
      } else if (res === 'denied') {
        setError(
          'สิทธิ์การแจ้งเตือนถูกปฏิเสธ กรุณาอนุญาตการแจ้งเตือนในการตั้งค่าเบราว์เซอร์ของมือถือ'
        );
      }
    } catch {
      // ignore
    }
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repairBgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(
    async (options?: { silent?: boolean; remoteSearch?: string }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort('superseded');
      }
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      if (repairBgTimerRef.current) {
        clearTimeout(repairBgTimerRef.current);
        repairBgTimerRef.current = null;
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      // Safety watchdog: ensure spinner NEVER hangs indefinitely
      syncTimeoutRef.current = setTimeout(() => {
        isFetchingRef.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }, 45000);

      if (options?.silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const result = await fetchSheetTabData(activeTab, {
          limit: rowLimit,
          remoteSearchQuery: options?.remoteSearch ?? deepSearchTerm,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setSheetData(result);

        if (activeTab.gid === '378250263') {
          void fetchEmployeeAccounts()
            .then((accounts) => {
              if (!controller.signal.aborted && accounts.length > 0) {
                setEmployeeAccounts(accounts);
              }
            })
            .catch(() => {});
        }

        if (activeTab.gid === '944294225') {
          handleUpdateRepairRows(result.rows);
        } else {
          // Stagger background repair fetch by 800ms so active tab renders first without concurrent load
          const repairTabConfig = SHEET_TABS.find((t) => t.gid === '944294225');
          if (repairTabConfig) {
            repairBgTimerRef.current = setTimeout(() => {
              if (controller.signal.aborted) return;
              void fetchSheetTabData(repairTabConfig, {
                limit: 250,
              })
                .then((repairRes) => {
                  if (!controller.signal.aborted) {
                    handleUpdateRepairRows(repairRes.rows);
                  }
                })
                .catch(() => {});
            }, 800);
          }
        }
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          (err as { name?: string })?.name === 'AbortError'
        ) {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Google Sheets'
        );
      } finally {
        if (syncTimeoutRef.current) {
          clearTimeout(syncTimeoutRef.current);
          syncTimeoutRef.current = null;
        }
        isFetchingRef.current = false;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeTab, rowLimit, deepSearchTerm, handleUpdateRepairRows]
  );

  const handleManualSync = useCallback(async () => {
    setIsRefreshing(true);
    try {
      try {
        await flushPendingMutationsToGoogleSheet();
      } catch {
        // ignore
      }
      await loadData({ silent: true });
      showSuccessToast('ซิงค์ข้อมูลสำเร็จ!', 'ดึงข้อมูลล่าสุดจาก Google Sheets เรียบร้อยแล้ว');
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [loadData]);

  // Silence cancelled fetch AbortError rejections so they never pollute the console
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const isAbort =
        reason?.name === 'AbortError' ||
        String(reason?.message || reason || '').includes('aborted') ||
        String(reason?.message || reason || '').includes('AbortError');
      if (isAbort) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  // Initial load and when activeTab / rowLimit / deepSearchTerm changes
  useEffect(() => {
    void loadData({ silent: false }).catch(() => {});
    return () => {
      abortControllerRef.current?.abort('unmount');
      if (repairBgTimerRef.current) {
        clearTimeout(repairBgTimerRef.current);
        repairBgTimerRef.current = null;
      }
    };
  }, [loadData]);

  // Register Service Worker & Web Push subscription + handle background push events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check URL parameter ?tab=repair when opened from notification
    if (window.location.search.includes('tab=repair')) {
      const repairTab = SHEET_TABS.find((t) => t.gid === '944294225');
      if (repairTab) {
        setActiveTab(repairTab);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration('/')
        .then((existingReg) => {
          if (!existingReg) {
            return navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
          }
          return existingReg;
        })
        .catch(() => {});

      if ('Notification' in window && Notification.permission === 'granted') {
        void registerAndSubscribeWebPush();
      }

      const handleServiceWorkerMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'PUSH_REPAIR_RECEIVED') {
          playNotificationChime();
          const payload = msg.payload || {};
          if (payload.vehicle || payload.symptom) {
            setNewRepairToast({
              vehicle: payload.vehicle || 'แจ้งซ่อมใหม่',
              symptom: payload.symptom || 'มีรายการแจ้งซ่อมใหม่เข้ามาในระบบ',
              reporter: payload.reporter || '',
            });
          }
          void loadData({ silent: true });
        } else if (msg.type === 'OPEN_REPAIR_TAB') {
          const repairTab = SHEET_TABS.find((t) => t.gid === '944294225');
          if (repairTab) {
            setActiveTab(repairTab);
          }
          void loadData({ silent: true });
        }
      };

      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && !isFetchingRef.current) {
          void loadData({ silent: true });
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [registerAndSubscribeWebPush, loadData]);

  // Real-time polling
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const timer = setInterval(() => {
      if (isFetchingRef.current) return;
      void loadData({ silent: true }).catch(() => {});
    }, refreshIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [refreshIntervalSec, loadData]);

  const handleSelectTab = (tab: SheetTabConfig) => {
    const wasInCustomView = showEmployeeManagement || showMaintenanceCalendar || showJobTransferStats;
    setIsSidebarOpen(false);
    setShowJobTransferStats(false);
    setShowEmployeeManagement(false);
    setShowMaintenanceCalendar(false);
    if (tab.gid === activeTab.gid && !wasInCustomView) return;
    setActiveTab(tab);
    setRowLimit(tab.defaultLimit ?? 250);
    setSearchQuery('');
    setDeepSearchTerm('');
    setSelectedColumnId('ALL');
    setQuickFilterValue('ALL');
    setFuelViewMode('summary');
    setTireLowStockOnly(false);
    setStartDateFilter('');
    setEndDateFilter('');
    setSortConfig(null);
    setCurrentPage(1);
    setCollapsedGroups({});
    setGroupPages({});
    setEditingGateRowNumber(null);
    setEditingColumnId(null);
    setConfirmingGateRowNumber(null);
  };

  const handleAssignVehicleDriver = useCallback(
    async (row: SheetRow, selectedDriverName: string) => {
      const cleanSelected = selectedDriverName.replace(/\s+/g, ' ').trim();
      const matched = matchVehicleDriverOption(cleanSelected, vehicleDriverOptions);
      const finalDriverName = matched ? matched.fullName : cleanSelected;
      const finalEmpCode = finalDriverName
        ? matched?.employeeCode ||
          KNOWN_DRIVER_EMP_CODES[normalizeDriverNameKey(finalDriverName)] ||
          ''
        : '';
      const finalEmpImage = finalDriverName
        ? matched?.image || undefined
        : '';
      const vehicleReg = (row.values['A'] ?? '').trim() || `#${row.rowNumber}`;

      setUpdatingDriverRowNumber(row.rowNumber);
      setError(null);
      try {
        const res = await assignVehicleDriver({
          rowNumber: row.rowNumber,
          driverName: finalDriverName,
          employeeCode: finalEmpCode,
          employeeImage: finalEmpImage,
        });

        row.values['I'] = res.driverName;
        row.rawValues['I'] = res.driverName;
        row.values['P'] = res.employeeCode;
        row.rawValues['P'] = res.employeeCode;
        if (res.employeeImage !== undefined) {
          row.values['M'] = res.employeeImage;
          row.rawValues['M'] = res.employeeImage;
        }

        setSheetData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((r) =>
              r.rowNumber === row.rowNumber
                ? {
                    ...r,
                    values: {
                      ...r.values,
                      I: res.driverName,
                      P: res.employeeCode,
                      ...(res.employeeImage !== undefined ? { M: res.employeeImage } : {}),
                    },
                    rawValues: {
                      ...r.rawValues,
                      I: res.driverName,
                      P: res.employeeCode,
                      ...(res.employeeImage !== undefined ? { M: res.employeeImage } : {}),
                    },
                  }
                : r
            ),
          };
        });

        const msg = res.driverName
          ? `ผูกข้อมูลพนักงาน "${res.driverName}"${res.employeeCode ? ` (รหัส ${res.employeeCode})` : ''} กับรถ ${vehicleReg} เรียบร้อยแล้ว`
          : `ถอดรายชื่อพนักงานประจำรถออกจากรถ ${vehicleReg} เรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('อัปเดตพนักงานประจำรถสำเร็จ!', msg);
        void loadData({ silent: true });
        setTimeout(() => setSaveSuccessMsg(null), 5000);
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาดในการบันทึกข้อมูลพนักงานประจำรถ'
        );
      } finally {
        setUpdatingDriverRowNumber(null);
      }
    },
    [vehicleDriverOptions, loadData]
  );

  const renderVehicleDriverSelectCell = (row: SheetRow, rawVal: string) => {
    const cleanVal = rawVal === '-' ? '' : rawVal.replace(/\s+/g, ' ').trim();
    const matched = matchVehicleDriverOption(cleanVal, vehicleDriverOptions);
    const selectVal = matched ? matched.fullName : cleanVal;
    const currentEmpCode = matched?.employeeCode || (row.values['P'] ?? '').trim();
    const isRowSaving = updatingDriverRowNumber === row.rowNumber;

    return (
      <div
        className="flex items-center gap-1.5 min-w-[210px] sm:min-w-[240px]"
        onClick={(e) => e.stopPropagation()}
      >
        <select
          value={selectVal}
          disabled={isRowSaving}
          onChange={(e) => {
            void handleAssignVehicleDriver(row, e.target.value);
          }}
          title={
            selectVal
              ? `${currentEmpCode && currentEmpCode !== '-' ? `${currentEmpCode} - ` : ''}${selectVal}`
              : 'เลือกพนักงานประจำรถจากชีต Account'
          }
          className={`w-full rounded-md border px-2 py-1 text-xs font-semibold transition-colors focus:border-slate-900 focus:outline-none shadow-2xs ${
            selectVal
              ? 'border-slate-300 bg-white text-slate-900 hover:border-slate-400'
              : 'border-dashed border-slate-300 bg-slate-50/80 text-slate-500 hover:border-slate-400'
          } ${isRowSaving ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
        >
          <option value="">-- ไม่ระบุพนักงาน (ว่าง) --</option>
          {cleanVal && !matched && (
            <option value={cleanVal}>
              {currentEmpCode && currentEmpCode !== '-'
                ? `${currentEmpCode} - ${cleanVal}`
                : cleanVal}
            </option>
          )}
          {vehicleDriverOptions.map((opt) => (
            <option key={opt.normalizedKey || opt.fullName} value={opt.fullName}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const handleConfirmGateUpdate = async (row: SheetRow) => {
    const newValue = editingGateValue.trim();
    const isVehicleTab = activeTab.gid === '378250263';
    const isJobTransferTab = activeTab.gid === '606634465';
    const isRepairTab = activeTab.gid === '944294225';
    const oldValue = isVehicleTab
      ? (row.values['A'] ?? '').trim()
      : isJobTransferTab
        ? (row.values['N'] ?? '').trim()
        : isRepairTab
          ? (row.values['AK'] ?? '').trim()
          : (row.values['C'] ?? '').trim();

    if (!isJobTransferTab && !isRepairTab && !newValue) return;
    if (newValue === oldValue) {
      setEditingGateRowNumber(null);
      setConfirmingGateRowNumber(null);
      return;
    }

    setIsUpdatingGate(true);
    setError(null);

    try {
      if (isRepairTab) {
        const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
        const repairRequestNo = (row.values['G'] ?? '').trim();

        if (editingColumnId === 'AM' || editingColumnId === 'ตอบกลับข้อมูลเพิ่มเติม') {
          await updateRepairReplyDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            replyDetails: newValue,
          });

          // Update local row immediately
          row.values['AM'] = newValue;

          setEditingGateRowNumber(null);
          setEditingColumnId(null);
          setConfirmingGateRowNumber(null);
          const msg = newValue
            ? `บันทึกการตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`
            : `ล้างการตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`;
          setSaveSuccessMsg(msg);
          showSuccessToast('บันทึกการตอบกลับสำเร็จ!', msg);
        } else {
          await updateRepairAdditionalDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            additionalDetails: newValue,
          });

          // Update local row immediately
          row.values['AK'] = newValue;

          setEditingGateRowNumber(null);
          setEditingColumnId(null);
          setConfirmingGateRowNumber(null);
          const msg = newValue
            ? `บันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`
            : `ล้างรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`;
          setSaveSuccessMsg(msg);
          showSuccessToast('บันทึกรายละเอียดเพิ่มเติมสำเร็จ!', msg);
        }
      } else if (isJobTransferTab) {
        const date = (row.values['A'] ?? '').trim();
        const driverName = (row.values['C'] ?? '').trim();
        const vehicleNumber = (row.values['D'] ?? '').trim();
        const startTime = (row.values['I'] ?? '').trim();

        await updateJobTransferNote({
          rowNumber: row.rowNumber,
          date,
          driverName,
          vehicleNumber,
          startTime,
          note: newValue,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        const msg = newValue
          ? `บันทึกหมายเหตุเรียบร้อยแล้ว`
          : `ล้างหมายเหตุเรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('บันทึกหมายเหตุสำเร็จ!', msg);
      } else if (isVehicleTab) {
        const driverName = (row.values['I'] ?? '').trim();
        const shift = (row.values['L'] ?? '').trim();

        await updateVehicleRegistration({
          oldRegistration: oldValue,
          newRegistration: newValue,
          driverName,
          shift,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        const msg = `อัปเดตทะเบียนรถจาก "${oldValue}" เป็น "${newValue}" เรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('อัปเดตทะเบียนรถสำเร็จ!', msg);
      } else {
        const deliveryPoint = (row.values['B'] ?? '').trim();
        const now = new Date();
        const updatedDate = `${now.getDate()}/${now.getMonth() + 1}/${
          now.getFullYear() + 543
        }`;

        await updateDeliveryPointGate({
          deliveryPoint,
          oldGate: oldValue,
          newGate: newValue,
          updatedDate,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        const msg = `อัปเดตประตูของจุดส่งสินค้า ${deliveryPoint} เป็น "${newValue}" เรียบร้อยแล้ว`;
        setSaveSuccessMsg(msg);
        showSuccessToast('อัปเดตข้อมูลสำเร็จ!', msg);
      }

      loadData({ silent: true });
      setTimeout(() => {
        setSaveSuccessMsg(null);
      }, 5000);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล'
      );
    } finally {
      setIsUpdatingGate(false);
    }
  };

  // Detect primary status/category column for quick filter buttons
  const quickFilterColumn = useMemo<SheetColumn | null>(() => {
    if (!sheetData) return null;
    const candidates = [
      'สถานะ',
      'สถานะการใช้งาน',
      'สถานะการอนุมัติ',
      'ประเภทสินค้า',
      'ประเภทรถ',
      'ประเภทการซ่อม',
      'STATUS',
      'ครบรอบPM',
      'ยี่ห้อ',
      'จุดส่งสินค้า',
    ];
    for (const label of candidates) {
      const found = sheetData.columns.find((c) => c.label.trim() === label);
      if (found) return found;
    }
    return null;
  }, [sheetData]);

  const quickFilterOptions = useMemo<string[]>(() => {
    if (activeTab.gid === '944294225') {
      return [
        'รอตรวจสอบ',
        'รอคิวซ่อม',
        'ซ่อมเสร็จแล้ว',
        'กำลังซ่อม',
        'ตรวจสอบแล้ว',
        'ผู้ใช้งานแจ้งซ่อม',
        'รออะไหล่',
        'รอข้อมูลเพิ่มเติม',
      ];
    }
    if (!sheetData || !quickFilterColumn) return [];
    const counts = new Map<string, number>();
    sheetData.rows.forEach((row) => {
      const val =
        activeTab.gid === '606634465'
          ? getRowJobTransferStatus(row, sheetData.columns).trim()
          : row.values[quickFilterColumn.id]?.trim();
      if (val) {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
    });
    if (activeTab.gid === '606634465') {
      if (!counts.has('อยู่ระว่างการส่ง')) {
        counts.set('อยู่ระว่างการส่ง', 0);
      }
      if (!counts.has('ส่งสินค้าเรียบร้อยแล้ว')) {
        counts.set('ส่งสินค้าเรียบร้อยแล้ว', 0);
      }
      const priorityOrder = ['อยู่ระว่างการส่ง', 'ส่งสินค้าเรียบร้อยแล้ว'];
      const sorted = Array.from(counts.keys()).sort((a, b) => {
        const idxA = priorityOrder.indexOf(a);
        const idxB = priorityOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      });
      return sorted.slice(0, 7);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([val]) => val);
  }, [sheetData, quickFilterColumn, activeTab.gid]);

  // Filter rows by date range, search query, selected column, and quick filter
  const filteredRows = useMemo<SheetRow[]>(() => {
    if (!sheetData) return [];
    const q = searchQuery.trim().toLowerCase();
    const startTs = parseIsoInputDateToTimestamp(startDateFilter);
    const endTs = parseIsoInputDateToTimestamp(endDateFilter);

    // Identify primary date column (Col B for הבันทึกน้ำมัน, Col A for บันทึกการย้ายงาน or any column with 'วัน' or 'date')
    const dateCol =
      (activeTab.gid === '1733355146'
        ? (sheetData.allColumns ?? sheetData.columns).find(
            (c) => c.id === 'B' || c.label.includes('วันที่')
          )
        : undefined) ||
      sheetData.columns.find((c) => c.id === 'A' && (c.type === 'date' || c.label.includes('วัน'))) ||
      sheetData.columns.find((c) => c.label.includes('วันที่') || c.type === 'date');

    return sheetData.rows.filter((row) => {
      // Date range filtering
      if (startTs !== null || endTs !== null) {
        const fallbackDateColId = activeTab.gid === '1733355146' ? 'B' : 'A';
        const rawDateStr = dateCol
          ? (row.values[dateCol.id] ?? row.values[fallbackDateColId] ?? '')
          : (row.values[fallbackDateColId] ?? '');
        const rowTs = parseThaiDateToTimestamp(rawDateStr);
        if (rowTs === null) return false;
        if (startTs !== null && rowTs < startTs) return false;
        if (endTs !== null && rowTs > endTs) return false;
      }

      if (quickFilterValue !== 'ALL') {
        if (activeTab.gid === '944294225') {
          const statusVal = (row.values['P'] ?? '').trim();
          const reporterVal = (row.values['AA'] ?? '').trim();
          const detailVal = (row.values['AK'] ?? '').trim();
          const appVal = (row.values['AI'] ?? '').trim();

          if (quickFilterValue === 'รอตรวจสอบ') {
            if (getRowApprovalStatus(row) !== 'รอตรวจสอบ' && statusVal !== 'รอตรวจสอบ' && appVal !== 'รอตรวจสอบ') return false;
          } else if (quickFilterValue === 'ผู้ใช้งานแจ้งซ่อม') {
            if (!reporterVal) return false;
          } else if (quickFilterValue === 'รอข้อมูลเพิ่มเติม') {
            if (!statusVal.includes('ข้อมูลเพิ่มเติม') && !detailVal && !appVal.includes('ข้อมูลเพิ่มเติม')) return false;
          } else {
            if (!statusVal.includes(quickFilterValue) && !appVal.includes(quickFilterValue)) return false;
          }
        } else if (activeTab.gid === '606634465') {
          const rowJobStatus = getRowJobTransferStatus(row, sheetData.columns).trim();
          if (rowJobStatus !== quickFilterValue.trim()) {
            return false;
          }
        } else if (
          quickFilterColumn &&
          row.values[quickFilterColumn.id]?.trim() !== quickFilterValue.trim()
        ) {
          return false;
        }
      }

      if (activeTab.gid === '1031154414' && tireLowStockOnly) {
        if (!isTireLowStock(row)) {
          return false;
        }
      }

      if (!q) return true;

      if (selectedColumnId !== 'ALL') {
        const cellVal = (row.values[selectedColumnId] ?? '').toLowerCase();
        return cellVal.includes(q);
      }

      // Search across row number and all columns
      if (String(row.rowNumber).includes(q)) return true;
      return (sheetData.allColumns ?? sheetData.columns).some((col) =>
        (row.values[col.id] ?? '').toLowerCase().includes(q)
      );
    });
  }, [
    sheetData,
    searchQuery,
    selectedColumnId,
    quickFilterValue,
    quickFilterColumn,
    startDateFilter,
    endDateFilter,
    activeTab.gid,
    tireLowStockOnly,
  ]);

  // Sort filtered rows
  const sortedRows = useMemo<SheetRow[]>(() => {
    if (!sortConfig || !sheetData) return filteredRows;
    const { colId, direction } = sortConfig;
    const col = sheetData.columns.find((c) => c.id === colId);

    return [...filteredRows].sort((a, b) => {
      if (colId === '__ROW__') {
        return direction === 'asc'
          ? a.rowNumber - b.rowNumber
          : b.rowNumber - a.rowNumber;
      }

      const rawA = a.rawValues[colId];
      const rawB = b.rawValues[colId];

      if (typeof rawA === 'number' && typeof rawB === 'number') {
        return direction === 'asc' ? rawA - rawB : rawB - rawA;
      }

      const strA = a.values[colId] ?? '';
      const strB = b.values[colId] ?? '';

      if (col?.type === 'number') {
        const numA = parseFloat(strA.replace(/,/g, ''));
        const numB = parseFloat(strB.replace(/,/g, ''));
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return direction === 'asc' ? numA - numB : numB - numA;
        }
      }

      const cmp = strA.localeCompare(strB, 'th');
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortConfig, sheetData]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
    setGroupPages({});
  }, [
    searchQuery,
    selectedColumnId,
    quickFilterValue,
    activeTab.gid,
    startDateFilter,
    endDateFilter,
  ]);

  const effectivePageSize = activeTab.gid === '378250263' ? 50 : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / effectivePageSize));
  const paginatedRows = useMemo<SheetRow[]>(() => {
    const start = (currentPage - 1) * effectivePageSize;
    return sortedRows.slice(start, start + effectivePageSize);
  }, [sortedRows, currentPage, effectivePageSize]);

  const repairGroupedRows = useMemo(() => {
    if (
      activeTab.gid !== '944294225' &&
      activeTab.gid !== '606634465' &&
      activeTab.gid !== '378250263' &&
      activeTab.gid !== '1733355146' &&
      activeTab.gid !== '1031154414'
    ) {
      return null;
    }
    const tempGroups = new Map<string, SheetRow[]>();
    sortedRows.forEach((row) => {
      const status =
        activeTab.gid === '944294225'
          ? getRowApprovalStatus(row)
          : activeTab.gid === '378250263'
          ? getRowVehicleShift(row, sheetData?.columns)
          : activeTab.gid === '1733355146'
          ? getRowFuelStatus(row, sheetData?.columns)
          : activeTab.gid === '1031154414'
          ? getRowTireItemGroup(row, sheetData?.columns)
          : getRowJobTransferStatus(row, sheetData?.columns);
      if (!tempGroups.has(status)) {
        tempGroups.set(status, []);
      }
      tempGroups.get(status)!.push(row);
    });

    if (activeTab.gid === '1733355146') {
      const getFuelStatusPriority = (statusKey: string): number => {
        const s = statusKey.trim();
        if (s.includes('รับเข้า')) return 0;
        if (s.includes('เบิกออก') || s.includes('จ่ายออก')) return 1;
        return 2;
      };

      const sortedEntries = Array.from(tempGroups.entries()).sort(([keyA], [keyB]) => {
        const prioA = getFuelStatusPriority(keyA);
        const prioB = getFuelStatusPriority(keyB);
        if (prioA !== prioB) return prioA - prioB;
        return keyA.localeCompare(keyB, 'th');
      });

      return new Map<string, SheetRow[]>(sortedEntries);
    }

    if (activeTab.gid === '944294225') {
      const orderedGroups = new Map<string, SheetRow[]>();
      REPAIR_STATUS_GROUP_ORDER.forEach((statusKey) => {
        const rowsForStatus = tempGroups.get(statusKey);
        if (rowsForStatus && rowsForStatus.length > 0) {
          orderedGroups.set(statusKey, rowsForStatus);
        }
      });
      tempGroups.forEach((rowsForStatus, statusKey) => {
        if (!orderedGroups.has(statusKey)) {
          orderedGroups.set(statusKey, rowsForStatus);
        }
      });
      return orderedGroups;
    }

    if (activeTab.gid === '606634465') {
      const getJobTransferStatusPriority = (statusKey: string): number => {
        const s = statusKey.trim();
        if (
          s.includes('อยู่ระหว่าง') ||
          s.includes('อยู่ระว่าง') ||
          s.includes('ระหว่าง') ||
          s.includes('ระว่าง') ||
          s.includes('กำลังส่ง') ||
          s.includes('กำลังย้าย') ||
          s.includes('ย้าย') ||
          s.includes('กำลัง') ||
          s.includes('ส่ง') ||
          s.includes('กำลังดำเนินการ')
        ) {
          return 0;
        }
        if (s.includes('เรียบร้อย') || s.includes('สำเร็จ')) {
          return 1;
        }
        return 2;
      };

      const sortedEntries = Array.from(tempGroups.entries()).sort(([keyA], [keyB]) => {
        const prioA = getJobTransferStatusPriority(keyA);
        const prioB = getJobTransferStatusPriority(keyB);
        if (prioA !== prioB) return prioA - prioB;
        return keyA.localeCompare(keyB, 'th');
      });

      return new Map<string, SheetRow[]>(sortedEntries);
    }

    return tempGroups;
  }, [sortedRows, activeTab.gid, sheetData?.columns]);

  useEffect(() => {
    if (repairGroupedRows) {
      const hasDateFilter = Boolean(startDateFilter || endDateFilter);
      setCollapsedGroups((prev) => {
        const next = { ...prev };
        repairGroupedRows.forEach((_, status) => {
          if (activeTab.gid === '1733355146' && hasDateFilter) {
            next[status] = false; // Auto-expand fuel table groups when date filter is active
          } else if (next[status] === undefined) {
            // Default to collapsed (true) for fuel tab and STOCK ยาง tab
            next[status] =
              activeTab.gid === '1733355146' || activeTab.gid === '1031154414';
          }
        });
        return next;
      });
    }
  }, [repairGroupedRows, activeTab.gid, startDateFilter, endDateFilter]);

  // Contextual real-time summary metric based on actual columns in current sheet
  const contextualMetric = useMemo<{ label: string; value: string; subtext: string }>(() => {
    if (!sheetData || filteredRows.length === 0) {
      return {
        label: 'คอลัมน์ข้อมูลที่ใช้งาน',
        value: sheetData ? `${sheetData.columns.length}` : '0',
        subtext: 'คอลัมน์ในตารางปัจจุบัน',
      };
    }

    // Check if there is a weight column ('น้ำหนัก')
    const weightCol = sheetData.columns.find((c) => c.label.trim() === 'น้ำหนัก');
    if (weightCol) {
      let totalWeight = 0;
      filteredRows.forEach((r) => {
        const raw = r.rawValues[weightCol.id];
        if (typeof raw === 'number') {
          totalWeight += raw;
        } else {
          const parsed = parseFloat((r.values[weightCol.id] ?? '').replace(/,/g, ''));
          if (!Number.isNaN(parsed)) totalWeight += parsed;
        }
      });
      return {
        label: 'น้ำหนักรวมรายการที่แสดง',
        value: `${totalWeight.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กก.`,
        subtext: `คำนวณจาก ${filteredRows.length.toLocaleString('th-TH')} รายการ`,
      };
    }

    // Check if there is a remaining stock column ('คงเหลือ')
    const remainCol = sheetData.columns.find((c) => c.label.trim() === 'คงเหลือ');
    if (remainCol) {
      let totalRemain = 0;
      filteredRows.forEach((r) => {
        const raw = r.rawValues[remainCol.id];
        if (typeof raw === 'number') {
          totalRemain += raw;
        } else {
          const parsed = parseFloat((r.values[remainCol.id] ?? '').replace(/,/g, ''));
          if (!Number.isNaN(parsed)) totalRemain += parsed;
        }
      });
      return {
        label: 'ยอดคงเหลือรวมในคลัง',
        value: `${totalRemain.toLocaleString('th-TH')} ชิ้น/เส้น`,
        subtext: `จากรายการอะไหล่ ${filteredRows.length.toLocaleString('th-TH')} รายการ`,
      };
    }

    // Otherwise count top status value if quickFilterColumn exists
    if (quickFilterColumn) {
      const topValue = quickFilterOptions[0];
      if (topValue) {
        const count = filteredRows.filter(
          (r) => r.values[quickFilterColumn.id]?.trim() === topValue
        ).length;
        return {
          label: `${quickFilterColumn.label}: ${topValue}`,
          value: `${count.toLocaleString('th-TH')} รายการ`,
          subtext: `คิดเป็น ${Math.round((count / filteredRows.length) * 100)}% ของข้อมูลที่แสดง`,
        };
      }
    }

    return {
      label: 'คอลัมน์ข้อมูลที่ใช้งาน',
      value: `${sheetData.columns.length} คอลัมน์`,
      subtext: `ตาราง ${sheetData.tabName}`,
    };
  }, [sheetData, filteredRows, quickFilterColumn, quickFilterOptions]);

  // Real-time KPI summary cards specifically for บันทึกการย้ายงาน (gid: 606634465)
  const jobTransferKpiMetrics = useMemo(() => {
    if (activeTab.gid !== '606634465') {
      return {
        totalWeightTons: 0,
        totalWeightKg: 0,
        vehicleCount: 0,
        driverCount: 0,
        totalRounds: 0,
        totalRecords: 0,
        completedCount: 0,
        inTransitCount: 0,
        completionRate: '0',
      };
    }

    const weightColId =
      sheetData?.columns.find((c) => c.label.trim() === 'น้ำหนัก')?.id ?? 'G';
    const vehColId =
      sheetData?.columns.find((c) => c.label.trim() === 'เบอร์รถ')?.id ?? 'D';
    const driverColId =
      sheetData?.columns.find((c) => c.label.trim() === 'ชื่อพนักงานขับรถ')?.id ??
      'C';
    const statusColId =
      sheetData?.columns.find((c) => c.label.trim() === 'สถานะ')?.id ?? 'M';

    let totalWeightKg = 0;
    const uniqueVehicles = new Set<string>();
    const uniqueDrivers = new Set<string>();
    let totalRounds = 0;
    let completedCount = 0;
    let inTransitCount = 0;

    filteredRows.forEach((r) => {
      // 1. น้ำหนัก (กก. -> ตัน)
      totalWeightKg += parseNumericCell(
        r.rawValues[weightColId] ??
          r.rawValues['G'] ??
          r.values[weightColId] ??
          r.values['G']
      );

      // 2. จำนวนรถที่ย้าย (คัน) และ พนักงานขับรถ
      const rawVeh = (r.values[vehColId] ?? r.values['D'] ?? '').trim();
      if (rawVeh && rawVeh !== '-') {
        uniqueVehicles.add(rawVeh.toUpperCase().replace(/\s+/g, ''));
      }
      const rawDrv = (r.values[driverColId] ?? r.values['C'] ?? '').trim();
      if (rawDrv && rawDrv !== '-') {
        uniqueDrivers.add(rawDrv.replace(/\s+/g, ' '));
      }

      // 3. รอบการย้ายรวม (เที่ยว)
      const parsedRound = parseNumericCell(r.rawValues['V'] ?? r.values['V']);
      totalRounds += parsedRound > 0 ? parsedRound : 1;

      // 4. สถานะการส่งสินค้า
      const statusText = (
        r.values[statusColId] ??
        r.values['M'] ??
        ''
      ).trim();
      if (
        statusText.includes('เรียบร้อย') ||
        statusText.includes('สำเร็จ')
      ) {
        completedCount += 1;
      } else if (
        statusText.includes('ระหว่าง') ||
        statusText.includes('ระว่าง') ||
        statusText.includes('กำลังส่ง')
      ) {
        inTransitCount += 1;
      }
    });

    const totalWeightTons = totalWeightKg / 1000;
    // Never round an incomplete (<100%) ratio up to 100% (e.g. 995/1000 -> "99.5")
    const completionRate = formatCompletionPercentage(
      completedCount,
      filteredRows.length
    );

    return {
      totalWeightTons,
      totalWeightKg,
      vehicleCount: uniqueVehicles.size,
      driverCount: uniqueDrivers.size,
      totalRounds,
      totalRecords: filteredRows.length,
      completedCount,
      inTransitCount,
      completionRate,
    };
  }, [activeTab.gid, sheetData, filteredRows]);

  // Real-time KPI summary cards specifically for บันทึกงานซ่อม (gid: 944294225)
  const repairKpiMetrics = useMemo(() => {
    if (activeTab.gid !== '944294225') {
      return {
        totalRequests: 0,
        pendingApprovalCount: 0,
        pendingOnlyCount: 0,
        repliedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        totalPartsCost: 0,
        totalLaborCost: 0,
        totalRepairCost: 0,
        approvedRate: '0',
      };
    }

    const totalRequests = filteredRows.length;
    let pendingApprovalCount = 0;
    let pendingOnlyCount = 0;
    let repliedCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let totalPartsCost = 0;
    let totalLaborCost = 0;

    const sparePartsColId =
      sheetData?.columns.find((c) => c.label.includes('ค่าอะไหล่'))?.id ?? 'N';
    const laborColId =
      sheetData?.columns.find((c) => c.label.includes('ค่าแรง'))?.id ?? 'O';

    filteredRows.forEach((r) => {
      const status = getRowApprovalStatus(r);

      if (
        status === 'รออนุมัติ' ||
        status === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว' ||
        status === 'ขอข้อมูลเพิ่มเติม' ||
        status === 'รอพิจารณา'
      ) {
        pendingApprovalCount += 1;
        if (status === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว') {
          repliedCount += 1;
        } else {
          pendingOnlyCount += 1;
        }
      } else if (status === 'อนุมัติ') {
        approvedCount += 1;
      } else if (status === 'ไม่อนุมัติ') {
        rejectedCount += 1;
      }

      totalPartsCost += parseNumericCell(
        r.rawValues[sparePartsColId] ??
          r.rawValues['N'] ??
          r.values[sparePartsColId] ??
          r.values['N']
      );

      totalLaborCost += parseNumericCell(
        r.rawValues[laborColId] ??
          r.rawValues['O'] ??
          r.values[laborColId] ??
          r.values['O']
      );
    });

    const totalRepairCost = totalPartsCost + totalLaborCost;
    const approvedRate = formatCompletionPercentage(approvedCount, totalRequests);

    return {
      totalRequests,
      pendingApprovalCount,
      pendingOnlyCount,
      repliedCount,
      approvedCount,
      rejectedCount,
      totalPartsCost,
      totalLaborCost,
      totalRepairCost,
      approvedRate,
    };
  }, [activeTab.gid, sheetData, filteredRows]);

  // Real-time KPI summary cards specifically for บันทึกน้ำมัน (gid: 1733355146)
  const fuelKpiMetrics = useMemo(() => {
    if (activeTab.gid !== '1733355146') {
      return {
        latestDieselBalance: 0,
        latestBenzeneBalance: 0,
        totalInLiters: 0,
        totalInCount: 0,
        inDieselLiters: 0,
        inDieselCount: 0,
        inBenzeneLiters: 0,
        inBenzeneCount: 0,
        inOtherLiters: 0,
        inOtherCount: 0,
        totalOutLiters: 0,
        totalOutCount: 0,
        dispenseCount: 0,
        outDieselLiters: 0,
        outDieselCount: 0,
        outBenzeneLiters: 0,
        outBenzeneCount: 0,
        outOtherLiters: 0,
        outOtherCount: 0,
        totalOutValue: 0,
        latestPrice: 0,
        avgPrice: 0,
      };
    }

    let latestDieselBalance = 0;
    let latestBenzeneBalance = 0;

    let totalInLiters = 0;
    let totalInCount = 0;
    let inDieselLiters = 0;
    let inDieselCount = 0;
    let inBenzeneLiters = 0;
    let inBenzeneCount = 0;

    let totalOutLiters = 0;
    let totalOutCount = 0;
    let outDieselLiters = 0;
    let outDieselCount = 0;
    let outBenzeneLiters = 0;
    let outBenzeneCount = 0;

    let totalOutValue = 0;
    let latestPrice = 0;
    let priceSumForAvg = 0;
    let priceCountForAvg = 0;

    const fuelTypeColId =
      sheetData?.columns.find((c) => c.label.includes('ชนิดน้ำมัน'))?.id ?? 'D';
    const inColId =
      sheetData?.columns.find((c) => c.label.includes('รับเข้า'))?.id ?? 'E';
    const priceColId =
      sheetData?.columns.find((c) => c.label.includes('ราคา'))?.id ?? 'F';
    const outColId =
      sheetData?.columns.find((c) => c.label.includes('จ่ายออก'))?.id ?? 'G';
    const amountColId =
      sheetData?.columns.find((c) => c.label.includes('มูลค่า'))?.id ?? 'H';

    filteredRows.forEach((r) => {
      const fType = (r.values[fuelTypeColId] ?? r.values['D'] ?? '').trim();
      const isBenzene =
        fType.includes('เบน') ||
        fType.includes('ซิน') ||
        fType.includes('ซิล') ||
        fType.toLowerCase().includes('benzene') ||
        fType.includes('โซฮอล์');

      const inVal = parseNumericCell(
        r.rawValues[inColId] ?? r.rawValues['E'] ?? r.values[inColId] ?? r.values['E']
      );
      if (inVal > 0) {
        totalInLiters += inVal;
        totalInCount += 1;
        if (isBenzene) {
          inBenzeneLiters += inVal;
          inBenzeneCount += 1;
        } else {
          inDieselLiters += inVal;
          inDieselCount += 1;
        }
      }

      const outVal = parseNumericCell(
        r.rawValues[outColId] ?? r.rawValues['G'] ?? r.values[outColId] ?? r.values['G']
      );
      if (outVal > 0) {
        totalOutLiters += outVal;
        totalOutCount += 1;
        if (isBenzene) {
          outBenzeneLiters += outVal;
          outBenzeneCount += 1;
        } else {
          outDieselLiters += outVal;
          outDieselCount += 1;
        }
      }

      const amountVal = parseNumericCell(
        r.rawValues[amountColId] ??
          r.rawValues['H'] ??
          r.values[amountColId] ??
          r.values['H']
      );
      if (amountVal > 0) {
        totalOutValue += amountVal;
      }

      const priceVal = parseNumericCell(
        r.rawValues[priceColId] ??
          r.rawValues['F'] ??
          r.values[priceColId] ??
          r.values['F']
      );
      if (priceVal > 0) {
        if (!latestPrice) latestPrice = priceVal;
        priceSumForAvg += priceVal;
        priceCountForAvg += 1;
      }
    });

    const avgPrice =
      priceCountForAvg > 0
        ? priceSumForAvg / priceCountForAvg
        : totalOutLiters > 0
        ? totalOutValue / totalOutLiters
        : 0;

    latestDieselBalance = inDieselLiters - outDieselLiters;
    latestBenzeneBalance = inBenzeneLiters - outBenzeneLiters;

    return {
      latestDieselBalance,
      latestBenzeneBalance,
      totalInLiters,
      totalInCount,
      inDieselLiters,
      inDieselCount,
      inBenzeneLiters,
      inBenzeneCount,
      inOtherLiters: 0,
      inOtherCount: 0,
      totalOutLiters,
      totalOutCount,
      dispenseCount: totalOutCount,
      outDieselLiters,
      outDieselCount,
      outBenzeneLiters,
      outBenzeneCount,
      outOtherLiters: 0,
      outOtherCount: 0,
      totalOutValue,
      latestPrice,
      avgPrice,
    };
  }, [activeTab.gid, sheetData, filteredRows]);

  // Real-time KPI summary metrics specifically for ฐานข้อมูลรถ (gid: 378250263)
  const vehicleKpiMetrics = useMemo(() => {
    if (activeTab.gid !== '378250263') {
      return {
        totalVehicles: 0,
        withDriverCount: 0,
        withoutDriverCount: 0,
        shifts: {} as Record<string, number>,
        teams: {} as Record<string, number>,
        areas: {} as Record<string, number>,
        distinctAreaCount: 0,
      };
    }

    const driverColId =
      sheetData?.columns.find(
        (c) => c.label.includes('ชื่อพนักงานประจำรถ') || c.label.includes('พนักงาน')
      )?.id ?? 'I';
    const areaColId =
      sheetData?.columns.find((c) => c.label.includes('พื้นที่'))?.id ?? 'J';
    const shiftColId =
      sheetData?.columns.find((c) => c.label.includes('กะ'))?.id ?? 'L';
    const teamColId =
      sheetData?.columns.find((c) => c.label.includes('ทีม'))?.id ?? 'O';

    let totalVehicles = filteredRows.length;
    let withDriverCount = 0;
    let withoutDriverCount = 0;

    const shifts: Record<string, number> = {};
    const teams: Record<string, number> = {};
    const areas: Record<string, number> = {};

    filteredRows.forEach((r) => {
      // Driver check
      const driverName = (r.values[driverColId] ?? r.values['I'] ?? '').trim();
      if (driverName) {
        withDriverCount += 1;
      } else {
        withoutDriverCount += 1;
      }

      // Shift check
      const shiftRaw = (r.values[shiftColId] ?? r.values['L'] ?? '').trim();
      const shift = shiftRaw || 'ไม่ระบุกะ';
      shifts[shift] = (shifts[shift] || 0) + 1;

      // Team check
      const teamRaw = (r.values[teamColId] ?? r.values['O'] ?? '').trim();
      const team = teamRaw ? `ทีม ${teamRaw}` : 'ไม่ระบุทีม';
      teams[team] = (teams[team] || 0) + 1;

      // Area check
      const areaRaw = (r.values[areaColId] ?? r.values['J'] ?? '').trim();
      const area = areaRaw || 'ไม่ระบุพื้นที่';
      areas[area] = (areas[area] || 0) + 1;
    });

    const distinctAreaCount = Object.keys(areas).filter(
      (k) => k !== 'ไม่ระบุพื้นที่'
    ).length;

    return {
      totalVehicles,
      withDriverCount,
      withoutDriverCount,
      shifts,
      teams,
      areas,
      distinctAreaCount,
    };
  }, [sheetData, filteredRows, activeTab.gid]);

  // Real-time KPI summary metrics specifically for STOCK ยาง (gid: 1031154414)
  const tireStockKpiMetrics = useMemo(() => {
    if (activeTab.gid !== '1031154414') {
      return {
        totalItemsCount: 0,
        uniqueGroupsCount: 0,
        totalCarryForward: 0,
        totalReceived: 0,
        totalIssued: 0,
        totalBalance: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        lowOnlyCount: 0,
      };
    }

    const itemGroups = new Set<string>();
    let totalCarryForward = 0;
    let totalReceived = 0;
    let totalIssued = 0;
    let totalBalance = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let lowOnlyCount = 0;

    filteredRows.forEach((r) => {
      const groupName = getRowTireItemGroup(r, sheetData?.columns);
      if (groupName) itemGroups.add(groupName);

      const carryVal = parseTireNumericCell(r, 'C');
      const recVal = parseTireNumericCell(r, 'D');
      const issVal = parseTireNumericCell(r, 'E');
      const balVal = parseTireNumericCell(r, 'F');

      totalCarryForward += carryVal;
      totalReceived += recVal;
      totalIssued += issVal;
      totalBalance += balVal;

      if (isTireLowStock(r)) {
        lowStockCount += 1;
        if (balVal <= 0) {
          outOfStockCount += 1;
        } else {
          lowOnlyCount += 1;
        }
      }
    });

    return {
      totalItemsCount: filteredRows.length,
      uniqueGroupsCount: itemGroups.size,
      totalCarryForward,
      totalReceived,
      totalIssued,
      totalBalance,
      lowStockCount,
      outOfStockCount,
      lowOnlyCount,
    };
  }, [sheetData, filteredRows, activeTab.gid]);

  const handleSort = (colId: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.colId !== colId) {
        return { colId, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { colId, direction: 'desc' };
      }
      return null;
    });
  };

  const handleTriggerDeepSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    setDeepSearchTerm(trimmed);
    loadData({ silent: false, remoteSearch: trimmed });
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSelectedColumnId('ALL');
    setQuickFilterValue('ALL');
    setTireLowStockOnly(false);
    setStartDateFilter('');
    setEndDateFilter('');
    if (deepSearchTerm !== '') {
      setDeepSearchTerm('');
    }
  };

  const handleExportCsv = () => {
    if (!sheetData || sortedRows.length === 0) return;
    const headers = ['ลำดับแถว', ...sheetData.columns.map((c) => c.label)];
    const csvLines = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...sortedRows.map((row) => {
        const cells = [
          String(row.rowNumber),
          ...sheetData.columns.map((col) => row.values[col.id] ?? ''),
        ];
        return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
      }),
    ];
    const csvContent = '\uFEFF' + csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sheetData.tabName}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Highlight matching search text inside cell
  const renderHighlightedText = (text: string) => {
    if (!text) return <span className="text-slate-300">-</span>;
    const q = searchQuery.trim();
    if (!q) return text;

    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const matchIdx = lowerText.indexOf(lowerQ);
    if (matchIdx === -1) return text;

    const before = text.slice(0, matchIdx);
    const match = text.slice(matchIdx, matchIdx + q.length);
    const after = text.slice(matchIdx + q.length);

    return (
      <>
        {before}
        <mark className="rounded-xs bg-amber-200/80 px-0.5 text-slate-900">
          {match}
        </mark>
        {after}
      </>
    );
  };

  const formattedFetchTime = useMemo(() => {
    if (!sheetData?.fetchedAt) return '-';
    return new Date(sheetData.fetchedAt).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [sheetData?.fetchedAt]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-68 shrink-0 flex-col border-r border-slate-200/90 bg-slate-50/70 backdrop-blur-xs transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200/90 bg-white px-4 py-3.5">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleSelectTab(SHEET_TABS[0]);
            }}
            className="flex items-center gap-2.5 min-w-0"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-amber-400 shadow-xs">
              <Truck className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-slate-900 truncate">
                ระบบขนส่งและงานซ่อมบำรุง
              </div>
              <div className="text-[11px] font-medium text-slate-500 truncate">
                เมนูหลักจัดการฐานข้อมูล
              </div>
            </div>
          </a>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="ปิดเมนู"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3.5">
          <div className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-slate-400">
            เมนูหลัก (ตารางข้อมูล)
          </div>
          <nav className="space-y-2">
            {SHEET_TABS.map((tab) => {
              const isSelected =
                activeTab.gid === tab.gid &&
                !showEmployeeManagement &&
                !showMaintenanceCalendar;
              const isJobTransferTab = tab.gid === '606634465';
              const isRepairTab = tab.gid === '944294225';
              const isFuelTab = tab.gid === '1733355146';

              const renderTabIcon = () => {
                const iconClass = 'h-4 w-4 shrink-0';
                switch (tab.gid) {
                  case '606634465':
                    return <Repeat className={iconClass} />;
                  case '944294225':
                    return <Wrench className={iconClass} />;
                  case '378250263':
                    return <Truck className={iconClass} />;
                  case '1733355146':
                    return <Fuel className={iconClass} />;
                  case '1031154414':
                    return <SlidersHorizontal className={iconClass} />;
                  case '1032541508':
                    return <Calendar className={iconClass} />;
                  case '1156877149':
                    return <Home className={iconClass} />;
                  case '1295975917':
                    return <Scale className={iconClass} />;
                  default:
                    return <Truck className={iconClass} />;
                }
              };

              const isTireStockTab = tab.gid === '1031154414';
              const hasSubmenu = isJobTransferTab || isRepairTab || isFuelTab || isTireStockTab;
              const isSubmenuExpanded = Boolean(expandedSidebarSubmenus[tab.gid]);

              const handleMainMenuClick = () => {
                if (hasSubmenu) {
                  setExpandedSidebarSubmenus((prev) => ({
                    ...prev,
                    [tab.gid]: !prev[tab.gid],
                  }));
                }
                handleSelectTab(tab);
              };

              return (
                <div key={tab.gid} className="space-y-1">
                  {/* เมนูหลัก: เด่นชัด มีกรอบไอคอนและตัวอักษรหนา */}
                  <button
                    type="button"
                    onClick={handleMainMenuClick}
                    className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-sm ring-1 ring-slate-900'
                        : 'bg-white text-slate-800 border border-slate-200/80 shadow-2xs hover:border-slate-300 hover:bg-slate-100/70 hover:text-slate-950'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          isSelected
                            ? 'bg-white/15 text-amber-300'
                            : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200/80 group-hover:text-slate-900'
                        }`}
                      >
                        {renderTabIcon()}
                      </span>
                      <div className="min-w-0">
                        <div
                          className={`truncate text-sm font-bold leading-snug ${
                            isSelected ? 'text-white' : 'text-slate-900'
                          }`}
                        >
                          {tab.name}
                        </div>
                        <div
                          className={`truncate text-[11px] leading-tight ${
                            isSelected ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {tab.category}
                        </div>
                      </div>
                    </div>
                    {hasSubmenu ? (
                      <ChevronDown
                        className={`ml-1.5 h-4 w-4 shrink-0 transition-transform duration-200 ${
                          isSubmenuExpanded
                            ? 'rotate-180 ' + (isSelected ? 'text-amber-300' : 'text-slate-700')
                            : isSelected
                            ? 'text-amber-300'
                            : 'text-slate-400 group-hover:text-slate-600'
                        }`}
                      />
                    ) : (
                      <ChevronRight
                        className={`ml-1.5 h-4 w-4 shrink-0 transition-transform ${
                          isSelected
                            ? 'text-amber-300 translate-x-0.5'
                            : 'text-slate-300 group-hover:text-slate-500'
                        }`}
                      />
                    )}
                  </button>

                  {/* เมนูย่อยของ บันทึกการย้ายงาน */}
                  {isJobTransferTab && isSubmenuExpanded && (
                    <div
                      className="ml-6 pl-3 border-l border-slate-200 space-y-0.5 py-0.5 transition-all duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '606634465' || showJobTransferStats) {
                            handleSelectTab(tab);
                          }
                          setIsJobModalOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <Plus className="h-3.5 w-3.5 text-slate-700 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">บันทึกย้ายงาน</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSidebarOpen(false);
                          setShowEmployeeManagement(false);
                          setShowMaintenanceCalendar(false);
                          if (activeTab.gid !== '606634465') {
                            handleSelectTab(tab);
                          }
                          setShowJobTransferStats(true);
                        }}
                        className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                          activeTab.gid === '606634465' && showJobTransferStats && !showEmployeeManagement && !showMaintenanceCalendar
                            ? 'bg-amber-500/15 text-amber-900 font-bold border border-amber-300/60'
                            : 'text-slate-600 hover:bg-white hover:text-slate-900'
                        }`}
                      >
                        <BarChart3 className="h-3.5 w-3.5 text-amber-600 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">สถิติการขนย้าย</span>
                      </button>
                    </div>
                  )}

                  {/* เมนูย่อยของ บันทึกงานซ่อม */}
                  {isRepairTab && isSubmenuExpanded && (
                    <div
                      className="ml-6 pl-3 border-l border-slate-200 space-y-0.5 py-0.5 transition-all duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '944294225') {
                            handleSelectTab(tab);
                          }
                          setIsRepairModalOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <Plus className="h-3.5 w-3.5 text-amber-600 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">บันทึกแจ้งซ่อม</span>
                      </button>
                    </div>
                  )}

                  {/* เมนูหลัก: ผู้จัดการอนุมัติงานซ่อม (แสดงเป็นเมนูหลักต่อจาก บันทึกงานซ่อม เพื่อให้ผู้จัดการเห็นได้ชัดเจนทันที) */}
                  {isRepairTab && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '944294225') {
                            handleSelectTab(tab);
                          }
                          setIsApprovalModalOpen(true);
                        }}
                        className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                          isApprovalModalOpen
                            ? 'bg-emerald-800 text-white shadow-sm ring-1 ring-emerald-800'
                            : 'bg-white text-slate-800 border border-emerald-200/90 shadow-2xs hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-slate-950'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                              isApprovalModalOpen
                                ? 'bg-white/15 text-emerald-200'
                                : 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200/80 group-hover:text-emerald-900'
                            }`}
                          >
                            <CheckCircle className="h-4 w-4 shrink-0" />
                          </span>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-bold leading-snug ${
                                isApprovalModalOpen ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              ผู้จัดการอนุมัติงานซ่อม
                            </div>
                            <div
                              className={`truncate text-[11px] leading-tight ${
                                isApprovalModalOpen ? 'text-emerald-200' : 'text-emerald-700 font-medium'
                              }`}
                            >
                              พิจารณาอนุมัติรายการซ่อม
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {pendingApprovalCount > 0 && (
                            <span className="inline-flex items-center justify-center rounded-full bg-red-600 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-2xs tabular-nums">
                              {pendingApprovalCount.toLocaleString('th-TH')}
                            </span>
                          )}
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 transition-transform ${
                              isApprovalModalOpen
                                ? 'text-emerald-200 translate-x-0.5'
                                : 'text-slate-300 group-hover:text-emerald-600'
                            }`}
                          />
                        </div>
                      </button>

                      {/* เมนูหลัก: ปฏิทินกำหนดรอบ PM & งานซ่อมที่ยังไม่อนุมัติ */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsSidebarOpen(false);
                          setShowJobTransferStats(false);
                          setShowEmployeeManagement(false);
                          setShowMaintenanceCalendar(true);
                        }}
                        className={`mt-1.5 group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                          showMaintenanceCalendar
                            ? 'bg-indigo-900 text-white shadow-sm ring-1 ring-indigo-900'
                            : 'bg-white text-slate-800 border border-indigo-200/90 shadow-2xs hover:border-indigo-400 hover:bg-indigo-50/60 hover:text-slate-950'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                              showMaintenanceCalendar
                                ? 'bg-white/15 text-indigo-200'
                                : 'bg-indigo-100 text-indigo-700 group-hover:bg-indigo-200/80 group-hover:text-indigo-900'
                            }`}
                          >
                            <Calendar className="h-4 w-4 shrink-0" />
                          </span>
                          <div className="min-w-0">
                            <div
                              className={`truncate text-sm font-bold leading-snug ${
                                showMaintenanceCalendar ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              ปฏิทิน PM & งานซ่อม
                            </div>
                            <div
                              className={`truncate text-[11px] leading-tight ${
                                showMaintenanceCalendar
                                  ? 'text-indigo-200'
                                  : 'text-indigo-700 font-medium'
                              }`}
                            >
                              รอบ PM และงานซ่อมไม่อนุมัติ
                            </div>
                          </div>
                        </div>
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 transition-transform ${
                            showMaintenanceCalendar
                              ? 'text-indigo-200 translate-x-0.5'
                              : 'text-slate-300 group-hover:text-indigo-600'
                          }`}
                        />
                      </button>
                    </div>
                  )}

                  {/* เมนูย่อยของ บันทึกน้ำมัน */}
                  {isFuelTab && isSubmenuExpanded && (
                    <div
                      className="ml-6 pl-3 border-l border-slate-200 space-y-0.5 py-0.5 transition-all duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '1733355146') {
                            handleSelectTab(tab);
                          }
                          setIsFuelModalOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <Plus className="h-3.5 w-3.5 text-sky-600 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">บันทึกน้ำมัน (รับเข้า-เบิกออก)</span>
                      </button>
                    </div>
                  )}

                  {/* เมนูย่อยของ STOCK ยาง */}
                  {isTireStockTab && isSubmenuExpanded && (
                    <div
                      className="ml-6 pl-3 border-l border-slate-200 space-y-0.5 py-0.5 transition-all duration-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsSidebarOpen(false);
                          if (activeTab.gid !== '1031154414') {
                            handleSelectTab(tab);
                          }
                          setTireModalInitType('OUT');
                          setTireModalInitCode('');
                          setIsTireModalOpen(true);
                        }}
                        className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <Plus className="h-3.5 w-3.5 text-emerald-600 shrink-0 transition-transform group-hover:scale-110" />
                        <span className="truncate">+ บันทึกรับเข้า-เบิกออกยาง</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* เมนูจัดการพนักงาน (Employee Account Management - ดึงจากชีต Account) */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsSidebarOpen(false);
                  setShowJobTransferStats(false);
                  setShowMaintenanceCalendar(false);
                  setShowEmployeeManagement(true);
                }}
                className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                  showEmployeeManagement
                    ? 'bg-slate-900 text-white shadow-sm ring-1 ring-slate-900'
                    : 'bg-white text-slate-800 border border-slate-200/80 shadow-2xs hover:border-slate-300 hover:bg-slate-100/70 hover:text-slate-950'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      showEmployeeManagement
                        ? 'bg-white/15 text-amber-300'
                        : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200/80 group-hover:text-slate-900'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                  </span>
                  <div className="min-w-0">
                    <div
                      className={`truncate text-sm font-bold leading-snug ${
                        showEmployeeManagement ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      จัดการพนักงาน
                    </div>
                    <div
                      className={`truncate text-[11px] leading-tight ${
                        showEmployeeManagement ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      ข้อมูลพนักงาน (Account)
                    </div>
                  </div>
                </div>
                <ChevronRight
                  className={`ml-1.5 h-4 w-4 shrink-0 transition-transform ${
                    showEmployeeManagement
                      ? 'text-amber-300 translate-x-0.5'
                      : 'text-slate-300 group-hover:text-slate-500'
                  }`}
                />
              </button>
            </div>
          </nav>
        </div>

        <div className="border-t border-slate-200/90 bg-white px-4 py-2.5 flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium text-slate-500">เวอร์ชันระบบ</span>
          <span className="font-mono font-semibold text-slate-700 text-[11px] tabular-nums">
            v{APP_VERSION}
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact Sticky Top Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 sm:py-2.5 lg:px-8">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="เปิดเมนู"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 lg:hidden shrink-0"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="text-sm font-bold text-slate-900 sm:text-base truncate">
              {showMaintenanceCalendar
                ? 'ปฏิทินกำหนดรอบ PM & งานซ่อมไม่อนุมัติ'
                : showEmployeeManagement
                  ? 'จัดการพนักงาน (Account)'
                  : activeTab.gid === '606634465' && showJobTransferStats
                    ? 'สถิติการขนย้าย'
                    : activeTab.name}
            </h1>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {activeTab.gid === '606634465' && (
              <button
                type="button"
                onClick={() => setIsJobModalOpen(true)}
                className="hidden md:inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>บันทึกย้ายงาน</span>
              </button>
            )}

            {activeTab.gid === '1156877149' && (
              <button
                type="button"
                onClick={() => setIsDeliveryPointModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>เพิ่มจุดส่งสินค้า</span>
              </button>
            )}

            {activeTab.gid === '1733355146' && (
              <button
                type="button"
                onClick={() => setIsFuelModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="sm:hidden">บันทึกน้ำมัน</span>
                <span className="hidden sm:inline">บันทึกน้ำมัน (รับเข้า-เบิกออก)</span>
              </button>
            )}

            {activeTab.gid === '1031154414' && (
              <button
                type="button"
                onClick={() => {
                  setTireModalInitType('OUT');
                  setTireModalInitCode('');
                  setIsTireModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ บันทึกรับเข้า-เบิกออกยาง</span>
              </button>
            )}

            {activeTab.gid === '944294225' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsRepairModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>แจ้งซ่อม</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap shrink-0"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>ผู้อนุมัติ</span>
                  {pendingApprovalCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-red-600 px-1.5 py-0.2 font-mono text-[10px] font-bold text-white animate-pulse">
                      {pendingApprovalCount.toLocaleString('th-TH')}
                    </span>
                  )}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleToggleMobileNotifications}
              title={
                notificationPermission === 'granted'
                  ? 'ระบบแจ้งเตือนบนมือถือเปิดใช้งานแล้ว'
                  : 'คลิกเพื่อเปิดการแจ้งเตือนเด้งบนมือถือเมื่อมีแจ้งซ่อมใหม่'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors shrink-0 ${
                notificationPermission === 'granted'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 animate-pulse'
              }`}
            >
              <Bell className="h-3.5 w-3.5 text-amber-600" />
              <span className="hidden sm:inline">
                {notificationPermission === 'granted'
                  ? 'การแจ้งเตือนเปิดแล้ว'
                  : 'เปิดแจ้งเตือนมือถือ'}
              </span>
            </button>

            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setIsWebhookModalOpen(true)}
              title="ตั้งค่าเชื่อมต่อชีต (ไม่ต้องล็อกอิน)"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">เชื่อมต่อชีต</span>
            </button>

            <button
              type="button"
              onClick={handleManualSync}
              disabled={isLoading || isRefreshing}
              title="ซิงค์ข้อมูลล่าสุด"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isLoading || isRefreshing ? 'animate-spin' : ''
                }`}
              />
              <span className="hidden sm:inline">ซิงค์ข้อมูล</span>
            </button>
          </div>
        </header>

        <main className="w-full px-2.5 pt-2.5 pb-24 sm:px-6 sm:pt-4 sm:pb-24 lg:px-8 lg:pb-6">
          {showMaintenanceCalendar && (
            <MaintenanceCalendarView
              repairRows={
                activeTab.gid === '944294225'
                  ? (sheetData?.rows ?? repairTabRows)
                  : repairTabRows
              }
              pmRows={activeTab.gid === '1032541508' ? sheetData?.rows : undefined}
              onOpenApprovalModal={() => setIsApprovalModalOpen(true)}
              onSelectRepairRow={(row) => setSelectedRow(row)}
              onSwitchToPmTab={() => {
                const pmTab = SHEET_TABS.find((t) => t.gid === '1032541508');
                if (pmTab) {
                  handleSelectTab(pmTab);
                }
              }}
            />
          )}

          {showEmployeeManagement && !showMaintenanceCalendar && <EmployeeManagementView />}

          {!showEmployeeManagement &&
            !showMaintenanceCalendar &&
            activeTab.gid === '606634465' &&
            showJobTransferStats && (
              <JobTransferStatsView rows={sheetData?.rows ?? []} columns={sheetData?.columns} />
            )}

          <div
            className={
              showEmployeeManagement ||
              showMaintenanceCalendar ||
              (activeTab.gid === '606634465' && showJobTransferStats)
                ? 'hidden'
                : 'block'
            }
          >

            {/* Mobile-Only Direct Job Transfer Form (when on บันทึกการย้ายงาน tab) */}
            {activeTab.gid === '606634465' && (
              <div className="md:hidden">
                <JobTransferModal
                  isOpen={true}
                  inlineMode={true}
                  onClose={() => {}}
                  existingRows={sheetData?.rows ?? []}
                  onSavedSuccess={() => {
                    setSaveSuccessMsg('บันทึกข้อมูลการย้ายงานเรียบร้อยแล้ว');
                    loadData({ silent: true });
                    setTimeout(() => {
                      setSaveSuccessMsg(null);
                    }, 5000);
                  }}
                />
              </div>
            )}

            <div className={activeTab.gid === '606634465' ? 'hidden md:block' : 'block'}>
          {/* Glassmorphism 4-Card KPI Summary Strip (Unified across all tabs) */}
          {activeTab.gid === '606634465' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: น้ำหนักที่ย้าย (ตัน) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        1. น้ำหนักที่ย้าย (ตัน)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.totalWeightTons.toLocaleString(
                                'th-TH',
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-sky-700">
                          ตัน
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/70 bg-sky-500/10 text-sky-700 backdrop-blur-sm">
                      <Scale className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รวม{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {jobTransferKpiMetrics.totalWeightKg.toLocaleString('th-TH', {
                        maximumFractionDigits: 0,
                      })}
                    </span>{' '}
                    กก.
                  </div>
                </div>

                {/* Card 2: จำนวนรถที่ย้าย (คัน) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        2. จำนวนรถที่ย้าย (คัน)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.vehicleCount.toLocaleString(
                                'th-TH'
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-indigo-700">
                          คัน
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Truck className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    พนักงานขับรถปฏิบัติงาน{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {jobTransferKpiMetrics.driverCount.toLocaleString('th-TH')}
                    </span>{' '}
                    คน
                  </div>
                </div>

                {/* Card 3: รอบการย้ายรวม (เที่ยว) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        3. รอบการย้ายรวม (เที่ยว)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.totalRounds.toLocaleString(
                                'th-TH'
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-amber-700">
                          เที่ยว
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Repeat className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    จากรายการบันทึก{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {jobTransferKpiMetrics.totalRecords.toLocaleString('th-TH')}
                    </span>{' '}
                    รายการ
                  </div>
                </div>

                {/* Card 4: ส่งสินค้าสำเร็จ (รายการ) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        4. ส่งสินค้าสำเร็จ (รายการ)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : jobTransferKpiMetrics.completedCount.toLocaleString(
                                'th-TH'
                              )}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    กำลังส่ง{' '}
                    <span className="font-sans font-bold tracking-tight text-amber-700 tabular-nums">
                      {jobTransferKpiMetrics.inTransitCount.toLocaleString('th-TH')}
                    </span>{' '}
                    รายการ · สำเร็จ{' '}
                    <span className="font-sans font-bold tracking-tight text-emerald-700 tabular-nums">
                      {jobTransferKpiMetrics.completionRate}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab.gid === '944294225' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-indigo-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: แจ้งซ่อมทั้งหมด */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        แจ้งซ่อมทั้งหมด
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : repairKpiMetrics.totalRequests.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-indigo-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Wrench className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    กำลังแสดงผล{' '}
                    <span className="font-sans font-bold tracking-tight text-indigo-700 tabular-nums">
                      {repairKpiMetrics.totalRequests.toLocaleString('th-TH')}
                    </span>{' '}
                    จากทั้งหมด{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {(sheetData?.totalRowsInSheet ?? repairKpiMetrics.totalRequests).toLocaleString('th-TH')}
                    </span>{' '}
                    รายการ
                  </div>
                </div>

                {/* Card 2: รออนุมัติ */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        รออนุมัติ
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : repairKpiMetrics.pendingApprovalCount.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-amber-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Clock className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รออนุมัติ{' '}
                    <span className="font-sans font-bold tracking-tight text-amber-700 tabular-nums">
                      {repairKpiMetrics.pendingOnlyCount.toLocaleString('th-TH')}
                    </span>{' '}
                    · ตอบกลับแล้ว{' '}
                    <span className="font-sans font-bold tracking-tight text-indigo-700 tabular-nums">
                      {repairKpiMetrics.repliedCount.toLocaleString('th-TH')}
                    </span>
                  </div>
                </div>

                {/* Card 3: อนุมัติแล้ว / ไม่อนุมัติ */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        อนุมัติแล้ว / ไม่อนุมัติ
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <div className="flex items-baseline gap-1 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                          <span>
                            {isLoading && !sheetData
                              ? '...'
                              : repairKpiMetrics.approvedCount.toLocaleString('th-TH')}
                          </span>
                          <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                            อนุมัติ
                          </span>
                        </div>
                        <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 font-sans text-xs font-bold tracking-tight text-rose-700 border border-rose-200/70 backdrop-blur-sm tabular-nums">
                          ไม่อนุมัติ {repairKpiMetrics.rejectedCount.toLocaleString('th-TH')}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    อนุมัติแล้วคิดเป็น{' '}
                    <span className="font-sans font-bold tracking-tight text-emerald-700 tabular-nums">
                      {repairKpiMetrics.approvedRate}%
                    </span>{' '}
                    ของรายการที่แสดง
                  </div>
                </div>

                {/* Card 4: ยอดรวมค่าซ่อมสุทธิ (บาท) */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-violet-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ยอดรวมค่าซ่อมสุทธิ (บาท)
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : `${repairKpiMetrics.totalRepairCost.toLocaleString('th-TH', {
                                maximumFractionDigits: 0,
                              })} ฿`}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/70 bg-violet-500/10 text-violet-700 backdrop-blur-sm">
                      <Coins className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    อะไหล่{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {repairKpiMetrics.totalPartsCost.toLocaleString('th-TH', {
                        maximumFractionDigits: 0,
                      })} ฿
                    </span>{' '}
                    · ค่าแรง{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {repairKpiMetrics.totalLaborCost.toLocaleString('th-TH', {
                        maximumFractionDigits: 0,
                      })} ฿
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab.gid === '1733355146' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: คงเหลือน้ำมันปัจจุบัน (ลิตร) */}
                <div className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-white/60 bg-white/80 px-2.5 py-2.5 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] sm:text-xs font-semibold text-slate-600 whitespace-nowrap">
                        คงเหลือน้ำมันปัจจุบัน
                      </div>
                      <div className="mt-1.5 sm:mt-2 flex flex-col gap-1 sm:gap-1.5">
                        <div className="flex items-baseline justify-between gap-1 font-sans text-xs sm:text-sm font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                          <span className="text-slate-500 text-[11px] font-sans">ดีเซล:</span>
                          <span className="font-sans text-xs sm:text-base font-extrabold tracking-tight text-blue-700 tabular-nums">
                            {isLoading && !sheetData
                              ? '...'
                              : `${fuelKpiMetrics.latestDieselBalance.toLocaleString('th-TH')} ล.`}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-1 font-sans text-xs sm:text-sm font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                          <span className="text-slate-500 text-[11px] font-sans">เบนซิน:</span>
                          <span className="font-sans text-xs sm:text-base font-extrabold tracking-tight text-indigo-700 tabular-nums">
                            {isLoading && !sheetData
                              ? '...'
                              : `${fuelKpiMetrics.latestBenzeneBalance.toLocaleString('th-TH')} ล.`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 bg-blue-500/10 text-blue-700 backdrop-blur-sm">
                      <Fuel className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                {/* Card 2: ยอดรับเข้าสะสม (ลิตร) */}
                <div className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-white/60 bg-white/80 px-2.5 py-2.5 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 whitespace-nowrap">
                        <span className="truncate text-[11px] sm:text-xs font-semibold text-slate-600">
                          ยอดรับเข้าสะสม
                        </span>
                        <span className="shrink-0 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 rounded-full px-1.5 py-0.5 tabular-nums">
                          {fuelKpiMetrics.totalInCount.toLocaleString('th-TH')} ครั้ง
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-1 font-sans text-base sm:text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums whitespace-nowrap">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : fuelKpiMetrics.totalInLiters.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-[11px] sm:text-xs font-semibold tracking-normal text-emerald-700">
                          ลิตร
                        </span>
                      </div>

                      <div className="mt-1.5 pt-1.5 border-t border-slate-100/90 flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[11px] sm:text-xs font-sans whitespace-nowrap">
                          <span className="text-slate-500 font-medium">ดีเซล:</span>
                          <span className="font-sans font-semibold text-slate-800 tabular-nums">
                            <span className="text-emerald-700 font-bold">
                              {fuelKpiMetrics.inDieselLiters.toLocaleString('th-TH')}
                            </span>{' '}
                            ล.{' '}
                            <span className="text-slate-400 font-normal text-[10px]">
                              ({fuelKpiMetrics.inDieselCount.toLocaleString('th-TH')})
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] sm:text-xs font-sans whitespace-nowrap">
                          <span className="text-slate-500 font-medium">เบนซิน:</span>
                          <span className="font-sans font-semibold text-slate-800 tabular-nums">
                            <span className="text-indigo-700 font-bold">
                              {fuelKpiMetrics.inBenzeneLiters.toLocaleString('th-TH')}
                            </span>{' '}
                            ล.{' '}
                            <span className="text-slate-400 font-normal text-[10px]">
                              ({fuelKpiMetrics.inBenzeneCount.toLocaleString('th-TH')})
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <Droplet className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                {/* Card 3: ยอดจ่ายออกสะสม (เบิกออก) */}
                <div className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-white/60 bg-white/80 px-2.5 py-2.5 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 whitespace-nowrap">
                        <span className="truncate text-[11px] sm:text-xs font-semibold text-slate-600">
                          ยอดเบิกออกสะสม
                        </span>
                        <span className="shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/70 rounded-full px-1.5 py-0.5 tabular-nums">
                          {fuelKpiMetrics.totalOutCount.toLocaleString('th-TH')} ครั้ง
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-1 font-sans text-base sm:text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums whitespace-nowrap">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : fuelKpiMetrics.totalOutLiters.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-[11px] sm:text-xs font-semibold tracking-normal text-amber-700">
                          ลิตร
                        </span>
                      </div>

                      <div className="mt-1.5 pt-1.5 border-t border-slate-100/90 flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[11px] sm:text-xs font-sans whitespace-nowrap">
                          <span className="text-slate-500 font-medium">ดีเซล:</span>
                          <span className="font-sans font-semibold text-slate-800 tabular-nums">
                            <span className="text-amber-700 font-bold">
                              {fuelKpiMetrics.outDieselLiters.toLocaleString('th-TH')}
                            </span>{' '}
                            ล.{' '}
                            <span className="text-slate-400 font-normal text-[10px]">
                              ({fuelKpiMetrics.outDieselCount.toLocaleString('th-TH')})
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] sm:text-xs font-sans whitespace-nowrap">
                          <span className="text-slate-500 font-medium">เบนซิน:</span>
                          <span className="font-sans font-semibold text-slate-800 tabular-nums">
                            <span className="text-indigo-700 font-bold">
                              {fuelKpiMetrics.outBenzeneLiters.toLocaleString('th-TH')}
                            </span>{' '}
                            ล.{' '}
                            <span className="text-slate-400 font-normal text-[10px]">
                              ({fuelKpiMetrics.outBenzeneCount.toLocaleString('th-TH')})
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Repeat className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                {/* Card 4: มูลค่าจ่ายออกรวม (บาท) */}
                <div className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-white/60 bg-white/80 px-2.5 py-2.5 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-violet-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] sm:text-xs font-semibold text-slate-600 whitespace-nowrap">
                        มูลค่าจ่ายออกรวม
                      </div>
                      <div className="mt-1 flex items-baseline gap-1 font-sans text-base sm:text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums whitespace-nowrap">
                        <span className="truncate">
                          {isLoading && !sheetData
                            ? '...'
                            : `${fuelKpiMetrics.totalOutValue.toLocaleString('th-TH', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })} ฿`}
                        </span>
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-slate-100/90 flex flex-col gap-0.5 text-[11px] font-sans whitespace-nowrap">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">ราคาล่าสุด:</span>
                          <span className="font-bold text-slate-800 tabular-nums">
                            {fuelKpiMetrics.latestPrice.toLocaleString('th-TH', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            ฿
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">ราคาเฉลี่ย:</span>
                          <span className="font-bold text-slate-800 tabular-nums">
                            {fuelKpiMetrics.avgPrice.toLocaleString('th-TH', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            ฿
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200/70 bg-violet-500/10 text-violet-700 backdrop-blur-sm">
                      <Coins className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab.gid === '378250263' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-blue-100/60 via-slate-100/70 to-amber-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: จำนวนรถทั้งหมด */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        จำนวนรถทั้งหมด
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : vehicleKpiMetrics.totalVehicles.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-blue-700">
                          คัน
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 bg-blue-500/10 text-blue-700 backdrop-blur-sm">
                      <Truck className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-100/90 flex flex-col gap-1 font-sans text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 font-medium">มีพนักงานประจำรถ:</span>
                      <span className="font-bold text-emerald-700 tabular-nums">
                        {vehicleKpiMetrics.withDriverCount.toLocaleString('th-TH')} คัน
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 font-medium">ยังไม่มีพนักงาน:</span>
                      <span className="font-bold text-amber-700 tabular-nums">
                        {vehicleKpiMetrics.withoutDriverCount.toLocaleString('th-TH')} คัน
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card 2: สรุปตามกะทำงาน */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        สรุปตามกะทำงาน
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : vehicleKpiMetrics.totalVehicles.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-amber-700">
                          คัน
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Clock className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-100/90 flex flex-col gap-1 font-sans text-xs">
                    {Object.entries(vehicleKpiMetrics.shifts).map(([shiftName, count]) => (
                      <div key={shiftName} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 font-medium">{shiftName}:</span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {count.toLocaleString('th-TH')} คัน
                        </span>
                      </div>
                    ))}
                    {Object.keys(vehicleKpiMetrics.shifts).length === 0 && (
                      <div className="text-[11px] text-slate-400">ไม่มีข้อมูลกะ</div>
                    )}
                  </div>
                </div>

                {/* Card 3: สรุปตามทีม */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        สรุปตามทีม
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : `${Object.keys(vehicleKpiMetrics.teams).filter((t) => !t.includes('ไม่ระบุ')).length} ทีม`}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Users className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-100/90 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs">
                    {Object.entries(vehicleKpiMetrics.teams).map(([teamName, count]) => (
                      <div key={teamName} className="flex items-center gap-1 text-[11px] bg-indigo-50/80 border border-indigo-100 rounded-md px-1.5 py-0.5">
                        <span className="text-slate-600 font-medium">{teamName}:</span>
                        <span className="font-bold text-indigo-700 tabular-nums">
                          {count.toLocaleString('th-TH')}
                        </span>
                      </div>
                    ))}
                    {Object.keys(vehicleKpiMetrics.teams).length === 0 && (
                      <div className="text-[11px] text-slate-400">ไม่มีข้อมูลทีม</div>
                    )}
                  </div>
                </div>

                {/* Card 4: สรุปตามพื้นที่ปฏิบัติงาน */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        สรุปตามพื้นที่ปฏิบัติงาน
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : `${vehicleKpiMetrics.distinctAreaCount} พื้นที่`}
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <MapPin className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-slate-100/90 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-sans text-[11px]">
                    {Object.entries(vehicleKpiMetrics.areas)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([areaName, count]) => (
                        <span key={areaName} className="text-slate-600 font-medium">
                          {areaName}{' '}
                          <strong className="font-bold text-emerald-700 tabular-nums">
                            {count}
                          </strong>
                          คัน ·
                        </span>
                      ))}
                    {Object.keys(vehicleKpiMetrics.areas).length > 4 && (
                      <span className="text-slate-400 font-normal">
                        และอื่นๆ +{Object.keys(vehicleKpiMetrics.areas).length - 4} พื้นที่
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab.gid === '1031154414' ? (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: รายการยางทั้งหมด */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        รายการยางทั้งหมด
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : tireStockKpiMetrics.totalItemsCount.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-sky-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/70 bg-sky-500/10 text-sky-700 backdrop-blur-sm">
                      <Disc className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    แบ่งเป็น{' '}
                    <span className="font-sans font-bold tracking-tight text-sky-700 tabular-nums">
                      {tireStockKpiMetrics.uniqueGroupsCount.toLocaleString('th-TH')}
                    </span>{' '}
                    กลุ่มขนาดยาง
                  </div>
                </div>

                {/* Card 2: ยอดคงเหลือรวมในคลัง */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ยอดคงเหลือรวมในคลัง
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-emerald-700 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : tireStockKpiMetrics.totalBalance.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-emerald-700">
                          เส้น/ชิ้น
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ยอดยกมารวม{' '}
                    <span className="font-sans font-bold tracking-tight text-slate-700 tabular-nums">
                      {tireStockKpiMetrics.totalCarryForward.toLocaleString('th-TH')}
                    </span>{' '}
                    เส้น/ชิ้น
                  </div>
                </div>

                {/* Card 3: ยอดรับเข้า / เบิกออกสะสม */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md flex flex-col justify-between">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ยอดรับเข้า / เบิกออกสะสม
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-baseline gap-2 font-sans tabular-nums">
                        <span className="text-lg sm:text-xl font-extrabold text-emerald-700">
                          +{tireStockKpiMetrics.totalReceived.toLocaleString('th-TH')}
                        </span>
                        <span className="text-slate-300 font-bold">/</span>
                        <span className="text-lg sm:text-xl font-extrabold text-amber-700">
                          -{tireStockKpiMetrics.totalIssued.toLocaleString('th-TH')}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">เส้น</span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Repeat className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รับเข้า{' '}
                    <span className="font-bold text-emerald-700 tabular-nums">
                      {tireStockKpiMetrics.totalReceived.toLocaleString('th-TH')}
                    </span>{' '}
                    · เบิกใช้{' '}
                    <span className="font-bold text-amber-700 tabular-nums">
                      {tireStockKpiMetrics.totalIssued.toLocaleString('th-TH')}
                    </span>{' '}
                    เส้น
                  </div>
                </div>

                {/* Card 4: รายการแจ้งเตือนสต็อกต่ำ / หมดสต็อก (คลิกเพื่อกรองได้) */}
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !tireLowStockOnly;
                    setTireLowStockOnly(nextVal);
                    if (nextVal && repairGroupedRows) {
                      const expandedMap: Record<string, boolean> = {};
                      repairGroupedRows.forEach((_, key) => {
                        expandedMap[key] = false;
                      });
                      setCollapsedGroups(expandedMap);
                    }
                  }}
                  className={`group relative overflow-hidden rounded-2xl border px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm transition-all duration-200 text-left flex flex-col justify-between cursor-pointer ${
                    tireLowStockOnly
                      ? 'border-red-500 bg-red-50/95 ring-2 ring-red-500/30 shadow-md'
                      : tireStockKpiMetrics.lowStockCount > 0
                      ? 'border-amber-300/80 bg-white/85 hover:bg-amber-50/50 ring-1 ring-amber-200/60 hover:shadow-md'
                      : 'border-white/60 bg-white/80 ring-1 ring-slate-200/50 hover:bg-white/90 hover:shadow-md'
                  }`}
                >
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-rose-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-slate-700">
                          แจ้งเตือนสต็อกต่ำ / หมดสต็อก
                        </span>
                        {tireLowStockOnly && (
                          <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-bold text-white shrink-0">
                            กำลังกรอง
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-rose-700 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : tireStockKpiMetrics.lowStockCount.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-rose-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200/70 bg-rose-500/10 text-rose-700 backdrop-blur-sm">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-600 w-full">
                    หมดสต็อก{' '}
                    <span className="font-bold text-red-600 tabular-nums">
                      {tireStockKpiMetrics.outOfStockCount.toLocaleString('th-TH')}
                    </span>{' '}
                    · สต็อกต่ำ{' '}
                    <span className="font-bold text-amber-700 tabular-nums">
                      {tireStockKpiMetrics.lowOnlyCount.toLocaleString('th-TH')}
                    </span>{' '}
                    <span className="underline decoration-dotted text-slate-500 ml-1">
                      ({tireLowStockOnly ? 'คลิกแสดงทั้งหมด' : 'คลิกเพื่อกรอง'})
                    </span>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="relative rounded-2xl bg-gradient-to-br from-sky-100/60 via-slate-100/70 to-emerald-100/50 p-2 sm:p-3 border border-white/80 shadow-xs">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
                {/* Card 1: ทั้งหมดในชีต */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        ทั้งหมดในชีต
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : (sheetData?.totalRowsInSheet ?? 0).toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-sky-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200/70 bg-sky-500/10 text-sky-700 backdrop-blur-sm">
                      <SlidersHorizontal className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ฐานข้อมูล {activeTab.name}
                  </div>
                </div>

                {/* Card 2: แสดงผล */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        แสดงผล
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        <span>
                          {isLoading && !sheetData
                            ? '...'
                            : sortedRows.length.toLocaleString('th-TH')}
                        </span>
                        <span className="font-sans text-xs font-semibold tracking-normal text-indigo-700">
                          รายการ
                        </span>
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700 backdrop-blur-sm">
                      <Eye className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    รายการที่กรองแสดงผลปัจจุบัน
                  </div>
                </div>

                {/* Card 3: Contextual Metric */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        {contextualMetric.label}
                      </div>
                      <div className="mt-1.5 truncate font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        {isLoading && !sheetData ? '...' : contextualMetric.value}
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700 backdrop-blur-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    {contextualMetric.subtext}
                  </div>
                </div>

                {/* Card 4: อัปเดตล่าสุด */}
                <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all duration-200 hover:bg-white/90 hover:shadow-md">
                  <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl transition-opacity group-hover:opacity-100" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-600">
                        อัปเดตล่าสุด
                      </div>
                      <div className="mt-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                        {formattedFetchTime}
                      </div>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700 backdrop-blur-sm">
                      <Clock className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-2 truncate font-sans text-[11px] font-medium text-slate-500">
                    ซิงค์ข้อมูลจาก Google Sheets
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Mode Switcher for Fuel Tab (1733355146) */}
          {activeTab.gid === '1733355146' && (
            <div className="mt-2.5 sm:mt-3.5 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-1.5 sm:p-2.5 shadow-2xs">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setFuelViewMode('summary')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 sm:px-3.5 sm:py-2 text-xs font-bold transition-all whitespace-nowrap min-w-0 ${
                    fuelViewMode === 'summary'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  <span className="truncate sm:hidden">สรุปรายเดือน/วัน</span>
                  <span className="hidden sm:inline">ตารางสรุปรับเข้า-เบิกออก แต่ละเดือน (ดูรายวัน)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFuelViewMode('rawTable')}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 sm:px-3.5 sm:py-2 text-xs font-bold transition-all whitespace-nowrap min-w-0 ${
                    fuelViewMode === 'rawTable'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  <span className="truncate sm:hidden">
                    ตารางทั้งหมด ({sheetData?.rows.length.toLocaleString('th-TH') ?? 0})
                  </span>
                  <span className="hidden sm:inline">
                    ตารางรายการทั้งหมด ({sheetData?.rows.length.toLocaleString('th-TH') ?? 0} แถว)
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsFuelModalOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
              >
                <PlusCircle className="h-4 w-4" />
                <span>+ บันทึกรับเข้า-เบิกออกน้ำมัน</span>
              </button>
            </div>
          )}

          {/* Monthly & Daily Summary View for Fuel Tab */}
          {activeTab.gid === '1733355146' && fuelViewMode === 'summary' && (
            <div className="mt-3">
              <FuelMonthlySummaryView
                rows={sheetData?.rows ?? []}
                columns={sheetData?.columns}
                onSelectRow={setSelectedRow}
                onOpenFuelModal={() => setIsFuelModalOpen(true)}
                onRefreshData={handleManualSync}
                isRefreshing={isRefreshing}
              />
            </div>
          )}

          {/* Fuel Charts section for tab 1733355146 (Visible in rawTable mode) */}
          {activeTab.gid === '1733355146' && fuelViewMode === 'rawTable' && (
            <div className="mt-4">
              <FuelCharts
                rows={sheetData?.rows ?? []}
                columns={sheetData?.columns}
                startDate={startDateFilter}
                endDate={endDateFilter}
                onStartDateChange={setStartDateFilter}
                onEndDateChange={setEndDateFilter}
                onClearDateFilter={() => {
                  setStartDateFilter('');
                  setEndDateFilter('');
                }}
              />
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">เกิดข้อผิดพลาด</div>
                  <div className="break-words text-red-700">{error}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadData({ silent: false })}
                className="rounded-lg bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-800 whitespace-nowrap shrink-0"
              >
                ลองใหม่
              </button>
            </div>
          )}

          {/* Main Data Table Card */}
          {(activeTab.gid !== '1733355146' || fuelViewMode === 'rawTable') && (
            <div className="mt-2.5 sm:mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {/* Toolbar on top of STOCK ยาง table */}
            {activeTab.gid === '1031154414' && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 bg-slate-50/90 px-3 py-2.5 sm:px-4">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ค้นหารหัสยาง, รายการขนาดยาง, ยี่ห้อ, ทะเบียนรถ..."
                      className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none shadow-2xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setTireLowStockOnly((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                      tireLowStockOnly
                        ? 'border-red-600 bg-red-600 text-white shadow-2xs'
                        : 'border-amber-300 bg-amber-50/80 text-amber-900 hover:bg-amber-100'
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      เฉพาะสต็อกต่ำ/หมด ({tireStockKpiMetrics.lowStockCount})
                    </span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {repairGroupedRows && repairGroupedRows.size > 0 && (() => {
                    const groupKeys = Array.from(repairGroupedRows.keys());
                    const areAllExpanded = groupKeys.every(
                      (k) => collapsedGroups[k] === false
                    );
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          const nextState: Record<string, boolean> = {};
                          groupKeys.forEach((k) => {
                            nextState[k] = areAllExpanded;
                          });
                          setCollapsedGroups(nextState);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors whitespace-nowrap"
                      >
                        <ChevronsUpDown className="h-3.5 w-3.5 text-slate-500" />
                        <span>{areAllExpanded ? 'ย่อทั้งหมด' : 'กางทั้งหมด'}</span>
                      </button>
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => {
                      setTireModalInitType('OUT');
                      setTireModalInitCode('');
                      setIsTireModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-colors whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5 text-amber-300" />
                    <span>+ บันทึกรับเข้า-เบิกออกยาง</span>
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    {activeTab.gid !== '944294225' && activeTab.gid !== '1733355146' && (
                      <th
                        className="w-16 px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap"
                      >
                        <button
                          type="button"
                          onClick={() => handleSort('__ROW__')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          <span>แถว</span>
                          {sortConfig?.colId === '__ROW__' ? (
                            sortConfig.direction === 'asc' ? (
                              <ArrowUp className="h-3 w-3 text-slate-900" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-slate-900" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 text-slate-400" />
                          )}
                        </button>
                      </th>
                    )}
                    {sheetData?.columns.map((col) => {
                      const isSorted = sortConfig?.colId === col.id;
                      const isNumeric = col.type === 'number';
                      const isFuelTab = activeTab.gid === '1733355146';
                      const isFuelMainCol =
                        isFuelTab &&
                        (col.id === 'D' ||
                          col.id === 'E' ||
                          col.id === 'F' ||
                          col.id === 'G' ||
                          col.id === 'H' ||
                          col.label.includes('ชนิดน้ำมัน') ||
                          col.label.includes('รับเข้า') ||
                          col.label.includes('ราคา') ||
                          col.label.includes('จ่ายออก') ||
                          col.label.includes('มูลค่า'));
                      const isHiddenOnMobile = isFuelTab && !isFuelMainCol;

                      return (
                        <th
                          key={col.id}
                          className={`px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap ${
                            isHiddenOnMobile ? 'hidden sm:table-cell' : ''
                          } ${isNumeric ? 'text-right' : 'text-left'}`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(col.id)}
                            className={`inline-flex items-center gap-1 hover:text-slate-900 ${
                              isNumeric ? 'ml-auto flex-row-reverse' : ''
                            }`}
                          >
                            <span>
                              {activeTab.gid === '944294225' && col.id === 'Q'
                                ? 'รูปถ่าย'
                                : col.label}
                            </span>
                            {isSorted ? (
                              sortConfig.direction === 'asc' ? (
                                <ArrowUp className="h-3 w-3 text-slate-900 shrink-0" />
                              ) : (
                                <ArrowDown className="h-3 w-3 text-slate-900 shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-slate-400 shrink-0" />
                            )}
                          </button>
                        </th>
                      );
                    })}
                    {activeTab.gid === '944294225' && (
                      <th className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap">
                        จัดการ
                      </th>
                    )}
                    {activeTab.gid === '378250263' && (
                      <th className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap">
                        เพิ่มเติม
                      </th>
                    )}
                    {activeTab.gid === '1031154414' && (
                      <th className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap">
                        รับเข้า / เบิกออก
                      </th>
                    )}
                  </tr>
                </thead>

              <tbody className="divide-y divide-slate-100 text-sm">
                {isLoading && !sheetData ? (
                  Array.from({ length: 10 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      {activeTab.gid !== '944294225' && (
                        <td className="px-4 py-3">
                          <div className="h-4 w-12 rounded bg-slate-200" />
                        </td>
                      )}
                      {Array.from({ length: 6 }).map((__, cIdx) => (
                        <td key={cIdx} className="px-4 py-3">
                          <div className="h-4 w-28 rounded bg-slate-200" />
                        </td>
                      ))}
                      {(activeTab.gid === '944294225' || activeTab.gid === '378250263') && (
                        <td className="px-4 py-3 text-center">
                          <div className="mx-auto h-4 w-20 rounded bg-slate-200" />
                        </td>
                      )}
                    </tr>
                  ))
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={(sheetData?.columns.length ?? 5) + (activeTab.gid === '944294225' ? 1 : 2)}
                      className="px-6 py-14 text-center"
                    >
                      <div className="mx-auto max-w-md">
                        <div className="text-base font-semibold text-slate-900">
                          {sheetData && sheetData.rows.length === 0
                            ? 'ไม่มีรายการข้อมูล'
                            : 'ไม่พบข้อมูล'}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {sheetData && sheetData.rows.length === 0
                            ? 'ไม่พบข้อมูลในตารางนี้จาก Google Sheets'
                            : searchQuery
                            ? `ไม่พบข้อมูลที่มีคำว่า "${searchQuery}" ในชุดข้อมูลที่เลือก`
                            : startDateFilter || endDateFilter
                            ? 'ไม่พบข้อมูลในช่วงวันที่ระบุ'
                            : 'ไม่พบรายการข้อมูลที่ตรงกับเงื่อนไขการค้นหา'}
                        </p>
                        <div className="mt-4 flex items-center justify-center gap-2">
                          {(searchQuery !== '' ||
                            selectedColumnId !== 'ALL' ||
                            quickFilterValue !== 'ALL' ||
                            startDateFilter !== '' ||
                            endDateFilter !== '' ||
                            deepSearchTerm !== '') && (
                            <button
                              type="button"
                              onClick={handleClearSearch}
                              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                            >
                              ล้างคำค้นหาทั้งหมด
                            </button>
                          )}
                          {searchQuery.trim() !== '' &&
                            sheetData &&
                            sheetData.totalRowsInSheet > rowLimit &&
                            deepSearchTerm !== searchQuery.trim() && (
                              <button
                                type="button"
                                onClick={handleTriggerDeepSearch}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                ค้นหาลึกทั้งชีต ({sheetData.totalRowsInSheet.toLocaleString('th-TH')} แถว)
                              </button>
                            )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (activeTab.gid === '944294225' ||
                    activeTab.gid === '606634465' ||
                    activeTab.gid === '378250263' ||
                    activeTab.gid === '1733355146' ||
                    activeTab.gid === '1031154414') &&
                  repairGroupedRows ? (
                  Array.from(repairGroupedRows.entries()).map(([status, rows]) => {
                    const isCollapsed = collapsedGroups[status] ?? true;
                    const colSpan =
                      (sheetData?.columns.length ?? 5) +
                      (activeTab.gid === '378250263' || activeTab.gid === '1031154414'
                        ? 2
                        : activeTab.gid === '944294225' || activeTab.gid === '1733355146'
                        ? 0
                        : 1);
                    const groupPageSize =
                      activeTab.gid === '378250263' ||
                      activeTab.gid === '1733355146' ||
                      activeTab.gid === '1031154414'
                        ? 50
                        : 15;
                    const currentGroupPage = groupPages[status] ?? 1;
                    const groupTotalPages = Math.max(1, Math.ceil(rows.length / groupPageSize));
                    const paginatedGroupRows = rows.slice(
                      (currentGroupPage - 1) * groupPageSize,
                      currentGroupPage * groupPageSize
                    );
                    const groupTheme = getStatusGroupHeaderTheme(status, activeTab.gid);
                    const isJobTransferInTransitGroup =
                      activeTab.gid === '606634465' && isJobTransferInTransitStatus(status);
                    const groupRowKeys = isJobTransferInTransitGroup
                      ? rows.map((r) => getJobTransferRowKey(r))
                      : [];
                    const selectedInGroupRows = isJobTransferInTransitGroup
                      ? rows.filter((r) => selectedInTransitKeys.has(getJobTransferRowKey(r)))
                      : [];
                    const isAllGroupSelected =
                      isJobTransferInTransitGroup &&
                      rows.length > 0 &&
                      selectedInGroupRows.length === rows.length;

                    const isTireTabGroup = activeTab.gid === '1031154414';
                    const tireGroupStats = isTireTabGroup
                      ? rows.reduce(
                          (acc, r) => {
                            const rec = parseTireNumericCell(r, 'D');
                            const iss = parseTireNumericCell(r, 'E');
                            const bal = parseTireNumericCell(r, 'F');
                            const low = isTireLowStock(r);
                            acc.received += rec;
                            acc.issued += iss;
                            acc.balance += bal;
                            if (low) acc.lowCount += 1;
                            if (bal <= 0) acc.outCount += 1;
                            return acc;
                          },
                          { received: 0, issued: 0, balance: 0, lowCount: 0, outCount: 0 }
                        )
                      : null;
                    const primaryTireRowInGroup = isTireTabGroup ? rows[0] : null;
                    const primaryTireCode = primaryTireRowInGroup
                      ? (primaryTireRowInGroup.values['A'] ?? '').trim() ||
                        `ROW-${primaryTireRowInGroup.rowNumber}`
                      : '';

                    return (
                      <React.Fragment key={status}>
                        <tr
                          onClick={() =>
                            setCollapsedGroups((prev) => ({
                              ...prev,
                              [status]: !isCollapsed,
                            }))
                          }
                          className={`cursor-pointer font-semibold transition-all duration-150 select-none ${
                            isTireTabGroup && tireGroupStats && tireGroupStats.lowCount > 0
                              ? 'bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-slate-50 hover:from-amber-500/25 border-y border-amber-300/80'
                              : groupTheme.rowClass
                          }`}
                        >
                          <td colSpan={colSpan} className="px-3 py-2.5 sm:px-4 sm:py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                                <button
                                  type="button"
                                  className={`flex h-6 w-6 items-center justify-center rounded-lg transition-transform duration-150 ${
                                    isTireTabGroup && tireGroupStats && tireGroupStats.lowCount > 0
                                      ? 'bg-amber-600 text-white shadow-xs'
                                      : groupTheme.chevronClass
                                  }`}
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </button>
                                <span
                                  className={`text-xs sm:text-sm font-extrabold tracking-tight ${groupTheme.titleClass}`}
                                >
                                  {status}
                                </span>
                                <span
                                  className={`rounded-lg px-2.5 py-0.5 font-sans text-[11px] font-bold tracking-tight tabular-nums ${groupTheme.countClass}`}
                                >
                                  {rows.length.toLocaleString('th-TH')}{' '}
                                  {isTireTabGroup ? 'รายการย่อย' : 'รายการ'}
                                </span>

                                {isTireTabGroup && tireGroupStats && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50/90 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800 tabular-nums">
                                      รับเข้า: +{tireGroupStats.received.toLocaleString('th-TH')}
                                    </span>
                                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50/90 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-800 tabular-nums">
                                      เบิก: -{tireGroupStats.issued.toLocaleString('th-TH')}
                                    </span>
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 font-mono text-[11px] font-extrabold tabular-nums ${
                                        tireGroupStats.balance <= 0
                                          ? 'border-red-300 bg-red-100 text-red-800'
                                          : tireGroupStats.lowCount > 0
                                          ? 'border-amber-300 bg-amber-100 text-amber-900'
                                          : 'border-slate-300 bg-white text-slate-900'
                                      }`}
                                    >
                                      คงเหลือ: {tireGroupStats.balance.toLocaleString('th-TH')} เส้น
                                    </span>

                                    {tireGroupStats.lowCount > 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-600 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-2xs">
                                        <AlertTriangle className="h-3 w-3" />
                                        <span>
                                          {tireGroupStats.outCount > 0
                                            ? 'หมดสต็อก / สต็อกต่ำ'
                                            : 'สต็อกต่ำ'}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                )}

                                {isJobTransferInTransitGroup && rows.length > 0 && (
                                  <div
                                    className="flex flex-wrap items-center gap-1.5 ml-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedInTransitKeys((prev) => {
                                          const next = new Set(prev);
                                          if (isAllGroupSelected) {
                                            groupRowKeys.forEach((k) => next.delete(k));
                                          } else {
                                            groupRowKeys.forEach((k) => next.add(k));
                                          }
                                          return next;
                                        });
                                      }}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white/90 hover:bg-white px-2.5 py-1 text-[11px] font-bold text-amber-900 shadow-2xs transition-colors"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isAllGroupSelected}
                                        readOnly
                                        className="h-3.5 w-3.5 rounded border-amber-400 text-emerald-600 focus:ring-0 pointer-events-none"
                                      />
                                      <span>
                                        {isAllGroupSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมด'}
                                      </span>
                                    </button>

                                    {selectedInGroupRows.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setBatchFinishConfirmRows(selectedInGroupRows)}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1 text-[11px] font-bold text-white shadow-xs transition-colors"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        <span>
                                          จบงานพร้อมกัน ({selectedInGroupRows.length} รายการ)
                                        </span>
                                      </button>
                                    )}

                                    {selectedInGroupRows.length === 0 && rows.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => setBatchFinishConfirmRows(rows)}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs transition-colors"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        <span>จบงานทั้งหมด ({rows.length})</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                {isTireTabGroup && primaryTireCode && (
                                  <div
                                    className="flex items-center gap-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTireModalInitType('IN');
                                        setTireModalInitCode(primaryTireCode);
                                        setIsTireModalOpen(true);
                                      }}
                                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs transition-colors"
                                      title="บันทึกรับเข้ายางรายการนี้"
                                    >
                                      <PackagePlus className="h-3 w-3" />
                                      <span>+ รับเข้า</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTireModalInitType('OUT');
                                        setTireModalInitCode(primaryTireCode);
                                        setIsTireModalOpen(true);
                                      }}
                                      className="inline-flex items-center gap-1 rounded-lg bg-amber-600 hover:bg-amber-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs transition-colors"
                                      title="บันทึกเบิกออกยางรายการนี้"
                                    >
                                      <PackageMinus className="h-3 w-3" />
                                      <span>- เบิกออก</span>
                                    </button>
                                  </div>
                                )}
                                <span
                                  className={`hidden sm:inline text-[11px] font-semibold ${groupTheme.actionClass}`}
                                >
                                  {isCollapsed ? 'คลิกเพื่อขยาย' : 'คลิกเพื่อย่อ'}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && (
                          <>
                            {paginatedGroupRows.map((row, rowIdx) => {
                              const rowKey = getJobTransferRowKey(row);
                              const isRowInTransit =
                                activeTab.gid === '606634465' &&
                                isJobTransferInTransitStatus(
                                  getRowJobTransferStatus(row, sheetData?.columns)
                                );
                              const isRowSelected =
                                isRowInTransit && selectedInTransitKeys.has(rowKey);

                              return (
                              <tr
                                key={`${rowKey}-${row.rowNumber}-${rowIdx}`}
                                onClick={() => setSelectedRow(row)}
                                className={`cursor-pointer transition-colors ${
                                  isRowSelected
                                    ? 'bg-emerald-50/70 hover:bg-emerald-50'
                                    : 'hover:bg-slate-50'
                                }`}
                              >
                                {activeTab.gid !== '944294225' && activeTab.gid !== '1733355146' && (
                                  <td
                                    className="px-2.5 py-2 sm:px-4 sm:py-2.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap"
                                    onClick={
                                      isRowInTransit
                                        ? (e) => {
                                            e.stopPropagation();
                                            setSelectedInTransitKeys((prev) => {
                                              const next = new Set(prev);
                                              if (next.has(rowKey)) {
                                                next.delete(rowKey);
                                              } else {
                                                next.add(rowKey);
                                              }
                                              return next;
                                            });
                                          }
                                        : undefined
                                    }
                                  >
                                    <div className="inline-flex items-center gap-2">
                                      {isRowInTransit && (
                                        <input
                                          type="checkbox"
                                          checked={isRowSelected}
                                          onChange={() => {}}
                                          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                          title="เลือกรายการเพื่อกดจบงานพร้อมกัน"
                                        />
                                      )}
                                      <span>#{row.rowNumber.toLocaleString('th-TH')}</span>
                                    </div>
                                  </td>
                                )}
                                {sheetData?.columns.map((col) => {
                                  const val = row.values[col.id] ?? '';
                                  const isNumeric = col.type === 'number';
                                  const isMono =
                                    isNumeric ||
                                    col.type === 'date' ||
                                    col.type === 'datetime' ||
                                    col.type === 'timeofday';

                                  const isFuelTab = activeTab.gid === '1733355146';
                                  const isFuelMainCol =
                                    isFuelTab &&
                                    (col.id === 'D' ||
                                      col.id === 'E' ||
                                      col.id === 'F' ||
                                      col.id === 'G' ||
                                      col.id === 'H' ||
                                      col.label.includes('ชนิดน้ำมัน') ||
                                      col.label.includes('รับเข้า') ||
                                      col.label.includes('ราคา') ||
                                      col.label.includes('จ่ายออก') ||
                                      col.label.includes('มูลค่า'));
                                  const isHiddenOnMobile = isFuelTab && !isFuelMainCol;

                                  const isEditableGateCell =
                                    activeTab.gid === '1156877149' && col.id === 'C';
                                  const isEditableVehicleRegCell = false;
                                  const isEditableJobNoteCell =
                                    activeTab.gid === '606634465' && col.id === 'N';
                                  const isEditableInlineCell =
                                    isEditableGateCell ||
                                    isEditableVehicleRegCell ||
                                    isEditableJobNoteCell;
                                  const isEditingThisRow =
                                    isEditableInlineCell &&
                                    editingGateRowNumber === row.rowNumber &&
                                    editingColumnId === col.id;
                                  const isConfirmingThisRow =
                                    isEditableInlineCell &&
                                    confirmingGateRowNumber === row.rowNumber &&
                                    editingColumnId === col.id;
                                  const isOver20MinDuration =
                                    activeTab.gid === '606634465' &&
                                    (col.id === 'L' || col.label === 'เวลาที่ใช้') &&
                                    isDurationExceeding20Minutes(val);

                                  return (
                                    <td
                                      key={col.id}
                                      onClick={
                                        isEditableInlineCell
                                          ? (e) => {
                                              e.stopPropagation();
                                              if (!isEditingThisRow && !isConfirmingThisRow) {
                                                setEditingGateRowNumber(row.rowNumber);
                                                setEditingColumnId(col.id);
                                                setEditingGateValue(val);
                                                setConfirmingGateRowNumber(null);
                                              }
                                            }
                                          : undefined
                                      }
                                      className={`px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap ${
                                        isHiddenOnMobile ? 'hidden sm:table-cell' : ''
                                      } ${
                                        isOver20MinDuration
                                          ? 'bg-red-50 font-bold text-red-600'
                                          : 'text-slate-800'
                                      } ${
                                        isEditableInlineCell
                                          ? 'min-w-[220px] sm:min-w-[280px] cursor-pointer'
                                          : 'max-w-[220px] sm:max-w-[260px] truncate'
                                      } ${isNumeric ? 'text-right' : 'text-left'} ${
                                        isMono ? 'font-mono text-xs tabular-nums' : 'text-xs sm:text-sm'
                                      }`}
                                      title={
                                        isEditableInlineCell
                                          ? 'คลิกเพื่อแก้ไขข้อมูลเพิ่มเติม'
                                          : val
                                      }
                                    >
                                      {isEditableInlineCell ? (
                                        isConfirmingThisRow ? (
                                          <div
                                            className="flex flex-wrap items-center gap-1.5"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <span className="text-xs text-slate-700">
                                              ยืนยัน{' '}
                                              <strong className="font-semibold text-slate-900">
                                                {editingGateValue.trim() || '(ว่าง)'}
                                              </strong>
                                              ?
                                            </span>
                                            <button
                                              type="button"
                                              disabled={isUpdatingGate}
                                              onClick={() => handleConfirmGateUpdate(row)}
                                              className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                                            >
                                              <Check className="h-3 w-3" />
                                              <span>
                                                {isUpdatingGate ? 'กำลังบันทึก...' : 'ยืนยัน'}
                                              </span>
                                            </button>
                                            <button
                                              type="button"
                                              disabled={isUpdatingGate}
                                              onClick={() => {
                                                setConfirmingGateRowNumber(null);
                                              }}
                                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                            >
                                              ย้อนกลับ
                                            </button>
                                          </div>
                                        ) : isEditingThisRow ? (
                                          <div
                                            className="flex items-center gap-1.5"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <input
                                              type="text"
                                              autoFocus
                                              value={editingGateValue}
                                              onChange={(e) => setEditingGateValue(e.target.value)}
                                              placeholder={
                                                isEditableJobNoteCell
                                                  ? 'พิมพ์หมายเหตุ...'
                                                  : undefined
                                              }
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  if (
                                                    (isEditableJobNoteCell ||
                                                      editingGateValue.trim()) &&
                                                    editingGateValue.trim() !== val.trim()
                                                  ) {
                                                    setConfirmingGateRowNumber(row.rowNumber);
                                                  } else {
                                                    setEditingGateRowNumber(null);
                                                    setEditingColumnId(null);
                                                  }
                                                } else if (e.key === 'Escape') {
                                                  setEditingGateRowNumber(null);
                                                  setEditingColumnId(null);
                                                  setConfirmingGateRowNumber(null);
                                                }
                                              }}
                                              className="w-40 sm:w-52 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (
                                                  (isEditableJobNoteCell ||
                                                    editingGateValue.trim()) &&
                                                  editingGateValue.trim() !== val.trim()
                                                ) {
                                                  setConfirmingGateRowNumber(row.rowNumber);
                                                } else {
                                                  setEditingGateRowNumber(null);
                                                  setEditingColumnId(null);
                                                }
                                              }}
                                              className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                                            >
                                              บันทึก
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingGateRowNumber(null);
                                                setEditingColumnId(null);
                                                setConfirmingGateRowNumber(null);
                                              }}
                                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                            >
                                              ยกเลิก
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-between gap-1.5 group/cell hover:text-slate-900">
                                            <span className="truncate">{renderHighlightedText(val || '-')}</span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingGateRowNumber(row.rowNumber);
                                                setEditingColumnId(col.id);
                                                setEditingGateValue(val);
                                                setConfirmingGateRowNumber(null);
                                              }}
                                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 whitespace-nowrap shrink-0 shadow-2xs"
                                            >
                                              <Pencil className="h-2.5 w-2.5" />
                                              <span>แก้ไข</span>
                                            </button>
                                          </div>
                                        )
                                      ) : activeTab.gid === '944294225' && col.id === 'Q' ? (
                                        (() => {
                                          const repairPhotos = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']
                                            .map((cId) => (row.values[cId] ?? '').trim())
                                            .filter((v) => isPhotoValue(v))
                                            .sort((a, b) => {
                                              const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                                              const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                                              return aDirect - bDirect;
                                            });
                                          if (repairPhotos.length === 0) {
                                            return <span className="text-slate-400">-</span>;
                                          }
                                          return (
                                            <div className="flex items-center gap-1">
                                              {repairPhotos.slice(0, 2).map((pSrc, pIdx) => (
                                                <DrivePhotoImg
                                                  key={pIdx}
                                                  src={pSrc}
                                                  alt={`รูปงานซ่อม ${pIdx + 1}`}
                                                  className="h-9 w-12 rounded border border-slate-200 object-cover shrink-0"
                                                />
                                              ))}
                                              {repairPhotos.length > 2 && (
                                                <span className="inline-flex h-6 items-center rounded-md bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600 border border-slate-200 shrink-0">
                                                  +{repairPhotos.length - 2}
                                                </span>
                                              )}
                                            </div>
                                          );
                                        })()
                                      ) : isPhotoValue(val) ? (
                                        <DrivePhotoImg
                                          src={val}
                                          alt={col.label}
                                          className="h-9 w-12 rounded border border-slate-200 object-cover"
                                        />
                                      ) : activeTab.gid === '606634465' &&
                                        (col.id === 'M' ||
                                          col.label.trim() === 'สถานะ' ||
                                          col.label.trim().toUpperCase() === 'STATUS') ? (
                                        <div className="inline-flex items-center gap-1.5">
                                          {renderJobTransferStatusBadge(
                                            getRowJobTransferStatus(row, sheetData?.columns)
                                          )}
                                          {isRowInTransit && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setBatchFinishConfirmRows([row]);
                                              }}
                                              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 hover:bg-emerald-700 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-2xs transition-colors whitespace-nowrap"
                                              title="กดจบงานรายการนี้"
                                            >
                                              <CheckCircle2 className="h-3 w-3" />
                                              <span>จบงาน</span>
                                            </button>
                                          )}
                                        </div>
                                      ) : activeTab.gid === '378250263' &&
                                        (col.id === 'I' ||
                                          col.label.trim() === 'ชื่อพนักงานประจำรถ') ? (
                                        renderVehicleDriverSelectCell(row, val)
                                      ) : (
                                        renderHighlightedText(val)
                                      )}
                                    </td>
                                  );
                                })}
                                {activeTab.gid === '944294225' && (
                                  <td
                                    className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-center gap-1.5">
                                      {getRowApprovalStatus(row) === 'รอตรวจสอบ' && (
                                        <button
                                          type="button"
                                          onClick={() => setSelectedRow(row)}
                                          title="ผู้ตรวจสอบยืนยันข้อมูลเพื่อส่งต่ออนุมัติ"
                                          className="inline-flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                        >
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                          <span>ผู้ตรวจสอบ</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setSelectedRow(row)}
                                        title="ดูรายละเอียดทั้งหมด"
                                        className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                        <span>รายละเอียด</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setAttachingPhotoRow(row)}
                                        title="แนบรูปเพิ่ม / แก้ไขรูปถ่าย"
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                      >
                                        <Camera className="h-3.5 w-3.5 text-slate-600" />
                                        <span>แนบรูป</span>
                                      </button>
                                    </div>
                                  </td>
                                )}
                                {activeTab.gid === '378250263' && (
                                  <td
                                    className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => setSelectedRow(row)}
                                      title="ดูข้อมูลเพิ่มเติมและแก้ไข"
                                      className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      <span>เพิ่มเติม</span>
                                    </button>
                                  </td>
                                )}
                                {activeTab.gid === '1031154414' && (
                                  <td
                                    className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="inline-flex items-center justify-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const code =
                                            (row.values['A'] ?? '').trim() ||
                                            `ROW-${row.rowNumber}`;
                                          setTireModalInitType('IN');
                                          setTireModalInitCode(code);
                                          setIsTireModalOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 px-2 py-1 text-[11px] font-bold text-white shadow-2xs transition-colors"
                                        title="รับเข้าสต็อก"
                                      >
                                        <Plus className="h-3 w-3" />
                                        <span>รับเข้า</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const code =
                                            (row.values['A'] ?? '').trim() ||
                                            `ROW-${row.rowNumber}`;
                                          setTireModalInitType('OUT');
                                          setTireModalInitCode(code);
                                          setIsTireModalOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md bg-amber-600 hover:bg-amber-700 px-2 py-1 text-[11px] font-bold text-white shadow-2xs transition-colors"
                                        title="เบิกออกตัดสต็อก"
                                      >
                                        <PackageMinus className="h-3 w-3" />
                                        <span>เบิกออก</span>
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                            })}
                            {groupTotalPages > 1 && (
                              <tr className="bg-slate-50/80">
                                <td colSpan={colSpan} className="px-3 py-2 sm:px-4 sm:py-2.5">
                                  <div className="flex items-center justify-between text-xs text-slate-600">
                                    <div>
                                      แสดงรายการที่{' '}
                                      <span className="font-mono font-semibold text-slate-900">
                                        {((currentGroupPage - 1) * groupPageSize + 1).toLocaleString('th-TH')}
                                      </span>
                                      –
                                      <span className="font-mono font-semibold text-slate-900">
                                        {Math.min(currentGroupPage * groupPageSize, rows.length).toLocaleString('th-TH')}
                                      </span>{' '}
                                      จากทั้งหมด{' '}
                                      <span className="font-mono font-semibold text-slate-900">
                                        {rows.length.toLocaleString('th-TH')}
                                      </span>{' '}
                                      รายการในกลุ่มนี้
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={currentGroupPage <= 1}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setGroupPages((prev) => ({
                                            ...prev,
                                            [status]: Math.max(1, currentGroupPage - 1),
                                          }));
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                      >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                        <span>ก่อนหน้า</span>
                                      </button>
                                      <span className="px-1.5 font-mono font-medium text-slate-700">
                                        {currentGroupPage}/{groupTotalPages}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={currentGroupPage >= groupTotalPages}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setGroupPages((prev) => ({
                                            ...prev,
                                            [status]: Math.min(groupTotalPages, currentGroupPage + 1),
                                          }));
                                        }}
                                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                      >
                                        <span>ถัดไป</span>
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  paginatedRows.map((row, rowIdx) => (
                    <tr
                      key={`${row.rowNumber}-${row.values['Q'] || row.values['A'] || rowIdx}`}
                      onClick={() => setSelectedRow(row)}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      {activeTab.gid !== '944294225' && (
                        <td
                          className={`px-2.5 py-2 sm:px-4 sm:py-2.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap ${
                            activeTab.gid === '1733355146' ? 'hidden sm:table-cell' : ''
                          }`}
                        >
                          <span>#{row.rowNumber.toLocaleString('th-TH')}</span>
                        </td>
                      )}
                      {sheetData?.columns.map((col) => {
                        const val = row.values[col.id] ?? '';
                        const isNumeric = col.type === 'number';
                        const isMono =
                          isNumeric ||
                          col.type === 'date' ||
                          col.type === 'datetime' ||
                          col.type === 'timeofday';

                        const isFuelTab = activeTab.gid === '1733355146';
                        const isFuelMainCol =
                          isFuelTab &&
                          (col.id === 'D' ||
                            col.id === 'E' ||
                            col.id === 'F' ||
                            col.id === 'G' ||
                            col.id === 'H' ||
                            col.label.includes('ชนิดน้ำมัน') ||
                            col.label.includes('รับเข้า') ||
                            col.label.includes('ราคา') ||
                            col.label.includes('จ่ายออก') ||
                            col.label.includes('มูลค่า'));
                        const isHiddenOnMobile = isFuelTab && !isFuelMainCol;

                        const isEditableGateCell =
                          activeTab.gid === '1156877149' && col.id === 'C';
                        const isEditableVehicleRegCell = false;
                        const isEditableJobNoteCell =
                          activeTab.gid === '606634465' && col.id === 'N';
                        const isEditableInlineCell =
                          isEditableGateCell ||
                          isEditableVehicleRegCell ||
                          isEditableJobNoteCell;
                        const isEditingThisRow =
                          isEditableInlineCell &&
                          editingGateRowNumber === row.rowNumber &&
                          editingColumnId === col.id;
                        const isConfirmingThisRow =
                          isEditableInlineCell &&
                          confirmingGateRowNumber === row.rowNumber &&
                          editingColumnId === col.id;
                        const isOver20MinDuration =
                          activeTab.gid === '606634465' &&
                          (col.id === 'L' || col.label === 'เวลาที่ใช้') &&
                          isDurationExceeding20Minutes(val);

                        return (
                          <td
                            key={col.id}
                            onClick={
                              isEditableInlineCell
                                ? (e) => {
                                    e.stopPropagation();
                                    if (!isEditingThisRow && !isConfirmingThisRow) {
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingColumnId(col.id);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }
                                  }
                                : undefined
                            }
                            className={`px-2.5 py-2 sm:px-4 sm:py-2.5 ${
                              isHiddenOnMobile ? 'hidden sm:table-cell' : ''
                            } ${
                              isOver20MinDuration
                                ? 'bg-red-50 font-bold text-red-600'
                                : 'text-slate-800'
                            } ${
                              isEditableInlineCell
                                ? 'min-w-[220px] sm:min-w-[280px] cursor-pointer'
                                : 'max-w-[220px] sm:max-w-[260px] truncate'
                            } ${isNumeric ? 'text-right' : 'text-left'} ${
                              isMono ? 'font-mono text-xs tabular-nums' : 'text-xs sm:text-sm'
                            }`}
                            title={
                              isEditableInlineCell
                                ? 'คลิกเพื่อแก้ไขข้อมูลเพิ่มเติม'
                                : val
                            }
                          >
                            {isEditableInlineCell ? (
                              isConfirmingThisRow ? (
                                <div
                                  className="flex flex-wrap items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-xs text-slate-700">
                                    ยืนยัน{' '}
                                    <strong className="font-semibold text-slate-900">
                                      {editingGateValue.trim() || '(ว่าง)'}
                                    </strong>
                                    ?
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isUpdatingGate}
                                    onClick={() => handleConfirmGateUpdate(row)}
                                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>
                                      {isUpdatingGate ? 'กำลังบันทึก...' : 'ยืนยัน'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isUpdatingGate}
                                    onClick={() => {
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    ย้อนกลับ
                                  </button>
                                </div>
                              ) : isEditingThisRow ? (
                                <div
                                  className="flex items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingGateValue}
                                    onChange={(e) => setEditingGateValue(e.target.value)}
                                    placeholder={
                                      isEditableJobNoteCell
                                        ? 'พิมพ์หมายเหตุ...'
                                        : undefined
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (
                                          (isEditableJobNoteCell ||
                                            editingGateValue.trim()) &&
                                          editingGateValue.trim() !== val.trim()
                                        ) {
                                          setConfirmingGateRowNumber(row.rowNumber);
                                        } else {
                                          setEditingGateRowNumber(null);
                                          setEditingColumnId(null);
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingGateRowNumber(null);
                                        setEditingColumnId(null);
                                        setConfirmingGateRowNumber(null);
                                      }
                                    }}
                                    className="w-40 sm:w-52 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (
                                        (isEditableJobNoteCell ||
                                          editingGateValue.trim()) &&
                                        editingGateValue.trim() !== val.trim()
                                      ) {
                                        setConfirmingGateRowNumber(row.rowNumber);
                                      } else {
                                        setEditingGateRowNumber(null);
                                        setEditingColumnId(null);
                                      }
                                    }}
                                    className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                                  >
                                    บันทึก
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingGateRowNumber(null);
                                      setEditingColumnId(null);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-1.5 group/cell hover:text-slate-900">
                                  <span className="truncate">{renderHighlightedText(val || '-')}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingColumnId(col.id);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 whitespace-nowrap shrink-0 shadow-2xs"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                    <span>แก้ไข</span>
                                  </button>
                                </div>
                              )
                            ) : activeTab.gid === '944294225' && col.id === 'Q' ? (
                              (() => {
                                const repairPhotos = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']
                                  .map((cId) => (row.values[cId] ?? '').trim())
                                  .filter((v) => isPhotoValue(v))
                                  .sort((a, b) => {
                                    const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                                    const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                                    return aDirect - bDirect;
                                  });
                                if (repairPhotos.length === 0) {
                                  return <span className="text-slate-400">-</span>;
                                }
                                return (
                                  <div className="flex items-center gap-1">
                                    {repairPhotos.slice(0, 2).map((pSrc, pIdx) => (
                                      <DrivePhotoImg
                                        key={pIdx}
                                        src={pSrc}
                                        alt={`รูปงานซ่อม ${pIdx + 1}`}
                                        className="h-9 w-12 rounded border border-slate-200 object-cover shrink-0"
                                      />
                                    ))}
                                    {repairPhotos.length > 2 && (
                                      <span className="inline-flex h-6 items-center rounded-md bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600 border border-slate-200 shrink-0">
                                        +{repairPhotos.length - 2}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()
                            ) : isPhotoValue(val) ? (
                              <DrivePhotoImg
                                src={val}
                                alt={col.label}
                                className="h-9 w-12 rounded border border-slate-200 object-cover"
                              />
                            ) : activeTab.gid === '606634465' &&
                              (col.id === 'M' ||
                                col.label.trim() === 'สถานะ' ||
                                col.label.trim().toUpperCase() === 'STATUS') ? (
                              renderJobTransferStatusBadge(
                                getRowJobTransferStatus(row, sheetData?.columns)
                              )
                            ) : activeTab.gid === '378250263' &&
                              (col.id === 'I' ||
                                col.label.trim() === 'ชื่อพนักงานประจำรถ') ? (
                              renderVehicleDriverSelectCell(row, val)
                            ) : (
                              renderHighlightedText(val)
                            )}
                          </td>
                        );
                      })}
                      {activeTab.gid === '944294225' && (
                        <td
                          className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            {getRowApprovalStatus(row) === 'รอตรวจสอบ' && (
                              <button
                                type="button"
                                onClick={() => setSelectedRow(row)}
                                title="ผู้ตรวจสอบยืนยันข้อมูลเพื่อส่งต่ออนุมัติ"
                                className="inline-flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>ผู้ตรวจสอบ</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedRow(row)}
                              title="ดูรายละเอียดทั้งหมด"
                              className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>รายละเอียด</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttachingPhotoRow(row)}
                              title="แนบรูปเพิ่ม / แก้ไขรูปถ่าย"
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <Camera className="h-3.5 w-3.5 text-slate-600" />
                              <span>แนบรูป</span>
                            </button>
                          </div>
                        </td>
                      )}
                      {activeTab.gid === '378250263' && (
                        <td
                          className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedRow(row)}
                            title="ดูข้อมูลเพิ่มเติมและแก้ไข"
                            className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>เพิ่มเติม</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Compact Pagination Footer */}
          {sheetData && sortedRows.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/50 px-3 py-2 sm:px-5 sm:py-2.5">
              <div className="text-[11px] sm:text-xs text-slate-600">
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {((currentPage - 1) * effectivePageSize + 1).toLocaleString('th-TH')}
                </span>
                –
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {Math.min(currentPage * effectivePageSize, sortedRows.length).toLocaleString(
                    'th-TH'
                  )}
                </span>{' '}
                / {' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {sortedRows.length.toLocaleString('th-TH')}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">ก่อนหน้า</span>
                </button>

                <span className="px-1.5 font-mono text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">
                  {currentPage.toLocaleString('th-TH')}/{totalPages.toLocaleString('th-TH')}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <span className="hidden sm:inline">ถัดไป</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
          </div>
          )}
          </div>
          </div>
        </main>

        {/* Android-Style Mobile Bottom Navigation Bar */}
        <nav
          aria-label="แถบเมนูด้านล่างสำหรับมือถือ"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-md shadow-[0_-4px_16px_rgba(15,23,42,0.08)] pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <div className="mx-auto grid h-16 max-w-lg grid-cols-6 items-center px-1">
            {/* 1. หน้าหลัก / แดชบอร์ด */}
            {(() => {
              const isHomeActive =
                !isApprovalModalOpen &&
                !showMaintenanceCalendar &&
                activeTab.gid !== '944294225' &&
                activeTab.gid !== '606634465' &&
                activeTab.gid !== '1733355146';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const dashboardTab =
                      SHEET_TABS.find((t) => t.gid === '378250263') ?? SHEET_TABS[0];
                    if (activeTab.gid === dashboardTab.gid && !showMaintenanceCalendar && !showEmployeeManagement) {
                      setIsSidebarOpen((prev) => !prev);
                    } else {
                      handleSelectTab(dashboardTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isHomeActive
                      ? 'text-blue-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`flex h-7 w-10 items-center justify-center rounded-full transition-all ${
                      isHomeActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <Home className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isHomeActive ? 'font-bold text-blue-700' : 'font-medium'
                    }`}
                  >
                    หน้าหลัก
                  </span>
                </button>
              );
            })()}

            {/* 2. บันทึกงานซ่อม */}
            {(() => {
              const isRepairActive =
                !isApprovalModalOpen && !showMaintenanceCalendar && activeTab.gid === '944294225';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const repairTab = SHEET_TABS.find((t) => t.gid === '944294225');
                    if (repairTab) {
                      handleSelectTab(repairTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group relative flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isRepairActive
                      ? 'text-amber-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`relative flex h-7 w-10 items-center justify-center rounded-full transition-all ${
                      isRepairActive
                        ? 'bg-amber-100 text-amber-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <Wrench className="h-4 w-4" />
                    {pendingApprovalCount > 0 && (
                      <span className="absolute -top-1 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 py-0.2 font-mono text-[9px] font-bold leading-tight text-white shadow-xs">
                        {pendingApprovalCount > 99
                          ? '99+'
                          : pendingApprovalCount.toLocaleString('th-TH')}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isRepairActive ? 'font-bold text-amber-700' : 'font-medium'
                    }`}
                  >
                    งานซ่อม
                  </span>
                </button>
              );
            })()}

            {/* 3. ปฏิทิน PM & งานซ่อม */}
            <button
              type="button"
              onClick={() => {
                setIsSidebarOpen(false);
                setShowJobTransferStats(false);
                setShowEmployeeManagement(false);
                setShowMaintenanceCalendar(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                showMaintenanceCalendar
                  ? 'text-indigo-700'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <div
                className={`flex h-7 w-10 items-center justify-center rounded-full transition-all ${
                  showMaintenanceCalendar
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'group-hover:bg-slate-100'
                }`}
              >
                <Calendar className="h-4 w-4" />
              </div>
              <span
                className={`text-[10px] leading-tight tracking-tight ${
                  showMaintenanceCalendar ? 'font-bold text-indigo-700' : 'font-medium'
                }`}
              >
                ปฏิทิน PM
              </span>
            </button>

            {/* 4. บันทึกการย้ายงาน */}
            {(() => {
              const isTransferActive =
                !isApprovalModalOpen && !showMaintenanceCalendar && activeTab.gid === '606634465';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const transferTab = SHEET_TABS.find((t) => t.gid === '606634465');
                    if (transferTab) {
                      handleSelectTab(transferTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isTransferActive
                      ? 'text-indigo-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`flex h-7 w-10 items-center justify-center rounded-full transition-all ${
                      isTransferActive
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isTransferActive ? 'font-bold text-indigo-700' : 'font-medium'
                    }`}
                  >
                    ย้ายงาน
                  </span>
                </button>
              );
            })()}

            {/* 5. บันทึกน้ำมัน */}
            {(() => {
              const isFuelActive =
                !isApprovalModalOpen && !showMaintenanceCalendar && activeTab.gid === '1733355146';
              return (
                <button
                  type="button"
                  onClick={() => {
                    const fuelTab = SHEET_TABS.find((t) => t.gid === '1733355146');
                    if (fuelTab) {
                      handleSelectTab(fuelTab);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`group flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                    isFuelActive
                      ? 'text-sky-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`flex h-7 w-10 items-center justify-center rounded-full transition-all ${
                      isFuelActive
                        ? 'bg-sky-100 text-sky-700'
                        : 'group-hover:bg-slate-100'
                    }`}
                  >
                    <Fuel className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] leading-tight tracking-tight ${
                      isFuelActive ? 'font-bold text-sky-700' : 'font-medium'
                    }`}
                  >
                    น้ำมัน
                  </span>
                </button>
              );
            })()}

            {/* 6. เมนูจัดการอนุมัติ (ผู้จัดการ) */}
            <button
              type="button"
              onClick={() => {
                setIsSidebarOpen(false);
                setIsApprovalModalOpen(true);
              }}
              className={`group relative flex flex-col items-center justify-center gap-0.5 py-1 transition-colors ${
                isApprovalModalOpen
                  ? 'text-emerald-700'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <div
                className={`relative flex h-7 w-10 items-center justify-center rounded-full transition-all ${
                  isApprovalModalOpen
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'group-hover:bg-slate-100'
                }`}
              >
                <CheckCircle className="h-4 w-4" />
                {pendingApprovalCount > 0 && (
                  <span className="absolute -top-1 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 py-0.2 font-mono text-[9px] font-bold leading-tight text-white animate-pulse shadow-xs">
                    {pendingApprovalCount > 99
                      ? '99+'
                      : pendingApprovalCount.toLocaleString('th-TH')}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] leading-tight tracking-tight ${
                  isApprovalModalOpen ? 'font-bold text-emerald-700' : 'font-medium'
                }`}
              >
                อนุมัติซ่อม
              </span>
            </button>
          </div>
        </nav>
      </div>

      {/* Record Detail Modal */}
      <RecordDetailModal
        row={selectedRow}
        columns={sheetData?.allColumns ?? sheetData?.columns ?? []}
        tabName={activeTab.name}
        onClose={() => setSelectedRow(null)}
        onOpenAttachPhotos={(row) => setAttachingPhotoRow(row)}
        onUpdateAdditionalDetails={async (row, newDetails) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          await updateRepairAdditionalDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            additionalDetails: newDetails,
          });
          row.values['AK'] = newDetails;
          setSaveSuccessMsg(
            newDetails
              ? `บันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`
              : `ล้างรายละเอียดเพิ่มเติมเรียบร้อยแล้ว`
          );
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
        onUpdateReplyDetails={async (row, newReply) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          await updateRepairReplyDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            replyDetails: newReply,
          });
          row.values['AM'] = newReply;
          setSaveSuccessMsg(
            newReply
              ? `บันทึกตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`
              : `ล้างตอบกลับข้อมูลเพิ่มเติมเรียบร้อยแล้ว`
          );
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
        onUpdateFinancialDetails={async (row, spareParts, labor) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          await updateRepairFinancialDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            sparePartsCost: spareParts,
            laborCost: labor,
          });
          row.values['N'] = spareParts;
          row.values['O'] = labor;
          setSaveSuccessMsg('อัปเดตค่าอะไหล่และค่าแรงเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
        driverOptions={vehicleDriverOptions}
        employeeAccounts={employeeAccounts}
        onAssignVehicleDriver={handleAssignVehicleDriver}
        onUpdateVehicleField={async (row, colId, newValue) => {
          if (colId === 'I' || colId === 'ชื่อพนักงานประจำรถ') {
            await handleAssignVehicleDriver(row, newValue);
            return row.values['I'] ?? newValue;
          }
          const oldReg = (row.values['A'] ?? '').trim();
          const drvName = (row.values['I'] ?? '').trim();
          const shf = (row.values['L'] ?? '').trim();
          const saved = await updateVehicleField({
            rowNumber: row.rowNumber,
            colId,
            newValue,
            oldRegistration: oldReg,
            driverName: drvName,
            shift: shf,
          });
          row.values[colId] = saved;
          row.rawValues[colId] = saved;
          setSaveSuccessMsg('อัปเดตข้อมูลฐานข้อมูลรถเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => setSaveSuccessMsg(null), 5000);
          return saved;
        }}
        onInspectRepair={async (row, inspectorName) => {
          const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
          const repairRequestNo = (row.values['G'] ?? '').trim();
          const now = new Date();
          const dd = String(now.getDate()).padStart(2, '0');
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const yyyy = String(now.getFullYear());
          const inspectionDate = `${dd}/${mm}/${yyyy}`;
          const hh = String(now.getHours()).padStart(2, '0');
          const min = String(now.getMinutes()).padStart(2, '0');
          const ss = String(now.getSeconds()).padStart(2, '0');
          const inspectionTime = `${hh}:${min}:${ss}`;

          await inspectRepairRecord({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            inspectorName,
            inspectionDate,
            inspectionTime,
          });

          row.values['AB'] = inspectorName;
          row.values['AC'] = inspectionDate;
          row.values['AD'] = inspectionTime;
          row.values['P'] = 'ตรวจสอบแล้ว';
          row.values['AI'] = '2.⚠️รออนุมัติ';
          setSaveSuccessMsg('ผู้ตรวจสอบยืนยันข้อมูลแล้ว ส่งต่อไปยังสถานะ รออนุมัติ เรียบร้อย');
          loadData({ silent: true });
          setTimeout(() => loadData({ silent: true }), 6000);
          setTimeout(() => setSaveSuccessMsg(null), 5000);
        }}
      />

      {/* Attach / Edit Repair Photos Modal */}
      <AttachRepairPhotosModal
        isOpen={attachingPhotoRow !== null}
        row={attachingPhotoRow}
        onClose={() => setAttachingPhotoRow(null)}
        onPhotosUpdated={(updatedPhotos) => {
          setSaveSuccessMsg('อัปเดตรูปถ่ายเพิ่มเติมในแถวเดิมเรียบร้อยแล้ว');
          if (
            selectedRow &&
            attachingPhotoRow &&
            selectedRow.rowNumber === attachingPhotoRow.rowNumber
          ) {
            const updatedValues = { ...selectedRow.values };
            const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
            photoCols.forEach((col, idx) => {
              updatedValues[col] = (updatedPhotos[idx] ?? '').trim();
            });
            setSelectedRow({
              ...selectedRow,
              values: updatedValues,
            });
          }
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Job Transfer Creation Modal */}
      <JobTransferModal
        isOpen={isJobModalOpen}
        onClose={() => setIsJobModalOpen(false)}
        existingRows={activeTab.gid === '606634465' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลการย้ายงานลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Batch Finish Job Transfer Confirmation Modal (from Table) */}
      {batchFinishConfirmRows && batchFinishConfirmRows.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          onClick={() => {
            if (!isBatchFinishingTable) setBatchFinishConfirmRows(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    ยืนยันการจบงาน ({batchFinishConfirmRows.length} รายการ)
                  </h3>
                  <p className="text-xs text-slate-500">
                    ระบบจะบันทึกเวลาส่งเสร็จ เวลาที่ใช้ และเปลี่ยนสถานะเป็น &ldquo;ส่งสินค้าเรียบร้อย&rdquo;
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBatchFinishingTable}
                onClick={() => setBatchFinishConfirmRows(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="my-4 max-h-64 space-y-2 overflow-y-auto pr-1">
              {batchFinishConfirmRows.map((r, idx) => {
                const startT = (r.values['I'] ?? '').trim();
                const previewFinishT = getCurrentTimeString();
                const previewDuration = startT
                  ? calculateDurationString(startT, previewFinishT)
                  : '-';
                return (
                  <div
                    key={getJobTransferRowKey(r)}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between font-bold text-slate-900">
                      <span>
                        รายการที่ {idx + 1}: #{r.rowNumber.toLocaleString('th-TH')} •{' '}
                        {r.values['H'] || '-'} → {r.values['J'] || '-'}
                      </span>
                      <span className="font-mono text-[11px] text-emerald-700">
                        ใช้เวลา ~{previewDuration}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                      <span>พนักงาน: {r.values['C'] || '-'}</span>
                      <span>เบอร์รถ: {r.values['D'] || '-'}</span>
                      <span>ชนิดสินค้า: {r.values['F'] || '-'}</span>
                      <span>เริ่ม: {startT || '-'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isBatchFinishingTable}
                onClick={() => setBatchFinishConfirmRows(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isBatchFinishingTable}
                onClick={async () => {
                  setIsBatchFinishingTable(true);
                  const finishTime = getCurrentTimeString();
                  try {
                    const completedMatches: Array<{
                      recordId?: string;
                      date?: string;
                      driverName?: string;
                      vehicleNumber?: string;
                      startTime?: string;
                      origin?: string;
                      destination?: string;
                      productType?: string;
                    }> = [];

                    for (const r of batchFinishConfirmRows) {
                      const startT = (r.values['I'] ?? '').trim();
                      const duration = startT
                        ? calculateDurationString(startT, finishTime)
                        : '00:00:00';
                      const recordId =
                        (r.values['Q'] ?? '').trim() || `ROW-${r.rowNumber}`;
                      const date = (r.values['A'] ?? '').trim();
                      const driverName = (r.values['C'] ?? '').trim();
                      const vehicleNumber = (r.values['D'] ?? '').trim();
                      const productType = (r.values['F'] ?? '').trim();
                      const origin = (r.values['H'] ?? '').trim();
                      const destination = (r.values['J'] ?? '').trim();

                      await completeJobTransferRecord({
                        recordId,
                        rowNumber: r.rowNumber,
                        endTime: finishTime,
                        duration,
                        status: 'ส่งสินค้าเรียบร้อยแล้ว',
                        date,
                        driverName,
                        vehicleNumber,
                        startTime: startT,
                        origin,
                        destination,
                        productType,
                      });

                      r.values['K'] = finishTime;
                      r.values['L'] = duration;
                      r.values['M'] = 'ส่งสินค้าเรียบร้อยแล้ว';

                      completedMatches.push({
                        recordId: (r.values['Q'] ?? '').trim() || undefined,
                        date,
                        driverName,
                        vehicleNumber,
                        startTime: startT,
                        origin,
                        destination,
                        productType,
                      });
                    }

                    removeStoredActiveJobsByMatches(completedMatches);

                    setSelectedInTransitKeys((prev) => {
                      const next = new Set(prev);
                      batchFinishConfirmRows.forEach((r) =>
                        next.delete(getJobTransferRowKey(r))
                      );
                      return next;
                    });

                    const finishedCount = batchFinishConfirmRows.length;
                    setBatchFinishConfirmRows(null);
                    setSaveSuccessMsg(
                      `บันทึกจบงานส่งสินค้าเรียบร้อยแล้ว (${finishedCount} รายการ)`
                    );
                    showSuccessToast(
                      `บันทึกจบงานส่งสินค้าเรียบร้อย (${finishedCount} รายการ)`
                    );
                    loadData({ silent: true });
                    setTimeout(() => {
                      setSaveSuccessMsg(null);
                    }, 5000);
                  } catch (err) {
                    console.error('Batch finish error:', err);
                  } finally {
                    setIsBatchFinishingTable(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  {isBatchFinishingTable
                    ? 'กำลังบันทึก...'
                    : `ยืนยันจบงาน (${batchFinishConfirmRows.length} รายการ)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Point Creation Modal */}
      <DeliveryPointModal
        isOpen={isDeliveryPointModalOpen}
        onClose={() => setIsDeliveryPointModalOpen(false)}
        existingRows={activeTab.gid === '1156877149' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('เพิ่มข้อมูลจุดส่งสินค้าลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Fuel Receive/Issue Modal */}
      <FuelRecordModal
        isOpen={isFuelModalOpen}
        onClose={() => setIsFuelModalOpen(false)}
        existingRows={activeTab.gid === '1733355146' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลน้ำมัน (รับเข้า-เบิกออก) ลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Tire Stock Receive/Issue Modal */}
      <TireStockModal
        isOpen={isTireModalOpen}
        onClose={() => setIsTireModalOpen(false)}
        existingRows={activeTab.gid === '1031154414' ? sheetData?.rows ?? [] : []}
        initialTransactionType={tireModalInitType}
        initialTireCode={tireModalInitCode}
        onSavedSuccess={(msg) => {
          setSaveSuccessMsg(msg);
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* No-Login Google Sheets Webhook Setup Modal */}
      <SheetWebhookModal
        isOpen={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        onSaved={() => {
          setSaveSuccessMsg('บันทึกการเชื่อมต่อ Google Sheets (ไม่ต้องล็อกอิน) เรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Repair Request Modal */}
      <RepairRequestModal
        isOpen={isRepairModalOpen}
        onClose={() => setIsRepairModalOpen(false)}
        existingRows={activeTab.gid === '944294225' ? (sheetData?.rows ?? repairTabRows) : repairTabRows}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลแจ้งซ่อมเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => loadData({ silent: true }), 6000);
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Manager Approval Modal */}
      <ManagerApprovalModal
        isOpen={isApprovalModalOpen}
        onClose={() => setIsApprovalModalOpen(false)}
        rows={activeTab.gid === '944294225' ? (sheetData?.rows ?? repairTabRows) : repairTabRows}
        onApprovedSuccess={() => {
          setSaveSuccessMsg('บันทึกผลการพิจารณาอนุมัติงานซ่อมเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => loadData({ silent: true }), 6000);
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />
    </div>
  );
}
