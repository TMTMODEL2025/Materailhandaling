import React, { useState, useMemo } from 'react';
import { SheetRow, SheetColumn } from '../types';
import {
  Calendar,
  RotateCcw,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Filter,
  Info,
} from 'lucide-react';

interface FuelChartsProps {
  rows: SheetRow[];
  columns?: SheetColumn[];
  startDate?: string;
  endDate?: string;
  onStartDateChange?: (date: string) => void;
  onEndDateChange?: (date: string) => void;
  onClearDateFilter?: () => void;
}

interface DateAggregate {
  ymd: string;
  displayDate: string;
  dieselLiters: number;
  benzeneLiters: number;
  otherLiters: number;
  totalLiters: number;
  dieselCount: number;
  benzeneCount: number;
  otherCount: number;
  totalCount: number;
}

function parseRowDateToYmd(dateStr: string): string | null {
  if (!dateStr) return null;
  const trimmed = String(dateStr).trim();
  if (!trimmed) return null;

  // 1. Check Date(YYYY, M, D) gviz format
  const dateObjMatch = trimmed.match(/^Date\((\d+),\s*(\d+),\s*(\d+)/i);
  if (dateObjMatch) {
    let year = parseInt(dateObjMatch[1], 10);
    let month = parseInt(dateObjMatch[2], 10) + 1; // 0-indexed month in Date(...)
    let day = parseInt(dateObjMatch[3], 10);
    if (year > 2400) year -= 543;
    if (year < 100) year += 2000;
    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return `${yStr}-${mStr}-${dStr}`;
  }

  // 2. Check DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    let day = parseInt(match[1], 10);
    let month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return `${yStr}-${mStr}-${dStr}`;
  }

  // 3. Check YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    let year = parseInt(isoMatch[1], 10);
    if (year > 2400) year -= 543;
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    const yStr = String(year);
    const mStr = String(month).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    return `${yStr}-${mStr}-${dStr}`;
  }

  return null;
}

function formatYmdToThaiDisplay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const shortYear = (y + 543) % 100;
  return `${d} ${thaiMonths[m - 1]} ${shortYear}`;
}

export const FuelCharts: React.FC<FuelChartsProps> = ({
  rows,
  columns,
  startDate: controlledStartDate,
  endDate: controlledEndDate,
  onStartDateChange,
  onEndDateChange,
  onClearDateFilter,
}) => {
  const [internalStartDate, setInternalStartDate] = useState<string>('');
  const [internalEndDate, setInternalEndDate] = useState<string>('');
  const [hoveredInDate, setHoveredInDate] = useState<DateAggregate | null>(null);
  const [hoveredOutDate, setHoveredOutDate] = useState<DateAggregate | null>(null);

  const startDate = controlledStartDate !== undefined ? controlledStartDate : internalStartDate;
  const endDate = controlledEndDate !== undefined ? controlledEndDate : internalEndDate;

  const setStartDate = (val: string) => {
    if (onStartDateChange) {
      onStartDateChange(val);
    } else {
      setInternalStartDate(val);
    }
  };

  const setEndDate = (val: string) => {
    if (onEndDateChange) {
      onEndDateChange(val);
    } else {
      setInternalEndDate(val);
    }
  };

  const fuelTypeColId =
    columns?.find((c) => c.label.includes('ชนิดน้ำมัน'))?.id ?? 'D';
  const dateColId =
    columns?.find((c) => c.label.includes('วันที่'))?.id ?? 'B';
  const inColId =
    columns?.find((c) => c.label.includes('รับเข้า'))?.id ?? 'E';
  const outColId =
    columns?.find((c) => c.label.includes('จ่ายออก'))?.id ?? 'G';

  // Preset Date Filter Helpers
  const handleSetPreset = (days: number | 'thisMonth') => {
    const end = new Date();
    let start = new Date();

    if (days === 'thisMonth') {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else {
      start.setDate(end.getDate() - days + 1);
    }

    const formatYmd = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    setStartDate(formatYmd(start));
    setEndDate(formatYmd(end));
  };

  const handleClearFilter = () => {
    if (onClearDateFilter) {
      onClearDateFilter();
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  // Aggregated Inflow & Outflow data grouped by Date
  const { inflowData, outflowData, dateRangeLabel } = useMemo(() => {
    const inMap: Record<string, DateAggregate> = {};
    const outMap: Record<string, DateAggregate> = {};

    rows.forEach((r) => {
      const rawDateStr = r.values[dateColId] ?? r.values['B'] ?? '';
      const ymd = parseRowDateToYmd(rawDateStr);
      if (!ymd) return;

      // Filter by Date Range if specified
      if (startDate && ymd < startDate) return;
      if (endDate && ymd > endDate) return;

      const fType = (r.values[fuelTypeColId] ?? r.values['D'] ?? '').trim();
      const isBenzene =
        fType.includes('เบน') ||
        fType.includes('ซิน') ||
        fType.includes('ซิล') ||
        fType.toLowerCase().includes('benzene') ||
        fType.includes('โซฮอล์');
      const isDiesel = !isBenzene;

      // Check Liters In
      const inRaw = r.rawValues[inColId] ?? r.rawValues['E'];
      let inVal =
        typeof inRaw === 'number'
          ? inRaw
          : parseFloat(
              String(r.values[inColId] ?? r.values['E'] ?? '').replace(/,/g, '').trim()
            );

      if (!Number.isNaN(inVal) && inVal > 0) {
        if (!inMap[ymd]) {
          inMap[ymd] = {
            ymd,
            displayDate: formatYmdToThaiDisplay(ymd),
            dieselLiters: 0,
            benzeneLiters: 0,
            otherLiters: 0,
            totalLiters: 0,
            dieselCount: 0,
            benzeneCount: 0,
            otherCount: 0,
            totalCount: 0,
          };
        }
        inMap[ymd].totalLiters += inVal;
        inMap[ymd].totalCount += 1;
        if (isBenzene) {
          inMap[ymd].benzeneLiters += inVal;
          inMap[ymd].benzeneCount += 1;
        } else {
          inMap[ymd].dieselLiters += inVal;
          inMap[ymd].dieselCount += 1;
        }
      }

      // Check Liters Out
      const outRaw = r.rawValues[outColId] ?? r.rawValues['G'];
      let outVal =
        typeof outRaw === 'number'
          ? outRaw
          : parseFloat(
              String(r.values[outColId] ?? r.values['G'] ?? '').replace(/,/g, '').trim()
            );

      if (!Number.isNaN(outVal) && outVal > 0) {
        if (!outMap[ymd]) {
          outMap[ymd] = {
            ymd,
            displayDate: formatYmdToThaiDisplay(ymd),
            dieselLiters: 0,
            benzeneLiters: 0,
            otherLiters: 0,
            totalLiters: 0,
            dieselCount: 0,
            benzeneCount: 0,
            otherCount: 0,
            totalCount: 0,
          };
        }
        outMap[ymd].totalLiters += outVal;
        outMap[ymd].totalCount += 1;
        if (isBenzene) {
          outMap[ymd].benzeneLiters += outVal;
          outMap[ymd].benzeneCount += 1;
        } else {
          outMap[ymd].dieselLiters += outVal;
          outMap[ymd].dieselCount += 1;
        }
      }
    });

    const sortFn = (a: DateAggregate, b: DateAggregate) =>
      a.ymd.localeCompare(b.ymd);

    const sortedIn = Object.values(inMap).sort(sortFn);
    const sortedOut = Object.values(outMap).sort(sortFn);

    let label = 'ข้อมูลทั้งหมด';
    if (startDate && endDate) {
      label = `${formatYmdToThaiDisplay(startDate)} - ${formatYmdToThaiDisplay(endDate)}`;
    } else if (startDate) {
      label = `ตั้งแต่วันที่ ${formatYmdToThaiDisplay(startDate)}`;
    } else if (endDate) {
      label = `ถึงวันที่ ${formatYmdToThaiDisplay(endDate)}`;
    }

    return {
      inflowData: sortedIn,
      outflowData: sortedOut,
      dateRangeLabel: label,
    };
  }, [rows, dateColId, fuelTypeColId, inColId, outColId, startDate, endDate]);

  // Helper renderer for Grouped Bar Chart Card
  const renderGroupedBarChart = (
    title: string,
    icon: React.ReactNode,
    data: DateAggregate[],
    dieselColor: string,
    benzeneColor: string,
    dieselBg: string,
    benzeneBg: string,
    hoveredItem: DateAggregate | null,
    setHoveredItem: (item: DateAggregate | null) => void,
    accentBorder: string
  ) => {
    const totalVolume = data.reduce((sum, d) => sum + d.totalLiters, 0);
    const totalTransactions = data.reduce((sum, d) => sum + d.totalCount, 0);

    const maxVal = Math.max(
      ...data.map((d) => Math.max(d.dieselLiters, d.benzeneLiters, d.otherLiters)),
      100
    );

    // Calculate Y-axis ticks
    const yTicks = [
      0,
      Math.round((maxVal * 0.33) / 10) * 10,
      Math.round((maxVal * 0.66) / 10) * 10,
      Math.ceil(maxVal / 10) * 10,
    ];

    return (
      <div className={`relative flex flex-col rounded-2xl border border-white/70 bg-white/85 p-4 sm:p-5 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all ${accentBorder}`}>
        {/* Card Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              {icon}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">{title}</h3>
              <p className="text-[11px] font-medium text-slate-500">{dateRangeLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 font-sans text-xs">
            <div className="text-right">
              <div className="font-extrabold text-slate-900 tabular-nums">
                {totalVolume.toLocaleString('th-TH')}{' '}
                <span className="text-[11px] font-semibold text-slate-500">ลิตร</span>
              </div>
              <div className="text-[10px] font-medium text-slate-400 tabular-nums">
                ({totalTransactions.toLocaleString('th-TH')} ครั้ง)
              </div>
            </div>
          </div>
        </div>

        {/* Chart Legend */}
        <div className="flex items-center justify-between pt-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-xs shadow-2xs" style={{ backgroundColor: dieselColor }} />
              <span className="text-xs font-semibold text-slate-700">ดีเซล</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-xs shadow-2xs" style={{ backgroundColor: benzeneColor }} />
              <span className="text-xs font-semibold text-slate-700">เบนซิน</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            {data.length > 0 ? `${data.length} วันที่มีรายการ` : 'ไม่มีข้อมูลในช่วงเวลานี้'}
          </span>
        </div>

        {/* Chart Viewport */}
        {data.length === 0 ? (
          <div className="my-6 flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-slate-400">
            <Info className="mb-2 h-6 w-6 text-slate-300" />
            <p className="text-xs font-medium">ไม่พบข้อมูลตามช่วงวันที่เลือก</p>
            <p className="mt-0.5 text-[11px] text-slate-400">ลองปรับเปลี่ยนตัวกรองวันที่ด้านบน</p>
          </div>
        ) : (
          <div className="relative mt-4 flex-1">
            {/* Interactive Tooltip Card */}
            {hoveredItem && (
              <div className="absolute right-2 top-0 z-20 pointer-events-none rounded-xl border border-slate-700/20 bg-slate-900/90 px-3 py-2 text-white shadow-lg backdrop-blur-md transition-all">
                <div className="text-[11px] font-bold text-slate-300 border-b border-slate-700/60 pb-1 mb-1">
                  📅 {hoveredItem.displayDate}
                </div>
                <div className="space-y-1 font-sans text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dieselColor }} />
                      ดีเซล:
                    </span>
                    <span className="font-bold text-emerald-400 tabular-nums">
                      {hoveredItem.dieselLiters.toLocaleString('th-TH')} ลิตร{' '}
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({hoveredItem.dieselCount} ครั้ง)
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: benzeneColor }} />
                      เบนซิน:
                    </span>
                    <span className="font-bold text-indigo-300 tabular-nums">
                      {hoveredItem.benzeneLiters.toLocaleString('th-TH')} ลิตร{' '}
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({hoveredItem.benzeneCount} ครั้ง)
                      </span>
                    </span>
                  </div>
                  {hoveredItem.otherLiters > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-300">อื่นๆ:</span>
                      <span className="font-bold text-slate-200 tabular-nums">
                        {hoveredItem.otherLiters.toLocaleString('th-TH')} ลิตร
                      </span>
                    </div>
                  )}
                  <div className="border-t border-slate-700/60 pt-1 mt-1 flex items-center justify-between gap-3 font-semibold text-slate-100">
                    <span>รวมทั้งหมด:</span>
                    <span className="tabular-nums">{hoveredItem.totalLiters.toLocaleString('th-TH')} ลิตร</span>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable Chart Area */}
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 pb-2">
              <div
                className="relative flex h-52 items-end gap-2 pt-6 pb-6 pr-2 pl-10"
                style={{ minWidth: Math.max(data.length * 48, 320) }}
              >
                {/* Horizontal Background Grid Lines & Y-Axis Labels */}
                <div className="pointer-events-none absolute inset-x-0 bottom-6 top-6 flex flex-col justify-between">
                  {[...yTicks].reverse().map((tick, i) => (
                    <div key={i} className="relative flex items-center">
                      <span className="absolute -left-9 text-[10px] font-semibold text-slate-400 tabular-nums">
                        {tick.toLocaleString('th-TH')}
                      </span>
                      <div className="w-full border-b border-dashed border-slate-200/80" />
                    </div>
                  ))}
                </div>

                {/* Bars per Date */}
                {data.map((item) => {
                  const dieselHeightPct = Math.min(
                    Math.max((item.dieselLiters / maxVal) * 100, item.dieselLiters > 0 ? 4 : 0),
                    100
                  );
                  const benzeneHeightPct = Math.min(
                    Math.max((item.benzeneLiters / maxVal) * 100, item.benzeneLiters > 0 ? 4 : 0),
                    100
                  );

                  const isHovered = hoveredItem?.ymd === item.ymd;

                  return (
                    <div
                      key={item.ymd}
                      onMouseEnter={() => setHoveredItem(item)}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={`group relative flex flex-1 flex-col items-center h-full justify-end cursor-pointer rounded-lg px-1 transition-all duration-150 ${
                        isHovered ? 'bg-slate-100/80 shadow-2xs' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      {/* Grouped Bars */}
                      <div className="flex h-full w-full items-end justify-center gap-1">
                        {/* Diesel Bar */}
                        <div
                          className="w-1/2 max-w-[18px] rounded-t-md transition-all duration-300 group-hover:brightness-110 shadow-2xs"
                          style={{
                            height: `${dieselHeightPct}%`,
                            backgroundColor: dieselColor,
                          }}
                        />
                        {/* Benzene Bar */}
                        <div
                          className="w-1/2 max-w-[18px] rounded-t-md transition-all duration-300 group-hover:brightness-110 shadow-2xs"
                          style={{
                            height: `${benzeneHeightPct}%`,
                            backgroundColor: benzeneColor,
                          }}
                        />
                      </div>

                      {/* X-Axis Date Label */}
                      <span className="mt-2 truncate text-[10px] font-medium text-slate-500 transition-colors group-hover:font-bold group-hover:text-slate-900">
                        {item.displayDate}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-6 space-y-4">
      {/* Date Filter & Control Bar */}
      <div className="rounded-2xl border border-white/80 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-3.5 sm:p-4 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                กราฟแสดงแนวโน้มปริมาณน้ำมัน
                <span className="hidden sm:inline-block rounded-md bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-300 border border-blue-400/30">
                  ชนิดน้ำมัน ดีเซล / เบนซิน
                </span>
              </h2>
              <p className="text-[11px] text-slate-300">
                เลือกช่วงวันที่เพื่อวิเคราะห์ปริมาณการรับเข้า และเบิกจ่ายออก
              </p>
            </div>
          </div>

          {/* Controls: Date Filter & Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Presets */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-800/80 p-1 border border-slate-700/70 text-xs">
              <button
                type="button"
                onClick={() => handleSetPreset(7)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                7 วัน
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset(30)}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                30 วัน
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset('thisMonth')}
                className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                เดือนนี้
              </button>
            </div>

            {/* Custom Date Inputs */}
            <div className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 px-2.5 py-1.5 border border-slate-700/70 text-xs">
              <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-[11px] font-medium text-white focus:outline-none cursor-pointer"
                title="ตั้งแต่วันที่"
              />
              <span className="text-slate-500 text-xs">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-[11px] font-medium text-white focus:outline-none cursor-pointer"
                title="ถึงวันที่"
              />
            </div>

            {/* Clear Filter Button */}
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={handleClearFilter}
                className="flex items-center gap-1 rounded-xl bg-rose-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Side-by-Side Grouped Bar Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chart 1: รับเข้า */}
        {renderGroupedBarChart(
          'ปริมาณน้ำมันรับเข้าสะสม (ลิตร)',
          <TrendingUp className="h-4 w-4 text-emerald-600" />,
          inflowData,
          '#059669', // Emerald Green for Diesel In
          '#6366f1', // Indigo for Benzene In
          'bg-emerald-500',
          'bg-indigo-500',
          hoveredInDate,
          setHoveredInDate,
          'border-emerald-200/80 hover:border-emerald-300'
        )}

        {/* Chart 2: จ่ายออก / เบิกออก */}
        {renderGroupedBarChart(
          'ปริมาณน้ำมันจ่ายออก / เบิกออกสะสม (ลิตร)',
          <TrendingDown className="h-4 w-4 text-amber-600" />,
          outflowData,
          '#d97706', // Amber for Diesel Out
          '#4f46e5', // Violet/Indigo for Benzene Out
          'bg-amber-500',
          'bg-indigo-600',
          hoveredOutDate,
          setHoveredOutDate,
          'border-amber-200/80 hover:border-amber-300'
        )}
      </div>
    </div>
  );
};
