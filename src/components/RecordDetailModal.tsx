import React from 'react';
import { X, Copy, Check, Camera } from 'lucide-react';
import { SheetColumn, SheetRow } from '../types';

interface RecordDetailModalProps {
  row: SheetRow | null;
  columns: SheetColumn[];
  tabName: string;
  onClose: () => void;
  onOpenAttachPhotos?: (row: SheetRow) => void;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  row,
  columns,
  tabName,
  onClose,
  onOpenAttachPhotos,
}) => {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  if (!row) return null;

  const handleCopy = (key: string, text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1500);
  };

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
              const val = row.values[col.id] || '-';
              const isNumericOrDate =
                col.type === 'number' ||
                col.type === 'date' ||
                col.type === 'datetime' ||
                col.type === 'timeofday';

              return (
                <div
                  key={col.id}
                  className="group flex items-baseline justify-between gap-3 py-2"
                >
                  <div className="shrink-0 text-xs font-medium text-slate-500">
                    {col.label}
                  </div>
                  <div className="flex min-w-0 flex-col items-end gap-1.5 text-right">
                    {val.startsWith('data:image/') ||
                    val.includes('.jpg') ||
                    val.includes('.png') ||
                    val.includes('.jpeg') ||
                    ((val.startsWith('http://') || val.startsWith('https://')) &&
                      (col.label.includes('รูป') || col.label.includes('ภาพ'))) ? (
                      <div className="flex flex-col items-end gap-1">
                        {val.startsWith('data:image/') || val.startsWith('http') ? (
                          <img
                            src={val}
                            alt={col.label}
                            className="max-h-36 max-w-xs rounded-lg border border-slate-200 object-cover shadow-xs"
                          />
                        ) : (
                          <span className="font-mono text-xs text-slate-700">{val}</span>
                        )}
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
          {tabName.includes('ซ่อม') && onOpenAttachPhotos ? (
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
