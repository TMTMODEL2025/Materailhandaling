import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Minus,
  CheckCircle2,
  AlertTriangle,
  PackagePlus,
  PackageMinus,
  Truck,
  Disc,
  Search,
} from 'lucide-react';
import { SheetRow } from '../types';
import {
  SHEET_TABS,
  fetchSheetTabData,
  extractTireSafetyStock,
  parseTireNumericCell,
  computeTireAlertText,
  updateTireStockTransaction,
  fetchVehicleAndTrailerList,
} from '../services/googleSheets';
import { showSuccessToast, showErrorAlert } from '../utils/swal';

interface TireStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  initialTransactionType?: 'IN' | 'OUT';
  initialTireCode?: string;
  onSavedSuccess: (message: string) => void;
}

const QUICK_WHEEL_POSITIONS = [
  'ล้อหน้า',
  'ล้อหลัง',
  'ล้อหน้าซ้าย',
  'ล้อหน้าขวา',
  'ล้อหลังซ้าย',
  'ล้อหลังขวา',
  'ล้อพ่วง/หาง',
  'ยางอะไหล่',
];

function parseVehicleListFromString(raw: string): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '-') return [];

  // Handle range like "TTL-01 ถึง TTL-04" or "TTL-05 ถึง TTL-58 ยกเว้น 15"
  const rangeMatch = trimmed.match(/([A-Za-z]+)-?0*(\d+)\s*ถึง\s*([A-Za-z]+)-?0*(\d+)/i);
  if (rangeMatch) {
    const prefix = rangeMatch[1].toUpperCase();
    const start = parseInt(rangeMatch[2], 10);
    const end = parseInt(rangeMatch[4], 10);
    const exceptMatch = trimmed.match(/ยกเว้น\s*(\d+)/);
    const exceptNum = exceptMatch ? parseInt(exceptMatch[1], 10) : -1;
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start && end - start <= 100) {
      const expanded: string[] = [];
      for (let i = start; i <= end; i++) {
        if (i === exceptNum) continue;
        expanded.push(`${prefix}-${String(i).padStart(2, '0')}`);
      }
      return expanded;
    }
  }

  return trimmed
    .split(/[,/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const TireStockModal: React.FC<TireStockModalProps> = ({
  isOpen,
  onClose,
  existingRows,
  initialTransactionType = 'OUT',
  initialTireCode = '',
  onSavedSuccess,
}) => {
  const [transactionType, setTransactionType] = useState<'IN' | 'OUT'>(initialTransactionType);
  const [selectedTireCode, setSelectedTireCode] = useState<string>(initialTireCode);
  const [tireFilterQuery, setTireFilterQuery] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [vehicleRegistration, setVehicleRegistration] = useState<string>('');
  const [wheelPosition, setWheelPosition] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [fetchedTireRows, setFetchedTireRows] = useState<SheetRow[]>([]);
  const [allVehiclesList, setAllVehiclesList] = useState<string[]>([]);

  const tireRows = useMemo(() => {
    if (existingRows && existingRows.length > 0) return existingRows;
    return fetchedTireRows;
  }, [existingRows, fetchedTireRows]);

  useEffect(() => {
    if (!isOpen) return;
    setTransactionType(initialTransactionType);
    setSelectedTireCode(initialTireCode);
    setTireFilterQuery('');
    setQuantity('1');
    setVehicleRegistration('');
    setWheelPosition('');
    setNoteText('');
    setFormError(null);

    if (!existingRows || existingRows.length === 0) {
      const tireTab = SHEET_TABS.find((t) => t.gid === '1031154414');
      if (tireTab) {
        fetchSheetTabData(tireTab, { limit: 200 })
          .then((res) => setFetchedTireRows(res.rows))
          .catch(() => {});
      }
    }

    fetchVehicleAndTrailerList()
      .then((list) => setAllVehiclesList(list))
      .catch(() => {});
  }, [isOpen, initialTransactionType, initialTireCode, existingRows]);

  const filteredTireOptions = useMemo(() => {
    const q = tireFilterQuery.trim().toLowerCase();
    const validRows = tireRows.filter(
      (r) => (r.values['A'] ?? '').trim() || (r.values['B'] ?? '').trim()
    );
    if (!q) return validRows;
    return validRows.filter((r) => {
      const code = (r.values['A'] ?? '').toLowerCase();
      const name = (r.values['B'] ?? '').toLowerCase();
      const brand = (r.values['I'] ?? '').toLowerCase();
      const veh = (r.values['G'] ?? '').toLowerCase();
      return (
        code.includes(q) ||
        name.includes(q) ||
        brand.includes(q) ||
        veh.includes(q)
      );
    });
  }, [tireRows, tireFilterQuery]);

  const selectedTireRow = useMemo<SheetRow | null>(() => {
    if (!selectedTireCode) return null;
    return (
      tireRows.find(
        (r) =>
          (r.values['A'] ?? '').trim() === selectedTireCode.trim() ||
          `ROW-${r.rowNumber}` === selectedTireCode
      ) ?? null
    );
  }, [tireRows, selectedTireCode]);

  const linkedVehicles = useMemo<string[]>(() => {
    if (!selectedTireRow) return [];
    return parseVehicleListFromString(selectedTireRow.values['G'] ?? '');
  }, [selectedTireRow]);

  // Auto-populate default vehicle and position when selecting a tire item
  useEffect(() => {
    if (!selectedTireRow) return;
    const defaultPos = (selectedTireRow.values['H'] ?? '').trim();
    if (defaultPos && defaultPos !== '-') {
      setWheelPosition(defaultPos);
    }
    const vehs = parseVehicleListFromString(selectedTireRow.values['G'] ?? '');
    if (vehs.length === 1) {
      setVehicleRegistration(vehs[0]);
    } else {
      setVehicleRegistration('');
    }
  }, [selectedTireRow]);

  const currentReceived = selectedTireRow ? parseTireNumericCell(selectedTireRow, 'D') : 0;
  const currentIssued = selectedTireRow ? parseTireNumericCell(selectedTireRow, 'E') : 0;
  const currentBalance = selectedTireRow ? parseTireNumericCell(selectedTireRow, 'F') : 0;
  const safetyStock = selectedTireRow ? extractTireSafetyStock(selectedTireRow) : 0;

  const parsedQty = Math.max(0, Math.floor(Number(quantity) || 0));
  const projectedBalance =
    transactionType === 'IN'
      ? currentBalance + parsedQty
      : currentBalance - parsedQty;
  const isOverIssue = transactionType === 'OUT' && parsedQty > currentBalance;
  const projectedAlert = selectedTireRow
    ? computeTireAlertText(
        Math.max(0, projectedBalance),
        safetyStock,
        selectedTireRow.values['N']
      )
    : '';

  const combinedVehicleOptions = useMemo(() => {
    const set = new Set<string>();
    linkedVehicles.forEach((v) => set.add(v));
    allVehiclesList.forEach((v) => set.add(v));
    return Array.from(set);
  }, [linkedVehicles, allVehiclesList]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedTireRow) {
      setFormError('กรุณาเลือก "รหัส / รายการยาง" ที่ต้องการทำรายการ');
      return;
    }

    if (parsedQty <= 0) {
      setFormError('กรุณาระบุจำนวน (เส้น/ชิ้น) ที่มากกว่า 0');
      return;
    }

    if (transactionType === 'OUT') {
      if (currentBalance <= 0) {
        setFormError('ไม่สามารถเบิกออกได้ เนื่องจากรายการยางนี้มียอดคงเหลือ 0 เส้น');
        return;
      }
      if (parsedQty > currentBalance) {
        setFormError(
          `ไม่สามารถเบิกเกินยอดคงเหลือได้ (ต้องการเบิก ${parsedQty} เส้น แต่คงเหลือเพียง ${currentBalance} เส้น)`
        );
        return;
      }
      if (!vehicleRegistration.trim()) {
        setFormError('กรุณาเลือกหรือระบุ "ทะเบียนรถที่เบิกใช้"');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const code = (selectedTireRow.values['A'] ?? '').trim();
      const itemName = (selectedTireRow.values['B'] ?? '').trim();
      const combinedPosAndNote = [wheelPosition.trim(), noteText.trim()]
        .filter(Boolean)
        .join(' • ');

      const result = await updateTireStockTransaction({
        rowNumber: selectedTireRow.rowNumber,
        tireCode: code,
        tireName: itemName,
        transactionType,
        quantity: parsedQty,
        currentReceived,
        currentIssued,
        currentBalance,
        safetyStock,
        existingAlert: selectedTireRow.values['N'],
        vehicleRegistration:
          transactionType === 'OUT' ? vehicleRegistration.trim() : undefined,
        wheelPositionOrNote: combinedPosAndNote || undefined,
      });

      // Immediately mutate row in memory so table & KPI cards update without delay
      selectedTireRow.values['D'] = String(result.receivedQty);
      selectedTireRow.rawValues['D'] = result.receivedQty;
      selectedTireRow.values['E'] = String(result.issuedQty);
      selectedTireRow.rawValues['E'] = result.issuedQty;
      selectedTireRow.values['F'] = String(result.balanceQty);
      selectedTireRow.rawValues['F'] = result.balanceQty;
      selectedTireRow.values['N'] = result.alertText;
      selectedTireRow.rawValues['N'] = result.alertText;
      selectedTireRow.values['O'] = result.updateNote;
      selectedTireRow.rawValues['O'] = result.updateNote;

      const msg =
        transactionType === 'IN'
          ? `บันทึกรับเข้ายาง [${code}] ${itemName} จำนวน +${parsedQty} เส้น (คงเหลือ ${result.balanceQty} เส้น)`
          : `บันทึกเบิกออกยาง [${code}] ${itemName} จำนวน -${parsedQty} เส้น ใช้กับรถ ${vehicleRegistration.trim()} (คงเหลือ ${result.balanceQty} เส้น)`;

      showSuccessToast(
        transactionType === 'IN' ? 'บันทึกรับเข้ายางสำเร็จ!' : 'บันทึกเบิกออกยางสำเร็จ!',
        msg
      );
      onSavedSuccess(msg);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกสต็อกยาง';
      setFormError(message);
      showErrorAlert('บันทึกไม่สำเร็จ', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3.5 sm:px-6 sm:py-4 border-b ${
            transactionType === 'IN'
              ? 'bg-gradient-to-r from-emerald-900 to-teal-900 border-emerald-800 text-white'
              : 'bg-gradient-to-r from-slate-900 to-amber-950 border-slate-800 text-white'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                transactionType === 'IN'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
              }`}
            >
              {transactionType === 'IN' ? (
                <PackagePlus className="h-5 w-5" />
              ) : (
                <PackageMinus className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-snug truncate">
                บันทึกรับเข้า-เบิกออกยาง (STOCK ยาง)
              </h2>
              <p className="text-xs text-slate-300 truncate">
                อัปเดตยอดรับเข้า เบิกออก และคำนวณสต็อกคงเหลือลงชีต STOCK ยาง ทันที
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* 1. ประเภทรายการ */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              1. เลือกประเภทรายการ <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setTransactionType('IN');
                  setFormError(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                  transactionType === 'IN'
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <PackagePlus className="h-4 w-4 shrink-0" />
                <span>รับเข้า (เพิ่มสต็อก)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTransactionType('OUT');
                  setFormError(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                  transactionType === 'OUT'
                    ? 'border-amber-600 bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <PackageMinus className="h-4 w-4 shrink-0" />
                <span>เบิกออก (ตัดสต็อก)</span>
              </button>
            </div>
          </div>

          {/* 2. เลือกรหัส / รายการยาง */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-bold text-slate-700">
                2. รหัส / รายการยาง <span className="text-red-500">*</span>
              </label>
              <div className="relative w-48 sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={tireFilterQuery}
                  onChange={(e) => setTireFilterQuery(e.target.value)}
                  placeholder="กรองรหัส / ขนาด / รถ..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 py-1 text-xs text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <select
              value={selectedTireCode}
              onChange={(e) => {
                setSelectedTireCode(e.target.value);
                setFormError(null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs sm:text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
            >
              <option value="">-- เลือกรหัส / รายการยาง (แสดงยอดคงเหลือ) --</option>
              {filteredTireOptions.map((r) => {
                const code = (r.values['A'] ?? '').trim();
                const name = (r.values['B'] ?? '').trim().replace(/\s+/g, ' ');
                const brand = (r.values['I'] ?? '').trim() || '-';
                const veh = (r.values['G'] ?? '').trim() || '-';
                const bal = parseTireNumericCell(r, 'F');
                const optKey = code || `ROW-${r.rowNumber}`;
                return (
                  <option key={optKey} value={optKey}>
                    {code} - {name} | ยี่ห้อ: {brand} | รถ: {veh} (คงเหลือ: {bal} เส้น)
                  </option>
                );
              })}
            </select>

            {/* Selected Tire Summary Card */}
            {selectedTireRow && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
                      <Disc className="h-3 w-3" />
                      {selectedTireRow.values['A']}
                    </span>
                    <span className="text-xs sm:text-sm font-extrabold text-slate-900">
                      {(selectedTireRow.values['B'] ?? '').replace(/\s+/g, ' ')}
                    </span>
                  </div>
                  <span className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    ยี่ห้อ: <strong>{selectedTireRow.values['I'] || '-'}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5 text-center">
                    <div className="text-[10px] font-semibold text-slate-500">
                      คงเหลือปัจจุบัน
                    </div>
                    <div
                      className={`font-mono text-base font-extrabold tabular-nums ${
                        currentBalance <= 0
                          ? 'text-red-600'
                          : safetyStock > 0 && currentBalance <= safetyStock
                          ? 'text-amber-600'
                          : 'text-slate-900'
                      }`}
                    >
                      {currentBalance.toLocaleString('th-TH')}{' '}
                      <span className="font-sans text-[11px] font-semibold text-slate-500">
                        เส้น
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg bg-white border border-slate-200/80 px-2.5 py-1.5 text-center">
                    <div className="text-[10px] font-semibold text-slate-500">
                      รับเข้า / เบิกสะสมเดิม
                    </div>
                    <div className="font-mono text-xs font-bold text-slate-800 tabular-nums mt-0.5">
                      <span className="text-emerald-700">+{currentReceived}</span> /{' '}
                      <span className="text-amber-700">-{currentIssued}</span>
                    </div>
                  </div>

                  <div
                    className={`rounded-lg border px-2.5 py-1.5 text-center ${
                      isOverIssue
                        ? 'border-red-300 bg-red-50'
                        : transactionType === 'IN'
                        ? 'border-emerald-200 bg-emerald-50/70'
                        : 'border-amber-200 bg-amber-50/70'
                    }`}
                  >
                    <div className="text-[10px] font-semibold text-slate-600">
                      คงเหลือหลังทำรายการ
                    </div>
                    <div
                      className={`font-mono text-base font-extrabold tabular-nums ${
                        isOverIssue
                          ? 'text-red-600'
                          : projectedBalance <= 0
                          ? 'text-red-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {projectedBalance.toLocaleString('th-TH')}{' '}
                      <span className="font-sans text-[11px] font-semibold">เส้น</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600 pt-0.5">
                  <span>
                    รถที่ผูกกับยาง: <strong className="text-slate-800">{selectedTireRow.values['G'] || '-'}</strong>
                  </span>
                  {safetyStock > 0 && (
                    <span className="text-amber-800 font-semibold">
                      Safety Stock: {safetyStock} เส้น
                    </span>
                  )}
                </div>

                {projectedAlert && !isOverIssue && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span>แจ้งเตือนหลังบันทึก: {projectedAlert}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. จำนวน (เส้น/ชิ้น) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              3. จำนวนที่{transactionType === 'IN' ? 'รับเข้า' : 'เบิกออก'} (เส้น/ชิ้น){' '}
              <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-xl border border-slate-300 bg-white p-1">
                <button
                  type="button"
                  onClick={() =>
                    setQuantity(String(Math.max(1, (Number(quantity) || 1) - 1)))
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={transactionType === 'OUT' && selectedTireRow ? Math.max(1, currentBalance) : 999}
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setFormError(null);
                  }}
                  className="w-20 text-center font-mono text-base font-extrabold text-slate-900 focus:outline-none tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(String((Number(quantity) || 0) + 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 2, 4, 6, 8, 10].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setQuantity(String(preset));
                      setFormError(null);
                    }}
                    className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs font-bold transition-colors ${
                      Number(quantity) === preset
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset} เส้น
                  </button>
                ))}
              </div>
            </div>

            {isOverIssue && selectedTireRow && (
              <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  จำนวนที่เบิก ({parsedQty} เส้น) เกินกว่ายอดคงเหลือปัจจุบัน ({currentBalance} เส้น)
                </span>
              </p>
            )}
          </div>

          {/* 4. กรณี เบิกออก: ทะเบียนรถที่เบิกใช้ + ตำแหน่งล้อ/หมายเหตุ */}
          {transactionType === 'OUT' ? (
            <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  4. ทะเบียนรถ / เบอร์รถที่เบิกใช้ <span className="text-red-500">*</span>
                </label>

                {linkedVehicles.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[11px] font-medium text-slate-500 mb-1">
                      คลิกเลือกเบอร์รถที่ผูกกับยางรายการนี้:
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {linkedVehicles.map((veh) => (
                        <button
                          key={veh}
                          type="button"
                          onClick={() => {
                            setVehicleRegistration(veh);
                            setFormError(null);
                          }}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                            vehicleRegistration === veh
                              ? 'border-amber-600 bg-amber-600 text-white shadow-2xs'
                              : 'border-amber-300 bg-white text-amber-950 hover:bg-amber-100/60'
                          }`}
                        >
                          <Truck className="h-3 w-3" />
                          <span>{veh}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={
                      combinedVehicleOptions.includes(vehicleRegistration)
                        ? vehicleRegistration
                        : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) {
                        setVehicleRegistration(e.target.value);
                        setFormError(null);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">-- เลือกจากฐานข้อมูลรถ/หาง --</option>
                    {combinedVehicleOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={vehicleRegistration}
                    onChange={(e) => {
                      setVehicleRegistration(e.target.value);
                      setFormError(null);
                    }}
                    placeholder="หรือพิมพ์ทะเบียนรถ/เบอร์รถ เช่น TT-01"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  5. ตำแหน่งล้อ / หมายเหตุการเบิก
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {QUICK_WHEEL_POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setWheelPosition(pos)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                        wheelPosition === pos
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={wheelPosition}
                    onChange={(e) => setWheelPosition(e.target.value)}
                    placeholder="ระบุตำแหน่งล้อ เช่น ล้อหน้าซ้าย..."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="หมายเหตุเพิ่มเติม (เช่น เปลี่ยนยางรั่ว)..."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                4. หมายเหตุการรับเข้า (ถ้ามี)
              </label>
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="เช่น รับเข้าสต็อกประจำเดือน / เลขที่ใบส่งของ..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          )}

          {formError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isOverIssue || !selectedTireRow}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm transition-all disabled:opacity-50 ${
                transactionType === 'IN'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {isSubmitting
                  ? 'กำลังบันทึก...'
                  : transactionType === 'IN'
                  ? `ยืนยันรับเข้า (+${parsedQty} เส้น)`
                  : `ยืนยันเบิกออก (-${parsedQty} เส้น)`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
