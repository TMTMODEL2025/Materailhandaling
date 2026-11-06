import React, { useState, useMemo } from 'react';
import { X, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { SheetRow, RepairApprovalPayload } from '../types';
import { approveRepairRecord } from '../services/googleSheets';

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

export const ManagerApprovalModal: React.FC<ManagerApprovalModalProps> = ({
  isOpen,
  onClose,
  rows,
  onApprovedSuccess,
}) => {
  const [filterMode, setFilterMode] = useState<'PENDING' | 'ALL'>('PENDING');
  const [approverName, setApproverName] = useState<string>(
    () => localStorage.getItem('gsheets_manager_approver_name') || ''
  );
  const [selectedRow, setSelectedRow] = useState<SheetRow | null>(null);
  const [decision, setDecision] = useState<'3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ'>('3.✔️อนุมัติ');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter rows based on approval status
  const pendingRows = useMemo(() => {
    return rows.filter((r) => {
      const status = (r.values['AI'] ?? '').trim();
      return (
        status === '2.⚠️รอพิจารณา' ||
        status === 'รอพิจารณา' ||
        status === 'รออนุมัติ' ||
        !status
      );
    });
  }, [rows]);

  const displayedRows = filterMode === 'PENDING' ? pendingRows : rows;

  if (!isOpen) return null;

  const handleOpenDecision = (row: SheetRow, defaultDecision: '3.✔️อนุมัติ' | '1.❌ไม่อนุมัติ') => {
    setSelectedRow(row);
    setDecision(defaultDecision);
    setNote('');
    setError(null);
  };

  const handleConfirmDecision = async () => {
    if (!selectedRow) return;
    if (!approverName.trim()) {
      setError('กรุณาระบุชื่อผู้อนุมัติ');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const repairStatus = decision === '3.✔️อนุมัติ' ? 'รอคิวซ่อม' : 'ยกเลิกการซ่อม';
      const payload: RepairApprovalPayload = {
        rowNumber: selectedRow.rowNumber,
        sequenceNo: (selectedRow.values['A'] ?? '').trim(),
        approvalStatus: decision,
        approverName: approverName.trim(),
        approvalDate: getCurrentThaiDateString(),
        approvalTime: getCurrentTimeString(),
        repairStatus,
        note: note.trim(),
      };

      await approveRepairRecord(payload);
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
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
          {selectedRow ? (
            /* Confirmation card */
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  ยืนยันการอนุมัติรายการ #{selectedRow.values['A'] || selectedRow.rowNumber}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRow(null)}
                  className="text-xs text-slate-500 hover:underline"
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

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:text-sm">
                <div>
                  <span className="text-slate-500">วันที่แจ้ง:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedRow.values['B']} {selectedRow.values['C']}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">เบอร์รถ:</span>{' '}
                  <span className="font-mono font-bold text-slate-900">
                    {selectedRow.values['D']}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">ประเภทการซ่อม:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedRow.values['E']}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">ผู้แจ้ง:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {selectedRow.values['AA']}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">อาการเสีย:</span>
                  <div className="mt-0.5 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs text-slate-800">
                    {selectedRow.values['F'] || '-'}
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3">
                <label className="block text-xs font-semibold text-slate-800">
                  ผลการพิจารณา:
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDecision('3.✔️อนุมัติ')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      decision === '3.✔️อนุมัติ'
                        ? 'bg-emerald-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>3.✔️ อนุมัติ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision('1.❌ไม่อนุมัติ')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      decision === '1.❌ไม่อนุมัติ'
                        ? 'bg-red-700 text-white'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>1.❌ ไม่อนุมัติ</span>
                  </button>
                </div>

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
            <div className="divide-y divide-slate-100">
              {displayedRows.map((r) => {
                const seq = r.values['A'] || `#${r.rowNumber}`;
                const dt = r.values['B'] || '';
                const veh = r.values['D'] || '';
                const typ = r.values['E'] || '';
                const sym = r.values['F'] || '';
                const rep = r.values['AA'] || '';
                const appStatus = (r.values['AI'] ?? '').trim();
                const approver = r.values['AE'] || '';

                const isApproved = appStatus.includes('อนุมัติ') && !appStatus.includes('ไม่อนุมัติ') && !appStatus.includes('รอ');
                const isRejected = appStatus.includes('ไม่อนุมัติ');

                return (
                  <div
                    key={r.rowNumber}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          ลำดับ {seq}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                          {veh}
                        </span>
                        <span className="text-xs text-slate-500">{dt}</span>
                        {appStatus && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              isApproved
                                ? 'bg-emerald-50 text-emerald-700'
                                : isRejected
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {appStatus}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-700">
                        <strong className="font-medium text-slate-900">{typ}:</strong>{' '}
                        <span className="text-slate-600 line-clamp-1">{sym || '-'}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        ผู้แจ้ง: {rep || '-'} {approver ? `· ผู้อนุมัติ: ${approver}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(r, '3.✔️อนุมัติ')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>อนุมัติ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDecision(r, '1.❌ไม่อนุมัติ')}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>ไม่อนุมัติ</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
