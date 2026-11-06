import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ChevronLeft,
  ChevronRight,
  X,
  SlidersHorizontal,
  ExternalLink,
  AlertCircle,
  Plus,
  CheckCircle2,
  Menu,
  Pencil,
  Check,
  Link2,
  Wrench,
  CheckCircle,
  Calendar,
  Camera,
  Eye,
} from 'lucide-react';
import {
  GOOGLE_SHEET_ID,
  SHEET_TABS,
  fetchSheetTabData,
  updateDeliveryPointGate,
  updateVehicleRegistration,
  updateJobTransferNote,
  updateRepairAdditionalDetails,
  updateRepairReplyDetails,
} from './services/googleSheets';
import { SheetColumn, SheetDataResult, SheetRow, SheetTabConfig } from './types';
import { RecordDetailModal } from './components/RecordDetailModal';
import { JobTransferModal } from './components/JobTransferModal';
import { DeliveryPointModal } from './components/DeliveryPointModal';
import { SheetWebhookModal } from './components/SheetWebhookModal';
import { RepairRequestModal } from './components/RepairRequestModal';
import { ManagerApprovalModal } from './components/ManagerApprovalModal';
import { AttachRepairPhotosModal } from './components/AttachRepairPhotosModal';
import { APP_VERSION } from './version';

const PAGE_SIZE = 30;

function isDurationExceeding20Minutes(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return false;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds > 20 * 60;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds > 20 * 60;
  }
  return false;
}

function parseThaiDateToTimestamp(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  // Convert Buddhist Era (พ.ศ.) to Common Era (ค.ศ.)
  if (year > 2400) {
    year -= 543;
  }
  return new Date(year, month - 1, day).setHours(0, 0, 0, 0);
}

function parseIsoInputDateToTimestamp(isoDate: string): number | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).setHours(0, 0, 0, 0);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<SheetTabConfig>(SHEET_TABS[0]);
  const [sheetData, setSheetData] = useState<SheetDataResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedColumnId, setSelectedColumnId] = useState<string>('ALL');
  const [quickFilterValue, setQuickFilterValue] = useState<string>('ALL');
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [rowLimit, setRowLimit] = useState<number>(SHEET_TABS[0].defaultLimit ?? 250);
  const [deepSearchTerm, setDeepSearchTerm] = useState<string>('');

  // Auto-refresh interval in seconds (0 = off)
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(30);

  // Sorting & Pagination
  const [sortConfig, setSortConfig] = useState<{
    colId: string;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Selected row for detail modal
  const [selectedRow, setSelectedRow] = useState<SheetRow | null>(null);

  // Job Transfer & Delivery Point creation modals
  const [isJobModalOpen, setIsJobModalOpen] = useState<boolean>(false);
  const [isDeliveryPointModalOpen, setIsDeliveryPointModalOpen] = useState<boolean>(false);
  const [isRepairModalOpen, setIsRepairModalOpen] = useState<boolean>(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState<boolean>(false);
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState<boolean>(false);
  const [attachingPhotoRow, setAttachingPhotoRow] = useState<SheetRow | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Inline editing state for จุดส่งสินค้า -> คอลัมน์ ประตู, ฐานข้อมูลรถ -> คอลัมน์ ทะเบียนรถ, และ บันทึกงานซ่อม -> คอลัมน์ รายละเอียดเพิ่มเติม / ตอบกลับข้อมูลเพิ่มเติม
  const [editingGateRowNumber, setEditingGateRowNumber] = useState<number | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingGateValue, setEditingGateValue] = useState<string>('');
  const [confirmingGateRowNumber, setConfirmingGateRowNumber] = useState<number | null>(
    null
  );
  const [isUpdatingGate, setIsUpdatingGate] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = useCallback(
    async (options?: { silent?: boolean; remoteSearch?: string }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (options?.silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const result = await fetchSheetTabData(activeTab, {
          limit: rowLimit,
          remoteSearchQuery: options?.remoteSearch ?? deepSearchTerm,
          signal: controller.signal,
        });
        setSheetData(result);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาดในการดึงข้อมูลจาก Google Sheets'
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeTab, rowLimit, deepSearchTerm]
  );

  // Initial load and when activeTab / rowLimit / deepSearchTerm changes
  useEffect(() => {
    loadData({ silent: false });
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadData]);

  // Real-time polling
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const timer = setInterval(() => {
      loadData({ silent: true });
    }, refreshIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [refreshIntervalSec, loadData]);

  const handleSelectTab = (tab: SheetTabConfig) => {
    setIsSidebarOpen(false);
    if (tab.gid === activeTab.gid) return;
    setActiveTab(tab);
    setRowLimit(tab.defaultLimit ?? 250);
    setSearchQuery('');
    setDeepSearchTerm('');
    setSelectedColumnId('ALL');
    setQuickFilterValue('ALL');
    setStartDateFilter('');
    setEndDateFilter('');
    setSortConfig(null);
    setCurrentPage(1);
    setEditingGateRowNumber(null);
    setEditingColumnId(null);
    setConfirmingGateRowNumber(null);
  };

  const handleConfirmGateUpdate = async (row: SheetRow) => {
    const newValue = editingGateValue.trim();
    const isVehicleTab = activeTab.gid === '378250263';
    const isJobTransferTab = activeTab.gid === '606634465';
    const isRepairTab = activeTab.gid === '944294225';
    const oldValue = isVehicleTab
      ? (row.values['A'] ?? '').trim()
      : isJobTransferTab
        ? (row.values['N'] ?? '').trim()
        : isRepairTab
          ? (row.values['AK'] ?? '').trim()
          : (row.values['C'] ?? '').trim();

    if (!isJobTransferTab && !isRepairTab && !newValue) return;
    if (newValue === oldValue) {
      setEditingGateRowNumber(null);
      setConfirmingGateRowNumber(null);
      return;
    }

    setIsUpdatingGate(true);
    setError(null);

    try {
      if (isRepairTab) {
        const sequenceNo = (row.values['A'] ?? String(row.rowNumber)).trim();
        const repairRequestNo = (row.values['G'] ?? '').trim();

        if (editingColumnId === 'AM' || editingColumnId === 'ตอบกลับข้อมูลเพิ่มเติม') {
          await updateRepairReplyDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            replyDetails: newValue,
          });

          // Update local row immediately
          row.values['AM'] = newValue;

          setEditingGateRowNumber(null);
          setEditingColumnId(null);
          setConfirmingGateRowNumber(null);
          setSaveSuccessMsg(
            newValue
              ? `บันทึกการตอบกลับข้อมูลเพิ่มเติม "${newValue}" ของรายการที่ #${row.rowNumber.toLocaleString('th-TH')} เรียบร้อยแล้ว`
              : `ล้างการตอบกลับข้อมูลเพิ่มเติมของรายการที่ #${row.rowNumber.toLocaleString('th-TH')} เรียบร้อยแล้ว`
          );
        } else {
          await updateRepairAdditionalDetails({
            rowNumber: row.rowNumber,
            sequenceNo,
            repairRequestNo,
            additionalDetails: newValue,
          });

          // Update local row immediately
          row.values['AK'] = newValue;

          setEditingGateRowNumber(null);
          setEditingColumnId(null);
          setConfirmingGateRowNumber(null);
          setSaveSuccessMsg(
            newValue
              ? `บันทึกรายละเอียดเพิ่มเติม "${newValue}" ของรายการที่ #${row.rowNumber.toLocaleString('th-TH')} เรียบร้อยแล้ว`
              : `ล้างรายละเอียดเพิ่มเติมของรายการที่ #${row.rowNumber.toLocaleString('th-TH')} เรียบร้อยแล้ว`
          );
        }
      } else if (isJobTransferTab) {
        const date = (row.values['A'] ?? '').trim();
        const driverName = (row.values['C'] ?? '').trim();
        const vehicleNumber = (row.values['D'] ?? '').trim();
        const startTime = (row.values['I'] ?? '').trim();

        await updateJobTransferNote({
          rowNumber: row.rowNumber,
          date,
          driverName,
          vehicleNumber,
          startTime,
          note: newValue,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        setSaveSuccessMsg(
          newValue
            ? `บันทึกหมายเหตุ "${newValue}" ของรายการที่ #${row.rowNumber.toLocaleString('th-TH')} เรียบร้อยแล้ว`
            : `ล้างหมายเหตุของรายการที่ #${row.rowNumber.toLocaleString('th-TH')} เรียบร้อยแล้ว`
        );
      } else if (isVehicleTab) {
        const driverName = (row.values['I'] ?? '').trim();
        const shift = (row.values['L'] ?? '').trim();

        await updateVehicleRegistration({
          oldRegistration: oldValue,
          newRegistration: newValue,
          driverName,
          shift,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        setSaveSuccessMsg(
          `อัปเดตทะเบียนรถจาก "${oldValue}" เป็น "${newValue}" เรียบร้อยแล้ว`
        );
      } else {
        const deliveryPoint = (row.values['B'] ?? '').trim();
        const now = new Date();
        const updatedDate = `${now.getDate()}/${now.getMonth() + 1}/${
          now.getFullYear() + 543
        }`;

        await updateDeliveryPointGate({
          deliveryPoint,
          oldGate: oldValue,
          newGate: newValue,
          updatedDate,
        });

        setEditingGateRowNumber(null);
        setConfirmingGateRowNumber(null);
        setSaveSuccessMsg(
          `อัปเดตประตูของจุดส่งสินค้า ${deliveryPoint} เป็น "${newValue}" และอัปเดตวันที่เป็น ${updatedDate} เรียบร้อยแล้ว`
        );
      }

      loadData({ silent: true });
      setTimeout(() => {
        setSaveSuccessMsg(null);
      }, 5000);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล'
      );
    } finally {
      setIsUpdatingGate(false);
    }
  };

  // Detect primary status/category column for quick filter buttons
  const quickFilterColumn = useMemo<SheetColumn | null>(() => {
    if (!sheetData) return null;
    const candidates = [
      'สถานะ',
      'สถานะการใช้งาน',
      'สถานะการอนุมัติ',
      'ประเภทสินค้า',
      'ประเภทรถ',
      'ประเภทการซ่อม',
      'STATUS',
      'ครบรอบPM',
      'ยี่ห้อ',
      'จุดส่งสินค้า',
    ];
    for (const label of candidates) {
      const found = sheetData.columns.find((c) => c.label.trim() === label);
      if (found) return found;
    }
    return null;
  }, [sheetData]);

  const quickFilterOptions = useMemo<string[]>(() => {
    if (!sheetData || !quickFilterColumn) return [];
    const counts = new Map<string, number>();
    sheetData.rows.forEach((row) => {
      const val = row.values[quickFilterColumn.id]?.trim();
      if (val) {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([val]) => val);
  }, [sheetData, quickFilterColumn]);

  // Filter rows by date range, search query, selected column, and quick filter
  const filteredRows = useMemo<SheetRow[]>(() => {
    if (!sheetData) return [];
    const q = searchQuery.trim().toLowerCase();
    const startTs = parseIsoInputDateToTimestamp(startDateFilter);
    const endTs = parseIsoInputDateToTimestamp(endDateFilter);

    // Identify primary date column (Col A for บันทึกการย้ายงาน or any column with 'วัน' or 'date')
    const dateCol =
      sheetData.columns.find((c) => c.id === 'A' && (c.type === 'date' || c.label.includes('วัน'))) ||
      sheetData.columns.find((c) => c.label.includes('วันที่') || c.type === 'date');

    return sheetData.rows.filter((row) => {
      // Date range filtering
      if (startTs !== null || endTs !== null) {
        const rawDateStr = dateCol ? (row.values[dateCol.id] ?? '') : (row.values['A'] ?? '');
        const rowTs = parseThaiDateToTimestamp(rawDateStr);
        if (rowTs !== null) {
          if (startTs !== null && rowTs < startTs) return false;
          if (endTs !== null && rowTs > endTs) return false;
        }
      }

      if (
        quickFilterValue !== 'ALL' &&
        quickFilterColumn &&
        row.values[quickFilterColumn.id]?.trim() !== quickFilterValue
      ) {
        return false;
      }

      if (!q) return true;

      if (selectedColumnId !== 'ALL') {
        const cellVal = (row.values[selectedColumnId] ?? '').toLowerCase();
        return cellVal.includes(q);
      }

      // Search across row number and all active columns
      if (String(row.rowNumber).includes(q)) return true;
      return sheetData.columns.some((col) =>
        (row.values[col.id] ?? '').toLowerCase().includes(q)
      );
    });
  }, [
    sheetData,
    searchQuery,
    selectedColumnId,
    quickFilterValue,
    quickFilterColumn,
    startDateFilter,
    endDateFilter,
  ]);

  // Sort filtered rows
  const sortedRows = useMemo<SheetRow[]>(() => {
    if (!sortConfig || !sheetData) return filteredRows;
    const { colId, direction } = sortConfig;
    const col = sheetData.columns.find((c) => c.id === colId);

    return [...filteredRows].sort((a, b) => {
      if (colId === '__ROW__') {
        return direction === 'asc'
          ? a.rowNumber - b.rowNumber
          : b.rowNumber - a.rowNumber;
      }

      const rawA = a.rawValues[colId];
      const rawB = b.rawValues[colId];

      if (typeof rawA === 'number' && typeof rawB === 'number') {
        return direction === 'asc' ? rawA - rawB : rawB - rawA;
      }

      const strA = a.values[colId] ?? '';
      const strB = b.values[colId] ?? '';

      if (col?.type === 'number') {
        const numA = parseFloat(strA.replace(/,/g, ''));
        const numB = parseFloat(strB.replace(/,/g, ''));
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return direction === 'asc' ? numA - numB : numB - numA;
        }
      }

      const cmp = strA.localeCompare(strB, 'th');
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortConfig, sheetData]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    selectedColumnId,
    quickFilterValue,
    activeTab.gid,
    startDateFilter,
    endDateFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const paginatedRows = useMemo<SheetRow[]>(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, currentPage]);

  // Contextual real-time summary metric based on actual columns in current sheet
  const contextualMetric = useMemo<{ label: string; value: string; subtext: string }>(() => {
    if (!sheetData || filteredRows.length === 0) {
      return {
        label: 'คอลัมน์ข้อมูลที่ใช้งาน',
        value: sheetData ? `${sheetData.columns.length}` : '0',
        subtext: 'คอลัมน์ในตารางปัจจุบัน',
      };
    }

    // Check if there is a weight column ('น้ำหนัก')
    const weightCol = sheetData.columns.find((c) => c.label.trim() === 'น้ำหนัก');
    if (weightCol) {
      let totalWeight = 0;
      filteredRows.forEach((r) => {
        const raw = r.rawValues[weightCol.id];
        if (typeof raw === 'number') {
          totalWeight += raw;
        } else {
          const parsed = parseFloat((r.values[weightCol.id] ?? '').replace(/,/g, ''));
          if (!Number.isNaN(parsed)) totalWeight += parsed;
        }
      });
      return {
        label: 'น้ำหนักรวมรายการที่แสดง',
        value: `${totalWeight.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กก.`,
        subtext: `คำนวณจาก ${filteredRows.length.toLocaleString('th-TH')} รายการ`,
      };
    }

    // Check if there is a remaining stock column ('คงเหลือ')
    const remainCol = sheetData.columns.find((c) => c.label.trim() === 'คงเหลือ');
    if (remainCol) {
      let totalRemain = 0;
      filteredRows.forEach((r) => {
        const raw = r.rawValues[remainCol.id];
        if (typeof raw === 'number') {
          totalRemain += raw;
        } else {
          const parsed = parseFloat((r.values[remainCol.id] ?? '').replace(/,/g, ''));
          if (!Number.isNaN(parsed)) totalRemain += parsed;
        }
      });
      return {
        label: 'ยอดคงเหลือรวมในคลัง',
        value: `${totalRemain.toLocaleString('th-TH')} ชิ้น/เส้น`,
        subtext: `จากรายการอะไหล่ ${filteredRows.length.toLocaleString('th-TH')} รายการ`,
      };
    }

    // Otherwise count top status value if quickFilterColumn exists
    if (quickFilterColumn) {
      const topValue = quickFilterOptions[0];
      if (topValue) {
        const count = filteredRows.filter(
          (r) => r.values[quickFilterColumn.id]?.trim() === topValue
        ).length;
        return {
          label: `${quickFilterColumn.label}: ${topValue}`,
          value: `${count.toLocaleString('th-TH')} รายการ`,
          subtext: `คิดเป็น ${Math.round((count / filteredRows.length) * 100)}% ของข้อมูลที่แสดง`,
        };
      }
    }

    return {
      label: 'คอลัมน์ข้อมูลที่ใช้งาน',
      value: `${sheetData.columns.length} คอลัมน์`,
      subtext: `ตาราง ${sheetData.tabName}`,
    };
  }, [sheetData, filteredRows, quickFilterColumn, quickFilterOptions]);

  const handleSort = (colId: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.colId !== colId) {
        return { colId, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { colId, direction: 'desc' };
      }
      return null;
    });
  };

  const handleTriggerDeepSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    setDeepSearchTerm(trimmed);
    loadData({ silent: false, remoteSearch: trimmed });
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSelectedColumnId('ALL');
    setQuickFilterValue('ALL');
    setStartDateFilter('');
    setEndDateFilter('');
    if (deepSearchTerm !== '') {
      setDeepSearchTerm('');
    }
  };

  const handleExportCsv = () => {
    if (!sheetData || sortedRows.length === 0) return;
    const headers = ['ลำดับแถว', ...sheetData.columns.map((c) => c.label)];
    const csvLines = [
      headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
      ...sortedRows.map((row) => {
        const cells = [
          String(row.rowNumber),
          ...sheetData.columns.map((col) => row.values[col.id] ?? ''),
        ];
        return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
      }),
    ];
    const csvContent = '\uFEFF' + csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sheetData.tabName}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Highlight matching search text inside cell
  const renderHighlightedText = (text: string) => {
    if (!text) return <span className="text-slate-300">-</span>;
    const q = searchQuery.trim();
    if (!q) return text;

    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const matchIdx = lowerText.indexOf(lowerQ);
    if (matchIdx === -1) return text;

    const before = text.slice(0, matchIdx);
    const match = text.slice(matchIdx, matchIdx + q.length);
    const after = text.slice(matchIdx + q.length);

    return (
      <>
        {before}
        <mark className="rounded-xs bg-amber-200/80 px-0.5 text-slate-900">
          {match}
        </mark>
        {after}
      </>
    );
  };

  const formattedFetchTime = useMemo(() => {
    if (!sheetData?.fetchedAt) return '-';
    return new Date(sheetData.fetchedAt).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [sheetData?.fetchedAt]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleSelectTab(SHEET_TABS[0]);
            }}
            className="text-sm font-bold tracking-tight text-slate-900 truncate"
          >
            ระบบขนส่งและงานซ่อมบำรุง
          </a>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="ปิดเมนู"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="px-2.5 pb-2 text-xs font-semibold text-slate-400">
            เมนูตารางข้อมูลทั้งหมด
          </div>
          <nav className="space-y-1">
            {SHEET_TABS.map((tab) => {
              const isSelected = activeTab.gid === tab.gid;
              return (
                <button
                  key={tab.gid}
                  type="button"
                  onClick={() => handleSelectTab(tab)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="truncate">{tab.name}</span>
                  <span
                    className={`ml-2 text-xs whitespace-nowrap shrink-0 ${
                      isSelected ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {tab.category}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 border-t border-slate-200 pt-3">
            <div className="px-2.5 pb-2 text-xs font-semibold text-slate-400">
              ระบบอนุมัติและแจ้งซ่อม
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setIsSidebarOpen(false);
                  setIsApprovalModalOpen(true);
                }}
                className="flex w-full items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-left text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <span>ผู้จัดการอนุมัติงานซ่อม</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsSidebarOpen(false);
                  setIsRepairModalOpen(true);
                }}
                className="flex w-full items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-200"
              >
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-slate-600" />
                  <span>+ บันทึกแจ้งซ่อม</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 px-4 py-2.5 bg-slate-50 flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium text-slate-500">เวอร์ชันระบบ</span>
          <span className="font-mono font-semibold px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 text-[11px]">
            v{APP_VERSION}
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact Sticky Top Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 sm:py-2.5 lg:px-8">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="เปิดเมนู"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 lg:hidden shrink-0"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="text-sm font-bold text-slate-900 sm:text-base truncate">
              {activeTab.name}
            </h1>
            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] sm:text-[11px] font-mono font-medium text-slate-600 border border-slate-200 shrink-0">
              v{APP_VERSION}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {activeTab.gid === '606634465' && (
              <button
                type="button"
                onClick={() => setIsJobModalOpen(true)}
                className="hidden md:inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>บันทึกย้ายงาน</span>
              </button>
            )}

            {activeTab.gid === '1156877149' && (
              <button
                type="button"
                onClick={() => setIsDeliveryPointModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>เพิ่มจุดส่งสินค้า</span>
              </button>
            )}

            {activeTab.gid === '944294225' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsRepairModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>แจ้งซ่อม</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap shrink-0"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>ผู้อนุมัติ</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setIsWebhookModalOpen(true)}
              title="ตั้งค่าเชื่อมต่อชีต (ไม่ต้องล็อกอิน)"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">เชื่อมต่อชีต</span>
            </button>

            <button
              type="button"
              onClick={() => loadData({ silent: true })}
              disabled={isLoading || isRefreshing}
              title="ซิงค์ข้อมูลล่าสุด"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isLoading || isRefreshing ? 'animate-spin' : ''
                }`}
              />
              <span className="hidden sm:inline">ซิงค์ข้อมูล</span>
            </button>
          </div>
        </header>

        <main className="w-full px-2.5 py-2.5 sm:px-6 sm:py-4 lg:px-8">
          {/* Save Success Notification */}
          {saveSuccessMsg && (
            <div className="mb-2.5 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs sm:text-sm text-emerald-900">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="font-medium truncate">{saveSuccessMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveSuccessMsg(null)}
                className="ml-2 text-xs font-medium text-emerald-800 hover:underline shrink-0"
              >
                ปิด
              </button>
            </div>
          )}

          {/* Mobile-Only Direct Job Transfer Form (when on הבันทึกการย้ายงาน tab) */}
          {activeTab.gid === '606634465' && (
            <div className="md:hidden">
              <JobTransferModal
                isOpen={true}
                inlineMode={true}
                onClose={() => {}}
                existingRows={sheetData?.rows ?? []}
                onSavedSuccess={() => {
                  setSaveSuccessMsg('บันทึกข้อมูลการย้ายงานเรียบร้อยแล้ว');
                  loadData({ silent: true });
                  setTimeout(() => {
                    setSaveSuccessMsg(null);
                  }, 5000);
                }}
              />
            </div>
          )}

          {/* Dashboard KPI, Search & Table (Hidden on mobile when on บันทึกการย้ายงาน so mobile shows ONLY the form) */}
          <div className={activeTab.gid === '606634465' ? 'hidden md:block' : 'block'}>
          {/* Compact KPI Summary Strip (2x2 on mobile, 4 cols on desktop, no verbose subtext) */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:p-3">
              <div className="truncate text-[11px] font-medium text-slate-500">
                ทั้งหมดในชีต
              </div>
              <div className="mt-0.5 font-mono text-lg font-bold text-slate-900 sm:text-xl tabular-nums">
                {isLoading && !sheetData
                  ? '...'
                  : (sheetData?.totalRowsInSheet ?? 0).toLocaleString('th-TH')}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:p-3">
              <div className="truncate text-[11px] font-medium text-slate-500">
                แสดงผล
              </div>
              <div className="mt-0.5 font-mono text-lg font-bold text-slate-900 sm:text-xl tabular-nums">
                {isLoading && !sheetData
                  ? '...'
                  : sortedRows.length.toLocaleString('th-TH')}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:p-3">
              <div className="truncate text-[11px] font-medium text-slate-500">
                {contextualMetric.label}
              </div>
              <div className="mt-0.5 truncate font-mono text-lg font-bold text-slate-900 sm:text-xl tabular-nums">
                {isLoading && !sheetData ? '...' : contextualMetric.value}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:p-3">
              <div className="truncate text-[11px] font-medium text-slate-500">
                อัปเดตล่าสุด
              </div>
              <div className="mt-0.5 font-mono text-lg font-bold text-slate-900 sm:text-xl tabular-nums">
                {formattedFetchTime}
              </div>
            </div>
          </div>

          {/* Compact Search, Filter & Utility Bar */}
          <div className="mt-2.5 rounded-lg border border-slate-200 bg-white p-2.5 sm:mt-3 sm:p-3">
            <form
              onSubmit={handleTriggerDeepSearch}
              className="flex flex-col gap-2 lg:flex-row lg:items-center"
            >
              {/* Main Search Input */}
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`ค้นหาใน ${activeTab.name}...`}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-8 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    aria-label="ล้างคำค้นหา"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Controls Row */}
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {/* Date Range Filter (Available for tables with dates, especially บันทึกการย้ายงาน) */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                  <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span className="hidden sm:inline text-[11px] font-medium text-slate-500">วันที่:</span>
                  <input
                    type="date"
                    aria-label="วันที่เริ่มต้น"
                    title="วันที่เริ่มต้น"
                    value={startDateFilter}
                    onChange={(e) => setStartDateFilter(e.target.value)}
                    className="bg-transparent font-mono text-[11px] text-slate-800 focus:outline-none"
                  />
                  <span className="text-slate-400">-</span>
                  <input
                    type="date"
                    aria-label="วันที่สิ้นสุด"
                    title="วันที่สิ้นสุด"
                    value={endDateFilter}
                    onChange={(e) => setEndDateFilter(e.target.value)}
                    className="bg-transparent font-mono text-[11px] text-slate-800 focus:outline-none"
                  />
                  {(startDateFilter || endDateFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartDateFilter('');
                        setEndDateFilter('');
                      }}
                      title="ล้างช่วงวันที่"
                      className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <SlidersHorizontal className="h-3 w-3 text-slate-500 shrink-0" />
                  <select
                    id="col-filter"
                    aria-label="ค้นหาในคอลัมน์"
                    value={selectedColumnId}
                    onChange={(e) => setSelectedColumnId(e.target.value)}
                    className="bg-transparent text-xs font-medium text-slate-800 focus:outline-none"
                  >
                    <option value="ALL">ทุกคอลัมน์</option>
                    {sheetData?.columns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  id="limit-select"
                  aria-label="จำนวนดึงข้อมูล"
                  value={rowLimit}
                  onChange={(e) => setRowLimit(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs font-medium text-slate-800 tabular-nums focus:border-slate-900 focus:outline-none"
                >
                  <option value={100}>100 แถว</option>
                  <option value={250}>250 แถว</option>
                  <option value={500}>500 แถว</option>
                  <option value={1000}>1,000 แถว</option>
                </select>

                <select
                  id="refresh-select"
                  aria-label="อัปเดตอัตโนมัติ"
                  value={refreshIntervalSec}
                  onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none"
                >
                  <option value={15}>ซิงค์ 15วิ</option>
                  <option value={30}>ซิงค์ 30วิ</option>
                  <option value={60}>ซิงค์ 60วิ</option>
                  <option value={0}>ปิดซิงค์</option>
                </select>

                {sheetData && sheetData.totalRowsInSheet > rowLimit && (
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    ค้นหาทั้งชีต
                  </button>
                )}

                {(searchQuery !== '' ||
                  selectedColumnId !== 'ALL' ||
                  quickFilterValue !== 'ALL' ||
                  startDateFilter !== '' ||
                  endDateFilter !== '' ||
                  deepSearchTerm !== '') && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    ล้างกรอง
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={!sheetData || sortedRows.length === 0}
                  title="ส่งออก CSV"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">CSV</span>
                </button>

                <a
                  href={`https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit#gid=${activeTab.gid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="เปิดตารางต้นฉบับ"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0"
                >
                  <span className="hidden sm:inline">ชีตต้นฉบับ</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </form>

            {/* Compact Horizontal Scrollable Quick Filter Bar */}
            {quickFilterColumn && quickFilterOptions.length > 0 && (
              <div className="mt-2 flex items-center gap-1 overflow-x-auto border-t border-slate-100 pt-2 no-scrollbar">
                <button
                  type="button"
                  onClick={() => setQuickFilterValue('ALL')}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                    quickFilterValue === 'ALL'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                  }`}
                >
                  ทั้งหมด
                </button>
                {quickFilterOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setQuickFilterValue((prev) => (prev === opt ? 'ALL' : opt))
                    }
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                      quickFilterValue === opt
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {deepSearchTerm && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700">
                <span className="truncate">
                  ค้นหาทั้งตาราง: <strong className="font-semibold text-slate-900">"{deepSearchTerm}"</strong>
                </span>
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="ml-2 font-medium text-slate-900 underline hover:no-underline whitespace-nowrap shrink-0"
                >
                  ดูข้อมูลปกติ
                </button>
              </div>
            )}
          </div>
          {false && saveSuccessMsg && <div />}

          {/* Error State */}
          {error && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">เกิดข้อผิดพลาด</div>
                  <div className="break-words text-red-700">{error}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadData({ silent: false })}
                className="rounded-lg bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-800 whitespace-nowrap shrink-0"
              >
                ลองใหม่
              </button>
            </div>
          )}

          {/* Main Data Table Card */}
          <div className="mt-2.5 sm:mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="w-16 px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('__ROW__')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>แถว</span>
                        {sortConfig?.colId === '__ROW__' ? (
                          sortConfig.direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-slate-900" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-slate-900" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        )}
                      </button>
                    </th>
                    {sheetData?.columns.map((col) => {
                      const isSorted = sortConfig?.colId === col.id;
                      const isNumeric = col.type === 'number';
                      return (
                        <th
                          key={col.id}
                          className={`px-2.5 py-2 sm:px-4 sm:py-2.5 whitespace-nowrap ${
                            isNumeric ? 'text-right' : 'text-left'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(col.id)}
                            className={`inline-flex items-center gap-1 hover:text-slate-900 ${
                              isNumeric ? 'ml-auto flex-row-reverse' : ''
                            }`}
                          >
                            <span>{col.label}</span>
                            {isSorted ? (
                              sortConfig.direction === 'asc' ? (
                                <ArrowUp className="h-3 w-3 text-slate-900 shrink-0" />
                              ) : (
                                <ArrowDown className="h-3 w-3 text-slate-900 shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-slate-400 shrink-0" />
                            )}
                          </button>
                        </th>
                      );
                    })}
                    {activeTab.gid === '944294225' && (
                      <th className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap">
                        จัดการ
                      </th>
                    )}
                  </tr>
                </thead>

              <tbody className="divide-y divide-slate-100 text-sm">
                {isLoading && !sheetData ? (
                  Array.from({ length: 10 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="px-4 py-3">
                        <div className="h-4 w-12 rounded bg-slate-200" />
                      </td>
                      {Array.from({ length: 6 }).map((__, cIdx) => (
                        <td key={cIdx} className="px-4 py-3">
                          <div className="h-4 w-28 rounded bg-slate-200" />
                        </td>
                      ))}
                      {activeTab.gid === '944294225' && (
                        <td className="px-4 py-3 text-center">
                          <div className="mx-auto h-4 w-20 rounded bg-slate-200" />
                        </td>
                      )}
                    </tr>
                  ))
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={(sheetData?.columns.length ?? 5) + 1 + (activeTab.gid === '944294225' ? 1 : 0)}
                      className="px-6 py-14 text-center"
                    >
                      <div className="mx-auto max-w-md">
                        <div className="text-base font-semibold text-slate-900">
                          {sheetData && sheetData.rows.length === 0
                            ? 'ไม่มีรายการข้อมูล'
                            : 'ไม่พบข้อมูล'}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {sheetData && sheetData.rows.length === 0
                            ? 'ไม่พบข้อมูลในตารางนี้จาก Google Sheets'
                            : searchQuery
                            ? `ไม่พบข้อมูลที่มีคำว่า "${searchQuery}" ในชุดข้อมูลที่เลือก`
                            : startDateFilter || endDateFilter
                            ? 'ไม่พบข้อมูลในช่วงวันที่ระบุ'
                            : 'ไม่พบรายการข้อมูลที่ตรงกับเงื่อนไขการค้นหา'}
                        </p>
                        <div className="mt-4 flex items-center justify-center gap-2">
                          {(searchQuery !== '' ||
                            selectedColumnId !== 'ALL' ||
                            quickFilterValue !== 'ALL' ||
                            deepSearchTerm !== '') && (
                            <button
                              type="button"
                              onClick={handleClearSearch}
                              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                            >
                              ล้างคำค้นหาทั้งหมด
                            </button>
                          )}
                          {searchQuery.trim() !== '' &&
                            sheetData &&
                            sheetData.totalRowsInSheet > rowLimit &&
                            deepSearchTerm !== searchQuery.trim() && (
                              <button
                                type="button"
                                onClick={handleTriggerDeepSearch}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                ค้นหาลึกทั้งชีต ({sheetData.totalRowsInSheet.toLocaleString('th-TH')} แถว)
                              </button>
                            )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      onClick={() => setSelectedRow(row)}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      <td className="px-2.5 py-2 sm:px-4 sm:py-2.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        <span>#{row.rowNumber.toLocaleString('th-TH')}</span>
                      </td>
                      {sheetData?.columns.map((col) => {
                        const val = row.values[col.id] ?? '';
                        const isNumeric = col.type === 'number';
                        const isMono =
                          isNumeric ||
                          col.type === 'date' ||
                          col.type === 'datetime' ||
                          col.type === 'timeofday';

                        const isEditableGateCell =
                          activeTab.gid === '1156877149' && col.id === 'C';
                        const isEditableVehicleRegCell =
                          activeTab.gid === '378250263' && col.id === 'A';
                        const isEditableJobNoteCell =
                          activeTab.gid === '606634465' && col.id === 'N';
                        const isEditableRepairDetailCell =
                          activeTab.gid === '944294225' &&
                          (col.id === 'AK' || col.label.includes('รายละเอียดเพิ่มเติม'));
                        const isEditableRepairReplyCell =
                          activeTab.gid === '944294225' &&
                          (col.id === 'AM' || col.label.includes('ตอบกลับข้อมูลเพิ่มเติม'));
                        const isEditableInlineCell =
                          isEditableGateCell ||
                          isEditableVehicleRegCell ||
                          isEditableJobNoteCell ||
                          isEditableRepairDetailCell ||
                          isEditableRepairReplyCell;
                        const isEditingThisRow =
                          isEditableInlineCell &&
                          editingGateRowNumber === row.rowNumber &&
                          editingColumnId === col.id;
                        const isConfirmingThisRow =
                          isEditableInlineCell &&
                          confirmingGateRowNumber === row.rowNumber &&
                          editingColumnId === col.id;
                        const isOver20MinDuration =
                          activeTab.gid === '606634465' &&
                          (col.id === 'L' || col.label === 'เวลาที่ใช้') &&
                          isDurationExceeding20Minutes(val);

                        return (
                          <td
                            key={col.id}
                            onClick={
                              isEditableInlineCell
                                ? (e) => {
                                    e.stopPropagation();
                                    if (!isEditingThisRow && !isConfirmingThisRow) {
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingColumnId(col.id);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }
                                  }
                                : undefined
                            }
                            className={`px-2.5 py-2 sm:px-4 sm:py-2.5 ${
                              isOver20MinDuration
                                ? 'bg-red-50 font-bold text-red-600'
                                : 'text-slate-800'
                            } ${
                              isEditableInlineCell
                                ? 'min-w-[220px] sm:min-w-[280px] cursor-pointer'
                                : 'max-w-[220px] sm:max-w-[260px] truncate'
                            } ${isNumeric ? 'text-right' : 'text-left'} ${
                              isMono ? 'font-mono text-xs tabular-nums' : 'text-xs sm:text-sm'
                            }`}
                            title={
                              isEditableInlineCell
                                ? 'คลิกเพื่อแก้ไขข้อมูลเพิ่มเติม'
                                : val
                            }
                          >
                            {isEditableInlineCell ? (
                              isConfirmingThisRow ? (
                                <div
                                  className="flex flex-wrap items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-xs text-slate-700">
                                    ยืนยัน{' '}
                                    <strong className="font-semibold text-slate-900">
                                      {editingGateValue.trim() || '(ว่าง)'}
                                    </strong>
                                    ?
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isUpdatingGate}
                                    onClick={() => handleConfirmGateUpdate(row)}
                                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>
                                      {isUpdatingGate ? 'กำลังบันทึก...' : 'ยืนยัน'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isUpdatingGate}
                                    onClick={() => {
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    ย้อนกลับ
                                  </button>
                                </div>
                              ) : isEditingThisRow ? (
                                <div
                                  className="flex items-center gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingGateValue}
                                    onChange={(e) => setEditingGateValue(e.target.value)}
                                    placeholder={
                                      isEditableJobNoteCell
                                        ? 'พิมพ์หมายเหตุ...'
                                        : isEditableRepairDetailCell
                                          ? 'พิมพ์รายละเอียดเพิ่มเติม...'
                                          : isEditableRepairReplyCell
                                            ? 'พิมพ์ตอบกลับข้อมูลเพิ่มเติม...'
                                            : undefined
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (
                                          (isEditableJobNoteCell ||
                                            isEditableRepairDetailCell ||
                                            isEditableRepairReplyCell ||
                                            editingGateValue.trim()) &&
                                          editingGateValue.trim() !== val.trim()
                                        ) {
                                          setConfirmingGateRowNumber(row.rowNumber);
                                        } else {
                                          setEditingGateRowNumber(null);
                                          setEditingColumnId(null);
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingGateRowNumber(null);
                                        setEditingColumnId(null);
                                        setConfirmingGateRowNumber(null);
                                      }
                                    }}
                                    className="w-40 sm:w-52 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none shadow-2xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (
                                        (isEditableJobNoteCell ||
                                          isEditableRepairDetailCell ||
                                          isEditableRepairReplyCell ||
                                          editingGateValue.trim()) &&
                                        editingGateValue.trim() !== val.trim()
                                      ) {
                                        setConfirmingGateRowNumber(row.rowNumber);
                                      } else {
                                        setEditingGateRowNumber(null);
                                        setEditingColumnId(null);
                                      }
                                    }}
                                    className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                                  >
                                    บันทึก
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingGateRowNumber(null);
                                      setEditingColumnId(null);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-1.5 group/cell hover:text-slate-900">
                                  <span className="truncate">{renderHighlightedText(val || '-')}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingColumnId(col.id);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 whitespace-nowrap shrink-0 shadow-2xs"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                    <span>แก้ไข</span>
                                  </button>
                                </div>
                              )
                            ) : (
                              renderHighlightedText(val)
                            )}
                          </td>
                        );
                      })}
                      {activeTab.gid === '944294225' && (
                        <td
                          className="px-2.5 py-2 sm:px-4 sm:py-2.5 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedRow(row)}
                              title="ดูรายละเอียดทั้งหมด"
                              className="inline-flex items-center gap-1 rounded bg-slate-900 hover:bg-slate-800 text-white px-2.5 py-1 text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>รายละเอียด</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttachingPhotoRow(row)}
                              title="แนบรูปเพิ่ม / แก้ไขรูปถ่าย"
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold transition-colors shadow-2xs"
                            >
                              <Camera className="h-3.5 w-3.5 text-slate-600" />
                              <span>แนบรูป</span>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Compact Pagination Footer */}
          {sheetData && sortedRows.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/50 px-3 py-2 sm:px-5 sm:py-2.5">
              <div className="text-[11px] sm:text-xs text-slate-600">
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString('th-TH')}
                </span>
                –
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {Math.min(currentPage * PAGE_SIZE, sortedRows.length).toLocaleString(
                    'th-TH'
                  )}
                </span>{' '}
                / {' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {sortedRows.length.toLocaleString('th-TH')}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">ก่อนหน้า</span>
                </button>

                <span className="px-1.5 font-mono text-xs font-medium text-slate-700 tabular-nums whitespace-nowrap">
                  {currentPage.toLocaleString('th-TH')}/{totalPages.toLocaleString('th-TH')}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <span className="hidden sm:inline">ถัดไป</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
        </main>
      </div>

      {/* Record Detail Modal */}
      <RecordDetailModal
        row={selectedRow}
        columns={sheetData?.allColumns ?? sheetData?.columns ?? []}
        tabName={activeTab.name}
        onClose={() => setSelectedRow(null)}
        onOpenAttachPhotos={(row) => setAttachingPhotoRow(row)}
      />

      {/* Attach / Edit Repair Photos Modal */}
      <AttachRepairPhotosModal
        isOpen={attachingPhotoRow !== null}
        row={attachingPhotoRow}
        onClose={() => setAttachingPhotoRow(null)}
        onPhotosUpdated={(updatedPhotos) => {
          setSaveSuccessMsg('อัปเดตรูปถ่ายเพิ่มเติมในแถวเดิมเรียบร้อยแล้ว');
          if (
            selectedRow &&
            attachingPhotoRow &&
            selectedRow.rowNumber === attachingPhotoRow.rowNumber
          ) {
            const updatedValues = { ...selectedRow.values };
            const photoCols = ['Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
            updatedPhotos.slice(0, 9).forEach((photo, idx) => {
              updatedValues[photoCols[idx]] = photo;
            });
            setSelectedRow({
              ...selectedRow,
              values: updatedValues,
            });
          }
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Job Transfer Creation Modal */}
      <JobTransferModal
        isOpen={isJobModalOpen}
        onClose={() => setIsJobModalOpen(false)}
        existingRows={activeTab.gid === '606634465' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลการย้ายงานลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Delivery Point Creation Modal */}
      <DeliveryPointModal
        isOpen={isDeliveryPointModalOpen}
        onClose={() => setIsDeliveryPointModalOpen(false)}
        existingRows={activeTab.gid === '1156877149' ? sheetData?.rows ?? [] : []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('เพิ่มข้อมูลจุดส่งสินค้าลงฐานข้อมูลเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* No-Login Google Sheets Webhook Setup Modal */}
      <SheetWebhookModal
        isOpen={isWebhookModalOpen}
        onClose={() => setIsWebhookModalOpen(false)}
        onSaved={() => {
          setSaveSuccessMsg('บันทึกการเชื่อมต่อ Google Sheets (ไม่ต้องล็อกอิน) เรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Repair Request Modal */}
      <RepairRequestModal
        isOpen={isRepairModalOpen}
        onClose={() => setIsRepairModalOpen(false)}
        existingRows={sheetData?.rows ?? []}
        onSavedSuccess={() => {
          setSaveSuccessMsg('บันทึกข้อมูลแจ้งซ่อมเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />

      {/* Manager Approval Modal */}
      <ManagerApprovalModal
        isOpen={isApprovalModalOpen}
        onClose={() => setIsApprovalModalOpen(false)}
        rows={activeTab.gid === '944294225' ? (sheetData?.rows ?? []) : []}
        onApprovedSuccess={() => {
          setSaveSuccessMsg('บันทึกผลการพิจารณาอนุมัติงานซ่อมเรียบร้อยแล้ว');
          loadData({ silent: true });
          setTimeout(() => {
            setSaveSuccessMsg(null);
          }, 5000);
        }}
      />
    </div>
  );
}
