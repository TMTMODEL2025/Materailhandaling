import React, { useState } from 'react';
import { X, Check, Camera, Pencil } from 'lucide-react';
import { SheetColumn, SheetRow } from '../types';
import { isPhotoValue } from '../services/googleSheets';
import { DrivePhotoImg } from './DrivePhotoImg';
import { showSuccessToast } from '../utils/swal';

interface RecordDetailModalProps {
  row: SheetRow | null;
  columns: SheetColumn[];
  tabName: string;
  onClose: () => void;
  onOpenAttachPhotos?: (row: SheetRow) => void;
  onUpdateAdditionalDetails?: (row: SheetRow, newDetails: string) => Promise<void>;
  onUpdateReplyDetails?: (row: SheetRow, newReply: string) => Promise<void>;
  onUpdateFinancialDetails?: (row: SheetRow, spareParts: string, labor: string) => Promise<void>;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  row,
  columns,
  tabName,
  onClose,
  onOpenAttachPhotos,
  onUpdateAdditionalDetails,
  onUpdateReplyDetails,
  onUpdateFinancialDetails,
}) => {
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessColId, setSaveSuccessColId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  if (!row) return null;

  const startEditing = (colId: string, currentVal: string) => {
    setEditingColId(colId);
    setEditValue(currentVal === '-' ? '' : currentVal);
    setSaveSuccessColId(null);
  };

  const handleSaveField = async (colId: string) => {
    if (!row) return;
    setIsSaving(true);
    try {
      const cleanVal = editValue.trim();
      if (colId === 'AK' || colId.includes('รายละเอียดเพิ่มเติม')) {
        if (onUpdateAdditionalDetails) {
          await onUpdateAdditionalDetails(row, cleanVal);
        }
        row.values[colId] = cleanVal;
      } else if (colId === 'AM' || colId.includes('ตอบกลับ')) {
        if (onUpdateReplyDetails) {
          await onUpdateReplyDetails(row, cleanVal);
        }
        row.values[colId] = cleanVal;
      } else if (colId === 'N' || colId === 'O' || colId.includes('ค่าอะไหล่') || colId.includes('ค่าแรง')) {
        const spareParts = colId === 'N' || colId.includes('ค่าอะไหล่') ? cleanVal : (row.values['N'] ?? '');
        const labor = colId === 'O' || colId.includes('ค่าแรง') ? cleanVal : (row.values['O'] ?? '');
        if (onUpdateFinancialDetails) {
          await onUpdateFinancialDetails(row, spareParts, labor);
        }
        row.values['N'] = spareParts;
        row.values['O'] = labor;
      }

      setEditingColId(null);
      setSaveSuccessColId(colId);

      const isReply = colId === 'AM' || colId.includes('ตอบกลับ');
      const isFinancial = colId === 'N' || colId === 'O' || colId.includes('ค่าอะไหล่') || colId.includes('ค่าแรง');
      showSuccessToast(
        isFinancial ? 'บันทึกค่าใช้จ่ายสำเร็จ!' : isReply ? 'บันทึกการตอบกลับสำเร็จ!' : 'บันทึกรายละเอียดเพิ่มเติมสำเร็จ!',
        isFinancial
          ? 'อัปเดตค่าอะไหล่และค่าแรงเรียบร้อยแล้ว'
          : isReply
          ? 'ส่งข้อความตอบกลับและอัปเดตสถานะเรียบร้อยแล้ว'
          : 'ระบบบันทึกรายละเอียดเพิ่มเติมเรียบร้อยแล้ว'
      );

      setTimeout(() => setSaveSuccessColId(null), 3000);
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
    }
  };

  const isRepairTab = tabName.includes('ซ่อม');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5 sm:py-3.5">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base truncate">
            {tabName}{' '}
            <span className="font-mono text-xs font-normal text-slate-500 tabular-nums">
              #{row.rowNumber.toLocaleString('th-TH')}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-2.5 sm:px-5 sm:py-3.5">
          <div className="divide-y divide-slate-100">
            {columns.map((col) => {
              const rawVal = (row.values[col.id] || '').trim();
              const isPhotoColumn =
                col.label.includes('รูป') ||
                col.label.includes('ภาพ') ||
                ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'].includes(col.id);

              const hasValidPhoto = isPhotoValue(rawVal);

              // Hide photo fields if there is no attached photo
              if (isPhotoColumn && (!rawVal || rawVal === '-' || !hasValidPhoto)) {
                return null;
              }

              // Hide optional repair fields when they have no data (empty or '-')
              const isHideIfEmptyField =
                col.id === 'H' ||
                col.id === 'I' ||
                col.id === 'J' ||
                col.id === 'K' ||
                col.id === 'L' ||
                col.id === 'M' ||
                col.label.includes('SAP') ||
                col.label.includes('กำหนดการ') ||
                col.label.includes('ซ่อมเสร็จ') ||
                col.label.includes('ระยะเวลาซ่อม') ||
                col.label.includes('PR') ||
                col.label.includes('ใบกำกับภาษี');

              if (isRepairTab && isHideIfEmptyField && (!rawVal || rawVal === '-')) {
                return null;
              }

              let val = rawVal || '-';
              if (
                (col.id === 'AI' || col.label.includes('สถานะการอนุมัติ')) &&
                (!rawVal || rawVal === '-' || rawVal === '2.⚠️รอพิจารณา' || rawVal === 'รอพิจารณา')
              ) {
                val = '2.⚠️รออนุมัติ';
              }
              const isNumericOrDate =
                col.type === 'number' ||
                col.type === 'date' ||
                col.type === 'datetime' ||
                col.type === 'timeofday';

              const isEditableInModal =
                isRepairTab &&
                (col.id === 'AK' ||
                  col.id === 'AM' ||
                  col.id === 'N' ||
                  col.id === 'O' ||
                  col.label.includes('รายละเอียดเพิ่มเติม') ||
                  col.label.includes('ตอบกลับข้อมูลเพิ่มเติม') ||
                  col.label.includes('ค่าอะไหล่') ||
                  col.label.includes('ค่าแรง'));

              if (isEditableInModal && editingColId === col.id) {
                return (
                  <div key={col.id} className="py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-700">
                        {col.label}
                      </span>
                      <span className="text-[11px] font-medium text-slate-400">
                        กำลังแก้ไข
                      </span>
                    </div>
                    {col.id === 'N' || col.id === 'O' || col.label.includes('ค่าอะไหล่') || col.label.includes('ค่าแรง') ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder={`พิมพ์${col.label}...`}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs sm:text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                      />
                    ) : (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={3}
                        placeholder={`พิมพ์${col.label}...`}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs resize-y"
                      />
                    )}
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => setEditingColId(null)}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleSaveField(col.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={col.id}
                  className="group flex items-baseline justify-between gap-3 py-2"
                >
                  <div className="shrink-0 text-xs font-medium text-slate-500">
                    {col.label}
                  </div>
                  <div className="flex min-w-0 flex-col items-end gap-1 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {hasValidPhoto && isPhotoColumn ? (
                        <div className="flex flex-col items-end gap-1">
                          <DrivePhotoImg
                            src={val}
                            alt={col.label}
                            onClick={() => setPreviewPhoto(val)}
                            className="max-h-36 max-w-xs cursor-pointer rounded-lg border border-slate-200 object-cover shadow-xs transition-opacity hover:opacity-95"
                          />
                        </div>
                      ) : (
                        <span
                          className={`break-words whitespace-pre-wrap text-xs sm:text-sm font-medium text-slate-900 ${
                            isNumericOrDate ? 'font-mono tabular-nums' : ''
                          }`}
                        >
                          {val}
                        </span>
                      )}

                      {isEditableInModal && (
                        <button
                          type="button"
                          onClick={() => startEditing(col.id, val)}
                          title={`แก้ไข${col.label}`}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-900 hover:text-slate-900 shadow-2xs shrink-0"
                        >
                          <Pencil className="h-2.5 w-2.5 text-slate-600" />
                          <span>แก้ไข</span>
                        </button>
                      )}
                    </div>

                    {saveSuccessColId === col.id && (
                      <span className="text-[11px] font-semibold text-emerald-600">
                        บันทึกข้อมูลเรียบร้อยแล้ว
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 sm:px-5">
          {isRepairTab && onOpenAttachPhotos ? (
            <button
              type="button"
              onClick={() => onOpenAttachPhotos(row)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>แนบรูปเพิ่ม / แก้ไขรูปถ่าย</span>
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            ปิด
          </button>
        </div>
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewPhoto(null);
          }}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <DrivePhotoImg
              src={previewPhoto}
              alt="ดูรูปภาพขนาดเต็ม"
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setPreviewPhoto(null)}
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
