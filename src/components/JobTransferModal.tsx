import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Play,
  Square,
  Truck,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { JobTransferPayload, SheetRow } from '../types';
import {
  appendJobTransferRecord,
  completeJobTransferRecord,
} from '../services/googleSheets';

interface JobTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  accessToken: string | null;
  currentUser: User | null;
  isLoggingIn: boolean;
  onRequestLogin: () => Promise<string | null>;
  onLogout: () => Promise<void>;
  onSavedSuccess: () => void;
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
  accessToken,
  currentUser,
  isLoggingIn,
  onRequestLogin,
  onLogout,
  onSavedSuccess,
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

  // Flow states:
  // 'FORM' -> fill details & press "เริ่มส่งสินค้า"
  // 'CONFIRM_START' -> confirm starting delivery
  // 'IN_TRANSIT' -> delivery in progress, live timer, press "จบ" when arrived
  // 'CONFIRM_FINISH' -> confirm finishing delivery
  const [flowStep, setFlowStep] = useState<
    'FORM' | 'CONFIRM_START' | 'IN_TRANSIT' | 'CONFIRM_FINISH'
  >('FORM');

  const [activeJob, setActiveJob] = useState<ActiveDeliveryJob | null>(null);
  const [pendingStartTime, setPendingStartTime] = useState<string>('');
  const [pendingEndTime, setPendingEndTime] = useState<string>('');
  const [liveNowTime, setLiveNowTime] = useState<string>(getCurrentTimeString());

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    if (!isOpen || flowStep !== 'IN_TRANSIT') return;
    setLiveNowTime(getCurrentTimeString());
    const timer = setInterval(() => {
      setLiveNowTime(getCurrentTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, flowStep]);

  // Reset error and update date when opening modal (preserve activeJob if currently in transit)
  useEffect(() => {
    if (isOpen) {
      setDate(getCurrentThaiDateString());
      setSubmitError(null);
      if (activeJob) {
        setFlowStep('IN_TRANSIT');
      } else {
        setFlowStep('FORM');
      }
    }
  }, [isOpen, activeJob]);

  if (!isOpen) return null;

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

  // Confirm "เริ่มส่งสินค้า" -> append row with status "อยู่ระว่างการส่ง" to Google Sheets
  const handleConfirmStartDelivery = async () => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let token = accessToken;
      if (!token) {
        token = await onRequestLogin();
      }
      if (!token) {
        throw new Error('กรุณาเข้าสู่ระบบด้วยบัญชี Google ก่อนเริ่มส่งสินค้า');
      }

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

      const { recordId, rowNumber } = await appendJobTransferRecord(payload, token);

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

      setActiveJob(startedJob);
      setFlowStep('IN_TRANSIT');
      onSavedSuccess();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกเริ่มส่งสินค้าลง Google Sheets'
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

  // Confirm "จบ" -> update row in Google Sheets with เวลาจบ, เวลาที่ใช้, and สถานะ="ส่งสินค้าเรียบร้อยแล้ว"
  const handleConfirmFinishDelivery = async () => {
    if (!activeJob) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let token = accessToken;
      if (!token) {
        token = await onRequestLogin();
      }
      if (!token) {
        throw new Error('กรุณาเข้าสู่ระบบด้วยบัญชี Google ก่อนกดจบงาน');
      }

      const endT = pendingEndTime || getCurrentTimeString();
      const totalDuration = calculateDurationString(activeJob.startTime, endT);

      if (activeJob.rowNumber !== null) {
        await completeJobTransferRecord(
          {
            rowNumber: activeJob.rowNumber,
            endTime: endT,
            duration: totalDuration,
            status: 'ส่งสินค้าเรียบร้อยแล้ว',
          },
          token
        );
      } else {
        // Fallback if rowNumber was not returned
        await appendJobTransferRecord(
          {
            date: activeJob.date,
            employeeId: activeJob.employeeId,
            driverName: activeJob.driverName,
            vehicleNumber: activeJob.vehicleNumber,
            trailerNumber: activeJob.trailerNumber,
            productType: activeJob.productType,
            weight: activeJob.weight,
            origin: activeJob.origin,
            startTime: activeJob.startTime,
            destination: activeJob.destination,
            endTime: endT,
            duration: totalDuration,
            status: 'ส่งสินค้าเรียบร้อยแล้ว',
            note: activeJob.note,
            rounds: activeJob.rounds,
          },
          token
        );
      }

      // Reset form and active job
      setActiveJob(null);
      setProductType('');
      setWeight('0');
      setOrigin('');
      setDestination('');
      setNote('');
      setFlowStep('FORM');

      onSavedSuccess();
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการบันทึกจบงานลง Google Sheets'
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {flowStep === 'CONFIRM_START' && 'ยืนยันการเริ่มส่งสินค้า'}
              {flowStep === 'IN_TRANSIT' && 'กำลังดำเนินการส่งสินค้า'}
              {flowStep === 'CONFIRM_FINISH' && 'ยืนยันการจบงานส่งสินค้า'}
              {flowStep === 'FORM' && 'บันทึกการย้ายงานใหม่'}
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              <span>ตาราง บันทึกการย้ายงาน</span>
              <span aria-hidden="true">·</span>
              <span>
                {flowStep === 'IN_TRANSIT' || flowStep === 'CONFIRM_FINISH'
                  ? 'ขั้นตอนที่ 2: ถึงที่หมายแล้วกดปุ่ม จบ'
                  : 'ขั้นตอนที่ 1: ระบุข้อมูลและกดปุ่ม เริ่มส่งสินค้า'}
              </span>
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

        {/* Google Account Connection Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-6 py-3">
          {accessToken && currentUser ? (
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  เชื่อมต่อบัญชี:{' '}
                  <strong className="font-semibold text-slate-900">
                    {currentUser.email || currentUser.displayName}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>สลับบัญชี</span>
              </button>
            </div>
          ) : (
            <div className="flex w-full flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="text-xs text-slate-600">
                เข้าสู่ระบบด้วย Google เพื่อรับสิทธิ์บันทึกข้อมูลลงตาราง บันทึกการย้ายงาน
              </div>
              <button
                type="button"
                onClick={() => onRequestLogin()}
                disabled={isLoggingIn}
                className="gsi-material-button inline-flex items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <div className="gsi-material-button-icon h-4 w-4 shrink-0">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    className="block h-full w-full"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isLoggingIn ? 'กำลังเข้าสู่ระบบ...' : 'Sign in with Google'}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="mx-6 mt-4 flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* STEP: CONFIRM_START */}
        {flowStep === 'CONFIRM_START' && (
          <div className="overflow-y-auto px-6 py-5">
            <p className="text-sm text-slate-700">
              ตรวจสอบข้อมูลก่อนกดยืนยันเพื่อ{' '}
              <strong className="font-semibold text-slate-900">เริ่มส่งสินค้า</strong>{' '}
              (ระบบจะบันทึกเวลาเริ่มและสถานะ{' '}
              <span className="font-semibold text-amber-700">อยู่ระว่างการส่ง</span>{' '}
              ลงในฐานข้อมูล):
            </p>

            <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-2 text-sm">
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">วันที่ / เวลาเริ่ม</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {date} · {pendingStartTime}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  รหัสพนักงาน / ชื่อพนักงานขับรถ
                </span>
                <span className="font-semibold text-slate-900">
                  {employeeId ? `${employeeId} · ` : ''}
                  {driverName || '-'}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  เบอร์รถ / เบอร์หาง
                </span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {vehicleNumber}
                  {trailerNumber ? ` / ${trailerNumber}` : ''}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  ประเภทสินค้า / น้ำหนัก
                </span>
                <span className="font-semibold text-slate-900">
                  {productType} ·{' '}
                  <span className="font-mono tabular-nums">
                    {Number(weight || 0).toLocaleString('th-TH')} กก.
                  </span>
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  ต้นทาง → ปลายทาง
                </span>
                <span className="font-semibold text-slate-900">
                  {origin} → {destination}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  สถานะเริ่มต้น
                </span>
                <span className="font-semibold text-amber-700">อยู่ระว่างการส่ง</span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setFlowStep('FORM')}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                กลับไปแก้ไข
              </button>
              <button
                type="button"
                onClick={handleConfirmStartDelivery}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>
                  {isSubmitting ? 'กำลังบันทึกเริ่มส่งสินค้า...' : 'ยืนยันเริ่มส่งสินค้า'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* STEP: IN_TRANSIT (Waiting for driver to arrive at destination and press "จบ") */}
        {flowStep === 'IN_TRANSIT' && activeJob && (
          <div className="overflow-y-auto px-6 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white shrink-0">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-amber-700">
                      สถานะปัจจุบัน: อยู่ระว่างการส่ง
                    </div>
                    <div className="text-base font-bold text-slate-900">
                      {activeJob.origin} → {activeJob.destination}
                    </div>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <div className="text-xs font-medium text-slate-500">
                    เวลาที่ใช้ขณะนี้
                  </div>
                  <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                    {liveElapsedDuration}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-xs text-slate-500">พนักงานขับรถ:</span>
                  <div className="font-semibold text-slate-900">
                    {activeJob.employeeId ? `${activeJob.employeeId} · ` : ''}
                    {activeJob.driverName}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-500">เบอร์รถ / เบอร์หาง:</span>
                  <div className="font-mono font-semibold text-slate-900 tabular-nums">
                    {activeJob.vehicleNumber}
                    {activeJob.trailerNumber ? ` / ${activeJob.trailerNumber}` : ''}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-500">ประเภทสินค้า / น้ำหนัก:</span>
                  <div className="font-semibold text-slate-900">
                    {activeJob.productType} ·{' '}
                    <span className="font-mono tabular-nums">
                      {activeJob.weight.toLocaleString('th-TH')} กก.
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-xs text-slate-500">เวลาเริ่มส่งสินค้า:</span>
                  <div className="font-mono font-semibold text-slate-900 tabular-nums">
                    {activeJob.date} เวลา {activeJob.startTime}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => {
                  setActiveJob(null);
                  setFlowStep('FORM');
                }}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                สร้างรายการส่งสินค้าใหม่
              </button>

              <button
                type="button"
                onClick={handleInitiateFinishDelivery}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Square className="h-4 w-4 fill-current" />
                <span>ถึงที่หมายแล้ว · กดปุ่ม จบ</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP: CONFIRM_FINISH */}
        {flowStep === 'CONFIRM_FINISH' && activeJob && (
          <div className="overflow-y-auto px-6 py-5">
            <p className="text-sm text-slate-700">
              ยืนยันการ{' '}
              <strong className="font-semibold text-slate-900">จบงานส่งสินค้า</strong>{' '}
              เมื่อถึงที่หมายเรียบร้อยแล้ว (ระบบจะบันทึกเวลาจบ เวลาที่ใช้ และอัปเดตสถานะเป็น{' '}
              <span className="font-semibold text-emerald-700">
                ส่งสินค้าเรียบร้อยแล้ว
              </span>
              ):
            </p>

            <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-2 text-sm">
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  พนักงานขับรถ / เบอร์รถ
                </span>
                <span className="font-semibold text-slate-900">
                  {activeJob.driverName} ({activeJob.vehicleNumber})
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  เส้นทางขนส่ง
                </span>
                <span className="font-semibold text-slate-900">
                  {activeJob.origin} → {activeJob.destination}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">เวลาเริ่ม</span>
                <span className="font-mono text-slate-900 tabular-nums">
                  {activeJob.startTime}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">เวลาจบ</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {pendingEndTime}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">เวลาที่ใช้</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {finalConfirmedDuration}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-xs font-medium text-slate-500">
                  สถานะหลังกดจบ
                </span>
                <span className="font-semibold text-emerald-700">
                  ส่งสินค้าเรียบร้อยแล้ว
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setFlowStep('IN_TRANSIT')}
                disabled={isSubmitting}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                ย้อนกลับ
              </button>
              <button
                type="button"
                onClick={handleConfirmFinishDelivery}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>
                  {isSubmitting ? 'กำลังบันทึกจบงาน...' : 'ยืนยันจบงานส่งสินค้า'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* STEP: FORM (Fill details -> click "เริ่มส่งสินค้า") */}
        {flowStep === 'FORM' && (
          <form
            onSubmit={handleInitiateStartDelivery}
            className="overflow-y-auto px-6 py-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              {/* จำนวนรอบ */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  จำนวนรอบ
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={rounds}
                  onChange={(e) => setRounds(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* รหัสพนักงาน */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  รหัสพนักงาน
                </label>
                <input
                  type="text"
                  list="datalist-employees"
                  value={employeeId}
                  onChange={(e) => handleEmployeeIdChange(e.target.value)}
                  placeholder="พิมพ์หรือเลือกรหัสพนักงาน"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
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
                <label className="block text-xs font-medium text-slate-700">
                  ชื่อพนักงานขับรถ <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-drivers"
                  value={driverName}
                  onChange={(e) => handleDriverNameChange(e.target.value)}
                  placeholder="พิมพ์หรือเลือกชื่อพนักงานขับรถ"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
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
                <label className="block text-xs font-medium text-slate-700">
                  เบอร์รถ <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-vehicles"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  placeholder="เช่น TT-20, FL-10"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-vehicles">
                  {referenceOptions.vehicles.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>

              {/* เบอร์หาง */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  เบอร์หาง (ถ้ามี)
                </label>
                <input
                  type="text"
                  list="datalist-trailers"
                  value={trailerNumber}
                  onChange={(e) => setTrailerNumber(e.target.value)}
                  placeholder="เช่น TTL-60 หรือเว้นว่าง"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-trailers">
                  {referenceOptions.trailers.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              {/* ประเภทสินค้า */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  ประเภทสินค้า <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-products"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="เลือกหรือพิมพ์ประเภทสินค้า"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-products">
                  {referenceOptions.products.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>

              {/* น้ำหนัก (กก.) */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  น้ำหนัก (กิโลกรัม) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* ต้นทาง */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  ต้นทาง <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-origins"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="เช่น FAC H, FAC E"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-origins">
                  {referenceOptions.origins.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </div>

              {/* ปลายทาง */}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  ปลายทาง <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="datalist-destinations"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="เช่น FAC E, FAC G"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <datalist id="datalist-destinations">
                  {referenceOptions.destinations.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>

              {/* หมายเหตุ */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">
                  หมายเหตุเพิ่มเติม
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="ระบุหมายเหตุ (ถ้ามี)"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>เริ่มส่งสินค้า</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
