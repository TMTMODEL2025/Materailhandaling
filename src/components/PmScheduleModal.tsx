import React, { useState, useEffect } from 'react';
import { X, Calendar, Wrench, CheckCircle2, AlertTriangle, RefreshCw, Save } from 'lucide-react';
import { SheetRow } from '../types';
import { savePmScheduleRecord } from '../services/googleSheets';
import { getCurrentThaiDateString, parseNumericCell } from '../utils/sheetMetrics';

interface PmScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  editingRow?: SheetRow | null;
  vehicleOptions?: string[];
  allPmRows?: SheetRow[];
}

export const PM_CYCLE_PRESETS = [
  'PM 250 ชม.',
  'PM 500 ชม.',
  'PM 1,000 ชม.',
  'PM 10,000 กม.',
  'PM 20,000 กม.',
  'PM 40,000 กม.',
];

export const PM_STATUS_OPTIONS = [
  '❌ ยังไม่ครบกำหนดPM',
  '⚠️ ครบรอบPM',
];

export const PmScheduleModal: React.FC<PmScheduleModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editingRow,
  vehicleOptions = [],
  allPmRows = [],
}) => {
  const [date, setDate] = useState<string>(getCurrentThaiDateString());
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [prevMileage, setPrevMileage] = useState<string>('0');
  const [currMileage, setCurrMileage] = useState<string>('0');
  const [pmCycle, setPmCycle] = useState<string>('PM 250 ชม.');
  const [pmStatus, setPmStatus] = useState<string>('❌ ยังไม่ครบกำหนดPM');
  const [isCustomCycle, setIsCustomCycle] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize form when modal opens or editingRow changes
  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    if (editingRow) {
      // Edit existing row
      const rVals = editingRow.values;
      const rDate = (rVals['B'] ?? '').trim() || getCurrentThaiDateString();
      const rVeh = (rVals['C'] ?? '').trim();
      const rPrev = (rVals['D'] ?? '0').trim();
      const rCurr = (rVals['E'] ?? '0').trim();
      const rCycle = (rVals['F'] ?? 'PM 250 ชม.').trim();
      const rStatus = (rVals['G'] ?? '❌ ยังไม่ครบกำหนดPM').trim();

      setDate(rDate);
      setVehicleNumber(rVeh);
      setPrevMileage(rPrev);
      setCurrMileage(rCurr);
      setPmCycle(rCycle);
      setPmStatus(rStatus);
      setIsCustomCycle(!PM_CYCLE_PRESETS.includes(rCycle));
    } else {
      // New record
      setDate(getCurrentThaiDateString());
      setVehicleNumber(vehicleOptions[0] || '');
      setPrevMileage('0');
      setCurrMileage('0');
      setPmCycle('PM 250 ชม.');
      setPmStatus('❌ ยังไม่ครบกำหนดPM');
      setIsCustomCycle(false);
    }
  }, [isOpen, editingRow, vehicleOptions]);

  // Handle vehicle selection & auto-lookup existing mileage
  const handleVehicleChange = (veh: string) => {
    setVehicleNumber(veh);
    if (!editingRow && veh) {
      const existing = allPmRows.find(
        (r) => (r.values['C'] ?? '').trim().toUpperCase() === veh.trim().toUpperCase()
      );
      if (existing) {
        const pMile = (existing.values['D'] ?? '0').trim();
        const cMile = (existing.values['E'] ?? '0').trim();
        const cycle = (existing.values['F'] ?? 'PM 250 ชม.').trim();
        const status = (existing.values['G'] ?? '❌ ยังไม่ครบกำหนดPM').trim();

        setPrevMileage(pMile);
        setCurrMileage(cMile);
        if (cycle) {
          setPmCycle(cycle);
          setIsCustomCycle(!PM_CYCLE_PRESETS.includes(cycle));
        }
        if (status) {
          setPmStatus(status);
        }
      }
    }
  };

  // Auto-calculate PM status based on mileage comparison if user hasn't explicitly locked it
  const handleCurrMileageChange = (val: string) => {
    setCurrMileage(val);
    const prevNum = parseNumericCell(prevMileage);
    const currNum = parseNumericCell(val);
    if (currNum > prevNum && prevNum > 0) {
      setPmStatus('⚠️ ครบรอบPM');
    } else {
      setPmStatus('❌ ยังไม่ครบกำหนดPM');
    }
  };

  const handlePrevMileageChange = (val: string) => {
    setPrevMileage(val);
    const prevNum = parseNumericCell(val);
    const currNum = parseNumericCell(currMileage);
    if (currNum > prevNum && prevNum > 0) {
      setPmStatus('⚠️ ครบรอบPM');
    } else {
      setPmStatus('❌ ยังไม่ครบกำหนดPM');
    }
  };

  const handleCopyCurrToPrev = () => {
    setPrevMileage(currMileage);
    setPmStatus('❌ ยังไม่ครบกำหนดPM');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleNumber.trim()) {
      setErrorMsg('กรุณาเลือกหรือระบุหมายเลขรถ');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const rowNumber = editingRow?.rowNumber ?? 0;
      await savePmScheduleRecord({
        rowNumber,
        date: date.trim() || getCurrentThaiDateString(),
        vehicleNumber: vehicleNumber.trim(),
        prevMileage: prevMileage.trim(),
        currMileage: currMileage.trim(),
        pmCycle: pmCycle.trim(),
        pmStatus: pmStatus.trim(),
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setErrorMsg(String((err as Error)?.message || err || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-3 backdrop-blur-xs sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-5 py-4 text-white rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-slate-950 font-bold shadow-xs">
              <Wrench className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold leading-tight">
                {editingRow ? 'แก้ไขกำหนดรอบ PM' : 'บันทึก / กำหนดรอบ PM รถ'}
              </h3>
              <p className="text-xs text-slate-300">
                {editingRow ? `ปรับปรุงข้อมูลคัน ${vehicleNumber}` : 'เพิ่มข้อมูลระยะทางและรอบ Maintenance'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Row 1: วันที่ & หมายเลขรถ */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                วันที่ <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="เช่น 11/11/2569"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                />
                <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                หมายเลขรถ <span className="text-red-500">*</span>
              </label>
              {vehicleOptions.length > 0 ? (
                <select
                  value={vehicleNumber}
                  onChange={(e) => handleVehicleChange(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                >
                  <option value="">-- เลือกหมายเลขรถ --</option>
                  {vehicleOptions.map((veh) => (
                    <option key={veh} value={veh}>
                      {veh}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={vehicleNumber}
                  onChange={(e) => handleVehicleChange(e.target.value)}
                  placeholder="เช่น TT-03, FL-1"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                />
              )}
            </div>
          </div>

          {/* Row 2: เลขไมล์ครั้งก่อน & เลขไมล์ปัจจุบัน */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  เลขไมล์ครั้งก่อน
                </label>
                <button
                  type="button"
                  onClick={handleCopyCurrToPrev}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline"
                  title="กดเมื่อทำ PM เสร็จสิ้น เพื่ออัปเดตไมล์ครั้งก่อนเป็นไมล์ปัจจุบัน"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>รับจากไมล์ปัจจุบัน</span>
                </button>
              </div>
              <input
                type="text"
                value={prevMileage}
                onChange={(e) => handlePrevMileageChange(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                เลขไมล์ปัจจุบัน
              </label>
              <input
                type="text"
                value={currMileage}
                onChange={(e) => handleCurrMileageChange(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
              />
            </div>
          </div>

          {/* Row 3: รอบ PM */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              รอบ PM (ระยะทาง/เวลา)
            </label>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PM_CYCLE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setPmCycle(preset);
                      setIsCustomCycle(false);
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                      !isCustomCycle && pmCycle === preset
                        ? 'bg-slate-900 text-amber-300 shadow-xs'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setIsCustomCycle(true)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                    isCustomCycle
                      ? 'bg-slate-900 text-amber-300 shadow-xs'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  กำหนดเอง
                </button>
              </div>

              {isCustomCycle && (
                <input
                  type="text"
                  value={pmCycle}
                  onChange={(e) => setPmCycle(e.target.value)}
                  placeholder="เช่น PM 300 ชม. หรือ PM ทุก 15,000 กม."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                />
              )}
            </div>
          </div>

          {/* Row 4: สถานะครบรอบ PM */}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              สถานะครบรอบ PM
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PM_STATUS_OPTIONS.map((statusOpt) => {
                const isSelected = pmStatus === statusOpt;
                const isDueOpt = statusOpt.includes('ครบรอบ');
                return (
                  <button
                    key={statusOpt}
                    type="button"
                    onClick={() => setPmStatus(statusOpt)}
                    className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-xs font-bold transition-all ${
                      isSelected
                        ? isDueOpt
                          ? 'border-red-600 bg-red-600 text-white shadow-xs'
                          : 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {statusOpt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-amber-300 shadow-md hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>กำลังบันทึก...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>บันทึกข้อมูล PM</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
