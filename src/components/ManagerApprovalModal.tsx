import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  HelpCircle,
  Lock,
  ZoomIn,
  Sparkles,
  ChevronDown,
  Calendar,
  Wrench,
} from 'lucide-react';
import { SheetRow, RepairApprovalPayload } from '../types';
import { approveRepairRecord, updateRepairAdditionalDetails, isPhotoValue } from '../services/googleSheets';
import { DrivePhotoImg } from './DrivePhotoImg';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { showSuccessToast } from '../utils/swal';
import {
  filterPendingApprovalRows,
  parseNumericCell,
} from '../utils/sheetMetrics';

const PHOTO_COLS = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];

const MANAGER_ACCESS_PIN = '685400';

interface ManagerApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: SheetRow[];
  onApprovedSuccess: () => void;
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

function parseCostAmount(val: string | undefined): number {
  return parseNumericCell(val);
}

function formatCostBaht(amount: number, rawVal?: string): string {
  if (amount > 0) {
    return `${amount.toLocaleString('th-TH', {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })} ฿`;
  }
  const trimmed = (rawVal ?? '').trim();
  if (!trimmed || trimmed === '-') return '0 ฿';
  return '0 ฿';
}

export const ManagerApprovalModal: React.FC<ManagerApprovalModalProps> = ({
  isOpen,
  onClose,
  rows,
  onApprovedSuccess,
}) => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<'PENDING' | 'ALL'>('PENDING');
  const DEFAULT_APPROVER_NAME = 'นายกฤษฎา เกิดเสม';

  const [approverName, setApproverName] = useState<string>(
    () => localStorage.getItem('gsheets_manager_approver_name') || DEFAULT_APPROVER_NAME
  );
  const [expandedRowNumber, setExpandedRowNumber] = useState<number | null>(null);
  const [selectedRow, setSelectedRow] = useState<SheetRow | null>(null);
  const [decision, setDecision] = useState<'3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ' | '4.⚠️ขอข้อมูลเพิ่มเติม'>('3.✔️อนุมัติ');
  const [note, setNote] = useState<string>('');
  const [additionalInfo, setAdditionalInfo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxState, setLightboxState] = useState<{
    isOpen: boolean;
    photos: string[];
    initialIndex: number;
    title?: string;
    subtitle?: string;
    vehicleNo?: string;
    sequenceNo?: string;
    rowNumber?: number;
    repairRequestNo?: string;
    targetRow?: SheetRow;
  }>({
    isOpen: false,
    photos: [],
    initialIndex: 0,
  });

  const handleOpenPhotoZoom = (
    photos: string[],
    idx: number,
    row: SheetRow
  ) => {
    const veh = (row.values['D'] ?? '').trim();
    const seq = (row.values['A'] ?? '').trim() || String(row.rowNumber);
    const reqNo = (row.values['G'] ?? '').trim();
    const sym = (row.values['F'] ?? '').trim();
    const typ = (row.values['E'] ?? '').trim();
    setLightboxState({
      isOpen: true,
      photos,
      initialIndex: idx,
      title: `รูปถ่ายงานซ่อม เบอร์รถ ${veh || '-'} (ลำดับ ${seq})`,
      subtitle: `${typ ? `${typ}: ` : ''}${sym || 'ตรวจสอบรอยและอาการเสีย'}`,
      vehicleNo: veh,
      sequenceNo: seq,
      rowNumber: row.rowNumber,
      repairRequestNo: reqNo,
      targetRow: row,
    });
  };

  useEffect(() => {
    if (!isOpen) {
      setIsUnlocked(false);
      setPinInput('');
      setPinError(null);
      setExpandedRowNumber(null);
      setSelectedRow(null);
      setError(null);
      setLightboxState({ isOpen: false, photos: [], initialIndex: 0 });
    }
  }, [isOpen]);

  // Filter rows based on centralized approval status (exclude 'รอตรวจสอบ' until passed 'ผู้ตรวจสอบ')
  const pendingRows = useMemo(
    () => filterPendingApprovalRows(rows),
    [rows]
  );

  const displayedRows = useMemo(
    () => (filterMode === 'PENDING' ? pendingRows : rows),
    [filterMode, pendingRows, rows]
  );

  if (!isOpen) return null;

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === MANAGER_ACCESS_PIN) {
      setIsUnlocked(true);
      setPinError(null);
    } else {
      setPinError('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    }
  };

  if (!isUnlocked) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  ยืนยันสิทธิ์ผู้จัดการ
                </h2>
                <p className="text-xs text-slate-500">
                  เมนูผู้จัดการอนุมัติงานซ่อม
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleVerifyPin} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                กรุณากรอกรหัสผ่านเข้าใช้งาน
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  if (pinError) setPinError(null);
                }}
                placeholder="รหัสผ่าน 6 หลัก"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-center font-mono text-base tracking-widest text-slate-900 focus:border-emerald-700 focus:bg-white focus:outline-none"
              />
            </div>

            {pinError && (
              <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{pinError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-800"
              >
                เข้าสู่เมนูอนุมัติ
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }


  const handleOpenDecision = (
    row: SheetRow,
    defaultDecision: '3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ' | '4.⚠️ขอข้อมูลเพิ่มเติม'
  ) => {
    setSelectedRow(row);
    setDecision(defaultDecision);
    setNote('');
    setAdditionalInfo((row.values['AK'] ?? '').trim());
    setError(null);
  };

  const handleConfirmDecision = async () => {
    if (!selectedRow) return;
    if (!approverName.trim()) {
      setError('กรุณาระบุชื่อผู้อนุมัติ');
      return;
    }

    if (decision === '4.⚠️ขอข้อมูลเพิ่มเติม' && !additionalInfo.trim() && !note.trim()) {
      setError('กรุณาระบุรายละเอียดหรือข้อมูลที่ต้องการขอเพิ่มเติม');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const repairStatus =
        decision === '3.✔️อนุมัติ'
          ? 'รอคิวซ่อม'
          : decision === '1.❌ไม่อนุมัติ'
          ? 'ยกเลิกการซ่อม'
          : 'รอข้อมูลเพิ่มเติม';

      const finalNote =
        decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
          ? additionalInfo.trim() || note.trim()
          : note.trim();

      const payload: RepairApprovalPayload = {
        rowNumber: selectedRow.rowNumber,
        sequenceNo: (selectedRow.values['A'] ?? '').trim(),
        approvalStatus: decision,
        approverName: approverName.trim(),
        approvalDate: getCurrentThaiDateString(),
        approvalTime: getCurrentTimeString(),
        repairStatus,
        note: finalNote,
      };

      await approveRepairRecord(payload);

      if (decision === '4.⚠️ขอข้อมูลเพิ่มเติม' && additionalInfo.trim()) {
        try {
          await updateRepairAdditionalDetails({
            rowNumber: selectedRow.rowNumber,
            sequenceNo: (selectedRow.values['A'] ?? '').trim(),
            repairRequestNo: (selectedRow.values['G'] ?? '').trim(),
            additionalDetails: additionalInfo.trim(),
          });
          selectedRow.values['AK'] = additionalInfo.trim();
        } catch {
          // ignore
        }
      }

      const toastTitle =
        decision === '3.✔️อนุมัติ'
          ? 'บันทึกการอนุมัติสำเร็จ!'
          : decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
          ? 'ส่งคำขอข้อมูลเพิ่มเติมสำเร็จ!'
          : 'บันทึกการไม่อนุมัติสำเร็จ!';

      showSuccessToast(toastTitle, 'ระบบบันทึกผลการพิจารณาเรียบร้อยแล้ว');

      setSelectedRow(null);
      onApprovedSuccess();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกการอนุมัติ'
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
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                เมนูผู้จัดการอนุมัติงานซ่อม
              </h2>
              <div className="text-xs text-slate-500">
                รายการรอพิจารณาอนุมัติ{' '}
                <strong className="font-mono text-emerald-700">
                  {pendingRows.length.toLocaleString('th-TH')}
                </strong>{' '}
                รายการ
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Top Controls: Approver name & filter tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-700">
              ชื่อผู้อนุมัติ:
            </label>
            <input
              type="text"
              value={approverName}
              onChange={(e) => {
                setApproverName(e.target.value);
                try {
                  localStorage.setItem('gsheets_manager_approver_name', e.target.value);
                } catch {
                  // ignore storage error
                }
              }}
              placeholder="ระบุชื่อผู้จัดการอนุมัติ"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilterMode('PENDING')}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filterMode === 'PENDING'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              รอพิจารณา ({pendingRows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filterMode === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              ทั้งหมดในตาราง ({rows.length})
            </button>
          </div>
        </div>

        {/* Content list / Decision view */}
        <div className="flex-1 overflow-y-auto bg-slate-100/70 px-3 py-3 sm:px-6 sm:py-4">
          {selectedRow ? (
            /* Confirmation card */
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  ยืนยันการอนุมัติรายการ #{selectedRow.values['A'] || selectedRow.rowNumber}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  ย้อนกลับ
                </button>
              </div>

              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              {(() => {
                const spareNum = parseCostAmount(selectedRow.values['N']);
                const laborNum = parseCostAmount(selectedRow.values['O']);
                const totalNum = spareNum + laborNum;
                const spareDisplay = formatCostBaht(spareNum, selectedRow.values['N']);
                const laborDisplay = formatCostBaht(laborNum, selectedRow.values['O']);
                const totalDisplay = formatCostBaht(totalNum);

                return (
                  <div className="mt-3 space-y-3 text-xs sm:text-sm">
                    {/* Header Info: วันที่ + ชื่อรถ + สถานะ อยู่บรรทัดเดียวกัน กระชับในโหมดมือถือ */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5 flex-nowrap">
                        <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                          <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] sm:text-xs font-bold text-slate-700 border border-slate-200 whitespace-nowrap shrink-0 tabular-nums">
                            <Calendar className="h-3 w-3 text-emerald-700 shrink-0" />
                            <span>{selectedRow.values['B'] || '-'}</span>
                          </span>
                          <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs sm:text-sm font-extrabold text-white whitespace-nowrap shrink-0">
                            {selectedRow.values['D'] || '-'}
                          </span>
                        </div>
                        <span className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] sm:text-[11px] font-bold text-amber-800 whitespace-nowrap shrink-0">
                          {(selectedRow.values['AI'] ?? '').trim() || '2.⚠️รออนุมัติ'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] sm:text-xs font-bold text-blue-900 truncate">
                          <Wrench className="h-3 w-3 text-blue-600 shrink-0" />
                          <span className="truncate">{selectedRow.values['E'] || 'ทั่วไป'}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                          #{selectedRow.values['A'] || selectedRow.rowNumber}
                        </span>
                      </div>
                    </div>

                    {/* 2-Column Cost Summary Box */}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white bg-white p-2.5 shadow-2xs">
                          <div className="text-[11px] font-medium text-slate-500">
                            ค่าอะไหล่ (บาท)
                          </div>
                          <div className="mt-0.5 font-mono text-sm sm:text-base font-extrabold text-slate-900 tabular-nums">
                            {spareDisplay}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white bg-white p-2.5 shadow-2xs">
                          <div className="text-[11px] font-medium text-slate-500">
                            ค่าแรง (บาท)
                          </div>
                          <div className="mt-0.5 font-mono text-sm sm:text-base font-extrabold text-slate-900 tabular-nums">
                            {laborDisplay}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-emerald-200/80 pt-2 px-1">
                        <span className="text-xs font-bold text-emerald-900">
                          ยอดรวมสุทธิ
                        </span>
                        <span className="font-mono text-sm sm:text-base font-extrabold text-emerald-800 tabular-nums">
                          {totalDisplay}
                        </span>
                      </div>
                    </div>

                    {/* Symptoms Box */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3">
                      <div className="text-[11px] font-bold text-slate-600">
                        อาการ / รายละเอียดที่ต้องการซ่อม:
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-xs sm:text-sm font-medium leading-relaxed text-slate-900">
                        {selectedRow.values['F'] || '-'}
                      </div>
                    </div>

                    {/* Photos Grid */}
                    {(() => {
                      const rowPhotos = PHOTO_COLS.map((c) => (selectedRow.values[c] ?? '').trim())
                        .filter((v) => isPhotoValue(v))
                        .sort((a, b) => {
                          const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                          const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                          return aDirect - bDirect;
                        });
                      if (rowPhotos.length === 0) return null;
                      return (
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-1 pb-1.5">
                            <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                              รูปถ่ายประกอบการแจ้งซ่อม ({rowPhotos.length} รูป):
                            </span>
                            <span className="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              🔍 แตะที่รูปเพื่อซูมขยายดูภาพชัด
                            </span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            {rowPhotos.map((pSrc, idx) => (
                              <div
                                key={idx}
                                onClick={() => handleOpenPhotoZoom(rowPhotos, idx, selectedRow)}
                                className="group relative cursor-pointer overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-900 shadow-2xs hover:border-blue-500 hover:shadow-md transition-all"
                                title="แตะเพื่อซูมดูรูปความละเอียดสูง"
                              >
                                <DrivePhotoImg
                                  src={pSrc}
                                  alt={`รูปถ่ายที่ ${idx + 1}`}
                                  className="h-28 sm:h-32 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-1 backdrop-blur-[1px]">
                                  <ZoomIn className="h-5 w-5 text-white drop-shadow" />
                                  <span className="text-[10px] font-bold bg-slate-900/80 px-2 py-0.5 rounded-full">
                                    ซูมดูภาพชัด
                                  </span>
                                </div>
                                <span className="absolute bottom-1 right-1 rounded bg-slate-950/75 px-1.5 py-0.2 font-mono text-[10px] text-white">
                                  {idx + 1}/{rowPhotos.length}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Responsible Persons (2 Columns) */}
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-xs">
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">ผู้แจ้งซ่อม</div>
                        <div className="mt-0.5 font-semibold text-slate-900 truncate">
                          {selectedRow.values['AA'] || '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-slate-500">ผู้ตรวจสอบ</div>
                        <div className="mt-0.5 font-semibold text-slate-900 truncate">
                          {selectedRow.values['AB'] || '-'}
                        </div>
                      </div>
                    </div>

                    {selectedRow.values['AK'] && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
                        <span className="text-xs font-bold text-amber-900">
                          คำขอข้อมูลเพิ่มเติมจากผู้อนุมัติ:
                        </span>
                        <div className="mt-0.5 whitespace-pre-wrap text-xs text-amber-950">
                          {selectedRow.values['AK']}
                        </div>
                      </div>
                    )}
                    {selectedRow.values['AM'] && (
                      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2.5">
                        <span className="text-xs font-bold text-emerald-900 flex items-center gap-1">
                          <span>💬</span> ข้อความตอบกลับข้อมูลเพิ่มเติมจากผู้แจ้งซ่อม:
                        </span>
                        <div className="mt-0.5 whitespace-pre-wrap text-xs font-semibold text-emerald-950">
                          {selectedRow.values['AM']}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="mt-4 border-t border-slate-200 pt-3">
                <label className="block text-xs font-semibold text-slate-800">
                  ผลการพิจารณา:
                </label>
                <div className="mt-1.5 flex flex-nowrap items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => setDecision('3.✔️อนุมัติ')}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] sm:text-xs font-bold whitespace-nowrap transition-colors ${
                      decision === '3.✔️อนุมัติ'
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-nowrap">อนุมัติ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecision('4.⚠️ขอข้อมูลเพิ่มเติม')}
                    className={`flex-[1.35] inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] sm:text-xs font-bold whitespace-nowrap transition-colors ${
                      decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-nowrap">ขอข้อมูลเพิ่ม</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecision('1.❌ไม่อนุมัติ')}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] sm:text-xs font-bold whitespace-nowrap transition-colors ${
                      decision === '1.❌ไม่อนุมัติ'
                        ? 'bg-red-700 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-nowrap">ไม่อนุมัติ</span>
                  </button>
                </div>

                {decision === '4.⚠️ขอข้อมูลเพิ่มเติม' ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <label className="block text-xs font-bold text-amber-900">
                      รายละเอียดข้อมูลที่ขอเพิ่มเติม <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={additionalInfo}
                      onChange={(e) => setAdditionalInfo(e.target.value)}
                      placeholder="ระบุรายละเอียดหรือข้อมูลเพิ่มเติมที่ต้องการให้ผู้แจ้งซ่อมชี้แจง..."
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700">
                      หมายเหตุผู้อนุมัติ:
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  disabled={isSubmitting}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDecision}
                  disabled={isSubmitting}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white transition-colors ${
                    decision === '3.✔️อนุมัติ'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : decision === '4.⚠️ขอข้อมูลเพิ่มเติม'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกผลการพิจารณา'}
                  </span>
                </button>
              </div>
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <Clock className="mx-auto h-8 w-8 text-slate-300" />
              <div className="mt-2 text-sm font-semibold text-slate-800">
                ไม่มีรายการข้อมูล
              </div>
              <div className="text-xs text-slate-400">
                {filterMode === 'PENDING'
                  ? 'ไม่พบรายการรอการอนุมัติในระบบ'
                  : 'ไม่พบรายการข้อมูลในตาราง'}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1 text-[11px] font-medium text-slate-500">
                <span>แตะที่รายการเพื่อเปิดดูรายละเอียดและพิจารณาอนุมัติ</span>
                <span>ทั้งหมด {displayedRows.length} รายการ</span>
              </div>
              {displayedRows.map((r) => {
                const seq = r.values['A'] || `#${r.rowNumber}`;
                const dt = (r.values['B'] ?? '').trim();
                const tm = (r.values['C'] ?? '').trim();
                const veh = (r.values['D'] ?? '').trim();
                const typ = (r.values['E'] ?? '').trim();
                const sym = (r.values['F'] ?? '').trim();
                const rep = (r.values['AA'] ?? '').trim();
                const appStatus = (r.values['AI'] ?? '').trim();
                const repairStatus = (r.values['P'] ?? '').trim();
                const inspector = (r.values['AB'] ?? '').trim();
                const reqInfoText = (r.values['AK'] ?? '').trim();
                const replyText = (r.values['AM'] ?? '').trim();

                const sparePartsNum = parseCostAmount(r.values['N']);
                const laborNum = parseCostAmount(r.values['O']);
                const netTotalNum = sparePartsNum + laborNum;
                const sparePartsLabel = formatCostBaht(sparePartsNum, r.values['N']);
                const laborLabel = formatCostBaht(laborNum, r.values['O']);
                const netTotalLabel = formatCostBaht(netTotalNum);

                const isWaitingInspection =
                  appStatus === 'รอตรวจสอบ' ||
                  repairStatus === 'รอตรวจสอบ' ||
                  (!appStatus && !inspector);
                const isReplied = appStatus.includes('ตอบกลับ') || Boolean(replyText);
                const isApproved =
                  appStatus.includes('อนุมัติ') &&
                  !appStatus.includes('ไม่อนุมัติ') &&
                  !appStatus.includes('รอ') &&
                  !isReplied;
                const isRejected = appStatus.includes('ไม่อนุมัติ');
                const isNeedInfo =
                  (appStatus.includes('ขอข้อมูล') || Boolean(reqInfoText)) && !isReplied;

                const displayStatusLabel = isWaitingInspection
                  ? 'รอตรวจสอบ'
                  : isReplied
                  ? '4.💬 ตอบกลับข้อมูลเพิ่มเติมแล้ว'
                  : appStatus === '2.⚠️รอพิจารณา' || appStatus === 'รอพิจารณา' || !appStatus
                  ? '2.⚠️รออนุมัติ'
                  : appStatus;

                const itemPhotos = PHOTO_COLS.map((c) => (r.values[c] ?? '').trim())
                  .filter((v) => isPhotoValue(v))
                  .sort((a, b) => {
                    const aDirect = a.startsWith('data:image/') || a.startsWith('http') ? 0 : 1;
                    const bDirect = b.startsWith('data:image/') || b.startsWith('http') ? 0 : 1;
                    return aDirect - bDirect;
                  });

                const isExpanded = expandedRowNumber === r.rowNumber;

                return (
                  <div
                    key={r.rowNumber}
                    className={`overflow-hidden rounded-2xl border transition-all ${
                      isExpanded
                        ? 'border-emerald-500 bg-white shadow-md ring-1 ring-emerald-500/30'
                        : 'border-slate-200/90 bg-white shadow-xs hover:border-slate-300'
                    }`}
                  >
                    {/* ส่วนหัวข้อหลักของรายการ (Summary Header - วันที่ + ชื่อรถ + สถานะ อยู่บรรทัดเดียวกัน กระชับในโหมดมือถือ) */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRowNumber((prev) =>
                          prev === r.rowNumber ? null : r.rowNumber
                        )
                      }
                      className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50/80 active:bg-slate-100/70"
                    >
                      {/* แถวที่ 1 (บรรทัดเดียว): วันที่ + ชื่อรถ + สถานะ + ลูกศร */}
                      <div className="flex w-full items-center justify-between gap-1.5 flex-nowrap">
                        <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] sm:text-xs font-bold text-slate-800 border border-slate-200/80 whitespace-nowrap shrink-0 tabular-nums">
                            <Calendar className="h-3 w-3 text-emerald-700 shrink-0" />
                            <span>{dt || '-'}</span>
                          </span>
                          <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] sm:text-xs font-extrabold text-white whitespace-nowrap shrink-0">
                            {veh || '-'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 flex-nowrap">
                          {displayStatusLabel && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold whitespace-nowrap shrink-0 ${
                                isWaitingInspection
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : isReplied
                                  ? 'bg-emerald-100 text-emerald-950 border border-emerald-400'
                                  : isApproved
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : isRejected
                                  ? 'bg-red-50 text-red-700 border border-red-200'
                                  : isNeedInfo
                                  ? 'bg-amber-50 text-amber-800 border border-amber-300'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}
                            >
                              {displayStatusLabel}
                            </span>
                          )}
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                              isExpanded ? 'rotate-180 text-emerald-700' : 'text-slate-400'
                            }`}
                          />
                        </div>
                      </div>

                      {/* แถวที่ 2: ประเภทการซ่อม + ข้อมูลย่อ */}
                      <div className="flex w-full items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] sm:text-xs font-bold text-blue-900 truncate">
                            <Wrench className="h-3 w-3 text-blue-600 shrink-0" />
                            <span className="truncate">{typ || 'ไม่ระบุประเภท'}</span>
                          </span>
                          {netTotalNum > 0 && (
                            <span className="rounded-md bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 font-mono text-[10px] sm:text-[11px] font-bold text-emerald-800 whitespace-nowrap shrink-0 tabular-nums">
                              {netTotalLabel}
                            </span>
                          )}
                          {itemPhotos.length > 0 && (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] sm:text-[11px] font-semibold text-slate-600 whitespace-nowrap shrink-0">
                              📷 {itemPhotos.length}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                          #{seq} {tm ? `• ${tm}` : ''}
                        </span>
                      </div>
                    </button>

                    {/* ส่วนรายละเอียดและการอนุมัติ (แสดงเมื่อคลิกที่หัวข้อรายการ) */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/40 p-3 sm:p-4 space-y-2.5">

                        {/* กล่องสรุปค่าใช้จ่าย (2 คอลัมน์คู่กัน เด่นชัด): ค่าอะไหล่ (บาท) และ ค่าแรง (บาท) พร้อมยอดรวมสุทธิ */}
                        <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/40 p-2.5 sm:p-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2 shadow-2xs">
                              <div className="text-[11px] font-semibold text-slate-500">
                                ค่าอะไหล่ (บาท)
                              </div>
                              <div className="mt-0.5 font-mono text-sm sm:text-base font-extrabold text-slate-900 tabular-nums">
                                {sparePartsLabel}
                              </div>
                            </div>
                            <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2 shadow-2xs">
                              <div className="text-[11px] font-semibold text-slate-500">
                                ค่าแรง (บาท)
                              </div>
                              <div className="mt-0.5 font-mono text-sm sm:text-base font-extrabold text-slate-900 tabular-nums">
                                {laborLabel}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between border-t border-emerald-200/70 pt-1.5 px-1">
                            <span className="text-xs font-bold text-emerald-900">
                              ยอดรวมสุทธิ (ค่าอะไหล่ + ค่าแรง)
                            </span>
                            <span className="font-mono text-sm sm:text-base font-extrabold text-emerald-800 tabular-nums">
                              {netTotalLabel}
                            </span>
                          </div>
                        </div>

                        {/* กล่องอาการ: อาการ / รายละเอียดที่ต้องการซ่อม */}
                        <div className="rounded-xl border border-slate-200/90 bg-white p-3">
                          <div className="text-[11px] font-bold text-slate-600">
                            อาการ / รายละเอียดที่ต้องการซ่อม
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-xs sm:text-sm font-medium leading-relaxed text-slate-900">
                            {sym || '-'}
                          </div>
                        </div>

                        {reqInfoText && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-900">
                            <strong className="font-bold text-amber-950">คำขอข้อมูลเพิ่ม:</strong>{' '}
                            <span className="whitespace-pre-wrap">{reqInfoText}</span>
                          </div>
                        )}

                        {replyText && (
                          <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-2.5 text-xs text-emerald-950 shadow-2xs">
                            <div className="font-bold text-emerald-900 flex items-center gap-1 mb-1">
                              <span className="text-sm">💬</span>
                              <span>ประวัติ / ข้อความตอบกลับข้อมูลเพิ่มเติม:</span>
                            </div>
                            <div className="whitespace-pre-wrap font-semibold text-emerald-950 bg-white/90 p-2 rounded-lg border border-emerald-200/80">
                              {replyText}
                            </div>
                          </div>
                        )}

                        {/* ส่วนรูปถ่าย: รูปถ่ายประกอบการแจ้งซ่อม */}
                        {itemPhotos.length > 0 && (
                          <div className="rounded-xl border border-slate-200/80 bg-white p-2.5 sm:p-3">
                            <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                <span>รูปถ่ายประกอบการแจ้งซ่อม ({itemPhotos.length} รูป)</span>
                              </span>
                              <span className="text-[10px] sm:text-[11px] text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                                🔍 แตะที่รูปเพื่อซูมขยายดูภาพชัด
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                              {itemPhotos.map((pSrc, pIdx) => (
                                <div
                                  key={pIdx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPhotoZoom(itemPhotos, pIdx, r);
                                  }}
                                  className="group relative cursor-pointer overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-900 shadow-2xs hover:border-blue-500 hover:shadow-sm transition-all"
                                  title="แตะเพื่อซูมดูรูปคมชัดระดับ HD (ใช้นิ้วถ่างซูมได้)"
                                >
                                  <DrivePhotoImg
                                    src={pSrc}
                                    alt={`รูปงานซ่อม ${pIdx + 1}`}
                                    className="h-28 sm:h-32 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                  />
                                  <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white backdrop-blur-[1px]">
                                    <div className="flex items-center gap-1 rounded-full bg-slate-900/90 px-2.5 py-1 text-[10px] font-bold text-white shadow">
                                      <ZoomIn className="h-3.5 w-3.5 text-blue-400" />
                                      <span>ซูมดูชัด</span>
                                    </div>
                                  </div>
                                  <span className="absolute bottom-1.5 right-1.5 rounded-md bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                                    {pIdx + 1}/{itemPhotos.length}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ส่วนผู้รับผิดชอบ (2 คอลัมน์คู่กัน): ผู้แจ้ง และ ผู้ตรวจสอบ */}
                        <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200/80 bg-white p-2.5 text-xs">
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-slate-500">ผู้แจ้ง</div>
                            <div className="mt-0.5 font-bold text-slate-900 truncate">
                              {rep || '-'}
                            </div>
                          </div>
                          <div className="min-w-0 border-l border-slate-200 pl-2.5">
                            <div className="text-[11px] font-medium text-slate-500">ผู้ตรวจสอบ</div>
                            <div className="mt-0.5 font-bold text-slate-900 truncate">
                              {inspector || '-'}
                            </div>
                          </div>
                        </div>

                        {/* แถบปุ่มกดอนุมัติด้านล่าง (บรรทัดเดียว ไม่ขึ้นบรรทัดใหม่บนมือถือ) */}
                        <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleOpenDecision(r, '3.✔️อนุมัติ')}
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-700 px-2 py-2.5 text-[11px] sm:text-sm font-bold text-white whitespace-nowrap shadow-2xs transition-colors hover:bg-emerald-800 active:scale-[0.99]"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                            <span className="whitespace-nowrap">อนุมัติ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDecision(r, '4.⚠️ขอข้อมูลเพิ่มเติม')}
                            className="flex-[1.35] inline-flex items-center justify-center gap-1 rounded-xl bg-amber-600 px-2 py-2.5 text-[11px] sm:text-sm font-bold text-white whitespace-nowrap shadow-2xs transition-colors hover:bg-amber-700 active:scale-[0.99]"
                          >
                            <HelpCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                            <span className="whitespace-nowrap">ขอข้อมูลเพิ่ม</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDecision(r, '1.❌ไม่อนุมัติ')}
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-red-50/70 px-2 py-2.5 text-[11px] sm:text-sm font-bold text-red-700 whitespace-nowrap transition-colors hover:bg-red-100 active:scale-[0.99]"
                          >
                            <XCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                            <span className="whitespace-nowrap">ไม่อนุมัติ</span>
                          </button>
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

      {/* High-Resolution Interactive Zoom & Pan Lightbox Modal */}
      <PhotoLightboxModal
        isOpen={lightboxState.isOpen}
        onClose={() => setLightboxState((prev) => ({ ...prev, isOpen: false }))}
        photos={lightboxState.photos}
        initialIndex={lightboxState.initialIndex}
        title={lightboxState.title}
        subtitle={lightboxState.subtitle}
        vehicleNo={lightboxState.vehicleNo}
        sequenceNo={lightboxState.sequenceNo}
        rowNumber={lightboxState.rowNumber}
        repairRequestNo={lightboxState.repairRequestNo}
        onPhotosUpdated={(updatedPhotos) => {
          setLightboxState((prev) => ({ ...prev, photos: updatedPhotos }));
          if (lightboxState.targetRow) {
            PHOTO_COLS.forEach((col, i) => {
              lightboxState.targetRow!.values[col] = updatedPhotos[i] || '';
            });
          }
          onApprovedSuccess();
        }}
      />
    </div>
  );
};
