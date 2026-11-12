import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  AlertCircle,
  Play,
  Square,
  Truck,
  Plus,
  MapPin,
  Trash2,
  ListPlus,
  CheckSquare,
} from 'lucide-react';
import { JobTransferPayload, SheetRow } from '../types';
import {
  SHEET_TABS,
  fetchSheetTabData,
  appendJobTransferRecord,
  completeJobTransferRecord,
  fetchAccountEmployeeMap,
  normalizeDriverNameKey,
  isValidEmployeeCode,
  KNOWN_DRIVER_EMP_CODES,
  appendTrailerRecord,
} from '../services/googleSheets';
import { isValidTrailerCode } from '../utils/sheetMetrics';
import { showSuccessToast } from '../utils/swal';

const CUSTOM_LOCATIONS_KEY = 'job_transfer_custom_locations';
const CUSTOM_TRAILERS_KEY = 'job_transfer_custom_trailers';

function getStoredCustomLocations(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_LOCATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function saveStoredCustomLocations(locations: string[]) {
  try {
    localStorage.setItem(CUSTOM_LOCATIONS_KEY, JSON.stringify(locations));
  } catch {
    // ignore
  }
}

function getStoredCustomTrailers(): string[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TRAILERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function saveStoredCustomTrailers(trailers: string[]) {
  try {
    localStorage.setItem(CUSTOM_TRAILERS_KEY, JSON.stringify(trailers));
  } catch {
    // ignore
  }
}

const DEFAULT_LOCATIONS = [
  'FAC 01', 'FAC 02', 'FAC 03', 'FAC 04', 'FAC 05',
  'FAC 06', 'FAC 07', 'FAC 08', 'FAC 09', 'FAC 10',
  'FAC 11', 'FAC 12', 'FAC 13', 'FAC 14', 'FAC 15',
  'WH', 'RM', 'FG', 'SCRAP', 'KUBOTA'
];

interface JobTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRows: SheetRow[];
  onSavedSuccess: () => void;
  inlineMode?: boolean;
}

export interface ActiveDeliveryJob {
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
  startedAtMs?: number;
  rounds: number;
  note: string;
}

interface DraftTransferItem {
  tempId: string;
  date: string;
  employeeId: string;
  driverName: string;
  vehicleNumber: string;
  trailerNumber: string;
  productType: string;
  weight: number;
  origin: string;
  destination: string;
  rounds: number;
  note: string;
}

const LEGACY_ACTIVE_JOB_STORAGE_KEY = 'gsheets_active_delivery_job_v1';
const ACTIVE_JOBS_STORAGE_KEY = 'gsheets_active_delivery_jobs_v2';
const ACTIVE_JOBS_EVENT_NAME = 'job-transfer-active-jobs-updated';

export function loadStoredActiveJobs(): ActiveDeliveryJob[] {
  try {
    const rawV2 = localStorage.getItem(ACTIVE_JOBS_STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => x && typeof x === 'object' && x.recordId);
      }
    }
    const rawV1 = localStorage.getItem(LEGACY_ACTIVE_JOB_STORAGE_KEY);
    if (rawV1) {
      const single = JSON.parse(rawV1) as ActiveDeliveryJob | null;
      localStorage.removeItem(LEGACY_ACTIVE_JOB_STORAGE_KEY);
      if (single && single.recordId) {
        const migrated = [single];
        localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

export function saveStoredActiveJobs(jobs: ActiveDeliveryJob[]): void {
  try {
    localStorage.removeItem(LEGACY_ACTIVE_JOB_STORAGE_KEY);
    if (jobs.length > 0) {
      localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(jobs));
    } else {
      localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ACTIVE_JOBS_EVENT_NAME));
    }
  } catch {
    // ignore storage errors
  }
}

export function removeStoredActiveJobsByMatches(
  completedItems: Array<{
    recordId?: string;
    rowNumber?: number | null;
    driverName?: string;
    vehicleNumber?: string;
    startTime?: string;
  }>
): void {
  const current = loadStoredActiveJobs();
  if (current.length === 0) return;
  const next = current.filter((job) => {
    return !completedItems.some((c) => {
      if (c.recordId && job.recordId && c.recordId === job.recordId) return true;
      if (c.rowNumber && job.rowNumber && c.rowNumber === job.rowNumber) return true;
      if (
        c.driverName &&
        c.vehicleNumber &&
        c.startTime &&
        job.driverName === c.driverName &&
        job.vehicleNumber === c.vehicleNumber &&
        job.startTime === c.startTime
      ) {
        return true;
      }
      return false;
    });
  });
  if (next.length !== current.length) {
    saveStoredActiveJobs(next);
  }
}

export function getCurrentThaiDateString(): string {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const buddhistYear = now.getFullYear() + 543;
  return `${day}/${month}/${buddhistYear}`;
}

export function getCurrentTimeString(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function calculateDurationString(startTime: string, endTime: string): string {
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
  const [bundleCount, setBundleCount] = useState<string>('');
  const [weightPerBundle, setWeightPerBundle] = useState<string>('');
  const [extraWeight, setExtraWeight] = useState<string>('');
  const [weight, setWeight] = useState<string>('0');
  const [origin, setOrigin] = useState<string>('');
  const [destination, setDestination] = useState<string>('');
  const [rounds, setRounds] = useState<string>('1');
  const [note, setNote] = useState<string>('');

  const [queuedItems, setQueuedItems] = useState<DraftTransferItem[]>([]);
  const [pendingStartItems, setPendingStartItems] = useState<DraftTransferItem[]>([]);

  const [activeJobs, setActiveJobs] = useState<ActiveDeliveryJob[]>(() =>
    loadStoredActiveJobs()
  );
  const [selectedFinishIds, setSelectedFinishIds] = useState<string[]>(() =>
    loadStoredActiveJobs().map((j) => j.recordId)
  );
  const [jobsToFinish, setJobsToFinish] = useState<ActiveDeliveryJob[]>([]);
  const [isAddingMoreWhileInTransit, setIsAddingMoreWhileInTransit] =
    useState<boolean>(false);

  const [flowStep, setFlowStep] = useState<
    'FORM' | 'CONFIRM_START' | 'IN_TRANSIT' | 'CONFIRM_FINISH'
  >(() => (loadStoredActiveJobs().length > 0 ? 'IN_TRANSIT' : 'FORM'));

  const [pendingStartTime, setPendingStartTime] = useState<string>('');
  const [pendingEndTime, setPendingEndTime] = useState<string>('');
  const [liveNowTime, setLiveNowTime] = useState<string>(getCurrentTimeString());

  const [customLocations, setCustomLocations] = useState<string[]>(() =>
    getStoredCustomLocations()
  );
  const [isAddLocationOpen, setIsAddLocationOpen] = useState<boolean>(false);
  const [addLocationTarget, setAddLocationTarget] = useState<
    'origin' | 'destination' | 'both'
  >('origin');
  const [newLocationInput, setNewLocationInput] = useState<string>('');
  const [locationAddError, setLocationAddError] = useState<string | null>(null);

  const [customTrailers, setCustomTrailers] = useState<string[]>(() =>
    getStoredCustomTrailers()
  );
  const [isAddTrailerOpen, setIsAddTrailerOpen] = useState<boolean>(false);
  const [newTrailerInput, setNewTrailerInput] = useState<string>('');
  const [trailerAddError, setTrailerAddError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fallbackRows, setFallbackRows] = useState<SheetRow[]>([]);
  const [vehicleDbRows, setVehicleDbRows] = useState<SheetRow[]>([]);
  const [trailerDbRows, setTrailerDbRows] = useState<SheetRow[]>([]);
  const [accountEmpMap, setAccountEmpMap] = useState<Map<string, string>>(
    new Map()
  );

  // Load ฐานข้อมูลรถ (gid: 378250263), ฐานข้อมูลหาง (gid: 1295975917) + Account employee code mapping whenever modal opens
  useEffect(() => {
    if (!isOpen && !inlineMode) return;
    const vehicleTab = SHEET_TABS.find((t) => t.gid === '378250263');
    const trailerTab = SHEET_TABS.find((t) => t.gid === '1295975917');
    if (!vehicleTab) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const [vehRes, empMap] = await Promise.all([
              fetchSheetTabData(vehicleTab, { limit: 250 }),
              fetchAccountEmployeeMap(),
            ]);
            if (cancelled) return;
            if (vehRes.rows.length > 0) {
              setVehicleDbRows(vehRes.rows);
            }
            if (empMap.size > 0) {
              setAccountEmpMap(new Map(empMap));
            }
            if (trailerTab) {
              const trlRes = await fetchSheetTabData(trailerTab, { limit: 250 });
              if (!cancelled && trlRes.rows.length > 0) {
                setTrailerDbRows(trlRes.rows);
              }
            }
          } catch {
            // ignore background fetch error
          }
        })();
      },
      inlineMode ? 600 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, inlineMode]);

  useEffect(() => {
    if (
      (!isOpen && !inlineMode) ||
      existingRows.length > 0 ||
      fallbackRows.length > 0
    ) {
      return;
    }
    const transferTab = SHEET_TABS.find((t) => t.gid === '606634465');
    if (!transferTab) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void fetchSheetTabData(transferTab, { limit: 250 })
          .then((res) => {
            if (!cancelled && res.rows.length > 0) {
              setFallbackRows(res.rows);
            }
          })
          .catch(() => {});
      },
      inlineMode ? 1800 : 100
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, inlineMode, existingRows.length, fallbackRows.length]);

  const updateActiveJobs = (jobs: ActiveDeliveryJob[]) => {
    setActiveJobs(jobs);
    saveStoredActiveJobs(jobs);
    setSelectedFinishIds((prev) => {
      const validPrev = prev.filter((id) => jobs.some((j) => j.recordId === id));
      const newIds = jobs
        .map((j) => j.recordId)
        .filter((id) => !validPrev.includes(id));
      return [...validPrev, ...newIds];
    });
  };

  useEffect(() => {
    const syncFromStorage = () => {
      const latest = loadStoredActiveJobs();
      setActiveJobs(latest);
      setSelectedFinishIds((prev) => {
        const validPrev = prev.filter((id) => latest.some((j) => j.recordId === id));
        const newIds = latest
          .map((j) => j.recordId)
          .filter((id) => !validPrev.includes(id));
        return validPrev.length > 0 || newIds.length > 0
          ? [...validPrev, ...newIds]
          : latest.map((j) => j.recordId);
      });
    };
    window.addEventListener(ACTIVE_JOBS_EVENT_NAME, syncFromStorage);
    window.addEventListener('storage', syncFromStorage);
    return () => {
      window.removeEventListener(ACTIVE_JOBS_EVENT_NAME, syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  const sourceRows = existingRows.length > 0 ? existingRows : fallbackRows;

  // Build employee/driver/vehicle options from ฐานข้อมูลรถ (gid: 378250263)
  // while keeping products, origins, destinations, and trailers from บันทึกการย้ายงาน
  // Build employee/driver/vehicle options from ฐานข้อมูลรถ (gid: 378250263)
  // while keeping products, origins, destinations, and trailers from บันทึกการย้ายงาน
  const referenceOptions = useMemo(() => {
    const employeeMap = new Map<
      string,
      { empCode: string; name: string; vehicle: string; trailer: string }
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

    const historyNameToEmp = new Map<string, string>();
    const historyNameToTrailer = new Map<string, string>();

    sourceRows.forEach((row) => {
      const emp = row.values['B']?.trim() ?? '';
      const drv = row.values['C']?.trim() ?? '';
      const veh = row.values['D']?.trim() ?? '';
      const rawTrl = row.values['E']?.trim() ?? '';
      const trl = isValidTrailerCode(rawTrl) && !/^FL/i.test(veh) ? rawTrl : '';
      const prd = row.values['F']?.trim() ?? '';
      const org = row.values['H']?.trim() ?? '';
      const dst = row.values['J']?.trim() ?? '';

      const normDrv = normalizeDriverNameKey(drv);
      const validEmp = emp && emp !== drv && isValidEmployeeCode(emp) ? emp : '';
      if (normDrv && validEmp && !historyNameToEmp.has(normDrv)) {
        historyNameToEmp.set(normDrv, validEmp);
      }
      if (normDrv && trl && !historyNameToTrailer.has(normDrv)) {
        historyNameToTrailer.set(normDrv, trl);
      }

      if (trl) trailers.add(trl);
      if (prd) products.add(prd);
      if (org) origins.add(org);
      if (dst) destinations.add(dst);

      // Fallback only while ฐานข้อมูลรถ is still loading
      if (vehicleDbRows.length === 0) {
        const resolvedEmp =
          validEmp ||
          accountEmpMap.get(normDrv) ||
          historyNameToEmp.get(normDrv) ||
          KNOWN_DRIVER_EMP_CODES[normDrv] ||
          '';
        const key = resolvedEmp || drv || emp;
        if (key) {
          const existing = employeeMap.get(key);
          if (!existing) {
            employeeMap.set(key, {
              empCode: resolvedEmp || key,
              name: drv || key,
              vehicle: veh,
              trailer: trl,
            });
          } else {
            if (!existing.name && drv) existing.name = drv;
            if (!existing.vehicle && veh) existing.vehicle = veh;
            if (!existing.trailer && trl) existing.trailer = trl;
          }
        }
        if (drv && !driverMap.has(drv)) {
          driverMap.set(drv, { empId: key, vehicle: veh, trailer: trl });
        }
        if (veh) vehicles.add(veh);
      }
    });

    // Primary source of truth: ฐานข้อมูลรถ (gid: 378250263)
    if (vehicleDbRows.length > 0) {
      vehicleDbRows.forEach((row) => {
        const veh = (row.values['A'] ?? row.values['ทะเบียนรถ'] ?? '').trim();
        const drv = (row.values['I'] ?? row.values['ชื่อพนักงานประจำรถ'] ?? '').trim();
        const empColP = (row.values['P'] ?? row.values['รหัสพนักงาน'] ?? '').trim();

        if (veh && veh !== '-') {
          vehicles.add(veh);
        }

        if ((!drv || drv === '-') && (!empColP || empColP === '-')) {
          return;
        }

        const normDrv = normalizeDriverNameKey(drv);
        const validColP =
          empColP && empColP !== '-' && empColP !== drv && isValidEmployeeCode(empColP)
            ? empColP
            : '';
        const candidateEmpCode =
          validColP ||
          accountEmpMap.get(normDrv) ||
          historyNameToEmp.get(normDrv) ||
          KNOWN_DRIVER_EMP_CODES[normDrv] ||
          '';
        const resolvedTrailer =
          /^FL/i.test(veh) ? '' : historyNameToTrailer.get(normDrv) || '';

        // Prevent collisions: ensure every unique driver/vehicle row from ฐานข้อมูลรถ gets its own option key
        let empKey = candidateEmpCode;
        if (!empKey) {
          empKey = drv;
        } else if (employeeMap.has(empKey) && employeeMap.get(empKey)?.name !== drv) {
          empKey = `${candidateEmpCode}__${drv}`;
        }

        employeeMap.set(empKey, {
          empCode: candidateEmpCode || empKey,
          name: drv || empKey,
          vehicle: veh,
          trailer: resolvedTrailer,
        });

        if (drv) {
          driverMap.set(drv, {
            empId: empKey,
            vehicle: veh,
            trailer: resolvedTrailer,
          });
        }
      });
    }

    trailerDbRows.forEach((row) => {
      const trl = (row.values['A'] ?? '').trim();
      if (trl && trl !== '-' && trl !== 'หมายเลขหาง' && trl !== 'หมายเลขหางพ่วง') {
        trailers.add(trl);
      }
    });

    customTrailers.forEach((trl) => {
      if (trl) {
        trailers.add(trl);
      }
    });

    DEFAULT_LOCATIONS.forEach((loc) => {
      origins.add(loc);
      destinations.add(loc);
    });

    customLocations.forEach((loc) => {
      if (loc) {
        origins.add(loc);
        destinations.add(loc);
      }
    });

    const sortLocations = (list: string[]) => {
      return list.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
    };

    const sortedEmployees = Array.from(employeeMap.keys()).sort((a, b) => {
      const infoA = employeeMap.get(a);
      const infoB = employeeMap.get(b);
      const nameA = infoA?.name || a;
      const nameB = infoB?.name || b;
      return nameA.localeCompare(nameB, 'th');
    });

    return {
      employeeMap,
      driverMap,
      employees: sortedEmployees,
      drivers: Array.from(driverMap.keys()),
      vehicles: Array.from(vehicles),
      trailers: sortLocations(Array.from(trailers)),
      products: Array.from(products),
      origins: sortLocations(Array.from(origins)),
      destinations: sortLocations(Array.from(destinations)),
    };
  }, [sourceRows, vehicleDbRows, trailerDbRows, accountEmpMap, customLocations, customTrailers]);

  const handleOpenAddTrailerModal = () => {
    setNewTrailerInput('');
    setTrailerAddError(null);
    setIsAddTrailerOpen(true);
  };

  const handleAddTrailerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTrailerInput.trim();
    if (!trimmed) {
      setTrailerAddError('กรุณากรอกเบอร์หาง');
      return;
    }

    if (!customTrailers.includes(trimmed)) {
      const updated = [...customTrailers, trimmed];
      setCustomTrailers(updated);
      saveStoredCustomTrailers(updated);
    }

    setTrailerNumber(trimmed);
    void appendTrailerRecord(trimmed);
    setIsAddTrailerOpen(false);
    setNewTrailerInput('');
  };

  const handleDeleteCustomTrailer = (trailerToDelete: string) => {
    const updated = customTrailers.filter((t) => t !== trailerToDelete);
    setCustomTrailers(updated);
    saveStoredCustomTrailers(updated);
    if (trailerNumber === trailerToDelete) {
      setTrailerNumber('');
    }
  };

  const handleOpenAddLocationModal = (
    target: 'origin' | 'destination' | 'both' = 'origin'
  ) => {
    setAddLocationTarget(target);
    setNewLocationInput('');
    setLocationAddError(null);
    setIsAddLocationOpen(true);
  };

  const handleAddLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newLocationInput.trim();
    if (!trimmed) {
      setLocationAddError('กรุณากรอกชื่อ Location');
      return;
    }

    let updated = customLocations;
    if (!customLocations.includes(trimmed)) {
      updated = [...customLocations, trimmed];
      setCustomLocations(updated);
      saveStoredCustomLocations(updated);
    }

    if (addLocationTarget === 'origin' || addLocationTarget === 'both') {
      setOrigin(trimmed);
    }
    if (addLocationTarget === 'destination' || addLocationTarget === 'both') {
      setDestination(trimmed);
    }

    setIsAddLocationOpen(false);
    setNewLocationInput('');
  };

  const handleDeleteCustomLocation = (locToDelete: string) => {
    const updated = customLocations.filter((l) => l !== locToDelete);
    setCustomLocations(updated);
    saveStoredCustomLocations(updated);
    if (origin === locToDelete) setOrigin('');
    if (destination === locToDelete) setDestination('');
  };

  // Keep driverName and vehicleNumber synced with ฐานข้อมูลรถ if employeeId is selected
  useEffect(() => {
    const trimmed = employeeId.trim();
    if (!trimmed) return;
    let match = referenceOptions.employeeMap.get(trimmed);
    if (!match) {
      const drvMatch = referenceOptions.driverMap.get(trimmed);
      if (drvMatch?.empId) {
        setEmployeeId(drvMatch.empId);
        match = referenceOptions.employeeMap.get(drvMatch.empId);
      }
    }
    if (match) {
      if (match.name) setDriverName(match.name);
      if (match.vehicle) setVehicleNumber(match.vehicle);
    }
  }, [employeeId, referenceOptions.employeeMap, referenceOptions.driverMap]);

  // Live clock timer when a job is in transit
  useEffect(() => {
    if ((!isOpen && !inlineMode) || flowStep !== 'IN_TRANSIT') return;
    setLiveNowTime(getCurrentTimeString());
    const timer = setInterval(() => {
      setLiveNowTime(getCurrentTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, inlineMode, flowStep]);

  // Reset error and update date when opening modal (preserve activeJobs unless user clicked "+ เพิ่มงานส่งสินค้า")
  useEffect(() => {
    if (isOpen || inlineMode) {
      setDate(getCurrentThaiDateString());
      setSubmitError(null);
      if (activeJobs.length > 0 && !isAddingMoreWhileInTransit) {
        if (flowStep !== 'CONFIRM_FINISH' && flowStep !== 'CONFIRM_START') {
          setFlowStep('IN_TRANSIT');
        }
      } else if (activeJobs.length === 0) {
        if (flowStep === 'IN_TRANSIT' || flowStep === 'CONFIRM_FINISH') {
          setFlowStep('FORM');
        }
      }
    }
  }, [isOpen, inlineMode, activeJobs.length, isAddingMoreWhileInTransit, flowStep]);

  if (!isOpen && !inlineMode) return null;

  const handleEmployeeIdChange = (val: string) => {
    setEmployeeId(val);
    const trimmed = val.trim();
    const match = referenceOptions.employeeMap.get(trimmed);
    if (match) {
      if (match.name) setDriverName(match.name);
      if (match.vehicle) {
        setVehicleNumber(match.vehicle);
        if (/^FL/i.test(match.vehicle)) {
          setTrailerNumber('');
        } else if (match.trailer && isValidTrailerCode(match.trailer) && !trailerNumber) {
          setTrailerNumber(match.trailer);
        }
      } else if (match.trailer && isValidTrailerCode(match.trailer) && !trailerNumber) {
        setTrailerNumber(match.trailer);
      }
    } else if (!trimmed) {
      setDriverName('');
      setVehicleNumber('');
      setTrailerNumber('');
    }
  };

  const handleDriverNameChange = (val: string) => {
    setDriverName(val);
    const match = referenceOptions.driverMap.get(val.trim());
    if (match) {
      if (match.empId) setEmployeeId(match.empId);
      if (match.vehicle && !vehicleNumber) {
        setVehicleNumber(match.vehicle);
      }
      const nextVeh = match.vehicle || vehicleNumber;
      if (/^FL/i.test(nextVeh)) {
        setTrailerNumber('');
      } else if (match.trailer && isValidTrailerCode(match.trailer) && !trailerNumber) {
        setTrailerNumber(match.trailer);
      }
    }
  };

  const recalculateTotalWeight = (
    nextBundles: string,
    nextPerBundle: string,
    nextExtra: string
  ) => {
    if (
      !nextBundles.trim() &&
      !nextPerBundle.trim() &&
      !nextExtra.trim()
    ) {
      setWeight('0');
      return;
    }
    const parsedBundles = parseFloat(nextBundles.replace(/,/g, ''));
    const parsedPerBundle = parseFloat(nextPerBundle.replace(/,/g, ''));
    const parsedExtra = parseFloat(nextExtra.replace(/,/g, ''));

    const cleanBundles = Number.isNaN(parsedBundles) ? 0 : parsedBundles;
    const cleanPerBundle = Number.isNaN(parsedPerBundle) ? 0 : parsedPerBundle;
    const cleanExtra = Number.isNaN(parsedExtra) ? 0 : parsedExtra;

    const total = cleanBundles * cleanPerBundle + cleanExtra;
    const rounded = Math.round(total * 100) / 100;
    setWeight(String(rounded));
  };

  const buildCurrentDraftItem = (): DraftTransferItem | null => {
    if (!driverName.trim() && !employeeId.trim()) {
      setSubmitError('กรุณาระบุรหัสพนักงาน หรือ ชื่อพนักงานขับรถ');
      return null;
    }
    if (!vehicleNumber.trim()) {
      setSubmitError('กรุณาระบุเบอร์รถ');
      return null;
    }
    if (!productType.trim()) {
      setSubmitError('กรุณาระบุประเภทสินค้า');
      return null;
    }
    if (!origin.trim() || !destination.trim()) {
      setSubmitError('กรุณาระบุต้นทางและปลายทาง');
      return null;
    }

    const numericWeight = parseFloat(weight.replace(/,/g, ''));
    const cleanWeight = Number.isNaN(numericWeight) ? 0 : numericWeight;
    const numericRounds = parseInt(rounds, 10);
    const cleanRounds =
      Number.isNaN(numericRounds) || numericRounds < 1 ? 1 : numericRounds;
    const autoDate = date.trim() || getCurrentThaiDateString();
    const selectedEmpInfo = referenceOptions.employeeMap.get(employeeId.trim());
    const resolvedEmployeeCode =
      selectedEmpInfo?.empCode ||
      KNOWN_DRIVER_EMP_CODES[normalizeDriverNameKey(driverName)] ||
      employeeId.trim();

    return {
      tempId: `${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      date: autoDate,
      employeeId: resolvedEmployeeCode,
      driverName: driverName.trim(),
      vehicleNumber: vehicleNumber.trim(),
      trailerNumber: trailerNumber.trim(),
      productType: productType.trim(),
      weight: cleanWeight,
      origin: origin.trim(),
      destination: destination.trim(),
      rounds: cleanRounds,
      note: note.trim(),
    };
  };

  const handleAddToQueue = () => {
    setSubmitError(null);
    const item = buildCurrentDraftItem();
    if (!item) return;

    setQueuedItems((prev) => [...prev, item]);
    // Reset only item-specific product/weight/note fields so adding the 2nd, 3rd item is instant
    setProductType('');
    setBundleCount('');
    setWeightPerBundle('');
    setExtraWeight('');
    setWeight('0');
    setNote('');
  };

  const handleRemoveQueuedItem = (tempId: string) => {
    setQueuedItems((prev) => prev.filter((item) => item.tempId !== tempId));
  };

  // Step 1: Validate form (and/or queuedItems) and prepare to press "เริ่มส่งสินค้า"
  const handleInitiateStartDelivery = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const hasCurrentProduct = Boolean(productType.trim());
    const itemsToStart: DraftTransferItem[] = [...queuedItems];

    if (itemsToStart.length === 0 || hasCurrentProduct) {
      const currentItem = buildCurrentDraftItem();
      if (!currentItem) return;
      itemsToStart.push(currentItem);
    }

    if (itemsToStart.length === 0) {
      setSubmitError('กรุณาเพิ่มรายการหรือกรอกข้อมูลก่อนเริ่มส่งสินค้า');
      return;
    }

    setPendingStartItems(itemsToStart);
    setPendingStartTime(getCurrentTimeString());
    setFlowStep('CONFIRM_START');
  };

  // Confirm "เริ่มส่งสินค้า" -> append all rows in pendingStartItems with status "อยู่ระว่างการส่ง"
  const handleConfirmStartDelivery = async () => {
    if (pendingStartItems.length === 0) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const baseStartT = pendingStartTime || getCurrentTimeString();
      const createdJobs: ActiveDeliveryJob[] = [];
      let allSynced = true;

      for (let i = 0; i < pendingStartItems.length; i++) {
        const item = pendingStartItems[i];
        const cleanTrailer =
          /^FL/i.test(item.vehicleNumber) || !isValidTrailerCode(item.trailerNumber)
            ? ''
            : item.trailerNumber.trim();
        const mergedNote =
          !cleanTrailer && item.trailerNumber.trim() && !isValidTrailerCode(item.trailerNumber)
            ? (item.note ? `${item.note} (${item.trailerNumber.trim()})` : item.trailerNumber.trim())
            : item.note;
        const payload: JobTransferPayload = {
          date: item.date,
          employeeId: item.employeeId,
          driverName: item.driverName,
          vehicleNumber: item.vehicleNumber,
          trailerNumber: cleanTrailer,
          productType: item.productType,
          weight: item.weight,
          origin: item.origin,
          startTime: baseStartT,
          destination: item.destination,
          endTime: '',
          duration: '',
          status: 'อยู่ระว่างการส่ง',
          note: mergedNote,
          rounds: item.rounds,
        };

        const { recordId, rowNumber, syncedToSheet } =
          await appendJobTransferRecord(payload);
        if (!syncedToSheet) {
          allSynced = false;
        }

        createdJobs.push({
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
          startedAtMs: Date.now(),
          rounds: payload.rounds,
          note: payload.note,
        });
      }

      const nextActiveJobs = [...activeJobs, ...createdJobs];
      updateActiveJobs(nextActiveJobs);
      setQueuedItems([]);
      setPendingStartItems([]);
      setProductType('');
      setBundleCount('');
      setWeightPerBundle('');
      setExtraWeight('');
      setWeight('0');
      setNote('');
      setIsAddingMoreWhileInTransit(false);
      setFlowStep('IN_TRANSIT');

      showSuccessToast(
        createdJobs.length > 1
          ? `เริ่มส่งสินค้า ${createdJobs.length} รายการสำเร็จ!`
          : 'เริ่มส่งสินค้าสำเร็จ!',
        allSynced
          ? `ระบบบันทึกสถานะอยู่ระหว่างการส่ง (${createdJobs.length} รายการ) ลง Google Sheets เรียบร้อยแล้ว`
          : 'บันทึกในระบบเรียบร้อยแล้ว (จะซิงค์เข้า Google Sheets อัตโนมัติเมื่อเชื่อมต่อ Webhook)'
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

  const handleToggleSelectFinishJob = (recordId: string) => {
    setSelectedFinishIds((prev) =>
      prev.includes(recordId)
        ? prev.filter((id) => id !== recordId)
        : [...prev, recordId]
    );
  };

  const handleToggleSelectAllFinishJobs = () => {
    if (selectedFinishIds.length === activeJobs.length) {
      setSelectedFinishIds([]);
    } else {
      setSelectedFinishIds(activeJobs.map((j) => j.recordId));
    }
  };

  const handleAddMoreJobsFromTransit = () => {
    const lastJob = activeJobs[activeJobs.length - 1];
    if (lastJob) {
      if (lastJob.employeeId && !employeeId) setEmployeeId(lastJob.employeeId);
      if (lastJob.driverName && !driverName) setDriverName(lastJob.driverName);
      if (lastJob.vehicleNumber && !vehicleNumber) setVehicleNumber(lastJob.vehicleNumber);
      if (lastJob.trailerNumber && !trailerNumber) setTrailerNumber(lastJob.trailerNumber);
      if (lastJob.origin && !origin) setOrigin(lastJob.origin);
      if (lastJob.destination && !destination) setDestination(lastJob.destination);
    }
    setProductType('');
    setBundleCount('');
    setWeightPerBundle('');
    setExtraWeight('');
    setWeight('0');
    setNote('');
    setSubmitError(null);
    setIsAddingMoreWhileInTransit(true);
    setFlowStep('FORM');
  };

  // Step 2: Arrived at destination -> press "จบงาน" (for 1 or multiple selected active jobs)
  const handleInitiateFinishSelected = (targetJobs?: ActiveDeliveryJob[]) => {
    const chosen =
      targetJobs && targetJobs.length > 0
        ? targetJobs
        : activeJobs.filter((j) => selectedFinishIds.includes(j.recordId));
    if (chosen.length === 0) {
      setSubmitError('กรุณาเลือกรายการที่ต้องการจบงานอย่างน้อย 1 รายการ');
      return;
    }
    setSubmitError(null);
    setJobsToFinish(chosen);
    setPendingEndTime(getCurrentTimeString());
    setFlowStep('CONFIRM_FINISH');
  };

  // Confirm "จบงาน" -> update all jobs in jobsToFinish with เวลาจบ, เวลาที่ใช้, and สถานะ="ส่งสินค้าเรียบร้อยแล้ว"
  const handleConfirmFinishDelivery = async () => {
    if (jobsToFinish.length === 0) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const endT = pendingEndTime || getCurrentTimeString();
      let allSynced = true;

      for (const job of jobsToFinish) {
        const totalDuration = calculateDurationString(job.startTime, endT);
        const { syncedToSheet } = await completeJobTransferRecord({
          recordId: job.recordId,
          rowNumber: job.rowNumber,
          endTime: endT,
          duration: totalDuration,
          status: 'ส่งสินค้าเรียบร้อยแล้ว',
          date: job.date,
          driverName: job.driverName,
          vehicleNumber: job.vehicleNumber,
          startTime: job.startTime,
          origin: job.origin,
          destination: job.destination,
          productType: job.productType,
        });
        if (!syncedToSheet) {
          allSynced = false;
        }
      }

      const finishedIds = new Set(jobsToFinish.map((j) => j.recordId));
      const remainingJobs = activeJobs.filter((j) => !finishedIds.has(j.recordId));
      updateActiveJobs(remainingJobs);
      setJobsToFinish([]);

      if (remainingJobs.length > 0) {
        setFlowStep('IN_TRANSIT');
      } else {
        setProductType('');
        setBundleCount('');
        setWeightPerBundle('');
        setExtraWeight('');
        setWeight('0');
        setOrigin('');
        setDestination('');
        setNote('');
        setIsAddingMoreWhileInTransit(false);
        setFlowStep('FORM');
      }

      showSuccessToast(
        jobsToFinish.length > 1
          ? `จบงานส่งสินค้า ${jobsToFinish.length} รายการสำเร็จ!`
          : 'จบงานส่งสินค้าสำเร็จ!',
        allSynced
          ? `ระบบบันทึกสถานะส่งสินค้าเรียบร้อยแล้ว (${jobsToFinish.length} รายการ)`
          : 'บันทึกในระบบเรียบร้อยแล้ว (จะซิงค์เข้า Google Sheets อัตโนมัติเมื่อเชื่อมต่อ Webhook)'
      );

      onSavedSuccess();
      if (!inlineMode && remainingJobs.length === 0) {
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

  const totalPendingStartWeight = pendingStartItems.reduce(
    (sum, item) => sum + (Number(item.weight) || 0),
    0
  );

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
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base">
            {flowStep === 'CONFIRM_START' &&
              `ยืนยันเริ่มส่งสินค้า (${pendingStartItems.length} รายการ)`}
            {flowStep === 'IN_TRANSIT' &&
              `กำลังส่งสินค้า (${activeJobs.length} รายการ)`}
            {flowStep === 'CONFIRM_FINISH' &&
              `ยืนยันจบงานส่งสินค้า (${jobsToFinish.length} รายการ)`}
            {flowStep === 'FORM' && 'บันทึกการย้ายงาน'}
          </h2>
          {flowStep === 'FORM' && activeJobs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsAddingMoreWhileInTransit(false);
                setFlowStep('IN_TRANSIT');
              }}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
            >
              <Truck className="h-3 w-3" />
              <span>กำลังส่ง ({activeJobs.length})</span>
            </button>
          )}
        </div>
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
      {flowStep === 'CONFIRM_START' && pendingStartItems.length > 0 && (
        <div className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          <div className="mb-2.5 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div>
              <span className="text-slate-500">วันที่ / เวลาเริ่ม: </span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {date} · {pendingStartTime}
              </span>
            </div>
            <div>
              <span className="text-slate-500">รวมทั้งหมด: </span>
              <span className="font-mono font-bold text-slate-900 tabular-nums">
                {pendingStartItems.length} รายการ (
                {totalPendingStartWeight.toLocaleString('th-TH')} กก.)
              </span>
            </div>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {pendingStartItems.map((item, idx) => (
              <div
                key={item.tempId}
                className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-2xs"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <span className="font-bold text-slate-900">
                    รายการที่ {idx + 1}: {item.origin} → {item.destination}
                  </span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                    อยู่ระว่างการส่ง
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px] sm:text-xs">
                  <div>
                    <span className="text-slate-500">พนักงาน: </span>
                    <span className="font-semibold text-slate-800">
                      {item.employeeId ? `${item.employeeId} · ` : ''}
                      {item.driverName}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">เบอร์รถ/หาง: </span>
                    <span className="font-mono font-semibold text-slate-800">
                      {item.vehicleNumber}
                      {item.trailerNumber ? ` / ${item.trailerNumber}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">สินค้า: </span>
                    <span className="font-semibold text-slate-900">
                      {item.productType}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">น้ำหนัก: </span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {item.weight.toLocaleString('th-TH')} กก.
                    </span>
                  </div>
                  {item.note && (
                    <div className="col-span-2">
                      <span className="text-slate-500">หมายเหตุ: </span>
                      <span className="text-slate-700">{item.note}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
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
                {isSubmitting
                  ? `กำลังบันทึก (${pendingStartItems.length} รายการ)...`
                  : `ยืนยันเริ่มส่งสินค้า (${pendingStartItems.length} รายการ)`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* STEP: IN_TRANSIT */}
      {flowStep === 'IN_TRANSIT' && activeJobs.length > 0 && (
        <div className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          {activeJobs.length > 1 && (
            <div className="mb-2.5 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={
                    activeJobs.length > 0 &&
                    selectedFinishIds.length === activeJobs.length
                  }
                  onChange={handleToggleSelectAllFinishJobs}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  เลือกทั้งหมด ({selectedFinishIds.length}/{activeJobs.length} รายการ)
                </span>
              </label>
              <span className="font-mono text-[11px] font-semibold text-slate-600 tabular-nums">
                รวม{' '}
                {activeJobs
                  .reduce((sum, j) => sum + (Number(j.weight) || 0), 0)
                  .toLocaleString('th-TH')}{' '}
                กก.
              </span>
            </div>
          )}

          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-0.5">
            {activeJobs.map((job, idx) => {
              const isChecked = selectedFinishIds.includes(job.recordId);
              const jobElapsed = calculateDurationString(job.startTime, liveNowTime);
              return (
                <div
                  key={job.recordId || idx}
                  className={`rounded-xl border p-3 transition-colors ${
                    isChecked
                      ? 'border-emerald-300 bg-emerald-50/30'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleSelectFinishJob(job.recordId)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0 cursor-pointer"
                      />
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white shrink-0">
                        <Truck className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-amber-700">
                          รายการที่ {idx + 1} · อยู่ระว่างการส่ง
                        </div>
                        <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                          {job.origin} → {job.destination}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] font-medium text-slate-500">
                          เวลาที่ใช้
                        </div>
                        <div className="font-mono text-sm sm:text-base font-bold text-slate-900 tabular-nums">
                          {jobElapsed}
                        </div>
                      </div>
                      {activeJobs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleInitiateFinishSelected([job])}
                          disabled={isSubmitting}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          <Square className="h-2.5 w-2.5 fill-current" />
                          <span>จบงานนี้</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                    <div>
                      <span className="text-[11px] text-slate-500">พนักงานขับรถ: </span>
                      <span className="font-semibold text-slate-900">
                        {job.employeeId ? `${job.employeeId} · ` : ''}
                        {job.driverName}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500">เบอร์รถ / หาง: </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {job.vehicleNumber}
                        {job.trailerNumber ? ` / ${job.trailerNumber}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500">สินค้า / น้ำหนัก: </span>
                      <span className="font-semibold text-slate-900">
                        {job.productType} ·{' '}
                        <span className="font-mono tabular-nums">
                          {job.weight.toLocaleString('th-TH')} กก.
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500">เวลาเริ่ม: </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {job.startTime}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleAddMoreJobsFromTransit}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5 text-indigo-600" />
              <span>เพิ่มงานส่งสินค้า (รายการถัดไป)</span>
            </button>

            <button
              type="button"
              onClick={() => handleInitiateFinishSelected()}
              disabled={isSubmitting || selectedFinishIds.length === 0}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs sm:text-sm font-bold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>
                {activeJobs.length > 1
                  ? `จบงานพร้อมกัน (${selectedFinishIds.length} รายการ)`
                  : 'จบงานส่งสินค้า'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* STEP: CONFIRM_FINISH */}
      {flowStep === 'CONFIRM_FINISH' && jobsToFinish.length > 0 && (
        <div className="overflow-y-auto px-3.5 py-3 sm:px-5 sm:py-4">
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {jobsToFinish.map((job, idx) => {
              const durationStr = calculateDurationString(
                job.startTime,
                pendingEndTime
              );
              return (
                <div
                  key={job.recordId || idx}
                  className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-xs"
                >
                  <div className="flex justify-between py-1.5">
                    <span className="font-bold text-slate-800">
                      รายการที่ {idx + 1}: {job.origin} → {job.destination}
                    </span>
                    <span className="font-semibold text-emerald-700">
                      ส่งสินค้าเรียบร้อยแล้ว
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">พนักงาน / เบอร์รถ</span>
                    <span className="font-semibold text-slate-900">
                      {job.driverName} ({job.vehicleNumber})
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">สินค้า / น้ำหนัก</span>
                    <span className="font-semibold text-slate-900">
                      {job.productType} ({job.weight.toLocaleString('th-TH')} กก.)
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">เวลาเริ่ม → เวลาจบ (เวลาที่ใช้)</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {job.startTime} → {pendingEndTime} ({durationStr})
                    </span>
                  </div>
                </div>
              );
            })}
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
                {isSubmitting
                  ? `กำลังบันทึก (${jobsToFinish.length} รายการ)...`
                  : `ยืนยันจบงาน (${jobsToFinish.length} รายการ)`}
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
            {/* วันที่ (ซ่อนจากหน้าฟอร์ม แต่บันทึกลงฐานข้อมูลอัตโนมัติ) */}
            <div className="hidden">
              <input type="hidden" value={date} readOnly />
            </div>

            {/* จำนวนรอบ (ซ่อนจากหน้าฟอร์ม แต่บันทึกลงฐานข้อมูลอัตโนมัติ) */}
            <div className="hidden">
              <input type="hidden" value={rounds} readOnly />
            </div>

            {/* รหัสพนักงาน */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                รหัสพนักงาน <span className="text-red-600">*</span>
              </label>
              <select
                required
                value={employeeId}
                onChange={(e) => handleEmployeeIdChange(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">-- เลือกรหัสพนักงาน / ชื่อพนักงาน --</option>
                {employeeId &&
                  !referenceOptions.employees.includes(employeeId) && (
                    <option value={employeeId}>{employeeId}</option>
                  )}
                {referenceOptions.employees.map((empKey) => {
                  const info = referenceOptions.employeeMap.get(empKey);
                  const hasSeparateCode = info?.empCode && info.empCode !== info?.name;
                  const labelParts = [];
                  if (hasSeparateCode) {
                    labelParts.push(info.empCode);
                  }
                  if (info?.name) {
                    labelParts.push(info.name);
                  } else {
                    labelParts.push(empKey);
                  }
                  const labelText = labelParts.join(' - ');
                  const vehSuffix = info?.vehicle ? ` (${info.vehicle})` : '';

                  return (
                    <option key={empKey} value={empKey}>
                      {labelText}{vehSuffix}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* ชื่อพนักงานขับรถ (ช่องทึบ Read-only / Disabled ดึงข้อมูลอัตโนมัติ) */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ชื่อพนักงานขับรถ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                readOnly
                disabled
                value={driverName}
                onChange={(e) => handleDriverNameChange(e.target.value)}
                placeholder="ดึงข้อมูลอัตโนมัติ"
                className="mt-0.5 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-slate-600 select-none focus:outline-none disabled:bg-slate-100 disabled:text-slate-600 disabled:opacity-100"
              />
            </div>

            {/* เบอร์รถ (ช่องทึบ Read-only / Disabled ดึงข้อมูลอัตโนมัติ) */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                เบอร์รถ <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                readOnly
                disabled
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                placeholder="ดึงข้อมูลอัตโนมัติ"
                className="mt-0.5 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 font-mono text-xs sm:text-sm font-medium text-slate-600 tabular-nums select-none focus:outline-none disabled:bg-slate-100 disabled:text-slate-600 disabled:opacity-100"
              />
            </div>

            {/* เบอร์หาง */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  เบอร์หาง
                </label>
                <button
                  type="button"
                  onClick={handleOpenAddTrailerModal}
                  className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  <Plus className="w-3 h-3" /> เพิ่มเบอร์หาง
                </button>
              </div>
              <select
                value={trailerNumber}
                onChange={(e) => {
                  if (e.target.value === '__ADD_NEW_TRAILER__') {
                    handleOpenAddTrailerModal();
                  } else {
                    setTrailerNumber(e.target.value);
                  }
                }}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">-- เลือกเบอร์หาง (ถ้ามี) --</option>
                {trailerNumber &&
                  !referenceOptions.trailers.includes(trailerNumber) &&
                  trailerNumber !== '__ADD_NEW_TRAILER__' && (
                    <option value={trailerNumber}>{trailerNumber}</option>
                  )}
                {referenceOptions.trailers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="__ADD_NEW_TRAILER__" className="font-semibold text-indigo-600">
                  + เพิ่มเบอร์หางใหม่...
                </option>
              </select>
            </div>

            {/* ประเภทสินค้า */}
            <div>
              <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                ประเภทสินค้า <span className="text-red-600">*</span>
              </label>
              <select
                required
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">-- เลือกประเภทสินค้า --</option>
                {productType &&
                  !referenceOptions.products.includes(productType) && (
                    <option value={productType}>{productType}</option>
                  )}
                {referenceOptions.products.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
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
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs sm:text-sm font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:bg-white focus:outline-none"
              />
            </div>

            {/* ฟิลด์คำนวณน้ำหนักจริงอัตโนมัติ: (จำนวนมัด × น้ำหนักต่อมัด) + น้ำหนักเศษ */}
            <div className="col-span-2 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 sm:p-2.5">
              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-slate-700 truncate">
                  จำนวนมัด
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={bundleCount}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBundleCount(val);
                    recalculateTotalWeight(val, weightPerBundle, extraWeight);
                  }}
                  placeholder="0"
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-slate-700 truncate">
                  น้ำหนักต่อมัด (กก.)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={weightPerBundle}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWeightPerBundle(val);
                    recalculateTotalWeight(bundleCount, val, extraWeight);
                  }}
                  placeholder="0"
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-slate-700 truncate">
                  น้ำหนักเศษ (กก.)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={extraWeight}
                  onChange={(e) => {
                    const val = e.target.value;
                    setExtraWeight(val);
                    recalculateTotalWeight(bundleCount, weightPerBundle, val);
                  }}
                  placeholder="0"
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs sm:text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            {/* ต้นทาง */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  ต้นทาง <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => handleOpenAddLocationModal('origin')}
                  className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  <Plus className="w-3 h-3" /> เพิ่ม Location
                </button>
              </div>
              <select
                required
                value={origin}
                onChange={(e) => {
                  if (e.target.value === '__ADD_NEW__') {
                    handleOpenAddLocationModal('origin');
                  } else {
                    setOrigin(e.target.value);
                  }
                }}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">-- เลือกต้นทาง --</option>
                {origin &&
                  !referenceOptions.origins.includes(origin) &&
                  origin !== '__ADD_NEW__' && (
                    <option value={origin}>{origin}</option>
                  )}
                {referenceOptions.origins.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value="__ADD_NEW__" className="font-semibold text-indigo-600">
                  + เพิ่ม Location ใหม่...
                </option>
              </select>
            </div>

            {/* ปลายทาง */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-[11px] sm:text-xs font-medium text-slate-700">
                  ปลายทาง <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => handleOpenAddLocationModal('destination')}
                  className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
                >
                  <Plus className="w-3 h-3" /> เพิ่ม Location
                </button>
              </div>
              <select
                required
                value={destination}
                onChange={(e) => {
                  if (e.target.value === '__ADD_NEW__') {
                    handleOpenAddLocationModal('destination');
                  } else {
                    setDestination(e.target.value);
                  }
                }}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">-- เลือกปลายทาง --</option>
                {destination &&
                  !referenceOptions.destinations.includes(destination) &&
                  destination !== '__ADD_NEW__' && (
                    <option value={destination}>{destination}</option>
                  )}
                {referenceOptions.destinations.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value="__ADD_NEW__" className="font-semibold text-indigo-600">
                  + เพิ่ม Location ใหม่...
                </option>
              </select>
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

          {/* คิวรายการที่เพิ่มไว้เตรียมส่งพร้อมกันหลายรายการ */}
          {queuedItems.length > 0 && (
            <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5 text-indigo-600" />
                  รายการที่เตรียมส่ง ({queuedItems.length} รายการ)
                </span>
                <button
                  type="button"
                  onClick={() => setQueuedItems([])}
                  className="text-[11px] font-medium text-red-600 hover:underline"
                >
                  ล้างคิวทั้งหมด
                </button>
              </div>
              <div className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5">
                {queuedItems.map((qItem, qIdx) => (
                  <div
                    key={qItem.tempId}
                    className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 truncate">
                        {qIdx + 1}. {qItem.productType} ({qItem.weight.toLocaleString('th-TH')} กก.)
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {qItem.origin} → {qItem.destination} · {qItem.driverName} ({qItem.vehicleNumber})
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveQueuedItem(qItem.tempId)}
                      title="ลบรายการนี้ออกจากคิว"
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
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
              type="button"
              onClick={handleAddToQueue}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 whitespace-nowrap shrink-0"
            >
              <ListPlus className="h-3.5 w-3.5" />
              <span>+ เพิ่มรายการเข้าคิว</span>
            </button>
            <button
              type="submit"
              formNoValidate={queuedItems.length > 0 && !productType.trim()}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap ${
                inlineMode ? 'flex-1 sm:flex-none' : 'shrink-0'
              }`}
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>
                {queuedItems.length > 0
                  ? `เริ่มส่งสินค้า (${queuedItems.length + (productType.trim() ? 1 : 0)} รายการ)`
                  : 'เริ่มส่งสินค้า'}
              </span>
            </button>
          </div>
        </form>
      )}
    </div>
  );

  const addLocationModalElement = isAddLocationOpen ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-4 sm:p-5 shadow-xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm sm:text-base font-semibold text-slate-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
            เพิ่ม Location ใหม่ (ต้นทาง / ปลายทาง)
          </h3>
          <button
            type="button"
            onClick={() => setIsAddLocationOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleAddLocationSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              ชื่อ Location / สถานที่ <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={newLocationInput}
              onChange={(e) => {
                setNewLocationInput(e.target.value);
                setLocationAddError(null);
              }}
              placeholder="เช่น FAC 16, คลัง B, สระบุรี..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs sm:text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
            />
            {locationAddError && (
              <p className="mt-1 text-xs text-red-600">{locationAddError}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              ตั้งค่าให้ฟิลด์
            </label>
            <div className="mt-1.5 flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="targetField"
                  value="origin"
                  checked={addLocationTarget === 'origin'}
                  onChange={() => setAddLocationTarget('origin')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                ต้นทาง
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="targetField"
                  value="destination"
                  checked={addLocationTarget === 'destination'}
                  onChange={() => setAddLocationTarget('destination')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                ปลายทาง
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="targetField"
                  value="both"
                  checked={addLocationTarget === 'both'}
                  onChange={() => setAddLocationTarget('both')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                ทั้งสองฝั่ง
              </label>
            </div>
          </div>

          {customLocations.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <span className="block text-[11px] font-medium text-slate-500 mb-1.5">
                Location ที่เพิ่มเอง ({customLocations.length}):
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {customLocations.map((loc) => (
                  <span
                    key={loc}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-100"
                  >
                    {loc}
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomLocation(loc)}
                      title="ลบ Location นี้"
                      className="text-indigo-400 hover:text-red-600 ml-0.5 font-bold"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAddLocationOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-xs"
            >
              บันทึก Location
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  const addTrailerModalElement = isAddTrailerOpen ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 backdrop-blur-xs"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-4 sm:p-5 shadow-xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm sm:text-base font-semibold text-slate-900 flex items-center gap-2">
            <Truck className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
            เพิ่มเบอร์หางใหม่
          </h3>
          <button
            type="button"
            onClick={() => setIsAddTrailerOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleAddTrailerSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              หมายเลขเบอร์หาง <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={newTrailerInput}
              onChange={(e) => {
                setNewTrailerInput(e.target.value);
                setTrailerAddError(null);
              }}
              placeholder="เช่น TTL-67, หางพ่วง 01..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs sm:text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
            />
            {trailerAddError && (
              <p className="mt-1 text-xs text-red-600">{trailerAddError}</p>
            )}
          </div>

          {customTrailers.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <span className="block text-[11px] font-medium text-slate-500 mb-1.5">
                เบอร์หางที่เพิ่มเอง ({customTrailers.length}):
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {customTrailers.map((trl) => (
                  <span
                    key={trl}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-xs font-medium text-indigo-700 border border-indigo-100"
                  >
                    {trl}
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomTrailer(trl)}
                      title="ลบเบอร์หางนี้"
                      className="text-indigo-400 hover:text-red-600 ml-0.5 font-bold"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAddTrailerOpen(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-xs"
            >
              บันทึกเบอร์หาง
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (inlineMode) {
    return (
      <>
        {cardContent}
        {addLocationModalElement}
        {addTrailerModalElement}
      </>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4 backdrop-blur-xs"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      >
        {cardContent}
      </div>
      {addLocationModalElement}
      {addTrailerModalElement}
    </>
  );
};
