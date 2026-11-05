import React, { useState, useMemo, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { DeliveryPointPayload, SheetRow } from '../types';
import { appendDeliveryPointRecord } from '../services/googleSheets';

interface DeliveryPointModalProps {
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

export const DeliveryPointModal: React.FC<DeliveryPointModalProps> = ({
  isOpen,
  onClose,
  existingRows,
  onSavedSuccess,
}) => {
  const [date, setDate] = useState<string>(getCurrentThaiDateString());
  const [deliveryPoint, setDeliveryPoint] = useState<string>('');
  const [gate, setGate] = useState<string>('');

  const [isConfirmStep, setIsConfirmStep] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Extract unique delivery points and gates from real rows in จุดส่งสินค้า
  const referenceOptions = useMemo(() => {
    const pointToGateMap = new Map<string, string>();
    const deliveryPoints = new Set<string>();
    const gates = new Set<string>();

    existingRows.forEach((row) => {
      const pt = row.values['B']?.trim() ?? '';
      const gt = row.values['C']?.trim() ?? '';
      if (pt) {
        deliveryPoints.add(pt);
        if (gt && !pointToGateMap.has(pt)) {
          pointToGateMap.set(pt, gt);
        }
      }
      if (gt) {
        gates.add(gt);
      }
    });

    return {
      pointToGateMap,
      deliveryPoints: Array.from(deliveryPoints),
      gates: Array.from(gates),
    };
  }, [existingRows]);

  useEffect(() => {
    if (isOpen) {
      setDate(getCurrentThaiDateString());
      setIsConfirmStep(false);
      setSubmitError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDeliveryPointChange = (val: string) => {
    setDeliveryPoint(val);
    const defaultGate = referenceOptions.pointToGateMap.get(val.trim());
    if (defaultGate && !gate) {
      setGate(defaultGate);
    }
  };

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!date.trim()) {
      setSubmitError('กรุณาระบุวันที่');
      return;
    }
    if (!deliveryPoint.trim()) {
      setSubmitError('กรุณาระบุจุดส่งสินค้า');
      return;
    }
    if (!gate.trim()) {
      setSubmitError('กรุณาระบุประตู');
      return;
    }

    setIsConfirmStep(true);
  };

  const handleConfirmedSave = async () => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const payload: DeliveryPointPayload = {
        date: date.trim(),
        deliveryPoint: deliveryPoint.trim(),
        gate: gate.trim(),
      };

      await appendDeliveryPointRecord(payload);

      setDeliveryPoint('');
      setGate('');
      setIsConfirmStep(false);

      onSavedSuccess();
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกจุดส่งสินค้าลง Google Sheets'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isConfirmStep
                ? 'ยืนยันการเพิ่มจุดส่งสินค้าลงฐานข้อมูล'
                : 'เพิ่มจุดส่งสินค้าใหม่'}
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span>ตาราง จุดส่งสินค้า</span>
              <span aria-hidden="true">·</span>
              <span>Google Sheets Database</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="mx-6 mt-4 flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Confirmation View or Form View */}
        {isConfirmStep ? (
          <div className="overflow-y-auto px-6 py-5">
            <p className="text-sm text-slate-700">
              กรุณาตรวจสอบข้อมูลด้านล่างก่อนยืนยันการบันทึกลงในตาราง{' '}
              <strong className="font-semibold text-slate-900">จุดส่งสินค้า</strong>:
            </p>

            <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-2 text-sm">
              <div className="flex justify-between py-2.5">
                <span className="text-xs font-medium text-slate-500">วันที่</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {date}
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-xs font-medium text-slate-500">
                  จุดส่งสินค้า
                </span>
                <span className="font-semibold text-slate-900">
                  {deliveryPoint}
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-xs font-medium text-slate-500">ประตู</span>
                <span className="font-semibold text-slate-900">{gate}</span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmStep(false)}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                กลับไปแก้ไข
              </button>
              <button
                type="button"
                onClick={handleConfirmedSave}
                disabled={isSubmitting}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {isSubmitting
                  ? 'กำลังบันทึกลง Google Sheets...'
                  : 'ยืนยันการบันทึกลงฐานข้อมูล'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleReviewSubmit} className="overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              {/* วันที่ */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  วันที่ (ว/ด/พ.ศ.) <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="เช่น 5/11/2569"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* จุดส่งสินค้า */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  จุดส่งสินค้า <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-delivery-points"
                  value={deliveryPoint}
                  onChange={(e) => handleDeliveryPointChange(e.target.value)}
                  placeholder="เช่น CF01, CF02, TM01"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-delivery-points">
                  {referenceOptions.deliveryPoints.map((pt) => (
                    <option key={pt} value={pt} />
                  ))}
                </datalist>
              </div>

              {/* ประตู */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  ประตู <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-gates"
                  value={gate}
                  onChange={(e) => setGate(e.target.value)}
                  placeholder="เช่น โอ1/3, โอ1/2, 01/2/4"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-gates">
                  {referenceOptions.gates.map((gt) => (
                    <option key={gt} value={gt} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                ตรวจสอบและบันทึกข้อมูล
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
