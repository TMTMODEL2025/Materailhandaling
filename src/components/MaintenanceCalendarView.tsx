import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  RefreshCw,
  Eye,
  CheckCircle,
  Truck,
  ShieldAlert,
  Filter,
  X,
} from 'lucide-react';
import { SheetRow, SheetColumn } from '../types';
import { fetchSheetTabData, SHEET_TABS } from '../services/googleSheets';
import {
  THAI_MONTHS_FULL as THAI_MONTHS,
  THAI_MONTHS_SHORT,
  parseNumericCell as parseNumeric,
  parseThaiDateToGregorianYmd,
  getRowApprovalStatus as getRowApprovalStatusLabel,
  evaluateVehiclePmList,
  VehiclePmStatusItem,
} from '../utils/sheetMetrics';

interface MaintenanceCalendarViewProps {
  repairRows: SheetRow[];
  repairColumns?: SheetColumn[];
  pmRows?: SheetRow[];
  onSelectRepairRow: (row: SheetRow) => void;
  onOpenApprovalModal: () => void;
  onOpenRepairModal?: () => void;
  onSwitchToPmTab?: () => void;
  onRefreshData?: () => void;
  isRefreshing?: boolean;
}

interface CalendarEventItem {
  id: string;
  ymd: string; // YYYY-MM-DD (Gregorian)
  dateDisplay: string;
  timeDisplay: string;
  vehicleNo: string;
  category: 'UNAPPROVED_REPAIR' | 'PM_SCHEDULE';
  repairType: string;
  symptom: string;
  approvalStatus: string;
  repairStatus: string;
  partsCost: number;
  laborCost: number;
  totalCost: number;
  reporter: string;
  inspector: string;
  pmHoursLabel?: string;
  prevMileage?: string;
  currMileage?: string;
  sourceRow: SheetRow;
}

const WEEKDAY_HEADERS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function formatYmdThaiShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`;
}

export const MaintenanceCalendarView: React.FC<MaintenanceCalendarViewProps> = ({
  repairRows,
  pmRows,
  onSelectRepairRow,
  onOpenApprovalModal,
  onOpenRepairModal,
  onRefreshData,
  isRefreshing,
}) => {
  const today = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => {
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [today]);

  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth() + 1); // 1..12
  const [selectedDateYmd, setSelectedDateYmd] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'UNAPPROVED' | 'PM'>('ALL');
  const [pmStatusFilter, setPmStatusFilter] = useState<'ALL' | 'DUE_ONLY'>('DUE_ONLY');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Load กำหนดรอบPM (gid: 1032541508)
  const [pmSheetRows, setPmSheetRows] = useState<SheetRow[]>(() => pmRows ?? []);
  const [isLoadingPmSheet, setIsLoadingPmSheet] = useState<boolean>(false);

  const loadPmSheet = () => {
    const pmTab = SHEET_TABS.find((t) => t.gid === '1032541508');
    if (!pmTab) return;
    setIsLoadingPmSheet(true);
    void fetchSheetTabData(pmTab, { limit: 300 })
      .then((res) => {
        setPmSheetRows(res.rows);
      })
      .catch(() => {})
      .finally(() => {
        setIsLoadingPmSheet(false);
      });
  };

  useEffect(() => {
    if (pmRows && pmRows.length > 0) {
      setPmSheetRows(pmRows);
      return;
    }
    let cancelled = false;
    const pmTab = SHEET_TABS.find((t) => t.gid === '1032541508');
    if (!pmTab) return;
    setIsLoadingPmSheet(true);
    void fetchSheetTabData(pmTab, { limit: 300 })
      .then((res) => {
        if (!cancelled) {
          setPmSheetRows(res.rows);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPmSheet(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pmRows]);

  // Parse PM Sheet rows and cross-reference with latest PM repair record per vehicle using centralized memoized helper
  const vehiclePmList = useMemo<VehiclePmStatusItem[]>(
    () => evaluateVehiclePmList(pmSheetRows, repairRows),
    [pmSheetRows, repairRows]
  );

  // Build Calendar Events from:
  // 1) Unapproved Repair Jobs in `บันทึกงานซ่อม`
  // 2) PM Repair / Scheduled PM Jobs in `บันทึกงานซ่อม`
  // 3) Vehicles in `กำหนดรอบPM` that have a date in Col B (or active due PM mapped to their latest PM date / today)
  const allEvents = useMemo<CalendarEventItem[]>(() => {
    const events: CalendarEventItem[] = [];
    const q = searchQuery.trim().toLowerCase();

    repairRows.forEach((r) => {
      const rawDate = (r.values['B'] ?? '').trim();
      const parsedDate = parseThaiDateToGregorianYmd(rawDate);
      if (!parsedDate) return;

      const vehicleNo = (r.values['D'] ?? '').trim() || '-';
      const repairType = (r.values['E'] ?? '').trim() || 'ไม่ระบุประเภท';
      const symptom = (r.values['F'] ?? '').trim() || '-';
      const approvalStatus = getRowApprovalStatusLabel(r);
      const repairStatus = (r.values['P'] ?? '').trim() || 'รอตรวจสอบ';
      const partsCost = parseNumeric(r.rawValues['N'] ?? r.values['N']);
      const laborCost = parseNumeric(r.rawValues['O'] ?? r.values['O']);
      const totalCost = partsCost + laborCost;
      const reporter = (r.values['AA'] ?? '').trim();
      const inspector = (r.values['AB'] ?? '').trim();
      const timeDisplay = (r.values['C'] ?? '').trim();

      const isUnapproved = approvalStatus !== 'อนุมัติ' && approvalStatus !== 'รอคิวซ่อม';
      const isPmRepair =
        repairType.includes('PM') ||
        repairType.includes('ซ่อมเชิงป้องกัน') ||
        symptom.toUpperCase().includes('PM ');

      if (!isUnapproved && !isPmRepair) return;

      // Extract PM hours if present in symptom
      let pmHoursLabel: string | undefined;
      if (isPmRepair) {
        const pmMatch = symptom.match(/(?:PM|ที่)\s*(\d{2,5})\s*(?:ชม\.|Hrs\.|ชั่วโมง)?/i);
        if (pmMatch) {
          pmHoursLabel = `PM ${pmMatch[1]} ชม.`;
        } else {
          pmHoursLabel = 'รอบ PM';
        }
      }

      if (q) {
        const matchText = `${vehicleNo} ${repairType} ${symptom} ${approvalStatus} ${repairStatus}`.toLowerCase();
        if (!matchText.includes(q)) return;
      }

      // If it's unapproved, add as UNAPPROVED_REPAIR (or if filter is PM and it's also PM, we can show both or tag appropriately)
      if (isUnapproved && (filterMode === 'ALL' || filterMode === 'UNAPPROVED')) {
        events.push({
          id: `unapproved-${r.rowNumber}`,
          ymd: parsedDate.ymd,
          dateDisplay: rawDate,
          timeDisplay,
          vehicleNo,
          category: 'UNAPPROVED_REPAIR',
          repairType,
          symptom,
          approvalStatus,
          repairStatus,
          partsCost,
          laborCost,
          totalCost,
          reporter,
          inspector,
          pmHoursLabel,
          sourceRow: r,
        });
      }

      if (isPmRepair && (filterMode === 'ALL' || filterMode === 'PM')) {
        // Avoid duplicate card on same day if already pushed above when filterMode === 'ALL', unless we mark it as PM_SCHEDULE
        if (!isUnapproved || filterMode === 'PM') {
          events.push({
            id: `pm-repair-${r.rowNumber}`,
            ymd: parsedDate.ymd,
            dateDisplay: rawDate,
            timeDisplay,
            vehicleNo,
            category: 'PM_SCHEDULE',
            repairType,
            symptom,
            approvalStatus,
            repairStatus,
            partsCost,
            laborCost,
            totalCost,
            reporter,
            inspector,
            pmHoursLabel,
            sourceRow: r,
          });
        }
      }
    });

    // Also check if any rows in กำหนดรอบPM have an explicit date in Col B, or if a due PM vehicle has no repair record yet today
    if (filterMode === 'ALL' || filterMode === 'PM') {
      vehiclePmList.forEach((pmItem) => {
        if (!pmItem.isDue && !pmItem.dateStr) return;
        if (q) {
          const matchText = `${pmItem.vehicleNo} ${pmItem.statusText} ${pmItem.pmCycle}`.toLowerCase();
          if (!matchText.includes(q)) return;
        }
        const parsedDate = pmItem.dateStr
          ? parseThaiDateToGregorianYmd(pmItem.dateStr)
          : null;
        const targetYmd = parsedDate?.ymd ?? todayYmd;

        // Check if this vehicle already has a PM event on targetYmd
        const alreadyOnDate = events.some(
          (e) =>
            e.ymd === targetYmd &&
            e.vehicleNo.toUpperCase() === pmItem.vehicleNo.toUpperCase() &&
            e.category === 'PM_SCHEDULE'
        );
        if (!alreadyOnDate && pmItem.isDue) {
          events.push({
            id: `pm-due-${pmItem.vehicleNo}`,
            ymd: targetYmd,
            dateDisplay: pmItem.dateStr || formatYmdThaiShort(targetYmd),
            timeDisplay: '',
            vehicleNo: pmItem.vehicleNo,
            category: 'PM_SCHEDULE',
            repairType: 'ครบกำหนดรอบ PM',
            symptom: `ไมล์ก่อนหน้า ${pmItem.prevMileage.toLocaleString('th-TH')} → ปัจจุบัน ${pmItem.currMileage.toLocaleString('th-TH')} (+${pmItem.diffMileage.toLocaleString('th-TH', { maximumFractionDigits: 1 })})`,
            approvalStatus: pmItem.statusText,
            repairStatus: pmItem.latestPmRepairStatus
              ? `แจ้งซ่อมล่าสุด: ${pmItem.latestPmRepairDate} (${pmItem.latestPmRepairStatus})`
              : 'ถึงกำหนดตรวจเช็ครอบ PM',
            partsCost: 0,
            laborCost: 0,
            totalCost: 0,
            reporter: '',
            inspector: '',
            pmHoursLabel: pmItem.pmCycle || 'ครบรอบ PM',
            prevMileage: pmItem.prevMileage.toLocaleString('th-TH'),
            currMileage: pmItem.currMileage.toLocaleString('th-TH'),
            sourceRow: pmItem.latestPmRepairRow ?? pmItem.row,
          });
        }
      });
    }

    return events.sort((a, b) => {
      if (a.ymd !== b.ymd) return b.ymd.localeCompare(a.ymd);
      if (a.category !== b.category) {
        return a.category === 'UNAPPROVED_REPAIR' ? -1 : 1;
      }
      return a.vehicleNo.localeCompare(b.vehicleNo, 'th');
    });
  }, [repairRows, vehiclePmList, filterMode, searchQuery, todayYmd]);

  // Group events by YYYY-MM-DD
  const eventsByDateMap = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    allEvents.forEach((ev) => {
      const list = map.get(ev.ymd) ?? [];
      list.push(ev);
      map.set(ev.ymd, list);
    });
    return map;
  }, [allEvents]);

  // Summary metrics
  const metrics = useMemo(() => {
    let unapprovedTotal = 0;
    let pendingManagerCount = 0;
    let waitingInspectCount = 0;

    repairRows.forEach((r) => {
      const st = getRowApprovalStatusLabel(r);
      if (st !== 'อนุมัติ' && st !== 'รอคิวซ่อม') {
        unapprovedTotal += 1;
        if (
          st === 'รออนุมัติ' ||
          st === 'ขอข้อมูลเพิ่มเติม' ||
          st === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว'
        ) {
          pendingManagerCount += 1;
        } else if (st === 'รอตรวจสอบ') {
          waitingInspectCount += 1;
        }
      }
    });

    const duePmCount = vehiclePmList.filter((v) => v.isDue).length;
    const totalPmVehicles = vehiclePmList.length;

    const currentMonthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    const currentMonthEvents = allEvents.filter((e) =>
      e.ymd.startsWith(currentMonthPrefix)
    );
    const currentMonthPmCount = currentMonthEvents.filter(
      (e) => e.category === 'PM_SCHEDULE'
    ).length;
    const currentMonthUnapprovedCount = currentMonthEvents.filter(
      (e) => e.category === 'UNAPPROVED_REPAIR'
    ).length;

    return {
      unapprovedTotal,
      pendingManagerCount,
      waitingInspectCount,
      duePmCount,
      totalPmVehicles,
      currentMonthPmCount,
      currentMonthUnapprovedCount,
    };
  }, [repairRows, vehiclePmList, allEvents, currentYear, currentMonth]);

  // Build Calendar Grid Cells for currentYear & currentMonth
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1);
    const startWeekday = firstDayOfMonth.getDay(); // 0 (Sun) .. 6 (Sat)
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const cells: Array<{
      ymd: string | null;
      dayNumber: number | null;
      isToday: boolean;
      events: CalendarEventItem[];
      unapprovedCount: number;
      pmCount: number;
    }> = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push({
        ymd: null,
        dayNumber: null,
        isToday: false,
        events: [],
        unapprovedCount: 0,
        pmCount: 0,
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayEvents = eventsByDateMap.get(ymd) ?? [];
      const unapprovedCount = dayEvents.filter(
        (e) => e.category === 'UNAPPROVED_REPAIR'
      ).length;
      const pmCount = dayEvents.filter((e) => e.category === 'PM_SCHEDULE').length;

      cells.push({
        ymd,
        dayNumber: d,
        isToday: ymd === todayYmd,
        events: dayEvents,
        unapprovedCount,
        pmCount,
      });
    }

    return cells;
  }, [currentYear, currentMonth, eventsByDateMap, todayYmd]);

  // Events displayed in the list below the calendar
  const displayedEvents = useMemo(() => {
    if (selectedDateYmd) {
      return eventsByDateMap.get(selectedDateYmd) ?? [];
    }
    const monthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    return allEvents.filter((e) => e.ymd.startsWith(monthPrefix));
  }, [selectedDateYmd, eventsByDateMap, allEvents, currentYear, currentMonth]);

  const handlePrevMonth = () => {
    setSelectedDateYmd(null);
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedDateYmd(null);
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleGoToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth() + 1);
    setSelectedDateYmd(todayYmd);
  };

  const filteredVehiclePmList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vehiclePmList.filter((item) => {
      if (pmStatusFilter === 'DUE_ONLY' && !item.isDue) return false;
      if (q) {
        return (
          item.vehicleNo.toLowerCase().includes(q) ||
          item.statusText.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [vehiclePmList, pmStatusFilter, searchQuery]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 1. Top KPI Summary Cards (Single-Line Compact on Mobile) */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {/* Card 1: รถถึงกำหนดรอบ PM */}
        <button
          type="button"
          onClick={() =>
            setFilterMode((prev) => (prev === 'PM' ? 'ALL' : 'PM'))
          }
          className={`text-left rounded-xl border px-3 py-2.5 sm:p-3.5 transition-all shadow-2xs ${
            filterMode === 'PM'
              ? 'border-blue-600 bg-blue-50/90 ring-2 ring-blue-500/20'
              : 'border-blue-200/80 bg-gradient-to-br from-blue-50/70 to-white hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-blue-900 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <ShieldAlert className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <span className="truncate">รถครบรอบ PM</span>
            </span>
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 shrink-0">
              จาก {metrics.totalPmVehicles} คัน
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 whitespace-nowrap">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-lg sm:text-2xl font-extrabold text-blue-700 tabular-nums">
                {metrics.duePmCount}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold text-blue-700">
                คัน
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] font-medium text-slate-500">
              เดือนนี้ {metrics.currentMonthPmCount} รายการ
            </span>
          </div>
        </button>

        {/* Card 2: งานซ่อมที่ยังไม่อนุมัติ */}
        <button
          type="button"
          onClick={() =>
            setFilterMode((prev) => (prev === 'UNAPPROVED' ? 'ALL' : 'UNAPPROVED'))
          }
          className={`text-left rounded-xl border px-3 py-2.5 sm:p-3.5 transition-all shadow-2xs ${
            filterMode === 'UNAPPROVED'
              ? 'border-amber-600 bg-amber-50/90 ring-2 ring-amber-500/20'
              : 'border-amber-200/80 bg-gradient-to-br from-amber-50/70 to-white hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-amber-900 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <span className="truncate">งานซ่อมยังไม่อนุมัติ</span>
            </span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 shrink-0">
              เดือนนี้ {metrics.currentMonthUnapprovedCount}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 whitespace-nowrap">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-lg sm:text-2xl font-extrabold text-amber-700 tabular-nums">
                {metrics.unapprovedTotal}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold text-amber-700">
                รายการ
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] font-medium text-slate-600">
              รออนุมัติ {metrics.pendingManagerCount} · รอตรวจ {metrics.waitingInspectCount}
            </span>
          </div>
        </button>

        {/* Card 3: รอผู้จัดการอนุมัติ (กดเพื่อเปิดหน้าอนุมัติทันที) */}
        <button
          type="button"
          onClick={onOpenApprovalModal}
          className="text-left rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/70 to-white px-3 py-2.5 sm:p-3.5 shadow-2xs hover:border-emerald-400 transition-all"
        >
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-emerald-900 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">รออนุมัติ (ผู้จัดการ)</span>
            </span>
            <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0">
              กดอนุมัติ
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 whitespace-nowrap">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-lg sm:text-2xl font-extrabold text-emerald-700 tabular-nums">
                {metrics.pendingManagerCount}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold text-emerald-700">
                รายการ
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] font-medium text-emerald-700">
              เปิดเมนูอนุมัติ →
            </span>
          </div>
        </button>

        {/* Card 4: รอผู้ตรวจสอบ */}
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 sm:p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-slate-700 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <Wrench className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              <span className="truncate">รอผู้ตรวจสอบ</span>
            </span>
            {onOpenRepairModal && (
              <button
                type="button"
                onClick={onOpenRepairModal}
                className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-800 shrink-0"
              >
                + แจ้งซ่อม
              </button>
            )}
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 whitespace-nowrap">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-lg sm:text-2xl font-extrabold text-slate-800 tabular-nums">
                {metrics.waitingInspectCount}
              </span>
              <span className="text-[11px] sm:text-xs font-semibold text-slate-600">
                รายการ
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] font-medium text-slate-500">
              ตรวจสอบก่อนส่งอนุมัติ
            </span>
          </div>
        </div>
      </div>

      {/* 2. Month Navigation & Filter Toolbar */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:p-3.5 shadow-xs">
        {/* Month Selector */}
        <div className="flex items-center justify-between sm:justify-start gap-1.5 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
              title="เดือนก่อนหน้า"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[135px] sm:min-w-[160px] text-center font-bold text-xs sm:text-sm text-slate-900 px-2">
              {THAI_MONTHS[currentMonth - 1]} {currentYear + 543}
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
              title="เดือนถัดไป"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleGoToday}
              className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap"
            >
              วันนี้
            </button>
            {selectedDateYmd && (
              <button
                type="button"
                onClick={() => setSelectedDateYmd(null)}
                className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 whitespace-nowrap"
              >
                ทั้งเดือน
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                loadPmSheet();
                if (onRefreshData) onRefreshData();
              }}
              disabled={isRefreshing || isLoadingPmSheet}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="ซิงค์ข้อมูลล่าสุด"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing || isLoadingPmSheet ? 'animate-spin text-blue-600' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] sm:text-xs whitespace-nowrap overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                filterMode === 'ALL'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('UNAPPROVED')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                filterMode === 'UNAPPROVED'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span>งานซ่อมไม่อนุมัติ ({metrics.unapprovedTotal})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('PM')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                filterMode === 'PM'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span>รอบ PM ({metrics.duePmCount} คัน)</span>
            </button>
          </div>

          <div className="relative flex-1 sm:w-48 min-w-[140px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาเบอร์รถ, อาการ..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-8 pr-7 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
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
        </div>
      </div>

      {/* 3. Monthly Calendar Grid */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {/* Weekday Header */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] sm:text-xs font-bold text-slate-600">
          {WEEKDAY_HEADERS.map((day, idx) => (
            <div
              key={day}
              className={`py-2 ${
                idx === 0
                  ? 'text-rose-600'
                  : idx === 6
                  ? 'text-indigo-600'
                  : 'text-slate-700'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
          {calendarCells.map((cell, idx) => {
            if (!cell.ymd || cell.dayNumber === null) {
              return (
                <div
                  key={`empty-${idx}`}
                  className="min-h-[64px] sm:min-h-[104px] bg-slate-50/40"
                />
              );
            }

            const isSelected = selectedDateYmd === cell.ymd;
            const hasEvents = cell.events.length > 0;

            return (
              <div
                key={cell.ymd}
                onClick={() =>
                  setSelectedDateYmd((prev) => (prev === cell.ymd ? null : cell.ymd))
                }
                className={`group relative min-h-[64px] sm:min-h-[104px] p-1 sm:p-2 cursor-pointer transition-colors flex flex-col justify-between ${
                  isSelected
                    ? 'bg-blue-50/80 ring-2 ring-inset ring-blue-600'
                    : cell.isToday
                    ? 'bg-amber-50/40 hover:bg-amber-50/70'
                    : hasEvents
                    ? 'bg-white hover:bg-slate-50'
                    : 'bg-white hover:bg-slate-50/60'
                }`}
              >
                {/* Top Row: Day Number */}
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`inline-flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full font-mono text-[11px] sm:text-xs font-bold ${
                      cell.isToday
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : isSelected
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {hasEvents && (
                    <div className="flex items-center gap-0.5 sm:hidden">
                      {cell.unapprovedCount > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-amber-500 px-1 font-mono text-[9px] font-bold text-white">
                          {cell.unapprovedCount}
                        </span>
                      )}
                      {cell.pmCount > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-blue-600 px-1 font-mono text-[9px] font-bold text-white">
                          {cell.pmCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Mobile Compact Vehicle Pills */}
                {hasEvents && (
                  <div className="mt-1 flex flex-col gap-0.5 sm:hidden overflow-hidden">
                    {cell.events.slice(0, 2).map((ev) => (
                      <div
                        key={ev.id}
                        className={`truncate rounded px-1 py-0.2 text-[9px] font-bold leading-tight whitespace-nowrap ${
                          ev.category === 'UNAPPROVED_REPAIR'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-blue-100 text-blue-900'
                        }`}
                      >
                        {ev.vehicleNo}
                      </div>
                    ))}
                    {cell.events.length > 2 && (
                      <div className="text-[9px] font-semibold text-slate-400 text-center leading-none">
                        +{cell.events.length - 2}
                      </div>
                    )}
                  </div>
                )}

                {/* Desktop Event List inside Calendar Cell */}
                {hasEvents && (
                  <div className="hidden sm:flex flex-col gap-1 mt-1 overflow-hidden">
                    {cell.events.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRepairRow(ev.sourceRow);
                        }}
                        className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold truncate transition-colors ${
                          ev.category === 'UNAPPROVED_REPAIR'
                            ? 'bg-amber-100/90 text-amber-950 hover:bg-amber-200 border border-amber-200/80'
                            : 'bg-blue-100/90 text-blue-950 hover:bg-blue-200 border border-blue-200/80'
                        }`}
                        title={`${ev.vehicleNo} - ${ev.repairType}: ${ev.symptom}`}
                      >
                        <span className="font-mono font-bold truncate">
                          {ev.vehicleNo}
                        </span>
                        <span className="text-[10px] opacity-85 truncate">
                          {ev.category === 'UNAPPROVED_REPAIR'
                            ? ev.approvalStatus
                            : ev.pmHoursLabel || 'PM'}
                        </span>
                      </div>
                    ))}
                    {cell.events.length > 3 && (
                      <div className="text-[10px] font-semibold text-slate-500 pl-1">
                        + อีก {cell.events.length - 3} รายการ
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
          <div className="flex items-center gap-3 whitespace-nowrap">
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-900">
              <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" />
              งานซ่อมที่ยังไม่อนุมัติ
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-blue-900">
              <span className="h-2.5 w-2.5 rounded-xs bg-blue-600" />
              กำหนดรอบ PM / ซ่อม PM
            </span>
          </div>
          {selectedDateYmd && (
            <span className="font-semibold text-blue-700 whitespace-nowrap">
              กำลังดูวันที่ {formatYmdThaiShort(selectedDateYmd)} ({displayedEvents.length} รายการ)
            </span>
          )}
        </div>
      </div>

      {/* 4. Two-Column Bottom Section: (Left) Events on Selected Date/Month, (Right) Live Vehicle PM Schedule Table */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Left Column: Event List for Selected Date or Current Month */}
        <div className="lg:col-span-7 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2 min-w-0 whitespace-nowrap">
              <CalendarIcon className="h-4 w-4 text-blue-600 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                {selectedDateYmd
                  ? `รายการวันที่ ${formatYmdThaiShort(selectedDateYmd)}`
                  : `รายการประจำเดือน ${THAI_MONTHS[currentMonth - 1]} ${currentYear + 543}`}
              </h3>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700 shrink-0">
                {displayedEvents.length}
              </span>
            </div>

            {selectedDateYmd && (
              <button
                type="button"
                onClick={() => setSelectedDateYmd(null)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap shrink-0"
              >
                ดูทั้งเดือน
              </button>
            )}
          </div>

          {displayedEvents.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              ไม่มีรายการใน{selectedDateYmd ? 'วันที่เลือก' : 'เดือนนี้'}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {displayedEvents.map((ev) => {
                const isUnapproved = ev.category === 'UNAPPROVED_REPAIR';

                return (
                  <div
                    key={ev.id}
                    onClick={() => onSelectRepairRow(ev.sourceRow)}
                    className="p-2.5 sm:px-4 sm:py-3 hover:bg-slate-50/90 transition-colors cursor-pointer"
                  >
                    {/* Row 1: Date + Vehicle + Status Badge (Single-Line on Mobile) */}
                    <div className="flex items-center justify-between gap-1.5 flex-nowrap whitespace-nowrap">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 shrink-0">
                          {ev.dateDisplay}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-extrabold text-amber-300 shrink-0">
                          <Truck className="h-3 w-3" />
                          {ev.vehicleNo}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold truncate ${
                            isUnapproved
                              ? 'bg-amber-100 text-amber-900 border border-amber-200'
                              : 'bg-blue-100 text-blue-900 border border-blue-200'
                          }`}
                        >
                          {isUnapproved
                            ? ev.approvalStatus
                            : ev.pmHoursLabel || 'รอบ PM'}
                        </span>
                      </div>

                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isUnapproved &&
                          (ev.approvalStatus === 'รออนุมัติ' ||
                            ev.approvalStatus === 'ขอข้อมูลเพิ่มเติม' ||
                            ev.approvalStatus === 'ตอบกลับข้อมูลเพิ่มเติมแล้ว') && (
                            <button
                              type="button"
                              onClick={onOpenApprovalModal}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 shadow-2xs"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              <span>อนุมัติ</span>
                            </button>
                          )}
                        <button
                          type="button"
                          onClick={() => onSelectRepairRow(ev.sourceRow)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          <Eye className="h-3 w-3" />
                          <span className="hidden sm:inline">รายละเอียด</span>
                        </button>
                      </div>
                    </div>

                    {/* Row 2: Repair Type + Symptom + Cost */}
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                      <div className="min-w-0 flex-1 truncate">
                        <span className="font-semibold text-slate-800">
                          {ev.repairType}:
                        </span>{' '}
                        <span className="text-slate-600">
                          {ev.symptom.replace(/\s+/g, ' ')}
                        </span>
                      </div>
                      {ev.totalCost > 0 && (
                        <span className="font-mono text-xs font-bold text-emerald-700 whitespace-nowrap shrink-0">
                          {ev.totalCost.toLocaleString('th-TH')} ฿
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Live Vehicle PM Status Table (จากชีต กำหนดรอบPM) */}
        <div className="lg:col-span-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
              <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                สถานะกำหนดรอบ PM รายคัน
              </h3>
            </div>

            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] whitespace-nowrap shrink-0">
              <button
                type="button"
                onClick={() => setPmStatusFilter('DUE_ONLY')}
                className={`rounded px-2 py-0.5 font-semibold transition-colors ${
                  pmStatusFilter === 'DUE_ONLY'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ครบรอบ ({metrics.duePmCount})
              </button>
              <button
                type="button"
                onClick={() => setPmStatusFilter('ALL')}
                className={`rounded px-2 py-0.5 font-semibold transition-colors ${
                  pmStatusFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ทั้งหมด ({metrics.totalPmVehicles})
              </button>
            </div>
          </div>

          {filteredVehiclePmList.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              ไม่พบรายการรถตามเงื่อนไข
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {filteredVehiclePmList.map((item) => (
                <div
                  key={item.vehicleNo + '_' + item.seq}
                  onClick={() => {
                    if (item.latestPmRepairRow) {
                      onSelectRepairRow(item.latestPmRepairRow);
                    } else {
                      onSelectRepairRow(item.row);
                    }
                  }}
                  className={`px-3 py-2.5 sm:px-4 transition-colors cursor-pointer ${
                    item.isDue
                      ? 'bg-amber-50/40 hover:bg-amber-50/80'
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  {/* Line 1: Vehicle + Due Badge + Mileage Diff */}
                  <div className="flex items-center justify-between gap-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-extrabold text-white shrink-0">
                        <Truck className="h-3 w-3 text-amber-300" />
                        {item.vehicleNo}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                          item.isDue
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {item.isDue ? '⚠️ ครบรอบ PM' : 'ยังไม่ครบกำหนด'}
                      </span>
                    </div>

                    <span className="font-mono text-xs font-bold text-slate-700 tabular-nums shrink-0">
                      ไมล์ {item.currMileage.toLocaleString('th-TH')}
                    </span>
                  </div>

                  {/* Line 2: Mileage Range & Latest PM Repair Status */}
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 whitespace-nowrap">
                    <span className="truncate">
                      ครั้งก่อน: {item.prevMileage.toLocaleString('th-TH')}{' '}
                      {item.diffMileage > 0 && (
                        <strong className="text-amber-700">
                          (+{item.diffMileage.toLocaleString('th-TH', { maximumFractionDigits: 1 })})
                        </strong>
                      )}
                    </span>
                    {item.latestPmRepairDate ? (
                      <span className="text-blue-700 font-medium truncate shrink-0">
                        PM ล่าสุด: {item.latestPmRepairDate} ({item.latestPmRepairStatus})
                      </span>
                    ) : (
                      <span className="text-slate-400 shrink-0">ไม่มีประวัติซ่อม PM ล่าสุด</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
