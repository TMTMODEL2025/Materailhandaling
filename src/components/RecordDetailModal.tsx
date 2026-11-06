import React, { useState } from 'react';
import { X, Copy, Check, Camera, Pencil } from 'lucide-react';
import { SheetColumn, SheetRow } from '../types';
import { formatDriveImageUrl, getDriveThumbnailUrl } from '../services/googleSheets';

interface RecordDetailModalProps {
  row: SheetRow | null;
  columns: SheetColumn[];
  tabName: string;
  onClose: () => void;
  onOpenAttachPhotos?: (row: SheetRow) => void;
  onUpdateAdditionalDetails?: (row: SheetRow, newDetails: string) => Promise<void>;
  onUpdateReplyDetails?: (row: SheetRow, newReply: string) => Promise<void>;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  row,
  columns,
  tabName,
  onClose,
  onOpenAttachPhotos,
  onUpdateAdditionalDetails,
  onUpdateReplyDetails,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessColId, setSaveSuccessColId] = useState<string | null>(null);

  if (!row) return null;

  const handleCopy = (key: string, text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1500);
  };

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
      } else if (colId === 'AM' || colId.includes('ตอบกลับ')) {
        if (onUpdateReplyDetails) {
          await onUpdateReplyDetails(row, cleanVal);
        }
      }
      row.values[colId] = cleanVal;
      setEditingColId(null);
      setSaveSuccessColId(colId);
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

              const hasValidPhoto =
                rawVal.startsWith('data:image/') ||
                rawVal.startsWith('http://') ||
                rawVal.startsWith('https://') ||
                rawVal.includes('.jpg') ||
                rawVal.includes('.jpeg') ||
                rawVal.includes('.png');

              // Hide photo fields if there is no attached photo
              if (isPhotoColumn && (!rawVal || rawVal === '-' || !hasValidPhoto)) {
                return null;
              }

              const val = rawVal || '-';
              const isNumericOrDate =
                col.type === 'number' ||
                col.type === 'date' ||
                col.type === 'datetime' ||
                col.type === 'timeofday';

              const isEditableInModal =
                isRepairTab &&
                (col.id === 'AK' ||
                  col.id === 'AM' ||
                  col.label.includes('รายละเอียดเพิ่มเติม') ||
                  col.label.includes('ตอบกลับข้อมูลเพิ่มเติม'));

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
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      rows={3}
                      placeholder={`พิมพ์${col.label}...`}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs resize-y"
                    />
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
                          <img
                            src={formatDriveImageUrl(val)}
                            onError={(e) => {
                              const fallback = getDriveThumbnailUrl(val);
                              if (fallback && e.currentTarget.src !== fallback) {
                                e.currentTarget.src = fallback;
                              }
                            }}
                            alt={col.label}
                            className="max-h-36 max-w-xs rounded-lg border border-slate-200 object-cover shadow-xs"
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

                    {val !== '-' && (
                      <button
                        type="button"
                        onClick={() => handleCopy(col.id, val)}
                        title="คัดลอกข้อมูล"
                        className="shrink-0 rounded p-1 text-slate-400 transition-opacity hover:bg-slate-100 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                      >
                        {copiedId === col.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
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
    </div>
  );
};
