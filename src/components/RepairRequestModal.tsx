import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X,
  AlertCircle,
  Wrench,
  Send,
  Camera,
  Trash2,
  History,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  CopyPlus,
  Loader2,
  Calendar,
  Truck,
} from 'lucide-react';
import { SheetRow, RepairRequestPayload } from '../types';
import {
  appendRepairRecord,
  clearRepairHistoryByTypeCache,
  fetchRepairHistoryByType,
  processHighResImageFile,
} from '../services/googleSheets';
import {
  getRowApprovalStatus,
  parseNumericCell,
  parseThaiDateToTimestamp,
} from '../utils/sheetMetrics';
import { showSuccessToast } from '../utils/swal';

interface RepairRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  onSavedSuccess: () => void;
}

function getCurrentThaiDateString(): string {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const buddhistYear = now.getFullYear() + 543;
  return `${day}/${month}/${buddhistYear}`;
}

function getCurrentTimeString(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function compressImageFile(file: File): Promise<string> {
  return processHighResImageFile(file);
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

function getRepairHistoryStatusBadge(row: SheetRow): {
  label: string;
  className: string;
} {
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

function generateNextRepairRequestNo(existingRows: SheetRow[]): string {
  const now = new Date();
  const monthStr = String(now.getMonth() + 1).padStart(2, '0');

  let maxSeq = 0;
  existingRows.forEach((r) => {
    const val = (r.values['G'] ?? '').trim();
    if (!val) return;

    // Pattern 1: TMT-FL{month}-{seq} or TMT-FL{month}{seq}
    const matchFl = val.match(new RegExp(`^TMT-FL${monthStr}-?(\\d+)$`, 'i'));
    if (matchFl && matchFl[1]) {
      const num = parseInt(matchFl[1], 10);
      if (num > maxSeq) maxSeq = num;
      return;
    }

    // Pattern 2: Existing sheet pattern TMT{year}-{month}-{seq} e.g. TMT2026-11-0012
    const matchTmt = val.match(new RegExp(`^TMT\\d{4}-${monthStr}-(\\d+)$`, 'i'));
    if (matchTmt && matchTmt[1]) {
      const num = parseInt(matchTmt[1], 10);
      if (num > maxSeq) maxSeq = num;
      return;
    }
  });

  const nextSeq = maxSeq + 1;
  const seqStr = String(nextSeq).padStart(4, '0');
  return `TMT-FL${monthStr}-${seqStr}`;
}

export const RepairRequestModal: React.FC<RepairRequestModalProps> = ({
  isOpen,
  onClose,
  existingRows,
  onSavedSuccess,
}) => {
  const [date, setDate] = useState<string>(getCurrentThaiDateString());
  const [time, setTime] = useState<string>(getCurrentTimeString());
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [repairType, setRepairType] = useState<string>('ซ่อมทั่วไป (MN)');
  const [symptoms, setSymptoms] = useState<string>('');
  const [reporterName, setReporterName] = useState<string>('');
  const [repairRequestNo, setRepairRequestNo] = useState<string>('');
  const [sparePartsCost, setSparePartsCost] = useState<string>('');
  const [laborCost, setLaborCost] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [photos, setPhotos] = useState<string[]>([]);

  const [remoteHistoryRows, setRemoteHistoryRows] = useState<SheetRow[]>([]);
  const [remoteVehicleHistoryRows, setRemoteVehicleHistoryRows] = useState<SheetRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(true);
  const [historyOnlySelectedVehicle, setHistoryOnlySelectedVehicle] =
    useState<boolean>(true);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [copiedHistoryKey, setCopiedHistoryKey] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Extract reference vehicle list and reporters
  const referenceOptions = useMemo(() => {
    const vehicles = new Set<string>();
    const reporters = new Set<string>();
    const repairTypes = new Set<string>([
      'ซ่อมทั่วไป (MN)',
      'ซ่อมเชิงป้องกัน (PM)',
      'ยางเสื่อมสภาพ',
      'ยางรั่ว',
      'ระบบไฟรถ',
      'ระบบเบรค',
      'ระบบช่วงล่าง',
      'ระบบแบตเตอร์รี่',
      'ระบบไดสตาร์ท',
      'ระบบระบายความร้อน',
      'ระบบส่งกำลัง',
      'ระบบเชื้อเพลิง',
      'เครื่องยนต์',
      'ไฮดรอลิค',
      'โครงสร้าง',
      'อื่นๆ',
    ]);

    existingRows.forEach((r) => {
      const veh = (r.values['D'] ?? '').trim();
      const typ = (r.values['E'] ?? '').trim();
      const rep = (r.values['AA'] ?? '').trim();
      if (veh) vehicles.add(veh);
      if (typ) repairTypes.add(typ);
      if (rep) reporters.add(rep);
    });

    return {
      vehicles: Array.from(vehicles),
      reporters: Array.from(reporters),
      repairTypes: Array.from(repairTypes),
    };
  }, [existingRows]);

  const normalizedVehicleInput = vehicleNumber.replace(/\s+/g, '').trim().toUpperCase();
  const displayVehicleLabel = vehicleNumber.trim();

  // Fetch fleet-wide historical records for the selected repairType (cached in memory)
  useEffect(() => {
    if (!isOpen || !repairType.trim()) {
      setRemoteHistoryRows([]);
      setIsLoadingHistory(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsLoadingHistory(true);
    setHistorySearch('');

    void fetchRepairHistoryByType(repairType, {
      signal: controller.signal,
      limit: 60,
    })
      .then((rows) => {
        if (!active) return;
        setRemoteHistoryRows(rows);
      })
      .catch(() => {
        if (!active) return;
        setRemoteHistoryRows([]);
      })
      .finally(() => {
        if (active) setIsLoadingHistory(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, repairType]);

  // Fetch vehicle-specific historical records when a vehicleNumber is chosen (debounced & cached)
  useEffect(() => {
    if (!isOpen || !repairType.trim() || !displayVehicleLabel) {
      setRemoteVehicleHistoryRows([]);
      return;
    }

    const controller = new AbortController();
    let active = true;

    const timer = setTimeout(() => {
      setIsLoadingHistory(true);
      void fetchRepairHistoryByType(repairType, {
        signal: controller.signal,
        limit: 50,
        vehicleNumber: displayVehicleLabel,
      })
        .then((rows) => {
          if (!active) return;
          setRemoteVehicleHistoryRows(rows);
        })
        .catch(() => {
          if (!active) return;
          setRemoteVehicleHistoryRows([]);
        })
        .finally(() => {
          if (active) setIsLoadingHistory(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, repairType, displayVehicleLabel]);

  // Automatically filter history by selected vehicle whenever user enters/changes vehicleNumber
  useEffect(() => {
    setHistoryOnlySelectedVehicle(Boolean(normalizedVehicleInput));
  }, [normalizedVehicleInput]);

  // Merge instant local existingRows + fetched remote rows for the selected repairType
  const matchedHistoryRows = useMemo(() => {
    if (!repairType.trim()) return [];
    const seen = new Set<string>();
    const merged: SheetRow[] = [];

    const addIfMatch = (row: SheetRow) => {
      const rowType = (row.values['E'] ?? '').trim();
      if (!matchesRepairType(rowType, repairType)) return;
      const symptom = (row.values['F'] ?? '').trim();
      const veh = (row.values['D'] ?? '').trim();
      if (!symptom && !veh) return;

      const seq = (row.values['A'] ?? '').trim();
      const reqNo = (row.values['G'] ?? '').trim();
      const dedupKey = seq
        ? `seq:${seq}`
        : reqNo
        ? `req:${reqNo}`
        : `row:${row.values['B'] ?? ''}|${veh}|${symptom}`;

      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      merged.push(row);
    };

    existingRows.forEach(addIfMatch);
    remoteVehicleHistoryRows.forEach(addIfMatch);
    remoteHistoryRows.forEach(addIfMatch);

    return merged.sort((a, b) => {
      const seqA = parseNumericCell(a.rawValues['A'] ?? a.values['A']);
      const seqB = parseNumericCell(b.rawValues['A'] ?? b.values['A']);
      if (seqA !== seqB) return seqB - seqA;
      const tsA = parseThaiDateToTimestamp(a.values['B'] ?? '') ?? 0;
      const tsB = parseThaiDateToTimestamp(b.values['B'] ?? '') ?? 0;
      if (tsA !== tsB) return tsB - tsA;
      return b.rowNumber - a.rowNumber;
    });
  }, [existingRows, remoteVehicleHistoryRows, remoteHistoryRows, repairType]);

  const sameVehicleHistoryCount = useMemo(() => {
    if (!normalizedVehicleInput) return 0;
    return matchedHistoryRows.filter(
      (r) =>
        (r.values['D'] ?? '').replace(/\s+/g, '').trim().toUpperCase() ===
        normalizedVehicleInput
    ).length;
  }, [matchedHistoryRows, normalizedVehicleInput]);

  const filteredHistoryRows = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return matchedHistoryRows.filter((row) => {
      if (historyOnlySelectedVehicle && normalizedVehicleInput) {
        const rowVeh = (row.values['D'] ?? '').replace(/\s+/g, '').trim().toUpperCase();
        if (rowVeh !== normalizedVehicleInput) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        row.values['B'],
        row.values['D'],
        row.values['F'],
        row.values['G'],
        row.values['P'],
        row.values['AA'],
        row.values['AH'],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    matchedHistoryRows,
    historyOnlySelectedVehicle,
    normalizedVehicleInput,
    historySearch,
  ]);

  useEffect(() => {
    if (isOpen) {
      setDate(getCurrentThaiDateString());
      setTime(getCurrentTimeString());
      setSubmitError(null);
      setRepairRequestNo(generateNextRepairRequestNo(existingRows));
    }
  }, [isOpen, existingRows]);

  if (!isOpen) return null;

  const handleUseHistoricalSymptom = (rowKey: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setSymptoms((prev) => {
      const current = prev.trim();
      if (!current) return clean;
      if (current.includes(clean)) return prev;
      return `${current}\n${clean}`;
    });
    setCopiedHistoryKey(rowKey);
    setTimeout(() => {
      setCopiedHistoryKey((curr) => (curr === rowKey ? null : curr));
    }, 1500);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const availableSlots = 9 - photos.length;
    if (availableSlots <= 0) return;

    const selectedFiles = Array.from(files).slice(0, availableSlots);
    const newCompressedPhotos: string[] = [];

    for (const file of selectedFiles) {
      try {
        const compressed = await compressImageFile(file);
        newCompressedPhotos.push(compressed);
      } catch {
        // ignore individual failed compression
      }
    }

    setPhotos((prev) => [...prev, ...newCompressedPhotos]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!vehicleNumber.trim()) {
      setSubmitError('กรุณาระบุเบอร์รถ');
      return;
    }
    if (!repairType.trim()) {
      setSubmitError('กรุณาเลือกประเภทการซ่อม');
      return;
    }
    if (!symptoms.trim()) {
      setSubmitError('กรุณาระบุอาการเสียหรือสิ่งที่ต้องการซ่อม');
      return;
    }
    if (!reporterName.trim()) {
      setSubmitError('กรุณาระบุชื่อผู้แจ้งซ่อม');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: RepairRequestPayload = {
        date: date.trim(),
        time: time.trim() || getCurrentTimeString(),
        vehicleNumber: vehicleNumber.trim(),
        repairType: repairType.trim(),
        symptoms: symptoms.trim(),
        reporterName: reporterName.trim(),
        repairRequestNo: repairRequestNo.trim(),
        sparePartsCost: sparePartsCost.trim(),
        laborCost: laborCost.trim(),
        note: note.trim(),
        photos: photos.length > 0 ? photos : undefined,
      };

      await appendRepairRecord(payload);
      clearRepairHistoryByTypeCache();

      showSuccessToast(
        'บันทึกแจ้งซ่อมสำเร็จ!',
        'ระบบบันทึกรายการแจ้งซ่อมลงฐานข้อมูลเรียบร้อยแล้ว'
      );

      // Reset form
      setSymptoms('');
      setSparePartsCost('');
      setLaborCost('');
      setNote('');
      setRepairRequestNo('');
      setPhotos([]);

      onSavedSuccess();
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกแจ้งซ่อม'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5 sm:py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Wrench className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              บันทึกแจ้งซ่อม
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="mx-4 mt-2.5 sm:mx-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
            {/* วันที่แจ้ง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                วันที่แจ้ง <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="5/11/2569"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* เวลาแจ้ง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เวลาแจ้ง
              </label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="09:30:00"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* เบอร์รถ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เบอร์รถ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="repair-vehicles"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="FL-10, TT-20"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="repair-vehicles">
                {referenceOptions.vehicles.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* ประเภทการซ่อม */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ประเภทการซ่อม <span className="text-red-600">*</span>
              </label>
              <select
                required
                value={repairType}
                onChange={(e) => {
                  setRepairType(e.target.value);
                  setIsHistoryExpanded(true);
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {referenceOptions.repairTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* ประวัติการซ่อมของประเภทและเบอร์รถที่เลือก */}
            {repairType.trim() && (
              <div className="col-span-2 rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-2.5 sm:p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white">
                      <History className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          ประวัติที่เคยซ่อม: {repairType}
                        </span>
                        {normalizedVehicleInput && historyOnlySelectedVehicle && (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                            <Truck className="h-2.5 w-2.5" />
                            <span>{displayVehicleLabel}</span>
                          </span>
                        )}
                        <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-800">
                          {historyOnlySelectedVehicle && normalizedVehicleInput
                            ? sameVehicleHistoryCount
                            : matchedHistoryRows.length}{' '}
                          รายการ
                        </span>
                        {isLoadingHistory && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-600">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>กำลังดึงประวัติเพิ่ม...</span>
                          </span>
                        )}
                      </div>
                      {!normalizedVehicleInput && (
                        <p className="text-[10px] text-slate-500">
                          ระบุเบอร์รถด้านบนเพื่อกรองประวัติเฉพาะรถคันนั้นอัตโนมัติ
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsHistoryExpanded((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors shrink-0"
                  >
                    <span>{isHistoryExpanded ? 'ซ่อนประวัติ' : 'ดูประวัติ'}</span>
                    {isHistoryExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {isHistoryExpanded && (
                  <div className="mt-2.5 space-y-2">
                    {(normalizedVehicleInput || matchedHistoryRows.length > 3) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {normalizedVehicleInput && (
                          <div className="inline-flex rounded-lg border border-indigo-200 bg-white p-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setHistoryOnlySelectedVehicle(true)}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold transition-colors ${
                                historyOnlySelectedVehicle
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              <Truck className="h-3 w-3" />
                              <span>
                                เฉพาะรถ {displayVehicleLabel} ({sameVehicleHistoryCount})
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryOnlySelectedVehicle(false)}
                              className={`rounded-md px-2 py-0.5 font-semibold transition-colors ${
                                !historyOnlySelectedVehicle
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              ทุกคัน ({matchedHistoryRows.length})
                            </button>
                          </div>
                        )}

                        {matchedHistoryRows.length > 3 && (
                          <div className="relative flex-1 min-w-[160px]">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              value={historySearch}
                              onChange={(e) => setHistorySearch(e.target.value)}
                              placeholder="ค้นหาอาการ, เบอร์รถ ในประวัติ..."
                              className="w-full rounded-lg border border-slate-200 bg-white py-1 pl-7 pr-2.5 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {filteredHistoryRows.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-indigo-200 bg-white/80 px-3 py-3 text-center text-xs text-slate-500">
                        {isLoadingHistory
                          ? 'กำลังค้นหาประวัติการซ่อมจากฐานข้อมูล...'
                          : historyOnlySelectedVehicle && normalizedVehicleInput
                          ? `ยังไม่พบประวัติการซ่อมประเภท "${repairType}" ของรถ ${displayVehicleLabel}`
                          : historySearch.trim()
                          ? `ไม่พบประวัติที่ตรงกับคำค้นหา "${historySearch.trim()}"`
                          : `ยังไม่มีประวัติการซ่อมในประเภท "${repairType}"`}
                      </div>
                    ) : (
                      <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200/90 bg-white divide-y divide-slate-100 shadow-2xs">
                        {filteredHistoryRows.slice(0, 30).map((row, idx) => {
                          const seq = (row.values['A'] ?? '').trim();
                          const reqDate = (row.values['B'] ?? '').trim() || '-';
                          const veh = (row.values['D'] ?? '').trim() || '-';
                          const sym = (row.values['F'] ?? '').trim() || '-';
                          const reqNo = (row.values['G'] ?? '').trim();
                          const completedDate = (row.values['J'] ?? '').trim();
                          const reporter = (row.values['AA'] ?? '').trim();
                          const rowNote = (row.values['AH'] ?? '').trim();
                          const partsCost = parseNumericCell(
                            row.rawValues['N'] ?? row.values['N']
                          );
                          const laborCostNum = parseNumericCell(
                            row.rawValues['O'] ?? row.values['O']
                          );
                          const totalCost = partsCost + laborCostNum;
                          const badge = getRepairHistoryStatusBadge(row);
                          const itemKey = `${seq || row.rowNumber}-${reqNo || idx}`;
                          const isCopied = copiedHistoryKey === itemKey;

                          return (
                            <div
                              key={itemKey}
                              className="px-2.5 py-2 hover:bg-slate-50/90 transition-colors"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                  <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-600">
                                    <Calendar className="h-3 w-3 text-slate-400" />
                                    {reqDate}
                                  </span>
                                  <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                                    {veh}
                                  </span>
                                  {reqNo && (
                                    <span className="font-mono text-[10px] text-slate-400">
                                      {reqNo}
                                    </span>
                                  )}
                                  <span
                                    className={`inline-flex items-center rounded-full border px-1.5 py-0.2 text-[10px] font-semibold ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                </div>

                                {sym !== '-' && (
                                  <button
                                    type="button"
                                    onClick={() => handleUseHistoricalSymptom(itemKey, sym)}
                                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors shrink-0 ${
                                      isCopied
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-400 hover:text-indigo-700'
                                    }`}
                                    title="คัดลอกข้อความอาการนี้ลงในช่องอาการเสีย"
                                  >
                                    {isCopied ? (
                                      <>
                                        <Check className="h-3 w-3" />
                                        <span>นำไปใช้แล้ว</span>
                                      </>
                                    ) : (
                                      <>
                                        <CopyPlus className="h-3 w-3" />
                                        <span>ใช้อาการนี้</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>

                              <p className="mt-1 text-xs font-medium text-slate-800 leading-snug whitespace-pre-line">
                                {sym}
                              </p>

                              {(totalCost > 0 || completedDate || reporter || rowNote) && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                                  {totalCost > 0 && (
                                    <span className="font-mono font-semibold text-slate-700">
                                      ค่าซ่อมรวม{' '}
                                      {totalCost.toLocaleString('th-TH', {
                                        maximumFractionDigits: 2,
                                      })}{' '}
                                      ฿
                                    </span>
                                  )}
                                  {completedDate && (
                                    <span>ซ่อมเสร็จ: {completedDate}</span>
                                  )}
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
                        {filteredHistoryRows.length > 30 && (
                          <div className="bg-slate-50 px-3 py-1.5 text-center text-[10px] text-slate-500">
                            แสดงล่าสุด 30 รายการ จากทั้งหมด {filteredHistoryRows.length}{' '}
                            รายการ (พิมพ์คำค้นหาด้านบนเพื่อกรองเพิ่ม)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ผู้แจ้งซ่อม */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ผู้แจ้งซ่อม <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="repair-reporters"
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="ชื่อ-นามสกุล ผู้แจ้ง"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="repair-reporters">
                {referenceOptions.reporters.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            {/* เลขที่ขอซ่อม (รันอัตโนมัติ) */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  เลขที่ขอซ่อม
                </label>
                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                  รันอัตโนมัติ
                </span>
              </div>
              <input
                type="text"
                value={repairRequestNo}
                onChange={(e) => setRepairRequestNo(e.target.value)}
                placeholder="TMT-FL11-0013"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs sm:text-sm font-semibold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>

            {/* ค่าอะไหล่ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ค่าอะไหล่ (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sparePartsCost}
                onChange={(e) => setSparePartsCost(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* ค่าแรง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ค่าแรง (บาท)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* อาการ / ปัญหาที่พบ */}
            <div className="col-span-2">
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                อาการ / รายละเอียดที่ต้องการซ่อม <span className="text-red-600">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="ระบุอาการเสีย หรือสาเหตุที่ต้องการซ่อมอย่างละเอียด..."
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* แนบรูปถ่ายแจ้งซ่อม */}
            <div className="col-span-2">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  แนบรูปถ่ายประกอบการแจ้งซ่อม (สูงสุด 9 รูป)
                </label>
                <span className="font-mono text-[11px] text-slate-400">
                  {photos.length}/9 รูป
                </span>
              </div>

              {/* Upload trigger buttons */}
              {photos.length < 9 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                    id="repair-photo-upload"
                  />
                  <label
                    htmlFor="repair-photo-upload"
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-900 hover:bg-slate-100"
                  >
                    <Camera className="h-4 w-4 text-slate-600" />
                    <span>ถ่ายรูป / เลือกรูปภาพ</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    รองรับภาพถ่ายจากมือถือและกล้อง
                  </span>
                </div>
              )}

              {/* Image Previews */}
              {photos.length > 0 && (
                <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((src, idx) => (
                    <div
                      key={idx}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-xs"
                    >
                      <img
                        src={src}
                        alt={`รูปถ่ายที่ ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-bold text-white">
                        รูปที่ {idx + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(idx)}
                        aria-label={`ลบรูปที่ ${idx + 1}`}
                        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-xs transition-opacity hover:bg-red-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* หมายเหตุ */}
            <div className="col-span-2">
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                หมายเหตุเพิ่มเติม
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSubmitting ? 'กำลังบันทึก...' : 'บันทึกแจ้งซ่อม'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
