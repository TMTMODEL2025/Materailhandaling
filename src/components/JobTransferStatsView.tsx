import React, { useState, useMemo } from 'react';
import { SheetRow, SheetColumn } from '../types';
import {
  BarChart3,
  Calendar,
  RotateCcw,
  Truck,
  Users,
  Scale,
  Repeat,
  Package,
  Award,
  TrendingUp,
  Info,
} from 'lucide-react';

interface JobTransferStatsViewProps {
  rows: SheetRow[];
  columns?: SheetColumn[];
}

interface DriverStat {
  id: string;
  name: string;
  rounds: number;
  totalWeightKg: number;
}

interface VehicleStat {
  vehicleNo: string;
  rounds: number;
  totalWeightKg: number;
}

interface ProductStat {
  productType: string;
  rounds: number;
  totalWeightKg: number;
  percentage: number;
}

function parseRowDateToYmd(dateStr: string): string | null {
  if (!dateStr) return null;
  const trimmed = String(dateStr).trim();
  if (!trimmed) return null;

  // 1. Check Date(YYYY, M, D) gviz format
  const dateObjMatch = trimmed.match(/^Date\((\d+),\s*(\d+),\s*(\d+)/i);
  if (dateObjMatch) {
    let year = parseInt(dateObjMatch[1], 10);
    let month = parseInt(dateObjMatch[2], 10) + 1;
    let day = parseInt(dateObjMatch[3], 10);
    if (year > 2400) year -= 543;
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // 2. Check DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    let day = parseInt(match[1], 10);
    let month = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // 3. Check YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    let year = parseInt(isoMatch[1], 10);
    if (year > 2400) year -= 543;
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function formatWeight(kg: number): string {
  const tons = kg / 1000;
  if (tons >= 1) {
    return `${tons.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ตัน (${kg.toLocaleString('th-TH')} กก.)`;
  }
  return `${kg.toLocaleString('th-TH')} กก.`;
}

export const JobTransferStatsView: React.FC<JobTransferStatsViewProps> = ({ rows, columns }) => {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('all');

  // Column IDs
  const dateColId = columns?.find((c) => c.label.includes('วันที่'))?.id ?? 'A';
  const driverIdColId = columns?.find((c) => c.label.includes('รหัสพนักงาน'))?.id ?? 'B';
  const driverNameColId = columns?.find((c) => c.label.includes('ชื่อพนักงาน'))?.id ?? 'C';
  const vehicleColId = columns?.find((c) => c.label.includes('เบอร์รถ'))?.id ?? 'D';
  const productColId = columns?.find((c) => c.label.includes('ประเภทสินค้า'))?.id ?? 'F';
  const weightColId = columns?.find((c) => c.label.includes('น้ำหนัก'))?.id ?? 'G';

  // Preset filter helper
  const handleSetPreset = (preset: 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'all') => {
    setActivePreset(preset);
    const now = new Date();
    const formatYmd = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
      return;
    }

    if (preset === 'today') {
      const ymd = formatYmd(now);
      setStartDate(ymd);
      setEndDate(ymd);
      return;
    }

    if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const ymd = formatYmd(y);
      setStartDate(ymd);
      setEndDate(ymd);
      return;
    }

    if (preset === 'last7') {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      setStartDate(formatYmd(start));
      setEndDate(formatYmd(now));
      return;
    }

    if (preset === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(formatYmd(start));
      setEndDate(formatYmd(now));
      return;
    }
  };

  // Filtered rows based on date range
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const rawDate = r.values[dateColId] ?? r.values['A'] ?? '';
      const ymd = parseRowDateToYmd(rawDate);
      if (!ymd) return true; // if no date, include or exclude? Better include if no filter, or exclude if filtered. Let's include if date cannot be parsed only when 'all'
      if (startDate && ymd < startDate) return false;
      if (endDate && ymd > endDate) return false;
      return true;
    });
  }, [rows, dateColId, startDate, endDate]);

  // Summary Metrics & Breakdowns
  const { totalRounds, totalWeightKg, activeDriversCount, activeVehiclesCount, driverStats, vehicleStats, productStats } = useMemo(() => {
    let rounds = filteredRows.length;
    let weightKg = 0;
    const driverMap = new Map<string, { name: string; rounds: number; weight: number }>();
    const vehicleMap = new Map<string, { rounds: number; weight: number }>();
    const productMap = new Map<string, { rounds: number; weight: number }>();

    filteredRows.forEach((r) => {
      // Weight
      const rawW = r.rawValues[weightColId] ?? r.rawValues['G'];
      let wVal = 0;
      if (typeof rawW === 'number') {
        wVal = rawW;
      } else {
        wVal = parseFloat(String(r.values[weightColId] ?? r.values['G'] ?? '').replace(/,/g, '').trim()) || 0;
      }
      weightKg += wVal;

      // Driver
      const dId = (r.values[driverIdColId] ?? r.values['B'] ?? '').trim();
      const dName = (r.values[driverNameColId] ?? r.values['C'] ?? '').trim();
      const dKey = dId ? `${dId} - ${dName}` : dName || 'ไม่ระบุพนักงาน';
      if (!driverMap.has(dKey)) {
        driverMap.set(dKey, { name: dName || dId || 'ไม่ระบุ', rounds: 0, weight: 0 });
      }
      const dEntry = driverMap.get(dKey)!;
      dEntry.rounds += 1;
      dEntry.weight += wVal;

      // Vehicle
      const vNo = (r.values[vehicleColId] ?? r.values['D'] ?? '').trim() || 'ไม่ระบุเบอร์รถ';
      if (!vehicleMap.has(vNo)) {
        vehicleMap.set(vNo, { rounds: 0, weight: 0 });
      }
      const vEntry = vehicleMap.get(vNo)!;
      vEntry.rounds += 1;
      vEntry.weight += wVal;

      // Product Type
      const pType = (r.values[productColId] ?? r.values['F'] ?? '').trim() || 'ไม่ระบุประเภทสินค้า';
      if (!productMap.has(pType)) {
        productMap.set(pType, { rounds: 0, weight: 0 });
      }
      const pEntry = productMap.get(pType)!;
      pEntry.rounds += 1;
      pEntry.weight += wVal;
    });

    const drivers: DriverStat[] = Array.from(driverMap.entries()).map(([key, val]) => ({
      id: key,
      name: val.name,
      rounds: val.rounds,
      totalWeightKg: val.weight,
    })).sort((a, b) => b.rounds - a.rounds || b.totalWeightKg - a.totalWeightKg);

    const vehicles: VehicleStat[] = Array.from(vehicleMap.entries()).map(([vNo, val]) => ({
      vehicleNo: vNo,
      rounds: val.rounds,
      totalWeightKg: val.weight,
    })).sort((a, b) => b.rounds - a.rounds || b.totalWeightKg - a.totalWeightKg);

    const products: ProductStat[] = Array.from(productMap.entries()).map(([pType, val]) => ({
      productType: pType,
      rounds: val.rounds,
      totalWeightKg: val.weight,
      percentage: weightKg > 0 ? (val.weight / weightKg) * 100 : rounds > 0 ? (val.rounds / rounds) * 100 : 0,
    })).sort((a, b) => b.totalWeightKg - a.totalWeightKg || b.rounds - a.rounds);

    return {
      totalRounds: rounds,
      totalWeightKg: weightKg,
      activeDriversCount: driverMap.size,
      activeVehiclesCount: vehicleMap.size,
      driverStats: drivers,
      vehicleStats: vehicles,
      productStats: products,
    };
  }, [filteredRows, driverIdColId, driverNameColId, vehicleColId, productColId, weightColId]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Date Filter Bar */}
      <div className="rounded-2xl border border-white/80 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-4 sm:p-5 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                สถิติการขนย้ายสินค้า
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-400/30">
                  Dashboard & Analytics
                </span>
              </h2>
              <p className="text-xs text-slate-300">
                สรุปสถิติรอบการทำงาน พนักงาน รถ และประเภทสินค้าจากการขนย้ายจริง
              </p>
            </div>
          </div>

          {/* Preset Buttons & Date Pickers */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-slate-800/90 p-1 border border-slate-700/80 text-xs">
              <button
                type="button"
                onClick={() => handleSetPreset('today')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${activePreset === 'today' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                วันนี้
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset('yesterday')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${activePreset === 'yesterday' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                เมื่อวาน
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset('last7')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${activePreset === 'last7' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                7 วันล่าสุด
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset('thisMonth')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${activePreset === 'thisMonth' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                เดือนนี้
              </button>
              <button
                type="button"
                onClick={() => handleSetPreset('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${activePreset === 'all' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                ทั้งหมด
              </button>
            </div>

            {/* Custom Date Inputs */}
            <div className="flex items-center gap-1.5 rounded-xl bg-slate-800/90 px-3 py-1.5 border border-slate-700/80 text-xs">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="bg-transparent text-xs font-medium text-white focus:outline-none cursor-pointer"
                title="ตั้งแต่วันที่"
              />
              <span className="text-slate-500">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="bg-transparent text-xs font-medium text-white focus:outline-none cursor-pointer"
                title="ถึงวันที่"
              />
            </div>

            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => handleSetPreset('all')}
                className="flex items-center gap-1 rounded-xl bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards (4 Cards) */}
      <div className="grid grid-cols-2 gap-3.5 sm:gap-4 lg:grid-cols-4">
        {/* Card 1: จำนวนรอบการย้ายรวม */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/90 p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all hover:shadow-md">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-amber-400/15 blur-xl" />
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-600">จำนวนรอบการย้ายรวม</div>
              <div className="mt-2 flex items-baseline gap-1.5 font-sans text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                <span>{totalRounds.toLocaleString('th-TH')}</span>
                <span className="text-xs font-semibold text-amber-700">เที่ยว</span>
              </div>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200/70 bg-amber-500/10 text-amber-700">
              <Repeat className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-[11px] font-medium text-slate-500">
            จากข้อมูลการขนย้ายในช่วงเวลาที่เลือก
          </div>
        </div>

        {/* Card 2: น้ำหนักรวมทั้งหมด */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/90 p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all hover:shadow-md">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-400/15 blur-xl" />
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-600">น้ำหนักรวมทั้งหมด</div>
              <div className="mt-2 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                <span>{(totalWeightKg / 1000).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="text-xs font-semibold text-emerald-700">ตัน</span>
              </div>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200/70 bg-emerald-500/10 text-emerald-700">
              <Scale className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-[11px] font-medium text-slate-500 tabular-nums">
            เทียบเท่า {totalWeightKg.toLocaleString('th-TH')} กิโลกรัม
          </div>
        </div>

        {/* Card 3: จำนวนพนักงานที่ปฏิบัติงาน */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/90 p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all hover:shadow-md">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-blue-400/15 blur-xl" />
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-600">พนักงานที่ปฏิบัติงาน</div>
              <div className="mt-2 flex items-baseline gap-1.5 font-sans text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                <span>{activeDriversCount.toLocaleString('th-TH')}</span>
                <span className="text-xs font-semibold text-blue-700">คน</span>
              </div>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-200/70 bg-blue-500/10 text-blue-700">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-[11px] font-medium text-slate-500">
            พนักงานขับรถที่มีรอบวิ่งขนย้าย
          </div>
        </div>

        {/* Card 4: จำนวนรถที่ใช้งาน */}
        <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/90 p-4 backdrop-blur-md shadow-sm ring-1 ring-slate-200/50 transition-all hover:shadow-md">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-indigo-400/15 blur-xl" />
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-600">จำนวนรถที่ใช้งาน</div>
              <div className="mt-2 flex items-baseline gap-1.5 font-sans text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                <span>{activeVehiclesCount.toLocaleString('th-TH')}</span>
                <span className="text-xs font-semibold text-indigo-700">คัน</span>
              </div>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-200/70 bg-indigo-500/10 text-indigo-700">
              <Truck className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-[11px] font-medium text-slate-500">
            รถขนย้ายที่ปฏิบัติงานวิ่งจริง
          </div>
        </div>
      </div>

      {/* 3 Main Statistics Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Section 1: สรุปรอบการทำงานของพนักงานแต่ละคน */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Users className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">สรุปผลงานพนักงานขับรถ (Top Drivers)</h3>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 tabular-nums">
              {driverStats.length} คน
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2.5 font-semibold">#</th>
                  <th className="pb-2.5 font-semibold">รหัส / ชื่อพนักงาน</th>
                  <th className="pb-2.5 font-semibold text-right">จำนวนรอบ</th>
                  <th className="pb-2.5 font-semibold text-right">น้ำหนักรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {driverStats.slice(0, 10).map((d, idx) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="py-2.5 font-mono font-bold text-slate-400 tabular-nums">
                      {idx === 0 ? <Award className="h-4 w-4 text-amber-500 inline" /> : idx + 1}
                    </td>
                    <td className="py-2.5 font-medium text-slate-900">{d.id}</td>
                    <td className="py-2.5 text-right font-mono font-bold text-blue-700 tabular-nums">
                      {d.rounds.toLocaleString('th-TH')} เที่ยว
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-700 tabular-nums">
                      {formatWeight(d.totalWeightKg)}
                    </td>
                  </tr>
                ))}
                {driverStats.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      ไม่พบข้อมูลพนักงานในช่วงเวลานี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: สรุปยอดการย้ายของรถแต่ละคัน */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                <Truck className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">สรุปยอดการใช้งานรถ (Vehicle Performance)</h3>
            </div>
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 tabular-nums">
              {vehicleStats.length} คัน
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2.5 font-semibold">#</th>
                  <th className="pb-2.5 font-semibold">เบอร์รถ</th>
                  <th className="pb-2.5 font-semibold text-right">จำนวนรอบ</th>
                  <th className="pb-2.5 font-semibold text-right">น้ำหนักรวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicleStats.slice(0, 10).map((v, idx) => (
                  <tr key={v.vehicleNo} className="hover:bg-slate-50">
                    <td className="py-2.5 font-mono font-bold text-slate-400 tabular-nums">
                      {idx === 0 ? <Award className="h-4 w-4 text-amber-500 inline" /> : idx + 1}
                    </td>
                    <td className="py-2.5 font-bold text-slate-900">{v.vehicleNo}</td>
                    <td className="py-2.5 text-right font-mono font-bold text-indigo-700 tabular-nums">
                      {v.rounds.toLocaleString('th-TH')} เที่ยว
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-700 tabular-nums">
                      {formatWeight(v.totalWeightKg)}
                    </td>
                  </tr>
                ))}
                {vehicleStats.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      ไม่พบข้อมูลรถในช่วงเวลานี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 3: สรุปปริมาณสินค้าที่ย้ายแยกตามประเภทสินค้า */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Package className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">สรุปสัดส่วนประเภทสินค้า (Product Share)</h3>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 tabular-nums">
            {productStats.length} ประเภทสินค้า
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2.5 font-semibold">ประเภทสินค้า</th>
                  <th className="pb-2.5 font-semibold text-right">จำนวนรอบ</th>
                  <th className="pb-2.5 font-semibold text-right">น้ำหนักรวม</th>
                  <th className="pb-2.5 font-semibold text-right">สัดส่วน (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {productStats.map((p) => (
                  <tr key={p.productType} className="hover:bg-slate-50">
                    <td className="py-2.5 font-semibold text-slate-900">{p.productType}</td>
                    <td className="py-2.5 text-right font-mono text-slate-700 tabular-nums">
                      {p.rounds.toLocaleString('th-TH')} เที่ยว
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-700 tabular-nums">
                      {formatWeight(p.totalWeightKg)}
                    </td>
                    <td className="py-2.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      {p.percentage.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {productStats.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      ไม่พบข้อมูลประเภทสินค้าในช่วงเวลานี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Visual Progress Bars */}
          <div className="flex flex-col justify-center space-y-3.5 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="text-xs font-bold text-slate-700 mb-1">สัดส่วนน้ำหนักตามประเภทสินค้า</div>
            {productStats.map((p, i) => {
              const colors = [
                'bg-emerald-600',
                'bg-blue-600',
                'bg-amber-600',
                'bg-indigo-600',
                'bg-violet-600',
                'bg-rose-600',
                'bg-teal-600',
              ];
              const colorClass = colors[i % colors.length];
              return (
                <div key={p.productType} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{p.productType}</span>
                    <span className="font-mono font-bold text-slate-700 tabular-nums">
                      {p.percentage.toFixed(1)}% ({formatWeight(p.totalWeightKg)})
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                      style={{ width: `${Math.max(p.percentage, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
