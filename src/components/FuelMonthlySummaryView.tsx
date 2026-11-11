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

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_WEEKDAYS = [
  'วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ',
  'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์',
];

function parseDateInfo(rawDate: string, rawMonthCol?: string): {
  ymd: string;
  year: number;
  month: number;
  day: number;
} | null {
  if (!rawDate) return null;
  const trimmed = String(rawDate).trim();
  if (!trimmed) return null;

  // 1. Check Date(YYYY, M, D) gviz format
  const dateObjMatch = trimmed.match(/^Date\((\d+),\s*(\d+),\s*(\d+)/i);
  if (dateObjMatch) {
    let year = parseInt(dateObjMatch[1], 10);
    const month = parseInt(dateObjMatch[2], 10) + 1; // 0-indexed month
    const day = parseInt(dateObjMatch[3], 10);
    if (year < 100) year += 2000;
    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return { ymd: `${yStr}-${mStr}-${dStr}`, year, month, day };
  }

  // 2. Check DD/MM/YYYY or D/M/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slashMatch) {
    let p1 = parseInt(slashMatch[1], 10);
    let p2 = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;

    let day = p1;
    let month = p2;

    // Check if Month Col has hint e.g. "3.มีนาคม"
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

    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return { ymd: `${yStr}-${mStr}-${dStr}`, year, month, day };
  }

  // 3. Check ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return { ymd: `${yStr}-${mStr}-${dStr}`, year, month, day };
  }

  return null;
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

        const rawIn = r.rawValues['E'] ?? r.values['E'] ?? '';
        const rawOut = r.rawValues['G'] ?? r.values['G'] ?? '';
        const inLiters =
          typeof rawIn === 'number'
            ? rawIn
            : parseFloat(String(rawIn).replace(/,/g, '').trim()) || 0;
        const outLiters =
          typeof rawOut === 'number'
            ? rawOut
            : parseFloat(String(rawOut).replace(/,/g, '').trim()) || 0;

        const rawPrice = r.rawValues['F'] ?? r.values['F'] ?? '';
        const pricePerLiter =
          typeof rawPrice === 'number'
            ? rawPrice
            : parseFloat(String(rawPrice).replace(/,/g, '').trim()) || 0;

        const rawAmount = r.rawValues['H'] ?? r.values['H'] ?? '';
        let totalAmount =
          typeof rawAmount === 'number'
            ? rawAmount
            : parseFloat(String(rawAmount).replace(/,/g, '').trim()) || 0;
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

  // Auto-expand the first/latest month on initial load
  React.useEffect(() => {
    if (monthlyData.length > 0 && Object.keys(expandedMonths).length === 0) {
      setExpandedMonths({ [monthlyData[0].monthKey]: true });
    }
  }, [monthlyData]);

  return (
    <div className="space-y-4">
      {/* 1. Header Toolbar & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาเบอร์รถ, คนขับ, ชนิดน้ำมัน, เลขใบเบิก..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Year Filter */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-500 hidden sm:inline">ปี:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
            >
              <option value="ALL">ทุกปีทั้งหมด</option>
              {availableYears.map((y) => (
                <option key={y} value={String(y)}>
                  ปี {y > 2400 ? y : y + 543}
                </option>
              ))}
            </select>
          </div>

          {/* Fuel Type Filter */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSelectedFuelType('ALL')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
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
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
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
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                selectedFuelType === 'BENZENE'
                  ? 'bg-amber-600 text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              เบนซิน
            </button>
          </div>

          {/* Transaction Type Filter */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSelectedTxType('ALL')}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
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
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                selectedTxType === 'IN'
                  ? 'bg-emerald-600 text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              เฉพาะรับเข้า
            </button>
            <button
              type="button"
              onClick={() => setSelectedTxType('OUT')}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                selectedTxType === 'OUT'
                  ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              เฉพาะจ่ายออก
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleAllMonths(true)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            title="ขยายทุกเดือน"
          >
            ขยายทุกเดือน
          </button>
          <button
            type="button"
            onClick={() => toggleAllMonths(false)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            title="พับเก็บทุกเดือน"
          >
            พับเก็บทุกเดือน
          </button>
          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              <span className="hidden sm:inline">รีเฟรช</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenFuelModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
          >
            <PlusCircle className="h-4 w-4" />
            <span>+ บันทึกรับเข้า-เบิกออกน้ำมัน</span>
          </button>
        </div>
      </div>

      {/* 2. Top Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Inflow */}
        <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 to-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
            <span className="flex items-center gap-1.5">
              <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
              รวมรับเข้าทั้งหมด
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
              {formatNumber(overallTotals.inCount)} ครั้ง
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-emerald-700">
              {formatNumber(overallTotals.inLit, 1)}
            </span>
            <span className="text-xs font-medium text-slate-500">ลิตร</span>
          </div>
          {overallTotals.inAmt > 0 && (
            <div className="mt-1 text-[11px] text-emerald-800/80">
              มูลค่า: {formatNumber(overallTotals.inAmt, 2)} บาท
            </div>
          )}
        </div>

        {/* Total Outflow */}
        <div className="rounded-xl border border-blue-200/80 bg-gradient-to-br from-blue-50/70 to-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-blue-800">
            <span className="flex items-center gap-1.5">
              <ArrowUpRight className="h-4 w-4 text-blue-600" />
              รวมจ่ายออก / เบิกออก
            </span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
              {formatNumber(overallTotals.outCount)} ครั้ง
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-blue-700">
              {formatNumber(overallTotals.outLit, 1)}
            </span>
            <span className="text-xs font-medium text-slate-500">ลิตร</span>
          </div>
          {overallTotals.outAmt > 0 && (
            <div className="mt-1 text-[11px] text-blue-800/80">
              มูลค่า: {formatNumber(overallTotals.outAmt, 2)} บาท
            </div>
          )}
        </div>

        {/* Net Flow */}
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
            <span className="flex items-center gap-1.5">
              <Fuel className="h-4 w-4 text-slate-600" />
              ผลต่างสุทธิ (รับ - จ่าย)
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span
              className={`font-mono text-2xl font-bold tracking-tight ${
                overallTotals.netLit >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {overallTotals.netLit > 0 ? '+' : ''}
              {formatNumber(overallTotals.netLit, 1)}
            </span>
            <span className="text-xs font-medium text-slate-500">ลิตร</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {monthlyData.length} เดือนที่แสดงในตาราง
          </div>
        </div>

        {/* Distinct Days & Records */}
        <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-900">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-amber-700" />
              จำนวนรายการที่พบ
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-2xl font-bold tracking-tight text-amber-800">
              {formatNumber(filteredRows.length)}
            </span>
            <span className="text-xs font-medium text-slate-500">รายการ</span>
          </div>
          <div className="mt-1 text-[11px] text-amber-800/80">
            จากทั้งหมด {formatNumber(rows.length)} รายการในชีต
          </div>
        </div>
      </div>

      {/* 3. Monthly Summary Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">
              ตารางสรุป รับเข้า-เบิกออก แต่ละเดือน
            </h3>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              {monthlyData.length} เดือน
            </span>
          </div>
          <div className="text-xs text-slate-500">
            คลิกที่แถวของเดือน เพื่อดูรายชื่อวันที่มีการรับเข้า-จ่ายออก
          </div>
        </div>

        {monthlyData.length === 0 ? (
          <div className="py-12 text-center">
            <Fuel className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">ไม่พบข้อมูลตามเงื่อนไขที่ค้นหา</p>
            <p className="text-xs text-slate-500">ลองล้างตัวกรองหรือเปลี่ยนคำค้นหา</p>
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
                    className={`cursor-pointer transition-colors p-3.5 sm:px-5 hover:bg-slate-50/90 ${
                      isMonthExpanded ? 'bg-slate-50/70 border-l-4 border-l-blue-600' : 'bg-white'
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      {/* Left: Month Title & Badges */}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 transition-colors shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMonth(m.monthKey);
                          }}
                        >
                          {isMonthExpanded ? (
                            <ChevronDown className="h-4 w-4 text-blue-700 font-bold" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-slate-900">
                              {m.monthTitle}
                            </span>
                            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                              {m.distinctDaysCount} วันที่มีรายการ
                            </span>
                            {m.distinctVehiclesCount > 0 && (
                              <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                <Truck className="h-3 w-3 text-slate-400" />
                                {m.distinctVehiclesCount} คัน
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                            <span>
                              รับเข้า: <strong className="text-emerald-700">{formatNumber(m.inCount)} รายการ</strong>
                            </span>
                            <span>•</span>
                            <span>
                              จ่ายออก: <strong className="text-blue-700">{formatNumber(m.outCount)} รายการ</strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Metrics Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4 text-xs">
                        {/* Received In */}
                        <div className="rounded-lg bg-emerald-50/70 border border-emerald-100 px-3 py-1.5">
                          <div className="flex items-center justify-between text-[11px] font-medium text-emerald-800">
                            <span>รับเข้า (In)</span>
                            <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                          </div>
                          <div className="mt-0.5 font-mono text-sm font-bold text-emerald-700">
                            {formatNumber(m.totalInLiters, 1)}{' '}
                            <span className="text-[10px] font-normal text-slate-500">ลิตร</span>
                          </div>
                          <div className="text-[10px] text-emerald-800/70">
                            ดีเซล {formatNumber(m.inDieselLiters, 0)} | เบนซิน {formatNumber(m.inBenzeneLiters, 0)}
                          </div>
                        </div>

                        {/* Issued Out */}
                        <div className="rounded-lg bg-blue-50/70 border border-blue-100 px-3 py-1.5">
                          <div className="flex items-center justify-between text-[11px] font-medium text-blue-800">
                            <span>จ่ายออก (Out)</span>
                            <ArrowUpRight className="h-3 w-3 text-blue-600" />
                          </div>
                          <div className="mt-0.5 font-mono text-sm font-bold text-blue-700">
                            {formatNumber(m.totalOutLiters, 1)}{' '}
                            <span className="text-[10px] font-normal text-slate-500">ลิตร</span>
                          </div>
                          <div className="text-[10px] text-blue-800/70">
                            ดีเซล {formatNumber(m.outDieselLiters, 0)} | เบนซิน {formatNumber(m.outBenzeneLiters, 0)}
                          </div>
                        </div>

                        {/* Net Change */}
                        <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-1.5">
                          <div className="text-[11px] font-medium text-slate-600">ผลต่างสุทธิ</div>
                          <div
                            className={`mt-0.5 font-mono text-sm font-bold ${
                              m.netLiters >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {m.netLiters > 0 ? '+' : ''}
                            {formatNumber(m.netLiters, 1)}{' '}
                            <span className="text-[10px] font-normal text-slate-500">ลิตร</span>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {m.netLiters >= 0 ? 'รับเข้ามากกว่าจ่าย' : 'จ่ายออกมากกว่ารับ'}
                          </div>
                        </div>

                        {/* Drill-down Toggle Button */}
                        <div className="flex items-center justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMonth(m.monthKey);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                              isMonthExpanded
                                ? 'bg-blue-600 text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            <span>{isMonthExpanded ? 'ซ่อนรายวัน' : 'คลิกดูรายวัน'}</span>
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

                  {/* Expanded Daily Breakdown ("วันไหนบ้าง ที่รับเข้า จ่ายออก") */}
                  {isMonthExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50/50 p-3 sm:p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                          <Calendar className="h-4 w-4 text-blue-600" />
                          <span>
                            รายละเอียดวันที่มีการ รับเข้า-จ่ายออก ประจำเดือน {m.monthTitle} ({m.days.length} วัน)
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          คลิกที่วันเพื่อดูรายละเอียดแต่ละเที่ยว (ID, เวลา, รถ, คนขับ, ผู้จ่าย)
                        </div>
                      </div>

                      {/* Day Cards List */}
                      <div className="space-y-2.5">
                        {m.days.map((d) => {
                          const isDayExpanded = expandedDays[d.ymd] ?? true;

                          return (
                            <div
                              key={d.ymd}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs transition-shadow hover:shadow-xs"
                            >
                              {/* Day Header Row */}
                              <div
                                onClick={() => toggleDay(d.ymd)}
                                className={`cursor-pointer px-3.5 py-2.5 transition-colors ${
                                  isDayExpanded ? 'bg-slate-100/70 border-b border-slate-200' : 'bg-white hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  {/* Left: Date & Weekday */}
                                  <div className="flex items-center gap-2.5">
                                    <button
                                      type="button"
                                      className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:text-slate-800"
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

                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-xs sm:text-sm text-slate-900">
                                          {d.weekdayThai}ที่ {d.dateDisplay}
                                        </span>
                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                                          {d.records.length} รายการ
                                        </span>
                                      </div>
                                      {d.vehicles.length > 0 && (
                                        <div className="mt-0.5 text-[11px] text-slate-500 truncate max-w-md">
                                          รถที่เข้าเติม: {d.vehicles.slice(0, 4).join(', ')}
                                          {d.vehicles.length > 4 ? ` และอีก ${d.vehicles.length - 4} คัน` : ''}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right: Day Totals */}
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    {d.inLiters > 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-800 border border-emerald-200 font-semibold">
                                        <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                                        รับเข้า: {formatNumber(d.inLiters, 1)} ล.
                                        <span className="text-[10px] font-normal text-emerald-600">
                                          ({d.inCount} ครั้ง)
                                        </span>
                                      </span>
                                    )}

                                    {d.outLiters > 0 && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-blue-800 border border-blue-200 font-semibold">
                                        <ArrowUpRight className="h-3 w-3 text-blue-600" />
                                        จ่ายออก: {formatNumber(d.outLiters, 1)} ล.
                                        <span className="text-[10px] font-normal text-blue-600">
                                          ({d.outCount} ครั้ง)
                                        </span>
                                      </span>
                                    )}

                                    <span
                                      className={`rounded-md px-2 py-1 font-mono font-bold text-xs ${
                                        d.netLiters >= 0
                                          ? 'bg-slate-100 text-slate-800'
                                          : 'bg-rose-50 text-rose-700'
                                      }`}
                                      title="คงเหลือสุทธิประจำวัน (รับ - จ่าย)"
                                    >
                                      สุทธิ: {d.netLiters > 0 ? '+' : ''}
                                      {formatNumber(d.netLiters, 1)} ล.
                                    </span>
                                  </div>
                                </div>
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
