import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Phone,
  Truck,
  Building2,
  BadgeCheck,
  X,
  Download,
  Eye,
  IdCard,
} from 'lucide-react';
import {
  EmployeeAccountRecord,
  fetchEmployeeAccounts,
} from '../services/googleSheets';
import { DrivePhotoImg } from './DrivePhotoImg';

export const EmployeeManagementView: React.FC = () => {
  const [employees, setEmployees] = useState<EmployeeAccountRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');
  const [selectedEmployee, setSelectedEmployee] =
    useState<EmployeeAccountRecord | null>(null);

  const loadEmployees = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await fetchEmployeeAccounts({ forceRefresh });
      setEmployees(data);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการดึงข้อมูลพนักงานจากชีต Account'
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadEmployees(false);
  }, [loadEmployees]);

  const positionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    employees.forEach((emp) => {
      const pos = emp.position.trim() || 'User';
      counts.set(pos, (counts.get(pos) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedPosition !== 'ALL') {
        if (emp.position.trim().toLowerCase() !== selectedPosition.toLowerCase()) {
          return false;
        }
      }
      if (!q) return true;
      return (
        emp.employeeCode.toLowerCase().includes(q) ||
        emp.fullName.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q) ||
        emp.position.toLowerCase().includes(q) ||
        emp.phone.toLowerCase().includes(q) ||
        emp.username.toLowerCase().includes(q) ||
        emp.assignedVehicle.toLowerCase().includes(q) ||
        emp.id.toLowerCase().includes(q)
      );
    });
  }, [employees, searchQuery, selectedPosition]);

  const summaryMetrics = useMemo(() => {
    const total = employees.length;
    let adminOrManagerCount = 0;
    let userCount = 0;
    let withVehicleOrPhoneCount = 0;

    employees.forEach((emp) => {
      const posUpper = emp.position.trim().toUpperCase();
      if (posUpper === 'MANAGER' || posUpper === 'ADMIN') {
        adminOrManagerCount += 1;
      } else {
        userCount += 1;
      }
      if (
        (emp.assignedVehicle && emp.assignedVehicle !== '-') ||
        (emp.phone && emp.phone !== '-')
      ) {
        withVehicleOrPhoneCount += 1;
      }
    });

    return {
      total,
      adminOrManagerCount,
      userCount,
      withVehicleOrPhoneCount,
    };
  }, [employees]);

  const renderPositionBadge = (position: string) => {
    const p = position.trim();
    const upper = p.toUpperCase();
    if (upper === 'MANAGER') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-bold text-purple-800">
          <ShieldCheck className="h-3 w-3 text-purple-600" />
          <span>Manager (ผู้จัดการ)</span>
        </span>
      );
    }
    if (upper === 'ADMIN') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-800">
          <BadgeCheck className="h-3 w-3 text-sky-600" />
          <span>ADMIN (ผู้ดูแลระบบ)</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        <UserCheck className="h-3 w-3 text-emerald-600" />
        <span>{p || 'User'} (พนักงานปฏิบัติการ)</span>
      </span>
    );
  };

  const handleExportCsv = () => {
    if (filteredEmployees.length === 0) return;
    const headers = [
      'ลำดับ',
      'รหัสพนักงาน',
      'ชื่อ-นามสกุล',
      'Username',
      'แผนก / พื้นที่ปฏิบัติงาน',
      'ตำแหน่ง / สิทธิ์ระบบ',
      'เบอร์โทรศัพท์',
      'รถประจำตัว',
    ];
    const lines = [
      headers.map((h) => `"${h}"`).join(','),
      ...filteredEmployees.map((emp, idx) =>
        [
          String(idx + 1),
          emp.employeeCode,
          emp.fullName,
          emp.username,
          emp.department,
          emp.position,
          emp.phone,
          emp.assignedVehicle,
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Account_Employees_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 4 KPI Summary Cards */}
      <div className="relative rounded-2xl bg-gradient-to-br from-slate-100/90 via-sky-50/50 to-indigo-50/40 p-2 sm:p-3 border border-white/80 shadow-xs">
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5 lg:grid-cols-4">
          {/* Card 1: พนักงานทั้งหมด */}
          <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/85 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-xs ring-1 ring-slate-200/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-600">
                  1. พนักงานทั้งหมดในระบบ
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl tabular-nums">
                  <span>
                    {isLoading
                      ? '...'
                      : summaryMetrics.total.toLocaleString('th-TH')}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">
                    คน
                  </span>
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-900 text-amber-300">
                <Users className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 truncate text-[11px] font-medium text-slate-500">
              ดึงข้อมูลจากชีต{' '}
              <span className="font-bold text-slate-700">Account</span> โดยตรง
            </div>
          </div>

          {/* Card 2: พนักงานปฏิบัติการ (User) */}
          <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/85 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-xs ring-1 ring-slate-200/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-600">
                  2. พนักงานปฏิบัติการ (User)
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-emerald-700 sm:text-2xl tabular-nums">
                  <span>
                    {isLoading
                      ? '...'
                      : summaryMetrics.userCount.toLocaleString('th-TH')}
                  </span>
                  <span className="text-xs font-semibold text-emerald-700">
                    คน
                  </span>
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-500/10 text-emerald-700">
                <UserCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 truncate text-[11px] font-medium text-slate-500">
              พนักงานขับรถและเคลื่อนย้ายสินค้า
            </div>
          </div>

          {/* Card 3: ผู้จัดการและแอดมิน (Manager / ADMIN) */}
          <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/85 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-xs ring-1 ring-slate-200/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-600">
                  3. ผู้จัดการ / ผู้ดูแลระบบ
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-sky-700 sm:text-2xl tabular-nums">
                  <span>
                    {isLoading
                      ? '...'
                      : summaryMetrics.adminOrManagerCount.toLocaleString(
                          'th-TH'
                        )}
                  </span>
                  <span className="text-xs font-semibold text-sky-700">คน</span>
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-500/10 text-sky-700">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 truncate text-[11px] font-medium text-slate-500">
              ระดับสิทธิ์ Manager และ ADMIN
            </div>
          </div>

          {/* Card 4: ผูกรถประจำตัว / เบอร์ติดต่อ */}
          <div className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/85 px-3.5 py-3 sm:p-4 backdrop-blur-md shadow-xs ring-1 ring-slate-200/60">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-600">
                  4. ผูกข้อมูลรถประจำตัว / เบอร์โทร
                </div>
                <div className="mt-1.5 flex items-baseline gap-1.5 font-sans text-xl font-extrabold tracking-tight text-amber-700 sm:text-2xl tabular-nums">
                  <span>
                    {isLoading
                      ? '...'
                      : summaryMetrics.withVehicleOrPhoneCount.toLocaleString(
                          'th-TH'
                        )}
                  </span>
                  <span className="text-xs font-semibold text-amber-700">
                    รายการ
                  </span>
                </div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-500/10 text-amber-700">
                <Truck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 truncate text-[11px] font-medium text-slate-500">
              แสดงผลตามตัวกรอง{' '}
              <span className="font-bold text-slate-800 tabular-nums">
                {filteredEmployees.length.toLocaleString('th-TH')}
              </span>{' '}
              คน
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filter Control Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 sm:p-3.5 shadow-2xs space-y-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหารหัสพนักงาน, ชื่อ-นามสกุล, แผนก, ตำแหน่ง, เบอร์โทรศัพท์ หรือรถประจำตัว..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-1.5 pl-9 pr-8 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="ล้างคำค้นหา"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadEmployees(true)}
              disabled={isLoading || isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isLoading || isRefreshing ? 'animate-spin' : ''
                }`}
              />
              <span>ซิงค์ข้อมูล Account</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredEmployees.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>ส่งออก CSV</span>
            </button>
          </div>
        </div>

        {/* Position / Role Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
          <span className="text-[11px] font-semibold text-slate-500 mr-1">
            กรองตามตำแหน่ง/สิทธิ์:
          </span>
          <button
            type="button"
            onClick={() => setSelectedPosition('ALL')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              selectedPosition === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            ทั้งหมด ({employees.length})
          </button>
          {positionOptions.map(([pos, count]) => {
            const active =
              selectedPosition.toLowerCase() === pos.toLowerCase();
            return (
              <button
                key={pos}
                type="button"
                onClick={() =>
                  setSelectedPosition(active ? 'ALL' : pos)
                }
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                {pos} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadEmployees(true)}
            className="rounded bg-red-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-800"
          >
            ลองใหม่
          </button>
        </div>
      )}

      {/* Compact SAP Fiori Style Employee Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <IdCard className="h-4 w-4 text-slate-700" />
            <span className="text-xs sm:text-sm font-bold text-slate-900">
              ตารางรายชื่อพนักงาน (ข้อมูลจากชีต Account)
            </span>
          </div>
          <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
            แสดง {filteredEmployees.length.toLocaleString('th-TH')} /{' '}
            {employees.length.toLocaleString('th-TH')} รายการ
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-xs font-semibold text-slate-600">
                <th className="w-14 px-3 py-2.5 text-center whitespace-nowrap">
                  ลำดับ
                </th>
                <th className="w-20 px-3 py-2.5 whitespace-nowrap">
                  รูปพนักงาน
                </th>
                <th className="px-3 py-2.5 whitespace-nowrap">รหัสพนักงาน</th>
                <th className="px-3 py-2.5 whitespace-nowrap">ชื่อ-นามสกุล</th>
                <th className="px-3 py-2.5 whitespace-nowrap">
                  แผนก / พื้นที่ปฏิบัติงาน
                </th>
                <th className="px-3 py-2.5 whitespace-nowrap">
                  ตำแหน่ง / สิทธิ์ระบบ
                </th>
                <th className="px-3 py-2.5 whitespace-nowrap">เบอร์โทรศัพท์</th>
                <th className="px-3 py-2.5 whitespace-nowrap">รถประจำตัว</th>
                <th className="w-24 px-3 py-2.5 text-center whitespace-nowrap">
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 text-xs sm:text-sm">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-3 py-3">
                      <div className="mx-auto h-4 w-6 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-10 w-10 rounded-lg bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-4 w-20 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-4 w-36 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-4 w-40 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-5 w-24 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-4 w-24 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="h-4 w-16 rounded bg-slate-200" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="mx-auto h-6 w-16 rounded bg-slate-200" />
                    </td>
                  </tr>
                ))
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-slate-500"
                  >
                    ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp, index) => (
                  <tr
                    key={`${emp.id}-${emp.rowNumber}`}
                    onClick={() => setSelectedEmployee(emp)}
                    className="cursor-pointer transition-colors hover:bg-slate-50/90"
                  >
                    <td className="px-3 py-2.5 text-center font-mono text-xs text-slate-500 tabular-nums">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2">
                      {emp.image ? (
                        <DrivePhotoImg
                          src={emp.image}
                          alt={`พนักงาน ${emp.fullName}`}
                          className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-500 font-bold text-xs">
                          {emp.fullName.slice(0, 2)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-800 tabular-nums">
                        {emp.employeeCode}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-slate-900">
                        {emp.fullName}
                      </div>
                      {emp.username && emp.username !== '-' && (
                        <div className="text-[11px] font-mono text-slate-500">
                          Username: {emp.username}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                        <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>{emp.department}</span>
                      </div>
                      {emp.shift && emp.shift !== '-' && (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          กะทำงาน: {emp.shift}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {renderPositionBadge(emp.position)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs">
                      {emp.phone && emp.phone !== '-' ? (
                        <a
                          href={`tel:${emp.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          <span>{emp.phone}</span>
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {emp.assignedVehicle && emp.assignedVehicle !== '-' ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-xs font-bold text-amber-900">
                          <Truck className="h-3 w-3 text-amber-600" />
                          <span>{emp.assignedVehicle}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedEmployee(emp)}
                        className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>ดูข้อมูล</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employee Detail Modal */}
      {selectedEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          onClick={() => setSelectedEmployee(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <IdCard className="h-4 w-4 text-amber-300" />
                <h3 className="text-sm font-bold">ข้อมูลบัญชีพนักงาน (Account)</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-4">
                {selectedEmployee.image ? (
                  <DrivePhotoImg
                    src={selectedEmployee.image}
                    alt={`พนักงาน ${selectedEmployee.fullName}`}
                    className="h-20 w-20 rounded-xl border border-slate-200 object-cover shrink-0 shadow-xs"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-lg font-bold text-slate-600 shrink-0">
                    {selectedEmployee.fullName.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <div className="text-base font-extrabold text-slate-900">
                    {selectedEmployee.fullName}
                  </div>
                  <div>{renderPositionBadge(selectedEmployee.position)}</div>
                  <div className="font-mono text-xs text-slate-500">
                    Account ID: {selectedEmployee.id}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs">
                <div>
                  <div className="text-slate-500 font-medium">รหัสพนักงาน</div>
                  <div className="mt-0.5 font-mono font-bold text-slate-900">
                    {selectedEmployee.employeeCode}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 font-medium">Username</div>
                  <div className="mt-0.5 font-mono font-bold text-slate-900">
                    {selectedEmployee.username}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-slate-500 font-medium">
                    แผนก / พื้นที่ปฏิบัติงาน
                  </div>
                  <div className="mt-0.5 font-semibold text-slate-900">
                    {selectedEmployee.department}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 font-medium">เบอร์โทรศัพท์</div>
                  <div className="mt-0.5 font-mono font-semibold text-slate-900">
                    {selectedEmployee.phone}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 font-medium">รถประจำตัว</div>
                  <div className="mt-0.5 font-mono font-semibold text-slate-900">
                    {selectedEmployee.assignedVehicle}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedEmployee(null)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
