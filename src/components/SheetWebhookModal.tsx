import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Link2 } from 'lucide-react';
import {
  GOOGLE_APPS_SCRIPT_CODE,
  GOOGLE_SHEET_ID,
  getConfiguredAppsScriptUrl,
  saveConfiguredAppsScriptUrl,
} from '../services/googleSheets';

interface SheetWebhookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const SheetWebhookModal: React.FC<SheetWebhookModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [urlInput, setUrlInput] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showScript, setShowScript] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setUrlInput(getConfiguredAppsScriptUrl());
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // ignore
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await saveConfiguredAppsScriptUrl(urlInput);
      onSaved();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSaving) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5 sm:py-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              เชื่อมต่อ Google Sheet (ไม่ต้องล็อกอิน)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="overflow-y-auto px-4 py-3.5 sm:px-5">
          <div className="space-y-3 text-xs text-slate-700">
            <div>
              <label className="block text-xs font-semibold text-slate-900">
                Apps Script Web App URL
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  วิธีตั้งค่าใน Google Sheet (ครั้งเดียว)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowScript((prev) => !prev)}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {showScript ? 'ซ่อนโค้ด' : 'ดูโค้ด'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span>คัดลอกแล้ว</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>คัดลอกโค้ด Apps Script</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-slate-600">
                <li>
                  เปิด{' '}
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-900 underline"
                  >
                    Google Sheet ต้นฉบับ
                  </a>{' '}
                  ไปที่เมนู <strong>ส่วนขยาย (Extensions) → Apps Script</strong>
                </li>
                <li>กดปุ่ม <strong>คัดลอกโค้ด Apps Script</strong> ด้านบน ไปวางแทนที่โค้ดเดิมแล้วกดบันทึก</li>
                <li>
                  กด <strong>การทำให้ใช้งานได้ (Deploy) → รายการใหม่ (New deployment) → เว็บแอป (Web app)</strong> เลือกผู้มีสิทธิ์เข้าถึงเป็น <strong>ทุกคน (Anyone)</strong>
                </li>
                <li>นำ URL ที่ได้มาวางในช่องด้านบนแล้วกดบันทึก (ทุกเครื่องจะใช้งานได้ทันทีโดยไม่ต้องล็อกอิน)</li>
              </ol>

              {showScript && (
                <pre className="mt-2.5 max-h-44 overflow-auto rounded border border-slate-200 bg-white p-2 font-mono text-[10px] text-slate-700">
                  {GOOGLE_APPS_SCRIPT_CODE}
                </pre>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ปิด
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSaving ? 'กำลังบันทึก...' : 'บันทึกการเชื่อมต่อ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
