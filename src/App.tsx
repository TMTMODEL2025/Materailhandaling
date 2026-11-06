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
} from 'lucide-react';
import {
  GOOGLE_SHEET_ID,
  SHEET_TABS,
  fetchSheetTabData,
  updateDeliveryPointGate,
  updateVehicleRegistration,
  updateJobTransferNote,
} from './services/googleSheets';
import { SheetColumn, SheetDataResult, SheetRow, SheetTabConfig } from './types';
import { RecordDetailModal } from './components/RecordDetailModal';
import { JobTransferModal } from './components/JobTransferModal';
import { DeliveryPointModal } from './components/DeliveryPointModal';
import { SheetWebhookModal } from './components/SheetWebhookModal';

const PAGE_SIZE = 50;

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
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Inline editing state for จุดส่งสินค้า -> คอลัมน์ ประตู and ฐานข้อมูลรถ -> คอลัมน์ ทะเบียนรถ
  const [editingGateRowNumber, setEditingGateRowNumber] = useState<number | null>(null);
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
    setSortConfig(null);
    setCurrentPage(1);
    setEditingGateRowNumber(null);
    setConfirmingGateRowNumber(null);
  };

  const handleConfirmGateUpdate = async (row: SheetRow) => {
    const newValue = editingGateValue.trim();
    const isVehicleTab = activeTab.gid === '378250263';
    const isJobTransferTab = activeTab.gid === '606634465';
    const oldValue = isVehicleTab
      ? (row.values['A'] ?? '').trim()
      : isJobTransferTab
        ? (row.values['N'] ?? '').trim()
        : (row.values['C'] ?? '').trim();

    if (!isJobTransferTab && !newValue) return;
    if (newValue === oldValue) {
      setEditingGateRowNumber(null);
      setConfirmingGateRowNumber(null);
      return;
    }

    setIsUpdatingGate(true);
    setError(null);

    try {
      if (isJobTransferTab) {
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

  // Filter rows by search query, selected column, and quick filter
  const filteredRows = useMemo<SheetRow[]>(() => {
    if (!sheetData) return [];
    const q = searchQuery.trim().toLowerCase();

    return sheetData.rows.filter((row) => {
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
  }, [sheetData, searchQuery, selectedColumnId, quickFilterValue, quickFilterColumn]);

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
  }, [searchQuery, selectedColumnId, quickFilterValue, activeTab.gid]);

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

        <main className="mx-auto w-full max-w-[1440px] px-2.5 py-2.5 sm:px-6 sm:py-4 lg:px-8">
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
                    </tr>
                  ))
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={(sheetData?.columns.length ?? 5) + 1}
                      className="px-6 py-14 text-center"
                    >
                      <div className="mx-auto max-w-md">
                        <div className="text-base font-semibold text-slate-900">
                          ไม่พบรายการข้อมูลที่ตรงกับเงื่อนไขการค้นหา
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {searchQuery
                            ? `ไม่พบข้อมูลที่มีคำว่า "${searchQuery}" ในชุดข้อมูลที่เลือก`
                            : 'ไม่มีข้อมูลในตารางนี้'}
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
                        #{row.rowNumber.toLocaleString('th-TH')}
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
                        const isEditableInlineCell =
                          isEditableGateCell ||
                          isEditableVehicleRegCell ||
                          isEditableJobNoteCell;
                        const isEditingThisRow =
                          isEditableInlineCell &&
                          editingGateRowNumber === row.rowNumber;
                        const isConfirmingThisRow =
                          isEditableInlineCell &&
                          confirmingGateRowNumber === row.rowNumber;
                        const isOver20MinDuration =
                          activeTab.gid === '606634465' &&
                          (col.id === 'L' || col.label === 'เวลาที่ใช้') &&
                          isDurationExceeding20Minutes(val);

                        return (
                          <td
                            key={col.id}
                            onClick={
                              isEditableInlineCell
                                ? (e) => e.stopPropagation()
                                : undefined
                            }
                            className={`px-2.5 py-2 sm:px-4 sm:py-2.5 ${
                              isOver20MinDuration
                                ? 'bg-red-50 font-bold text-red-600'
                                : 'text-slate-800'
                            } ${
                              isEditableInlineCell
                                ? 'min-w-[200px] sm:min-w-[240px]'
                                : 'max-w-[220px] sm:max-w-[260px] truncate'
                            } ${isNumeric ? 'text-right' : 'text-left'} ${
                              isMono ? 'font-mono text-xs tabular-nums' : 'text-xs sm:text-sm'
                            }`}
                            title={!isEditableInlineCell ? val : undefined}
                          >
                            {isEditableInlineCell ? (
                              isConfirmingThisRow ? (
                                <div className="flex flex-wrap items-center gap-1.5">
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
                                    onClick={() => setConfirmingGateRowNumber(null)}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    ย้อนกลับ
                                  </button>
                                </div>
                              ) : isEditingThisRow ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editingGateValue}
                                    onChange={(e) => setEditingGateValue(e.target.value)}
                                    placeholder={
                                      isEditableJobNoteCell ? 'พิมพ์หมายเหตุ...' : undefined
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (
                                          (isEditableJobNoteCell ||
                                            editingGateValue.trim()) &&
                                          editingGateValue.trim() !== val.trim()
                                        ) {
                                          setConfirmingGateRowNumber(row.rowNumber);
                                        } else {
                                          setEditingGateRowNumber(null);
                                        }
                                      } else if (e.key === 'Escape') {
                                        setEditingGateRowNumber(null);
                                        setConfirmingGateRowNumber(null);
                                      }
                                    }}
                                    className="w-32 sm:w-36 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (
                                        (isEditableJobNoteCell ||
                                          editingGateValue.trim()) &&
                                        editingGateValue.trim() !== val.trim()
                                      ) {
                                        setConfirmingGateRowNumber(row.rowNumber);
                                      } else {
                                        setEditingGateRowNumber(null);
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
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap shrink-0"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-1.5">
                                  <span>{renderHighlightedText(val)}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingGateRowNumber(row.rowNumber);
                                      setEditingGateValue(val);
                                      setConfirmingGateRowNumber(null);
                                    }}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-900 hover:text-slate-900 whitespace-nowrap shrink-0"
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
        columns={sheetData?.columns ?? []}
        tabName={activeTab.name}
        onClose={() => setSelectedRow(null)}
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
    </div>
  );
}
