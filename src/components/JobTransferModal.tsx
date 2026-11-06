import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  AlertCircle,
  Play,
  Square,
  Truck,
} from 'lucide-react';
import { JobTransferPayload, SheetRow } from '../types';
import {
  appendJobTransferRecord,
  completeJobTransferRecord,
} from '../services/googleSheets';
import { showSuccessToast } from '../utils/swal';

interface JobTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  onSavedSuccess: () => void;
  inlineMode?: boolean;
}

interface ActiveDeliveryJob {
  rowNumber: number | null;
  recordId: string;
  date: string;
  employeeId: string;
  driverName: string;
  vehicleNumber: string;
  trailerNumber: string;
  productType: string;
  weight: number;
  origin: string;
  destination: string;
  startTime: string;
  rounds: number;
  note: string;
}

const ACTIVE_JOB_STORAGE_KEY = 'gsheets_active_delivery_job_v1';

function loadStoredActiveJob(): ActiveDeliveryJob | null {
  try {
    const raw = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveDeliveryJob;
  } catch {
    return null;
  }
}

function saveStoredActiveJob(job: ActiveDeliveryJob | null): void {
  try {
    if (job) {
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(job));
    } else {
      localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
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

function calculateDurationString(startTime: string, endTime: string): string {
  const parseSec = (t: string): number | null => {
    const parts = t.trim().split(':').map(Number);
    if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
    const [h, m, s = 0] = parts;
    return h * 3600 + m * 60 + s;
  };

  const startSec = parseSec(startTime);
  const endSec = parseSec(endTime);
  if (startSec === null || endSec === null) return '0:00:00';

  let diff = endSec - startSec;
  if (diff < 0) {
    diff += 24 * 3600;
  }
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}`;
}

export const JobTransferModal: React.FC<JobTransferModalProps> = ({
  isOpen,
  onClose,
  existingRows,
  onSavedSuccess,
  inlineMode = false,
}) => {
  const [date, setDate] = useState<string>(getCurrentThaiDateString());
  const [employeeId, setEmployeeId] = useState<string>('');
  const [driverName, setDriverName] = useState<string>('');
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [trailerNumber, setTrailerNumber] = useState<string>('');
  const [productType, setProductType] = useState<string>('');
  const [weight, setWeight] = useState<string>('0');
  const [origin, setOrigin] = useState<string>('');
  const [destination, setDestination] = useState<string>('');
  const [rounds, setRounds] = useState<string>('1');
  const [note, setNote] = useState<string>('');

  const [activeJob, setActiveJob] = useState<ActiveDeliveryJob | null>(() =>
    loadStoredActiveJob()
  );

  const [flowStep, setFlowStep] = useState<
    'FORM' | 'CONFIRM_START' | 'IN_TRANSIT' | 'CONFIRM_FINISH'
  >(() => (loadStoredActiveJob() ? 'IN_TRANSIT' : 'FORM'));

  const [pendingStartTime, setPendingStartTime] = useState<string>('');
  const [pendingEndTime, setPendingEndTime] = useState<string>('');
  const [liveNowTime, setLiveNowTime] = useState<string>(getCurrentTimeString());

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateActiveJob = (job: ActiveDeliveryJob | null) => {
    setActiveJob(job);
    saveStoredActiveJob(job);
  };

  // Extract unique reference options directly from real spreadsheet rows
  const referenceOptions = useMemo(() => {
    const employeeMap = new Map<
      string,
      { name: string; vehicle: string; trailer: string }
    >();
    const driverMap = new Map<
      string,
      { empId: string; vehicle: string; trailer: string }
    >();
    const vehicles = new Set<string>();
    const trailers = new Set<string>();
    const products = new Set<string>();
    const origins = new Set<string>();
    const destinations = new Set<string>();

    existingRows.forEach((row) => {
      const emp = row.values['B']?.trim() ?? '';
      const drv = row.values['C']?.trim() ?? '';
      const veh = row.values['D']?.trim() ?? '';
      const trl = row.values['E']?.trim() ?? '';
      const prd = row.values['F']?.trim() ?? '';
      const org = row.values['H']?.trim() ?? '';
      const dst = row.values['J']?.trim() ?? '';

      if (emp && !employeeMap.has(emp)) {
        employeeMap.set(emp, { name: drv, vehicle: veh, trailer: trl });
      }
      if (drv && !driverMap.has(drv)) {
        driverMap.set(drv, { empId: emp, vehicle: veh, trailer: trl });
      }
      if (veh) vehicles.add(veh);
      if (trl) trailers.add(trl);
      if (prd) products.add(prd);
      if (org) origins.add(org);
      if (dst) destinations.add(dst);
    });

    return {
      employeeMap,
      driverMap,
      employees: Array.from(employeeMap.keys()),
      drivers: Array.from(driverMap.keys()),
      vehicles: Array.from(vehicles),
      trailers: Array.from(trailers),
      products: Array.from(products),
      origins: Array.from(origins),
      destinations: Array.from(destinations),
    };
  }, [existingRows]);

  // Live clock timer when a job is in transit
  useEffect(() => {
    if ((!isOpen && !inlineMode) || flowStep !== 'IN_TRANSIT') return;
    setLiveNowTime(getCurrentTimeString());
    const timer = setInterval(() => {
      setLiveNowTime(getCurrentTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, inlineMode, flowStep]);

  // Reset error and update date when opening modal (preserve activeJob if currently in transit)
  useEffect(() => {
    if (isOpen || inlineMode) {
      setDate(getCurrentThaiDateString());
      setSubmitError(null);
      if (activeJob) {
        setFlowStep('IN_TRANSIT');
      } else {
        setFlowStep('FORM');
      }
    }
  }, [isOpen, inlineMode, activeJob]);

  if (!isOpen && !inlineMode) return null;

  const handleEmployeeIdChange = (val: string) => {
    setEmployeeId(val);
    const match = referenceOptions.employeeMap.get(val.trim());
    if (match) {
      if (match.name) setDriverName(match.name);
      if (match.vehicle && !vehicleNumber) setVehicleNumber(match.vehicle);
      if (match.trailer && !trailerNumber) setTrailerNumber(match.trailer);
    }
  };

  const handleDriverNameChange = (val: string) => {
    setDriverName(val);
    const match = referenceOptions.driverMap.get(val.trim());
    if (match) {
      if (match.empId) setEmployeeId(match.empId);
      if (match.vehicle && !vehicleNumber) setVehicleNumber(match.vehicle);
      if (match.trailer && !trailerNumber) setTrailerNumber(match.trailer);
    }
  };

  // Step 1: Validate form and prepare to press "เริ่มส่งสินค้า"
  const handleInitiateStartDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!driverName.trim() && !employeeId.trim()) {
      setSubmitError('กรุณาระบุรหัสพนักงาน หรือ ชื่อพนักงานขับรถ');
      return;
    }
    if (!vehicleNumber.trim()) {
      setSubmitError('กรุณาระบุเบอร์รถ');
      return;
    }
    if (!productType.trim()) {
      setSubmitError('กรุณาระบุประเภทสินค้า');
      return;
    }
    if (!origin.trim() || !destination.trim()) {
      setSubmitError('กรุณาระบุต้นทางและปลายทาง');
      return;
    }

    setPendingStartTime(getCurrentTimeString());
    setFlowStep('CONFIRM_START');
  };

  // Confirm "เริ่มส่งสินค้า" -> append row with status "อยู่ระว่างการส่ง"
  const handleConfirmStartDelivery = async () => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const startT = pendingStartTime || getCurrentTimeString();
      const numericWeight = parseFloat(weight.replace(/,/g, ''));
      const cleanWeight = Number.isNaN(numericWeight) ? 0 : numericWeight;
      const numericRounds = parseInt(rounds, 10);
      const cleanRounds =
        Number.isNaN(numericRounds) || numericRounds < 1 ? 1 : numericRounds;

      const payload: JobTransferPayload = {
        date: date.trim(),
        employeeId: employeeId.trim(),
        driverName: driverName.trim(),
        vehicleNumber: vehicleNumber.trim(),
        trailerNumber: trailerNumber.trim(),
        productType: productType.trim(),
        weight: cleanWeight,
        origin: origin.trim(),
        startTime: startT,
        destination: destination.trim(),
        endTime: startT,
        duration: '0:00:00',
        status: 'อยู่ระว่างการส่ง',
        note: note.trim(),
        rounds: cleanRounds,
      };

      const { recordId, rowNumber } = await appendJobTransferRecord(payload);

      const startedJob: ActiveDeliveryJob = {
        rowNumber,
        recordId,
        date: payload.date,
        employeeId: payload.employeeId,
        driverName: payload.driverName,
        vehicleNumber: payload.vehicleNumber,
        trailerNumber: payload.trailerNumber,
        productType: payload.productType,
        weight: payload.weight,
        origin: payload.origin,
        destination: payload.destination,
        startTime: payload.startTime,
        rounds: payload.rounds,
        note: payload.note,
      };

      updateActiveJob(startedJob);
      setFlowStep('IN_TRANSIT');
      showSuccessToast(
        'เริ่มส่งสินค้าสำเร็จ!',
        'ระบบบันทึกสถานะอยู่ระหว่างการส่งเรียบร้อยแล้ว'
      );
      onSavedSuccess();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกเริ่มส่งสินค้า'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Arrived at destination -> press "จบ"
  const handleInitiateFinishDelivery = () => {
    if (!activeJob) return;
    setSubmitError(null);
    setPendingEndTime(getCurrentTimeString());
    setFlowStep('CONFIRM_FINISH');
  };

  // Confirm "จบ" -> update row with เวลาจบ, เวลาที่ใช้, and สถานะ="ส่งสินค้าเรียบร้อยแล้ว"
  const handleConfirmFinishDelivery = async () => {
    if (!activeJob) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const endT = pendingEndTime || getCurrentTimeString();
      const totalDuration = calculateDurationString(activeJob.startTime, endT);

      await completeJobTransferRecord({
        recordId: activeJob.recordId,
        rowNumber: activeJob.rowNumber,
        endTime: endT,
        duration: totalDuration,
        status: 'ส่งสินค้าเรียบร้อยแล้ว',
      });

      // Reset form and active job
      updateActiveJob(null);
      setProductType('');
      setWeight('0');
      setOrigin('');
      setDestination('');
      setNote('');
      setFlowStep('FORM');

      showSuccessToast(
        'จบงานส่งสินค้าสำเร็จ!',
        'ระบบบันทึกสถานะส่งสินค้าเรียบร้อยแล้ว'
      );

      onSavedSuccess();
      if (!inlineMode) {
        onClose();
      }
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกจบงาน'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const liveElapsedDuration = activeJob
    ? calculateDurationString(activeJob.startTime, liveNowTime)
    : '0:00:00';

  const finalConfirmedDuration = activeJob
    ? calculateDurationString(activeJob.startTime, pendingEndTime)
    : '0:00:00';

  const cardContent = (
    <div
      className={
        inlineMode
          ? ' flex w-full flex-col rounded-xl border border-slate-200 bg-white'
          : 'flex max-h-[94vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg'
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* Compact Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5 sm:px-5 sm:py-3">
        <h2 className="text-sm font-bold text-slate-900 sm:text-base">
          {flowStep === 'CONFIRM_START' && 'ยืนยันเริ่มส่งสินค้า'}
          {flowStep === 'IN_TRANSIT' && 'กำลังส่งสินค้า'}
          {flowStep === 'CONFIRM_FINISH' && 'ยืนยันจบงานส่งสินค้า'}
          {flowStep === 'FORM' && 'บันทึกการย้ายงาน'}
        </h2>
        {!inlineMode && (
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Error Banner */}
      {submitError && (
        <div className="mx-3.5 mt-2.5 sm:mx-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {/* STEP: CONFIRM_START */}
      {flowStep === 'CONFIRM_START' && (
        <div className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1 text-xs sm:text-sm">
            <div className="flex justify-between py-2">
              <span className="text-slate-500">วันที่ / เวลาเริ่ม</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {date} · {pendingStartTime}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">พนักงานขับรถ</span>
              <span className="font-semibold text-slate-900">
                {employeeId ? `${employeeId} · ` : ''}
                {driverName || '-'}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">เบอร์รถ / เบอร์หาง</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {vehicleNumber}
                {trailerNumber ? ` / ${trailerNumber}` : ''}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">สินค้า / น้ำหนัก</span>
              <span className="font-semibold text-slate-900">
                {productType} ·{' '}
                <span className="font-mono tabular-nums">
                  {Number(weight || 0).toLocaleString('th-TH')} กก.
                </span>
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">ต้นทาง → ปลายทาง</span>
              <span className="font-semibold text-slate-900">
                {origin} → {destination}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">สถานะ</span>
              <span className="font-semibold text-amber-700">อยู่ระว่างการส่ง</span>
            </div>
          </div>

          <div className="mt-3.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setFlowStep('FORM')}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              แก้ไข
            </button>
            <button
              type="button"
              onClick={handleConfirmStartDelivery}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>
                {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันเริ่มส่งสินค้า'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* STEP: IN_TRANSIT */}
      {flowStep === 'IN_TRANSIT' && activeJob && (
        <div className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2.5 border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shrink-0">
                  <Truck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-amber-700">
                    อยู่ระว่างการส่ง
                  </div>
                  <div className="text-sm font-bold text-slate-900 sm:text-base truncate">
                    {activeJob.origin} → {activeJob.destination}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-[11px] font-medium text-slate-500">
                  เวลาที่ใช้
                </div>
                <div className="font-mono text-lg font-bold text-slate-900 sm:text-2xl tabular-nums">
                  {liveElapsedDuration}
                </div>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:text-sm">
              <div>
                <span className="text-[11px] text-slate-500">พนักงานขับรถ</span>
                <div className="font-semibold text-slate-900 truncate">
                  {activeJob.employeeId ? `${activeJob.employeeId} · ` : ''}
                  {activeJob.driverName}
                </div>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">เบอร์รถ / หาง</span>
                <div className="font-mono font-semibold text-slate-900 tabular-nums">
                  {activeJob.vehicleNumber}
                  {activeJob.trailerNumber ? ` / ${activeJob.trailerNumber}` : ''}
                </div>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">สินค้า / น้ำหนัก</span>
                <div className="font-semibold text-slate-900 truncate">
                  {activeJob.productType} ·{' '}
                  <span className="font-mono tabular-nums">
                    {activeJob.weight.toLocaleString('th-TH')} กก.
                  </span>
                </div>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">เวลาเริ่ม</span>
                <div className="font-mono font-semibold text-slate-900 tabular-nums">
                  {activeJob.startTime}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                updateActiveJob(null);
                setFlowStep('FORM');
              }}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              สร้างรายการใหม่
            </button>

            <button
              type="button"
              onClick={handleInitiateFinishDelivery}
              disabled={isSubmitting}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs sm:text-sm font-bold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>จบงานส่งสินค้า</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP: CONFIRM_FINISH */}
      {flowStep === 'CONFIRM_FINISH' && activeJob && (
        <div className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1 text-xs sm:text-sm">
            <div className="flex justify-between py-2">
              <span className="text-slate-500">พนักงาน / เบอร์รถ</span>
              <span className="font-semibold text-slate-900">
                {activeJob.driverName} ({activeJob.vehicleNumber})
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">เส้นทาง</span>
              <span className="font-semibold text-slate-900">
                {activeJob.origin} → {activeJob.destination}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">เวลาเริ่ม → เวลาจบ</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {activeJob.startTime} → {pendingEndTime}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">เวลาที่ใช้</span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {finalConfirmedDuration}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-500">สถานะ</span>
              <span className="font-semibold text-emerald-700">
                ส่งสินค้าเรียบร้อยแล้ว
              </span>
            </div>
          </div>

          <div className="mt-3.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setFlowStep('IN_TRANSIT')}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              ย้อนกลับ
            </button>
            <button
              type="button"
              onClick={handleConfirmFinishDelivery}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>
                {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันจบงาน'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* STEP: FORM (Compact 2-column grid for mobile) */}
      {flowStep === 'FORM' && (
        <form
          onSubmit={handleInitiateStartDelivery}
          className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4"
        >
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {/* วันที่ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                วันที่ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="5/11/2569"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* จำนวนรอบ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                จำนวนรอบ
              </label>
              <input
                type="number"
                min="1"
                required
                value={rounds}
                onChange={(e) => setRounds(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* รหัสพนักงาน */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                รหัสพนักงาน
              </label>
              <input
                type="text"
                list="datalist-employees"
                value={employeeId}
                onChange={(e) => handleEmployeeIdChange(e.target.value)}
                placeholder="รหัสพนักงาน"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-employees">
                {referenceOptions.employees.map((emp) => {
                  const info = referenceOptions.employeeMap.get(emp);
                  return (
                    <option
                      key={emp}
                      value={emp}
                      label={info?.name ? `${info.name} (${info.vehicle})` : undefined}
                    />
                  );
                })}
              </datalist>
            </div>

            {/* ชื่อพนักงานขับรถ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ชื่อพนักงานขับรถ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="datalist-drivers"
                value={driverName}
                onChange={(e) => handleDriverNameChange(e.target.value)}
                placeholder="ชื่อพนักงาน"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-drivers">
                {referenceOptions.drivers.map((drv) => {
                  const info = referenceOptions.driverMap.get(drv);
                  return (
                    <option
                      key={drv}
                      value={drv}
                      label={info?.empId ? `รหัส ${info.empId}` : undefined}
                    />
                  );
                })}
              </datalist>
            </div>

            {/* เบอร์รถ */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เบอร์รถ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="datalist-vehicles"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="TT-20, FL-10"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-vehicles">
                {referenceOptions.vehicles.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* เบอร์หาง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เบอร์หาง
              </label>
              <input
                type="text"
                list="datalist-trailers"
                value={trailerNumber}
                onChange={(e) => setTrailerNumber(e.target.value)}
                placeholder="TTL-60"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-trailers">
                {referenceOptions.trailers.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>

            {/* ประเภทสินค้า */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ประเภทสินค้า <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="datalist-products"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder="ประเภทสินค้า"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-products">
                {referenceOptions.products.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            {/* น้ำหนัก (กก.) */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                น้ำหนัก (กก.) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* ต้นทาง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ต้นทาง <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="datalist-origins"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="FAC H, FAC E"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-origins">
                {referenceOptions.origins.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>

            {/* ปลายทาง */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ปลายทาง <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                list="datalist-destinations"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="FAC E, FAC G"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <datalist id="datalist-destinations">
                {referenceOptions.destinations.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            {/* หมายเหตุ */}
            <div className="col-span-2">
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                หมายเหตุ
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="หมายเหตุ (ถ้ามี)"
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            {!inlineMode && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                ยกเลิก
              </button>
            )}
            <button
              type="submit"
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap ${
                inlineMode ? 'w-full' : 'shrink-0'
              }`}
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>เริ่มส่งสินค้า</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );

  if (inlineMode) {
    return cardContent;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      {cardContent}
    </div>
  );
};
