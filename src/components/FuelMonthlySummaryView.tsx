import React, { useState, useMemo } from 'react';
import { SheetRow, SheetColumn } from '../types';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Search,
  Fuel,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  Layers,
  Truck,
  User,
  Clock,
  FileText,
  DollarSign,
  PlusCircle,
  ChevronsUpDown,
  Sparkles,
  RefreshCw,
  Eye,
} from 'lucide-react';
import {
  THAI_MONTHS_FULL,
  parseThaiDateToGregorianYmd,
  parseNumericCell,
} from '../utils/sheetMetrics';

interface FuelMonthlySummaryViewProps {
  rows: SheetRow[];
  columns?: SheetColumn[];
  onSelectRow: (row: SheetRow) => void;
  onOpenFuelModal: () => void;
  onRefreshData?: () => void;
  isRefreshing?: boolean;
}

interface ParsedFuelRow {
  row: SheetRow;
  rowNumber: number;
  id: string;
  ymd: string;
  year: number;
  month: number;
  monthKey: string; // YYYY-MM
  monthNameThai: string;
  dateDisplay: string;
  time: string;
  fuelType: string;
  isDiesel: boolean;
  isBenzene: boolean;
  status: 'IN' | 'OUT';
  inLiters: number;
  outLiters: number;
  pricePerLiter: number;
  totalAmount: number;
  vehicleNo: string;
  mileage: string;
  driverName: string;
  issuer: string;
  receiver: string;
  reqNo: string;
  note: string;
  monthColText: string;
}

interface DayAggregate {
  ymd: string;
  dateDisplay: string;
  dayOfMonth: number;
  weekdayThai: string;
  inLiters: number;
  outLiters: number;
  netLiters: number;
  inDieselLiters: number;
  outDieselLiters: number;
  inBenzeneLiters: number;
  outBenzeneLiters: number;
  inAmount: number;
  outAmount: number;
  inCount: number;
  outCount: number;
  vehicles: string[];
  records: ParsedFuelRow[];
}

interface MonthAggregate {
  monthKey: string;
  year: number;
  month: number;
  monthTitle: string;
  totalInLiters: number;
  totalOutLiters: number;
  netLiters: number;
  inDieselLiters: number;
  outDieselLiters: number;
  inBenzeneLiters: number;
  outBenzeneLiters: number;
  totalInAmount: number;
  totalOutAmount: number;
  inCount: number;
  outCount: number;
  distinctDaysCount: number;
  distinctVehiclesCount: number;
  days: DayAggregate[];
}

const THAI_WEEKDAYS = [
  'วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ',
  'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์',
];

function parseDateInfo(rawDate: string, rawMonthCol?: string) {
  return parseThaiDateToGregorianYmd(rawDate, rawMonthCol);
}

function formatNumber(num: number, decimals = 0): string {
  if (num === 0) return '0';
  return num.toLocaleString('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const FuelMonthlySummaryView: React.FC<FuelMonthlySummaryViewProps> = ({
  rows,
  onSelectRow,
  onOpenFuelModal,
  onRefreshData,
  isRefreshing,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [selectedFuelType, setSelectedFuelType] = useState<'ALL' | 'DIESEL' | 'BENZENE'>('ALL');
  const [selectedTxType, setSelectedTxType] = useState<'ALL' | 'IN' | 'OUT'>('ALL');

  // Track expanded months (key: monthKey)
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  // Track expanded days (key: ymd)
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  // 1. Parse and extract all fuel records
  const parsedRows: ParsedFuelRow[] = useMemo(() => {
    return rows
      .map((r) => {
        const dateRaw = r.values['B'] ?? '';
        const monthRaw = r.values['X'] ?? '';
        const dateInfo = parseDateInfo(dateRaw, monthRaw);
        if (!dateInfo) return null;

        const { ymd, year, month, day } = dateInfo;
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;

        // Buddhist year display
        const displayYear = year > 2400 ? year : year + 543;
        const monthName = THAI_MONTHS_FULL[month - 1] || `เดือน ${month}`;
        const monthNameThai = `${monthName} ${displayYear}`;
        const dateDisplay = `${day} ${monthName} ${displayYear}`;

        const fuelType = (r.values['D'] ?? '').trim();
        const isBenzene =
          fuelType.includes('เบน') ||
          fuelType.includes('ซิน') ||
          fuelType.includes('ซิล') ||
          fuelType.toLowerCase().includes('benzene') ||
          fuelType.includes('โซฮอล์');
        const isDiesel = !isBenzene;

        const inLiters = parseNumericCell(r.rawValues['E'] ?? r.values['E']);
        const outLiters = parseNumericCell(r.rawValues['G'] ?? r.values['G']);
        const pricePerLiter = parseNumericCell(r.rawValues['F'] ?? r.values['F']);
        let totalAmount = parseNumericCell(r.rawValues['H'] ?? r.values['H']);
        if (totalAmount === 0 && pricePerLiter > 0) {
          totalAmount = (inLiters > 0 ? inLiters : outLiters) * pricePerLiter;
        }

        const statusRaw = (r.values['S'] ?? '').trim();
        let status: 'IN' | 'OUT' = 'OUT';
        if (
          statusRaw.includes('รับ') ||
          (inLiters > 0 && outLiters === 0) ||
          statusRaw.toLowerCase() === 'in'
        ) {
          status = 'IN';
        }

        return {
          row: r,
          rowNumber: r.rowNumber,
          id: r.values['A'] ?? String(r.rowNumber),
          ymd,
          year,
          month,
          monthKey,
          monthNameThai,
          dateDisplay,
          time: (r.values['C'] ?? '').trim(),
          fuelType: fuelType || (isDiesel ? 'ดีเซล' : 'เบนซิน'),
          isDiesel,
          isBenzene,
          status,
          inLiters,
          outLiters,
          pricePerLiter,
          totalAmount,
          vehicleNo: (r.values['O'] ?? '').trim(),
          mileage: (r.values['P'] ?? '').trim(),
          driverName: (r.values['Q'] ?? '').trim(),
          issuer: (r.values['R'] ?? '').trim(),
          receiver: (r.values['T'] ?? '').trim(),
          reqNo: (r.values['U'] ?? '').trim(),
          note: (r.values['V'] ?? '').trim(),
          monthColText: monthRaw,
        };
      })
      .filter((item): item is ParsedFuelRow => item !== null);
  }, [rows]);

  // Extract list of distinct years for filter dropdown
  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    parsedRows.forEach((item) => yearsSet.add(item.year));
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [parsedRows]);

  // 2. Filter parsed rows
  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return parsedRows.filter((item) => {
      // Year filter
      if (selectedYear !== 'ALL' && String(item.year) !== selectedYear) {
        return false;
      }
      // Fuel Type filter
      if (selectedFuelType === 'DIESEL' && !item.isDiesel) return false;
      if (selectedFuelType === 'BENZENE' && !item.isBenzene) return false;
      // Tx Type filter
      if (selectedTxType === 'IN' && item.status !== 'IN') return false;
      if (selectedTxType === 'OUT' && item.status !== 'OUT') return false;

      // Keyword search
      if (q) {
        const matches =
          item.vehicleNo.toLowerCase().includes(q) ||
          item.driverName.toLowerCase().includes(q) ||
          item.fuelType.toLowerCase().includes(q) ||
          item.note.toLowerCase().includes(q) ||
          item.dateDisplay.toLowerCase().includes(q) ||
          item.reqNo.toLowerCase().includes(q) ||
          item.issuer.toLowerCase().includes(q) ||
          item.receiver.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [parsedRows, searchTerm, selectedYear, selectedFuelType, selectedTxType]);

  // 3. Group by Month and then by Day
  const monthlyData: MonthAggregate[] = useMemo(() => {
    const monthMap = new Map<string, {
      monthKey: string;
      year: number;
      month: number;
      monthTitle: string;
      dayMap: Map<string, DayAggregate>;
    }>();

    filteredRows.forEach((item) => {
      if (!monthMap.has(item.monthKey)) {
        monthMap.set(item.monthKey, {
          monthKey: item.monthKey,
          year: item.year,
          month: item.month,
          monthTitle: item.monthNameThai,
          dayMap: new Map<string, DayAggregate>(),
        });
      }

      const mObj = monthMap.get(item.monthKey)!;
      if (!mObj.dayMap.has(item.ymd)) {
        const [y, m, d] = item.ymd.split('-').map(Number);
        // Calculate weekday using Gregorian reference
        const gregYear = y > 2400 ? y - 543 : y;
        const dateObj = new Date(gregYear, m - 1, d);
        const weekdayThai = THAI_WEEKDAYS[dateObj.getDay()] || '';

        mObj.dayMap.set(item.ymd, {
          ymd: item.ymd,
          dateDisplay: item.dateDisplay,
          dayOfMonth: d,
          weekdayThai,
          inLiters: 0,
          outLiters: 0,
          netLiters: 0,
          inDieselLiters: 0,
          outDieselLiters: 0,
          inBenzeneLiters: 0,
          outBenzeneLiters: 0,
          inAmount: 0,
          outAmount: 0,
          inCount: 0,
          outCount: 0,
          vehicles: [],
          records: [],
        });
      }

      const dayObj = mObj.dayMap.get(item.ymd)!;
      dayObj.records.push(item);
      if (item.vehicleNo && !dayObj.vehicles.includes(item.vehicleNo)) {
        dayObj.vehicles.push(item.vehicleNo);
      }

      if (item.status === 'IN') {
        dayObj.inLiters += item.inLiters;
        dayObj.inAmount += item.totalAmount;
        dayObj.inCount += 1;
        if (item.isDiesel) dayObj.inDieselLiters += item.inLiters;
        else dayObj.inBenzeneLiters += item.inLiters;
      } else {
        dayObj.outLiters += item.outLiters;
        dayObj.outAmount += item.totalAmount;
        dayObj.outCount += 1;
        if (item.isDiesel) dayObj.outDieselLiters += item.outLiters;
        else dayObj.outBenzeneLiters += item.outLiters;
      }
      dayObj.netLiters = dayObj.inLiters - dayObj.outLiters;
    });

    // Compile month summaries
    const result: MonthAggregate[] = [];
    monthMap.forEach((mObj) => {
      const days = Array.from(mObj.dayMap.values()).sort(
        (a, b) => b.dayOfMonth - a.dayOfMonth
      );

      let totalInLiters = 0;
      let totalOutLiters = 0;
      let inDieselLiters = 0;
      let outDieselLiters = 0;
      let inBenzeneLiters = 0;
      let outBenzeneLiters = 0;
      let totalInAmount = 0;
      let totalOutAmount = 0;
      let inCount = 0;
      let outCount = 0;
      const allVehicles = new Set<string>();

      days.forEach((d) => {
        totalInLiters += d.inLiters;
        totalOutLiters += d.outLiters;
        inDieselLiters += d.inDieselLiters;
        outDieselLiters += d.outDieselLiters;
        inBenzeneLiters += d.inBenzeneLiters;
        outBenzeneLiters += d.outBenzeneLiters;
        totalInAmount += d.inAmount;
        totalOutAmount += d.outAmount;
        inCount += d.inCount;
        outCount += d.outCount;
        d.vehicles.forEach((v) => allVehicles.add(v));
      });

      result.push({
        monthKey: mObj.monthKey,
        year: mObj.year,
        month: mObj.month,
        monthTitle: mObj.monthTitle,
        totalInLiters,
        totalOutLiters,
        netLiters: totalInLiters - totalOutLiters,
        inDieselLiters,
        outDieselLiters,
        inBenzeneLiters,
        outBenzeneLiters,
        totalInAmount,
        totalOutAmount,
        inCount,
        outCount,
        distinctDaysCount: days.length,
        distinctVehiclesCount: allVehicles.size,
        days,
      });
    });

    // Sort months newest first
    return result.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }, [filteredRows]);

  // Overall totals across all filtered records
  const overallTotals = useMemo(() => {
    let inLit = 0;
    let outLit = 0;
    let inAmt = 0;
    let outAmt = 0;
    let inCount = 0;
    let outCount = 0;

    monthlyData.forEach((m) => {
      inLit += m.totalInLiters;
      outLit += m.totalOutLiters;
      inAmt += m.totalInAmount;
      outAmt += m.totalOutAmount;
      inCount += m.inCount;
      outCount += m.outCount;
    });

    return {
      inLit,
      outLit,
      netLit: inLit - outLit,
      inAmt,
      outAmt,
      inCount,
      outCount,
    };
  }, [monthlyData]);

  // Toggle month expansion
  const toggleMonth = (monthKey: string) => {
    setExpandedMonths((prev) => ({
      ...prev,
      [monthKey]: !prev[monthKey],
    }));
  };

  // Toggle day expansion
  const toggleDay = (ymd: string) => {
    setExpandedDays((prev) => ({
      ...prev,
      [ymd]: !prev[ymd],
    }));
  };

  // Expand / collapse all months
  const toggleAllMonths = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    monthlyData.forEach((m) => {
      next[m.monthKey] = expand;
    });
    setExpandedMonths(next);
  };

  // Default initial state: all months collapsed by default

  return (
    <div className="space-y-2.5 sm:space-y-4">
      {/* 1. Header Toolbar & Filters */}
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:p-3.5 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5 flex-1 min-w-0">
          {/* Row 1 on Mobile: Search Box + Year Filter + Refresh */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto sm:flex-1 sm:min-w-[240px] sm:max-w-md">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ค้นหารถ, คนขับ, ใบเบิก..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none whitespace-nowrap"
            >
              <option value="ALL">ทุกปี</option>
              {availableYears.map((y) => (
                <option key={y} value={String(y)}>
                  ปี {y > 2400 ? y : y + 543}
                </option>
              ))}
            </select>

            {onRefreshData && (
              <button
                type="button"
                onClick={onRefreshData}
                disabled={isRefreshing}
                className="inline-flex sm:hidden items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 shrink-0"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            )}
          </div>

          {/* Row 2 on Mobile: Fuel Type + Transaction Type + Expand/Collapse */}
          <div className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap">
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Fuel Type Filter */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] sm:text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedFuelType('ALL')}
                  className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                    selectedFuelType === 'ALL'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFuelType('DIESEL')}
                  className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                    selectedFuelType === 'DIESEL'
                      ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ดีเซล
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFuelType('BENZENE')}
                  className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                    selectedFuelType === 'BENZENE'
                      ? 'bg-amber-600 text-white shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  เบนซิน
                </button>
              </div>

              {/* Transaction Type Filter */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] sm:text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedTxType('ALL')}
                  className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                    selectedTxType === 'ALL'
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  รับ/เบิก
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTxType('IN')}
                  className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                    selectedTxType === 'IN'
                      ? 'bg-emerald-600 text-white shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  รับเข้า
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTxType('OUT')}
                  className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                    selectedTxType === 'OUT'
                      ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  จ่ายออก
                </button>
              </div>
            </div>

            {/* Mobile Expand/Collapse Compact Buttons */}
            <div className="flex sm:hidden items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => toggleAllMonths(true)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                ขยายทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => toggleAllMonths(false)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                ย่อทั้งหมด
              </button>
            </div>
          </div>
        </div>

        {/* Desktop Action Buttons */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => toggleAllMonths(true)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
          >
            ขยายทุกเดือน
          </button>
          <button
            type="button"
            onClick={() => toggleAllMonths(false)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
          >
            พับเก็บทุกเดือน
          </button>
          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              <span>รีเฟรช</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Top Summary KPI Cards (Compact Single-Line on Mobile) */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
        {/* Total Inflow */}
        <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 to-white px-3 py-2 sm:p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-emerald-800 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">รวมรับเข้า</span>
            </span>
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 shrink-0">
              {formatNumber(overallTotals.inCount)} ครั้ง
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 whitespace-nowrap">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-base sm:text-2xl font-bold tracking-tight text-emerald-700">
                {formatNumber(overallTotals.inLit, 1)}
              </span>
              <span className="text-[11px] sm:text-xs font-medium text-slate-500">ล.</span>
            </div>
            {overallTotals.inAmt > 0 && (
              <span className="text-[10px] sm:text-[11px] text-emerald-800/80 font-mono truncate">
                {formatNumber(overallTotals.inAmt, 0)} ฿
              </span>
            )}
          </div>
        </div>

        {/* Total Outflow */}
        <div className="rounded-xl border border-blue-200/80 bg-gradient-to-br from-blue-50/70 to-white px-3 py-2 sm:p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-blue-800 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <ArrowUpRight className="h-3.5 w-3.5 text-blue-600 shrink-0" />
              <span className="truncate">รวมเบิกออก</span>
            </span>
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 shrink-0">
              {formatNumber(overallTotals.outCount)} ครั้ง
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-1 whitespace-nowrap">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-base sm:text-2xl font-bold tracking-tight text-blue-700">
                {formatNumber(overallTotals.outLit, 1)}
              </span>
              <span className="text-[11px] sm:text-xs font-medium text-slate-500">ล.</span>
            </div>
            {overallTotals.outAmt > 0 && (
              <span className="text-[10px] sm:text-[11px] text-blue-800/80 font-mono truncate">
                {formatNumber(overallTotals.outAmt, 0)} ฿
              </span>
            )}
          </div>
        </div>

        {/* Net Flow */}
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2 sm:p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-slate-700 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <Fuel className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              <span className="truncate">ผลต่างสุทธิ</span>
            </span>
            <span className="text-[10px] font-medium text-slate-500 shrink-0">
              {monthlyData.length} เดือน
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
            <span
              className={`font-mono text-base sm:text-2xl font-bold tracking-tight ${
                overallTotals.netLit >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {overallTotals.netLit > 0 ? '+' : ''}
              {formatNumber(overallTotals.netLit, 1)}
            </span>
            <span className="text-[11px] sm:text-xs font-medium text-slate-500">ล.</span>
          </div>
        </div>

        {/* Distinct Days & Records */}
        <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-white px-3 py-2 sm:p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-semibold text-amber-900 whitespace-nowrap">
            <span className="flex items-center gap-1 truncate">
              <Calendar className="h-3.5 w-3.5 text-amber-700 shrink-0" />
              <span className="truncate">รายการที่พบ</span>
            </span>
            <span className="text-[10px] font-medium text-amber-800/80 shrink-0">
              / {formatNumber(rows.length)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
            <span className="font-mono text-base sm:text-2xl font-bold tracking-tight text-amber-800">
              {formatNumber(filteredRows.length)}
            </span>
            <span className="text-[11px] sm:text-xs font-medium text-slate-500">รายการ</span>
          </div>
        </div>
      </div>

      {/* 3. Monthly Summary Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2 min-w-0 whitespace-nowrap">
            <Layers className="h-4 w-4 text-blue-600 shrink-0" />
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
              ตารางสรุป รับเข้า-เบิกออก แต่ละเดือน
            </h3>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shrink-0">
              {monthlyData.length} เดือน
            </span>
          </div>
        </div>

        {monthlyData.length === 0 ? (
          <div className="py-10 text-center">
            <Fuel className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-xs sm:text-sm font-semibold text-slate-700">ไม่พบข้อมูลตามเงื่อนไขที่ค้นหา</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {monthlyData.map((m) => {
              const isMonthExpanded = expandedMonths[m.monthKey] ?? false;

              return (
                <div key={m.monthKey} className="transition-colors">
                  {/* Month Row Header (Clickable Accordion) */}
                  <div
                    onClick={() => toggleMonth(m.monthKey)}
                    className={`cursor-pointer transition-colors p-2.5 sm:p-3.5 sm:px-5 hover:bg-slate-50/90 ${
                      isMonthExpanded ? 'bg-slate-50/70 border-l-4 border-l-blue-600' : 'bg-white'
                    }`}
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      {/* Top Row on Mobile: Month Title + Badges + Counts on a Single Line */}
                      <div className="flex items-center justify-between gap-2 min-w-0 whitespace-nowrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 transition-colors shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMonth(m.monthKey);
                            }}
                          >
                            {isMonthExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-700 font-bold" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            )}
                          </button>

                          <span className="text-xs sm:text-base font-bold text-slate-900 truncate">
                            {m.monthTitle}
                          </span>
                          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] sm:text-xs font-semibold text-blue-700 border border-blue-200 shrink-0">
                            {m.distinctDaysCount} วัน
                          </span>
                          {m.distinctVehiclesCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] sm:text-xs font-medium text-slate-600 shrink-0">
                              <Truck className="h-3 w-3 text-slate-400" />
                              {m.distinctVehiclesCount} คัน
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 shrink-0">
                          <span>
                            รับ <strong className="text-emerald-700">{formatNumber(m.inCount)}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            จ่าย <strong className="text-blue-700">{formatNumber(m.outCount)}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Bottom Row on Mobile: 3-Column Single-Line Metrics Strip */}
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-3 text-xs">
                        {/* Received In */}
                        <div className="rounded-lg bg-emerald-50/70 border border-emerald-100 px-2 py-1 sm:px-3 sm:py-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px] font-medium text-emerald-800 whitespace-nowrap">
                            <span>รับเข้า</span>
                            <span className="font-mono font-bold text-emerald-700 text-[11px] sm:text-sm">
                              {formatNumber(m.totalInLiters, 1)} ล.
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-emerald-800/75 truncate whitespace-nowrap">
                            ดีเซล {formatNumber(m.inDieselLiters, 0)} | เบนซิน {formatNumber(m.inBenzeneLiters, 0)}
                          </div>
                        </div>

                        {/* Issued Out */}
                        <div className="rounded-lg bg-blue-50/70 border border-blue-100 px-2 py-1 sm:px-3 sm:py-1.5 min-w-0">
                          <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px] font-medium text-blue-800 whitespace-nowrap">
                            <span>จ่ายออก</span>
                            <span className="font-mono font-bold text-blue-700 text-[11px] sm:text-sm">
                              {formatNumber(m.totalOutLiters, 1)} ล.
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-blue-800/75 truncate whitespace-nowrap">
                            ดีเซล {formatNumber(m.outDieselLiters, 0)} | เบนซิน {formatNumber(m.outBenzeneLiters, 0)}
                          </div>
                        </div>

                        {/* Net Change */}
                        <div className="rounded-lg bg-slate-100 border border-slate-200 px-2 py-1 sm:px-3 sm:py-1.5 min-w-0 flex flex-col justify-center">
                          <div className="flex items-center justify-between gap-1 text-[10px] sm:text-[11px] font-medium text-slate-600 whitespace-nowrap">
                            <span>สุทธิ</span>
                            <span
                              className={`font-mono font-bold text-[11px] sm:text-sm ${
                                m.netLiters >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {m.netLiters > 0 ? '+' : ''}
                              {formatNumber(m.netLiters, 1)} ล.
                            </span>
                          </div>
                        </div>

                        {/* Drill-down Toggle Button (Desktop only) */}
                        <div className="hidden sm:flex items-center justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMonth(m.monthKey);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                              isMonthExpanded
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            <span>{isMonthExpanded ? 'ซ่อนรายวัน' : 'ดูรายวัน'}</span>
                            {isMonthExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Daily Breakdown */}
                  {isMonthExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50/50 p-2 sm:p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 truncate">
                          <Calendar className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                          <span className="truncate">
                            รายวันประจำเดือน {m.monthTitle} ({m.days.length} วัน)
                          </span>
                        </div>
                      </div>

                      {/* Day Cards List */}
                      <div className="space-y-2">
                        {m.days.map((d) => {
                          const isDayExpanded = expandedDays[d.ymd] ?? true;

                          return (
                            <div
                              key={d.ymd}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs transition-shadow hover:shadow-xs"
                            >
                              {/* Day Header Row (Single-Line Focused) */}
                              <div
                                onClick={() => toggleDay(d.ymd)}
                                className={`cursor-pointer px-2.5 py-2 sm:px-3.5 sm:py-2.5 transition-colors ${
                                  isDayExpanded ? 'bg-slate-100/70 border-b border-slate-200' : 'bg-white hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5 flex-nowrap overflow-x-auto no-scrollbar whitespace-nowrap">
                                  {/* Left: Date & Count */}
                                  <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                                    <button
                                      type="button"
                                      className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:text-slate-800 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleDay(d.ymd);
                                      }}
                                    >
                                      {isDayExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      )}
                                    </button>

                                    <span className="font-semibold text-xs sm:text-sm text-slate-900">
                                      <span className="hidden sm:inline">{d.weekdayThai}ที่ </span>
                                      {d.dateDisplay}
                                    </span>
                                    <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-700">
                                      {d.records.length} รายการ
                                    </span>
                                  </div>

                                  {/* Right: Day Totals on Same Single Line */}
                                  <div className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs shrink-0">
                                    {d.inLiters > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800 border border-emerald-200 font-semibold">
                                        <ArrowDownLeft className="h-3 w-3 text-emerald-600 shrink-0" />
                                        <span>รับ {formatNumber(d.inLiters, 1)} ล.</span>
                                      </span>
                                    )}

                                    {d.outLiters > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-blue-800 border border-blue-200 font-semibold">
                                        <ArrowUpRight className="h-3 w-3 text-blue-600 shrink-0" />
                                        <span>จ่าย {formatNumber(d.outLiters, 1)} ล.</span>
                                      </span>
                                    )}

                                    <span
                                      className={`rounded px-1.5 py-0.5 font-mono font-bold text-[11px] sm:text-xs ${
                                        d.netLiters >= 0
                                          ? 'bg-slate-100 text-slate-800'
                                          : 'bg-rose-50 text-rose-700'
                                      }`}
                                    >
                                      สุทธิ {d.netLiters > 0 ? '+' : ''}
                                      {formatNumber(d.netLiters, 1)} ล.
                                    </span>
                                  </div>
                                </div>

                                {d.vehicles.length > 0 && (
                                  <div className="mt-1 pl-6 text-[11px] text-slate-500 truncate whitespace-nowrap">
                                    รถที่เติม: {d.vehicles.slice(0, 6).join(', ')}
                                    {d.vehicles.length > 6 ? ` +${d.vehicles.length - 6} คัน` : ''}
                                  </div>
                                )}
                              </div>

                              {/* Day Transactions Table (When expanded) */}
                              {isDayExpanded && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs text-slate-700">
                                    <thead className="bg-slate-50/80 text-[11px] font-semibold text-slate-500 border-b border-slate-200">
                                      <tr>
                                        <th className="px-3 py-2">เวลา</th>
                                        <th className="px-3 py-2">ประเภท</th>
                                        <th className="px-3 py-2">ชนิดน้ำมัน</th>
                                        <th className="px-3 py-2 text-right">จำนวน (ลิตร)</th>
                                        <th className="px-3 py-2 text-right">ราคา/ลิตร</th>
                                        <th className="px-3 py-2 text-right">มูลค่า (บาท)</th>
                                        <th className="px-3 py-2">เบอร์รถ</th>
                                        <th className="px-3 py-2">พนักงานขับรถ</th>
                                        <th className="px-3 py-2">ผู้จ่าย / ผู้รับ</th>
                                        <th className="px-3 py-2">เลขที่ใบเบิก/ไมล์</th>
                                        <th className="px-3 py-2">หมายเหตุ</th>
                                        <th className="px-2 py-2 text-center">ดูข้อมูล</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {d.records.map((rec) => {
                                        const isIn = rec.status === 'IN';
                                        const liters = isIn ? rec.inLiters : rec.outLiters;

                                        return (
                                          <tr
                                            key={rec.id + '_' + rec.rowNumber}
                                            onClick={() => onSelectRow(rec.row)}
                                            className="cursor-pointer hover:bg-blue-50/50 transition-colors"
                                          >
                                            {/* Time */}
                                            <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                              <div className="flex items-center gap-1">
                                                <Clock className="h-3 w-3 text-slate-400" />
                                                {rec.time || '-'}
                                              </div>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-3 py-2 whitespace-nowrap">
                                              {isIn ? (
                                                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                                  <ArrowDownLeft className="h-3 w-3" />
                                                  รับเข้า
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                                                  <ArrowUpRight className="h-3 w-3" />
                                                  เบิกออก
                                                </span>
                                              )}
                                            </td>

                                            {/* Fuel Type */}
                                            <td className="px-3 py-2 whitespace-nowrap">
                                              <span
                                                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                                  rec.isBenzene
                                                    ? 'bg-amber-100 text-amber-800'
                                                    : 'bg-indigo-100 text-indigo-800'
                                                }`}
                                              >
                                                {rec.fuelType}
                                              </span>
                                            </td>

                                            {/* Liters */}
                                            <td className="px-3 py-2 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                                              <span className={isIn ? 'text-emerald-700' : 'text-blue-700'}>
                                                {formatNumber(liters, 1)}
                                              </span>
                                            </td>

                                            {/* Price */}
                                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                              {rec.pricePerLiter > 0 ? formatNumber(rec.pricePerLiter, 2) : '-'}
                                            </td>

                                            {/* Amount */}
                                            <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                              {rec.totalAmount > 0 ? formatNumber(rec.totalAmount, 2) : '-'}
                                            </td>

                                            {/* Vehicle */}
                                            <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-900">
                                              {rec.vehicleNo ? (
                                                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
                                                  <Truck className="h-3 w-3 text-slate-500" />
                                                  {rec.vehicleNo}
                                                </span>
                                              ) : (
                                                <span className="text-slate-400">-</span>
                                              )}
                                            </td>

                                            {/* Driver */}
                                            <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                                              {rec.driverName ? (
                                                <span className="inline-flex items-center gap-1">
                                                  <User className="h-3 w-3 text-slate-400" />
                                                  {rec.driverName}
                                                </span>
                                              ) : (
                                                <span className="text-slate-400">-</span>
                                              )}
                                            </td>

                                            {/* Issuer / Receiver */}
                                            <td className="px-3 py-2 whitespace-nowrap text-slate-600 text-[11px]">
                                              {isIn
                                                ? rec.receiver || rec.issuer || '-'
                                                : rec.issuer || rec.receiver || '-'}
                                            </td>

                                            {/* Requisition / Mileage */}
                                            <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-500">
                                              {rec.reqNo ? (
                                                <span className="font-semibold text-slate-700">{rec.reqNo}</span>
                                              ) : rec.mileage ? (
                                                `ไมล์ ${rec.mileage}`
                                              ) : (
                                                '-'
                                              )}
                                            </td>

                                            {/* Note */}
                                            <td className="px-3 py-2 text-slate-500 text-[11px] max-w-[160px] truncate" title={rec.note}>
                                              {rec.note || '-'}
                                            </td>

                                            {/* Action View */}
                                            <td className="px-2 py-2 text-center whitespace-nowrap">
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  onSelectRow(rec.row);
                                                }}
                                                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-blue-600 transition-colors"
                                                title="คลิกดูรายละเอียดแถวนี้"
                                              >
                                                <Eye className="h-3.5 w-3.5" />
                                              </button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
