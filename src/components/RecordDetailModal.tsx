import React from 'react';
import { X, Copy, Check } from 'lucide-react';
import { SheetColumn, SheetRow } from '../types';

interface RecordDetailModalProps {
  row: SheetRow | null;
  columns: SheetColumn[];
  tabName: string;
  onClose: () => void;
}

export const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  row,
  columns,
  tabName,
  onClose,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              รายละเอียดข้อมูลรายการ
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span>ตาราง {tabName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                แถวที่ #{row.rowNumber.toLocaleString('th-TH')}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4">
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
                  className="group flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <div className="shrink-0 text-xs font-medium text-slate-500 sm:w-48">
                    {col.label}
                  </div>
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <span
                      className={`break-words whitespace-pre-wrap text-sm text-slate-900 ${
                        isNumericOrDate ? 'font-mono tabular-nums' : ''
                      }`}
                    >
                      {val}
                    </span>
                    {val !== '-' && (
                      <button
                        type="button"
                        onClick={() => handleCopy(col.id, val)}
                        title="คัดลอกข้อมูล"
                        className="shrink-0 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
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

        <div className="flex items-center justify-end border-t border-slate-200 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
