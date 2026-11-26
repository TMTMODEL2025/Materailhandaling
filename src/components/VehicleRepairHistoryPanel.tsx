import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Search,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import { SheetRow } from '../types';
import { fetchRepairHistoryByType } from '../services/googleSheets';
import {
  getRowApprovalStatus,
  parseNumericCell,
  parseThaiDateToTimestamp,
} from '../utils/sheetMetrics';

interface VehicleRepairHistoryPanelProps {
  vehicleNumber: string;
  repairType: string;
  currentRow: SheetRow;
  allLocalRows: SheetRow[];
  defaultExpanded?: boolean;
}

type HistoryTabScope = 'SAME_VEHICLE' | 'OTHER_VEHICLES' | 'ALL_VEHICLES';

function normalizeVehicle(raw: string): string {
  return raw.replace(/\s+/g, '').trim().toUpperCase();
}

function matchesRepairType(rowType: string, selectedType: string): boolean {
  const normRow = rowType.trim().toLowerCase();
  const normSel = selectedType.trim().toLowerCase();
  if (!normRow || !normSel) return false;
  if (normRow === normSel) return true;
  const baseRow = normRow.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const baseSel = normSel.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return baseSel.length > 0 && baseRow === baseSel;
}

function isSameRepairRow(a: SheetRow, b: SheetRow): boolean {
  const seqA = (a.values['A'] ?? '').trim();
  const seqB = (b.values['A'] ?? '').trim();
  if (seqA && seqB) return seqA === seqB;

  const reqA = (a.values['G'] ?? '').trim();
  const reqB = (b.values['G'] ?? '').trim();
  if (reqA && reqB) return reqA === reqB;

  if (a.rowNumber > 0 && b.rowNumber > 0 && a.rowNumber === b.rowNumber) {
    return (
      (a.values['B'] ?? '').trim() === (b.values['B'] ?? '').trim() &&
      (a.values['F'] ?? '').trim() === (b.values['F'] ?? '').trim()
    );
  }
  return false;
}

function getStatusBadge(row: SheetRow): { label: string; className: string } {
  const rawStatus = (row.values['P'] ?? '').trim();
  const approval = getRowApprovalStatus(row);
  const label = rawStatus || approval || '-';

  if (label.includes('ซ่อมเสร็จ') || approval === 'อนุมัติ') {
    return {
      label,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (label.includes('รอคิว') || approval === 'รอคิวซ่อม') {
    return {
      label: rawStatus || 'รอคิวซ่อม',
      className: 'border-orange-200 bg-orange-50 text-orange-700',
    };
  }
  if (label.includes('ไม่อนุมัติ') || label.includes('ยกเลิก')) {
    return {
      label,
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    };
  }
  return {
    label,
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  };
}

export const VehicleRepairHistoryPanel: React.FC<VehicleRepairHistoryPanelProps> = ({
  vehicleNumber,
  repairType,
  currentRow,
  allLocalRows,
  defaultExpanded = true,
}) => {
  const cleanVehicle = vehicleNumber.trim();
  const cleanType = repairType.trim();
  const normVeh = normalizeVehicle(cleanVehicle);

  const [remoteVehicleRows, setRemoteVehicleRows] = useState<SheetRow[]>([]);
  const [remoteTypeRows, setRemoteTypeRows] = useState<SheetRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const [activeScope, setActiveScope] = useState<HistoryTabScope>('SAME_VEHICLE');
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    if (!cleanType) {
      setRemoteVehicleRows([]);
      setRemoteTypeRows([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setSearchTerm('');

    const requests: Promise<void>[] = [];

    // 1. Fetch fleet-wide history for the same repair type (includes other vehicles)
    requests.push(
      fetchRepairHistoryByType(cleanType, {
        limit: 60,
        signal: controller.signal,
      })
        .then((fetched) => {
          if (active) setRemoteTypeRows(fetched);
        })
        .catch(() => {
          if (active) setRemoteTypeRows([]);
        })
    );

    // 2. Fetch vehicle-specific history for the exact current vehicle + repair type
    if (cleanVehicle) {
      requests.push(
        fetchRepairHistoryByType(cleanType, {
          vehicleNumber: cleanVehicle,
          limit: 50,
          signal: controller.signal,
        })
          .then((fetched) => {
            if (active) setRemoteVehicleRows(fetched);
          })
          .catch(() => {
            if (active) setRemoteVehicleRows([]);
          })
      );
    } else {
      setRemoteVehicleRows([]);
    }

    void Promise.all(requests).finally(() => {
      if (active) setIsLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [cleanVehicle, cleanType]);

  // Merge all local + remote rows matching this repairType (excluding the current row itself)
  const { sameVehicleRows, otherVehicleRows, allMatchedRows, otherUniqueVehicleCount } =
    useMemo(() => {
      if (!cleanType) {
        return {
          sameVehicleRows: [] as SheetRow[],
          otherVehicleRows: [] as SheetRow[],
          allMatchedRows: [] as SheetRow[],
          otherUniqueVehicleCount: 0,
        };
      }

      const seen = new Set<string>();
      const merged: SheetRow[] = [];

      const addIfMatch = (row: SheetRow) => {
        if (isSameRepairRow(row, currentRow)) return;
        const rowType = (row.values['E'] ?? '').trim();
        if (!matchesRepairType(rowType, cleanType)) return;
        const sym = (row.values['F'] ?? '').trim();
        const veh = (row.values['D'] ?? '').trim();
        if (!sym && !veh) return;

        const seq = (row.values['A'] ?? '').trim();
        const reqNo = (row.values['G'] ?? '').trim();
        const dedupKey = seq
          ? `seq:${seq}`
          : reqNo
          ? `req:${reqNo}`
          : `row:${row.values['B'] ?? ''}|${normalizeVehicle(veh)}|${sym}`;

        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        merged.push(row);
      };

      allLocalRows.forEach(addIfMatch);
      remoteVehicleRows.forEach(addIfMatch);
      remoteTypeRows.forEach(addIfMatch);

      merged.sort((a, b) => {
        const seqA = parseNumericCell(a.rawValues['A'] ?? a.values['A']);
        const seqB = parseNumericCell(b.rawValues['A'] ?? b.values['A']);
        if (seqA !== seqB) return seqB - seqA;
        const tsA = parseThaiDateToTimestamp(a.values['B'] ?? '') ?? 0;
        const tsB = parseThaiDateToTimestamp(b.values['B'] ?? '') ?? 0;
        if (tsA !== tsB) return tsB - tsA;
        return b.rowNumber - a.rowNumber;
      });

      const same: SheetRow[] = [];
      const others: SheetRow[] = [];
      const otherVehSet = new Set<string>();

      merged.forEach((r) => {
        const rNormVeh = normalizeVehicle(r.values['D'] ?? '');
        if (normVeh && rNormVeh === normVeh) {
          same.push(r);
        } else {
          others.push(r);
          if (rNormVeh) otherVehSet.add(rNormVeh);
        }
      });

      return {
        sameVehicleRows: same,
        otherVehicleRows: others,
        allMatchedRows: merged,
        otherUniqueVehicleCount: otherVehSet.size,
      };
    }, [allLocalRows, remoteVehicleRows, remoteTypeRows, normVeh, cleanType, currentRow]);

  const activeBaseRows = useMemo(() => {
    if (activeScope === 'SAME_VEHICLE') return sameVehicleRows;
    if (activeScope === 'OTHER_VEHICLES') return otherVehicleRows;
    return allMatchedRows;
  }, [activeScope, sameVehicleRows, otherVehicleRows, allMatchedRows]);

  const displayedRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return activeBaseRows;
    return activeBaseRows.filter((r) => {
      const haystack = [
        r.values['B'],
        r.values['D'],
        r.values['F'],
        r.values['G'],
        r.values['P'],
        r.values['AA'],
        r.values['AH'],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activeBaseRows, searchTerm]);

  const activeTotalCost = useMemo(() => {
    return activeBaseRows.reduce((sum, r) => {
      const parts = parseNumericCell(r.rawValues['N'] ?? r.values['N']);
      const labor = parseNumericCell(r.rawValues['O'] ?? r.values['O']);
      return sum + parts + labor;
    }, 0);
  }, [activeBaseRows]);

  if (!cleanType) return null;

  return (
    <div
      className="rounded-xl border border-indigo-200/90 bg-indigo-50/50 p-2.5 sm:p-3"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white">
            <History className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-slate-900">
                ประวัติที่เคยซ่อม
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-900">
                <Wrench className="h-2.5 w-2.5 text-blue-600" />
                <span className="truncate max-w-[160px]">{cleanType}</span>
              </span>
              {cleanVehicle && (
                <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-800">
                  คันนี้ {sameVehicleRows.length} • คันอื่น {otherVehicleRows.length}
                </span>
              )}
              {isLoading && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>กำลังดึงประวัติย้อนหลัง...</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors shrink-0"
        >
          <span>{isExpanded ? 'ซ่อนประวัติ' : 'ดูประวัติ'}</span>
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-2.5 space-y-2">
          {/* Scope Tabs: รถคันนี้ | รถคันอื่น (ประเภทเดียวกัน) | ทุกคัน */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-indigo-200/90 bg-white p-0.5 text-[11px]">
              {cleanVehicle && (
                <button
                  type="button"
                  onClick={() => setActiveScope('SAME_VEHICLE')}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold transition-colors ${
                    activeScope === 'SAME_VEHICLE'
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Truck className="h-3 w-3" />
                  <span>
                    รถคันนี้ {cleanVehicle} ({sameVehicleRows.length})
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveScope('OTHER_VEHICLES')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-bold transition-colors ${
                  activeScope === 'OTHER_VEHICLES'
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-800'
                }`}
              >
                <Users className="h-3 w-3" />
                <span>
                  รถคันอื่น ({otherVehicleRows.length}
                  {otherUniqueVehicleCount > 0 ? ` • ${otherUniqueVehicleCount} คัน` : ''})
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveScope('ALL_VEHICLES')}
                className={`rounded-md px-2 py-1 font-bold transition-colors ${
                  activeScope === 'ALL_VEHICLES'
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                ทุกคัน ({allMatchedRows.length})
              </button>
            </div>

            {activeTotalCost > 0 && (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 tabular-nums">
                ยอดค่าซ่อมสะสม{' '}
                {activeTotalCost.toLocaleString('th-TH', {
                  maximumFractionDigits: 2,
                })}{' '}
                ฿
              </span>
            )}
          </div>

          {/* Search box inside history when there are multiple items */}
          {activeBaseRows.length > 2 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={
                  activeScope === 'SAME_VEHICLE'
                    ? 'ค้นหาอาการที่เคยซ่อมของรถคันนี้...'
                    : 'ค้นหาอาการเดียวกัน หรือ เบอร์รถคันอื่น...'
                }
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}

          {/* History List */}
          {displayedRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-indigo-200 bg-white/80 px-3 py-2.5 text-center text-xs text-slate-500">
              {isLoading ? (
                'กำลังค้นหาประวัติการซ่อมย้อนหลังจากฐานข้อมูล...'
              ) : searchTerm.trim() ? (
                `ไม่พบประวัติที่ตรงกับคำค้นหา "${searchTerm.trim()}"`
              ) : activeScope === 'SAME_VEHICLE' ? (
                <div className="space-y-1.5">
                  <div>
                    รถ {cleanVehicle} ยังไม่เคยมีประวัติการซ่อมประเภท &ldquo;{cleanType}&rdquo; มาก่อน
                  </div>
                  {otherVehicleRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveScope('OTHER_VEHICLES')}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
                    >
                      <Users className="h-3 w-3" />
                      <span>
                        ดูประวัติรถคันอื่นที่ซ่อมประเภทนี้ ({otherVehicleRows.length} รายการ)
                      </span>
                    </button>
                  )}
                </div>
              ) : activeScope === 'OTHER_VEHICLES' ? (
                `ยังไม่พบประวัติรถคันอื่นที่เคยซ่อมประเภท "${cleanType}"`
              ) : (
                `ยังไม่มีประวัติการซ่อมประเภท "${cleanType}" ในระบบ`
              )}
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200/90 bg-white divide-y divide-slate-100 shadow-2xs">
              {displayedRows.slice(0, 40).map((r, idx) => {
                const seq = (r.values['A'] ?? '').trim();
                const reqDate = (r.values['B'] ?? '').trim() || '-';
                const rowVeh = (r.values['D'] ?? '').trim() || '-';
                const isThisVehicle =
                  Boolean(normVeh) && normalizeVehicle(rowVeh) === normVeh;
                const sym = (r.values['F'] ?? '').trim() || '-';
                const reqNo = (r.values['G'] ?? '').trim();
                const completedDate = (r.values['J'] ?? '').trim();
                const reporter = (r.values['AA'] ?? '').trim();
                const rowNote = (r.values['AH'] ?? '').trim();
                const partsCost = parseNumericCell(r.rawValues['N'] ?? r.values['N']);
                const laborCost = parseNumericCell(r.rawValues['O'] ?? r.values['O']);
                const totalCost = partsCost + laborCost;
                const badge = getStatusBadge(r);

                return (
                  <div
                    key={`${seq || r.rowNumber}-${reqNo || idx}`}
                    className="px-2.5 py-2 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="inline-flex items-center gap-1 font-mono font-bold text-slate-700 tabular-nums">
                          <Calendar className="h-3 w-3 text-indigo-500" />
                          {reqDate}
                        </span>
                        {activeScope !== 'SAME_VEHICLE' && (
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-extrabold ${
                              isThisVehicle
                                ? 'bg-slate-900 text-white'
                                : 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                            }`}
                          >
                            <Truck className="h-2.5 w-2.5" />
                            <span>{rowVeh}</span>
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-slate-400">
                          {reqNo || `#${seq || r.rowNumber}`}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.2 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      {totalCost > 0 && (
                        <span className="font-mono text-[11px] font-bold text-emerald-700 tabular-nums">
                          {totalCost.toLocaleString('th-TH', {
                            maximumFractionDigits: 2,
                          })}{' '}
                          ฿
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs font-medium text-slate-800 leading-snug whitespace-pre-line">
                      {sym}
                    </p>

                    {(partsCost > 0 || laborCost > 0 || completedDate || reporter || rowNote) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                        {partsCost > 0 && (
                          <span className="font-mono">
                            อะไหล่{' '}
                            {partsCost.toLocaleString('th-TH', {
                              maximumFractionDigits: 2,
                            })}{' '}
                            ฿
                          </span>
                        )}
                        {laborCost > 0 && (
                          <span className="font-mono">
                            ค่าแรง{' '}
                            {laborCost.toLocaleString('th-TH', {
                              maximumFractionDigits: 2,
                            })}{' '}
                            ฿
                          </span>
                        )}
                        {completedDate && <span>ซ่อมเสร็จ: {completedDate}</span>}
                        {reporter && <span>ผู้แจ้ง: {reporter}</span>}
                        {rowNote && (
                          <span className="truncate max-w-[260px]" title={rowNote}>
                            หมายเหตุ: {rowNote}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {displayedRows.length > 40 && (
                <div className="bg-slate-50 px-3 py-1.5 text-center text-[10px] text-slate-500">
                  แสดงล่าสุด 40 รายการ จากทั้งหมด {displayedRows.length} รายการ
                  (พิมพ์คำค้นหาด้านบนเพื่อกรองเพิ่ม)
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
