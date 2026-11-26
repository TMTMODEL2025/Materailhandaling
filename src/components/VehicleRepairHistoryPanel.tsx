import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Truck,
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

  const [remoteRows, setRemoteRows] = useState<SheetRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  useEffect(() => {
    if (!cleanVehicle || !cleanType) {
      setRemoteRows([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsLoading(true);

    void fetchRepairHistoryByType(cleanType, {
      vehicleNumber: cleanVehicle,
      limit: 50,
      signal: controller.signal,
    })
      .then((fetched) => {
        if (!active) return;
        setRemoteRows(fetched);
      })
      .catch(() => {
        if (!active) return;
        setRemoteRows([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [cleanVehicle, cleanType]);

  const historyRows = useMemo(() => {
    if (!normVeh || !cleanType) return [];
    const seen = new Set<string>();
    const merged: SheetRow[] = [];

    const addIfMatch = (row: SheetRow) => {
      if (isSameRepairRow(row, currentRow)) return;
      const rowVeh = normalizeVehicle(row.values['D'] ?? '');
      if (rowVeh !== normVeh) return;
      const rowType = (row.values['E'] ?? '').trim();
      if (!matchesRepairType(rowType, cleanType)) return;

      const seq = (row.values['A'] ?? '').trim();
      const reqNo = (row.values['G'] ?? '').trim();
      const sym = (row.values['F'] ?? '').trim();
      const dedupKey = seq
        ? `seq:${seq}`
        : reqNo
        ? `req:${reqNo}`
        : `row:${row.values['B'] ?? ''}|${rowVeh}|${sym}`;

      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      merged.push(row);
    };

    allLocalRows.forEach(addIfMatch);
    remoteRows.forEach(addIfMatch);

    return merged.sort((a, b) => {
      const seqA = parseNumericCell(a.rawValues['A'] ?? a.values['A']);
      const seqB = parseNumericCell(b.rawValues['A'] ?? b.values['A']);
      if (seqA !== seqB) return seqB - seqA;
      const tsA = parseThaiDateToTimestamp(a.values['B'] ?? '') ?? 0;
      const tsB = parseThaiDateToTimestamp(b.values['B'] ?? '') ?? 0;
      if (tsA !== tsB) return tsB - tsA;
      return b.rowNumber - a.rowNumber;
    });
  }, [allLocalRows, remoteRows, normVeh, cleanType, currentRow]);

  const totalHistoricalCost = useMemo(() => {
    return historyRows.reduce((sum, r) => {
      const parts = parseNumericCell(r.rawValues['N'] ?? r.values['N']);
      const labor = parseNumericCell(r.rawValues['O'] ?? r.values['O']);
      return sum + parts + labor;
    }, 0);
  }, [historyRows]);

  if (!cleanVehicle || !cleanType) return null;

  return (
    <div className="rounded-xl border border-indigo-200/90 bg-indigo-50/50 p-2.5 sm:p-3">
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
              <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                <Truck className="h-2.5 w-2.5" />
                <span>{cleanVehicle}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-900">
                <Wrench className="h-2.5 w-2.5 text-blue-600" />
                <span className="truncate max-w-[160px]">{cleanType}</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-800">
                เคยซ่อม {historyRows.length} ครั้ง
              </span>
              {totalHistoricalCost > 0 && (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-800 tabular-nums">
                  สะสม{' '}
                  {totalHistoricalCost.toLocaleString('th-TH', {
                    maximumFractionDigits: 2,
                  })}{' '}
                  ฿
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
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((v) => !v);
          }}
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
        <div className="mt-2">
          {historyRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-indigo-200 bg-white/80 px-3 py-2.5 text-center text-xs text-slate-500">
              {isLoading
                ? 'กำลังค้นหาประวัติการซ่อมย้อนหลังจากฐานข้อมูล...'
                : `รถ ${cleanVehicle} ยังไม่เคยมีประวัติการซ่อมประเภท "${cleanType}" มาก่อน`}
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200/90 bg-white divide-y divide-slate-100 shadow-2xs">
              {historyRows.map((r, idx) => {
                const seq = (r.values['A'] ?? '').trim();
                const reqDate = (r.values['B'] ?? '').trim() || '-';
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};
