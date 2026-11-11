import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Move,
  Sparkles,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { DrivePhotoImg } from './DrivePhotoImg';
import {
  extractDriveFileId,
  getDriveDirectViewUrl,
  processHighResImageFile,
  updateRepairPhotos,
} from '../services/googleSheets';
import { showSuccessToast } from '../utils/swal';

interface PhotoLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: string[];
  initialIndex?: number;
  title?: string;
  subtitle?: string;
  vehicleNo?: string;
  sequenceNo?: string;
  rowNumber?: number;
  repairRequestNo?: string;
  onPhotosUpdated?: (updatedPhotos: string[]) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  isOpen,
  onClose,
  photos,
  initialIndex = 0,
  title,
  subtitle,
  vehicleNo,
  sequenceNo,
  rowNumber,
  repairRequestNo,
  onPhotosUpdated,
}) => {
  const [localPhotos, setLocalPhotos] = useState<string[]>(photos);
  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight * 0.75 : 700,
  });
  const [isActual1to1, setIsActual1to1] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [enableSharpen, setEnableSharpen] = useState<boolean>(false);
  const [isUploadingHighRes, setIsUploadingHighRes] = useState<boolean>(false);

  // Mouse & 1-finger touch drag/pan state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const modalRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileReplaceInputRef = useRef<HTMLInputElement>(null);

  // Refs for pinch-to-zoom, 1-finger pan/swipe, and double-tap zoom
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;

  const isActual1to1Ref = useRef<boolean>(isActual1to1);
  isActual1to1Ref.current = isActual1to1;

  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  const pinchStateRef = useRef<{
    active: boolean;
    initialDist: number;
    initialZoom: number;
    startScrollLeft: number;
    startScrollTop: number;
    startOriginX: number;
    startOriginY: number;
  }>({
    active: false,
    initialDist: 0,
    initialZoom: 1,
    startScrollLeft: 0,
    startScrollTop: 0,
    startOriginX: 0,
    startOriginY: 0,
  });

  const singleTouchRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
    moved: false,
  });

  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });

  // Sync localPhotos and index when modal opens or photos prop changes
  useEffect(() => {
    setLocalPhotos(photos);
  }, [photos]);

  useEffect(() => {
    if (isOpen) {
      const validIndex = Math.max(0, Math.min(initialIndex, photos.length - 1));
      setCurrentIndex(validIndex);
      setZoom(1);
      setRotation(0);
      setNaturalDimensions(null);
      setIsActual1to1(false);
      setEnableSharpen(false);
    }
  }, [isOpen, initialIndex, photos.length]);

  // Measure scroll container dimensions so mobile/desktop zoom scales smoothly from 100% fit size
  useEffect(() => {
    if (!isOpen) return;
    const updateSize = () => {
      if (scrollContainerRef.current) {
        setContainerSize({
          width: scrollContainerRef.current.clientWidth || window.innerWidth,
          height: scrollContainerRef.current.clientHeight || window.innerHeight * 0.75,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isOpen]);

  // Apply anchored scroll position synchronously right after zoom state updates
  useLayoutEffect(() => {
    if (pendingScrollRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = Math.max(0, pendingScrollRef.current.left);
      scrollContainerRef.current.scrollTop = Math.max(0, pendingScrollRef.current.top);
      pendingScrollRef.current = null;
    }
  }, [zoom, isActual1to1]);

  // Compute the base "fit-to-screen" width in pixels at zoom = 1
  const getBaseFitWidth = useCallback((): number => {
    const pad = containerSize.width < 640 ? 16 : 32;
    const availW = Math.max(240, containerSize.width - pad);
    const availH = Math.max(200, containerSize.height - pad);

    if (naturalDimensions && naturalDimensions.width > 0 && naturalDimensions.height > 0) {
      const aspect = naturalDimensions.width / naturalDimensions.height;
      return Math.round(Math.min(availW, availH * aspect));
    }
    return Math.round(availW * 0.92);
  }, [containerSize.width, containerSize.height, naturalDimensions]);

  // Helper to zoom while keeping a specific viewport point (originX, originY) anchored
  const applyZoomAtPoint = useCallback(
    (nextZoomRaw: number, originX?: number, originY?: number) => {
      const container = scrollContainerRef.current;
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parseFloat(nextZoomRaw.toFixed(2))));
      const prevZoom = zoomRef.current;

      if (container && clampedZoom > 1) {
        const ox = originX !== undefined ? originX : container.clientWidth / 2;
        const oy = originY !== undefined ? originY : container.clientHeight / 2;
        const ratio = clampedZoom / Math.max(1, prevZoom);
        const nextLeft = (container.scrollLeft + ox) * ratio - ox;
        const nextTop = (container.scrollTop + oy) * ratio - oy;
        pendingScrollRef.current = { left: nextLeft, top: nextTop };
      } else if (container && clampedZoom <= 1) {
        pendingScrollRef.current = { left: 0, top: 0 };
      }

      setIsActual1to1(false);
      setZoom(clampedZoom);
    },
    []
  );

  const handleSelectPhoto = (idx: number) => {
    setCurrentIndex(idx);
    setZoom(1);
    setRotation(0);
    setNaturalDimensions(null);
    setIsActual1to1(false);
    setEnableSharpen(false);
  };

  const handleNextPhoto = useCallback(() => {
    if (localPhotos.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % localPhotos.length);
    setZoom(1);
    setRotation(0);
    setNaturalDimensions(null);
    setIsActual1to1(false);
    setEnableSharpen(false);
  }, [localPhotos.length]);

  const handlePrevPhoto = useCallback(() => {
    if (localPhotos.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + localPhotos.length) % localPhotos.length);
    setZoom(1);
    setRotation(0);
    setNaturalDimensions(null);
    setIsActual1to1(false);
    setEnableSharpen(false);
  }, [localPhotos.length]);

  const handleZoomIn = () => {
    const step = zoomRef.current >= 2 ? 0.5 : 0.25;
    applyZoomAtPoint(zoomRef.current + step);
  };

  const handleZoomOut = () => {
    const step = zoomRef.current > 2 ? 0.5 : 0.25;
    applyZoomAtPoint(zoomRef.current - step);
  };

  const handleResetZoom = useCallback(() => {
    setIsActual1to1(false);
    setZoom(1);
    setRotation(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
      scrollContainerRef.current.scrollTop = 0;
    }
  }, []);

  const handleSetActualSize = () => {
    setIsActual1to1((prev) => {
      const next = !prev;
      if (next) {
        const fitW = getBaseFitWidth();
        const targetW = naturalDimensions ? Math.max(naturalDimensions.width, fitW * 2) : fitW * 2;
        const computedZoom = Math.max(1.5, Math.min(MAX_ZOOM, parseFloat((targetW / Math.max(1, fitW)).toFixed(2))));
        setZoom(computedZoom);
      } else {
        setZoom(1);
      }
      return next;
    });
  };

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };

  // Native non-passive touch listeners for smooth 2-finger pinch-to-zoom, 1-finger pan, and double-tap zoom on mobile
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!isOpen || !container) return;

    const getTouchDistance = (t1: Touch, t2: Touch) => {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return Math.hypot(dx, dy);
    };

    const getTouchMidpoint = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Two-finger pinch start: prevent browser page zoom
        e.preventDefault();
        e.stopPropagation();
        singleTouchRef.current.active = false;

        const dist = getTouchDistance(e.touches[0], e.touches[1]);
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        const rect = container.getBoundingClientRect();

        pinchStateRef.current = {
          active: true,
          initialDist: Math.max(10, dist),
          initialZoom: zoomRef.current,
          startScrollLeft: container.scrollLeft,
          startScrollTop: container.scrollTop,
          startOriginX: mid.x - rect.left,
          startOriginY: mid.y - rect.top,
        };
      } else if (e.touches.length === 1) {
        pinchStateRef.current.active = false;
        const touch = e.touches[0];
        singleTouchRef.current = {
          active: true,
          startX: touch.clientX,
          startY: touch.clientY,
          startScrollLeft: container.scrollLeft,
          startScrollTop: container.scrollTop,
          moved: false,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStateRef.current.active) {
        e.preventDefault();
        e.stopPropagation();

        const dist = getTouchDistance(e.touches[0], e.touches[1]);
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        const rect = container.getBoundingClientRect();
        const currentOriginX = mid.x - rect.left;
        const currentOriginY = mid.y - rect.top;

        const scaleRatio = dist / pinchStateRef.current.initialDist;
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, parseFloat((pinchStateRef.current.initialZoom * scaleRatio).toFixed(2)))
        );

        const effectiveRatio = nextZoom / Math.max(1, pinchStateRef.current.initialZoom);
        const contentX = pinchStateRef.current.startScrollLeft + pinchStateRef.current.startOriginX;
        const contentY = pinchStateRef.current.startScrollTop + pinchStateRef.current.startOriginY;

        pendingScrollRef.current = {
          left: contentX * effectiveRatio - currentOriginX,
          top: contentY * effectiveRatio - currentOriginY,
        };

        setIsActual1to1(false);
        setZoom(nextZoom);
      } else if (e.touches.length === 1 && singleTouchRef.current.active) {
        const touch = e.touches[0];
        const dx = touch.clientX - singleTouchRef.current.startX;
        const dy = touch.clientY - singleTouchRef.current.startY;

        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          singleTouchRef.current.moved = true;
        }

        // When zoomed in, pan the scroll container smoothly with 1 finger
        if (zoomRef.current > 1 || isActual1to1Ref.current) {
          if (e.cancelable) e.preventDefault();
          container.scrollLeft = singleTouchRef.current.startScrollLeft - dx;
          container.scrollTop = singleTouchRef.current.startScrollTop - dy;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (pinchStateRef.current.active && e.touches.length < 2) {
        pinchStateRef.current.active = false;
        // If 1 finger remains on screen after pinching, transition smoothly to 1-finger pan
        if (e.touches.length === 1) {
          singleTouchRef.current = {
            active: true,
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            startScrollLeft: container.scrollLeft,
            startScrollTop: container.scrollTop,
            moved: true,
          };
        }
        return;
      }

      if (e.touches.length === 0 && singleTouchRef.current.active) {
        const wasMoved = singleTouchRef.current.moved;
        const endTouch = e.changedTouches[0];
        singleTouchRef.current.active = false;

        if (!endTouch) return;

        // Check for horizontal swipe to change photo when at 1x zoom
        if (wasMoved && zoomRef.current <= 1 && !isActual1to1Ref.current && localPhotos.length > 1) {
          const dx = endTouch.clientX - singleTouchRef.current.startX;
          const dy = endTouch.clientY - singleTouchRef.current.startY;
          if (Math.abs(dx) > 65 && Math.abs(dy) < 50) {
            if (dx < 0) {
              handleNextPhoto();
            } else {
              handlePrevPhoto();
            }
          }
          return;
        }

        // Check for double-tap to zoom on mobile (when finger didn't drag)
        if (!wasMoved) {
          const targetEl = e.target as HTMLElement | null;
          if (targetEl && targetEl.closest('button, a, input')) return;

          const now = Date.now();
          const dt = now - lastTapRef.current.time;
          const dist = Math.hypot(
            endTouch.clientX - lastTapRef.current.x,
            endTouch.clientY - lastTapRef.current.y
          );

          if (dt > 0 && dt < 320 && dist < 36) {
            // Double-tap detected!
            if (e.cancelable) e.preventDefault();
            const rect = container.getBoundingClientRect();
            const originX = endTouch.clientX - rect.left;
            const originY = endTouch.clientY - rect.top;

            if (zoomRef.current > 1 || isActual1to1Ref.current) {
              handleResetZoom();
            } else {
              applyZoomAtPoint(2.5, originX, originY);
            }
            lastTapRef.current = { time: 0, x: 0, y: 0 };
          } else {
            lastTapRef.current = {
              time: now,
              x: endTouch.clientX,
              y: endTouch.clientY,
            };
          }
        }
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [isOpen, localPhotos.length, handleNextPhoto, handlePrevPhoto, handleResetZoom, applyZoomAtPoint]);

  // Replace current blurry photo with a full 4K high-res file directly from Lightbox
  const handleReplaceCurrentPhoto = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsUploadingHighRes(true);
    try {
      const highResDataUrl = await processHighResImageFile(file);
      const updatedList = [...localPhotos];
      updatedList[currentIndex] = highResDataUrl;
      setLocalPhotos(updatedList);
      setNaturalDimensions(null);

      if (sequenceNo || (rowNumber && rowNumber > 0)) {
        const padded = Array.from({ length: 9 }, (_, i) => (updatedList[i] || '').trim());
        const savedUrls = await updateRepairPhotos({
          rowNumber: rowNumber || 0,
          sequenceNo: sequenceNo || '',
          repairRequestNo: repairRequestNo || '',
          photos: padded,
        });
        const finalUrls = updatedList.map((item, idx) => savedUrls[idx] || item);
        setLocalPhotos(finalUrls);
        if (onPhotosUpdated) {
          onPhotosUpdated(finalUrls);
        }
      } else if (onPhotosUpdated) {
        onPhotosUpdated(updatedList);
      }

      showSuccessToast(
        'อัปเดตรูปความละเอียดสูง (HD/4K) สำเร็จ!',
        'เปลี่ยนเป็นไฟล์ภาพความละเอียดสูงโดยไม่บีบอัดเรียบร้อยแล้ว'
      );
    } catch {
      // ignore
    } finally {
      setIsUploadingHighRes(false);
    }
  };

  // Mouse wheel zoom inside scroll container (Desktop)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const rect = scrollContainerRef.current?.getBoundingClientRect();
      const ox = rect ? e.clientX - rect.left : undefined;
      const oy = rect ? e.clientY - rect.top : undefined;
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      applyZoomAtPoint(zoomRef.current + delta, ox, oy);
    }
  };

  // Mouse drag panning on the scroll container (Desktop)
  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom <= 1 && !isActual1to1) return;
    if (!scrollContainerRef.current) return;
    if ((e.target as HTMLElement).closest('button, a, input')) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollContainerRef.current.scrollLeft,
      scrollTop: scrollContainerRef.current.scrollTop,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    scrollContainerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    scrollContainerRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Desktop double-click to toggle zoom at cursor
  const handleViewerDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    const rect = scrollContainerRef.current?.getBoundingClientRect();
    const ox = rect ? e.clientX - rect.left : undefined;
    const oy = rect ? e.clientY - rect.top : undefined;
    if (zoom > 1 || isActual1to1) {
      handleResetZoom();
    } else {
      applyZoomAtPoint(2.5, ox, oy);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        handleNextPhoto();
      } else if (e.key === 'ArrowLeft') {
        handlePrevPhoto();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoom();
      } else if (e.key.toLowerCase() === 'r') {
        handleRotate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleNextPhoto, handlePrevPhoto, handleResetZoom, onClose]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!modalRef.current) return;
    if (!document.fullscreenElement) {
      modalRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  if (!isOpen || localPhotos.length === 0) return null;

  const currentPhoto = localPhotos[currentIndex] || '';
  const fileId = extractDriveFileId(currentPhoto);
  const directDriveViewUrl = fileId ? getDriveDirectViewUrl(currentPhoto) : null;

  const isLegacyLowResFile =
    naturalDimensions !== null &&
    naturalDimensions.width <= 800 &&
    naturalDimensions.height <= 800;

  // Calculate actual pixel width for the img tag (NO CSS transform: scale!)
  const computeImageStyle = (): React.CSSProperties => {
    const filterValue = enableSharpen
      ? 'url(#hd-crisp-sharpen) contrast(1.08)'
      : undefined;

    const baseFitWidth = getBaseFitWidth();
    const targetWidth = Math.round(baseFitWidth * zoom);

    return {
      width: `${targetWidth}px`,
      maxWidth: 'none',
      height: 'auto',
      filter: filterValue,
      transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    };
  };

  const zoomPercent =
    isActual1to1 && naturalDimensions
      ? `1:1 (${Math.round(zoom * 100)}%)`
      : `${Math.round(zoom * 100)}%`;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-70 flex flex-col bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-150"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onWheel={handleWheel}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Hidden SVG Unsharp Mask Convolution Filter for sharpening text/tables */}
      <svg className="absolute h-0 w-0 pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="hd-crisp-sharpen">
            <feConvolveMatrix
              order="3 3"
              preserveAlpha="true"
              kernelMatrix="0 -0.6 0 -0.6 3.4 -0.6 0 -0.6 0"
            />
          </filter>
        </defs>
      </svg>

      {/* Hidden input for replacing blurry low-res photo with original 4K file */}
      <input
        ref={fileReplaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleReplaceCurrentPhoto(e.target.files);
          if (e.target) e.target.value = '';
        }}
      />

      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-2 sm:px-4 sm:py-2.5 text-white z-20 shrink-0 gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 shrink-0">
            <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate max-w-[180px] sm:max-w-none">
                {title || (vehicleNo ? `รูปถ่ายงานซ่อม เบอร์รถ ${vehicleNo}` : 'ดูรูปถ่ายความละเอียดสูง')}
              </h3>
              {sequenceNo && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] sm:text-[11px] text-slate-300 border border-slate-700 shrink-0">
                  #{sequenceNo}
                </span>
              )}
              {naturalDimensions ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold border shrink-0 inline-flex items-center gap-1 ${
                    isLegacyLowResFile
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>
                    {naturalDimensions.width}×{naturalDimensions.height}px
                    {isLegacyLowResFile ? ' (ไฟล์เดิมขนาดเล็ก)' : ' (HD/4K)'}
                  </span>
                </span>
              ) : (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 border border-slate-700 animate-pulse">
                  กำลังโหลดความละเอียดจริง...
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-slate-400 truncate max-w-xl hidden sm:block">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Button to replace current photo with 100% uncompressed 4K original */}
          <button
            type="button"
            disabled={isUploadingHighRes}
            onClick={() => fileReplaceInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] sm:text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors cursor-pointer"
            title="เลือกไฟล์ภาพต้นฉบับจากเครื่องเพื่ออัปเดตแทนที่รูปนี้ด้วยความละเอียดสูงสุด 4K (ไม่บีบอัด)"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">
              {isUploadingHighRes ? 'กำลังอัปโหลดรูปชัด 4K...' : 'อัปโหลดรูปชัด (HD/4K) แทนที่รูปนี้'}
            </span>
            <span className="md:hidden">
              {isUploadingHighRes ? 'กำลังอัปโหลด...' : 'อัปโหลดรูปชัด'}
            </span>
          </button>

          {directDriveViewUrl && (
            <a
              href={directDriveViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="เปิดรูปต้นฉบับใน Google Drive แท็บใหม่"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">เปิดดูใน Drive</span>
            </a>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors hidden sm:inline-flex"
            title={isFullscreen ? 'ออกจากเต็มจอ' : 'เต็มหน้าจอ'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-rose-600 hover:text-white transition-colors"
            title="ปิดหน้าต่าง (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Low-Res Original File Warning Banner */}
      {isLegacyLowResFile && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-950/90 border-b border-amber-700/60 px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs text-amber-200 z-20 shrink-0">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>
              ไฟล์รูปเดิมใน Drive มีความละเอียดต่ำ ({naturalDimensions.width}×{naturalDimensions.height}px) — กด{' '}
              <strong className="text-emerald-300">"อัปโหลดรูปชัด"</strong> เพื่อเปลี่ยนเป็นไฟล์ 4K
            </span>
          </div>
          <button
            type="button"
            disabled={isUploadingHighRes}
            onClick={() => fileReplaceInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-slate-950 hover:bg-amber-400 shrink-0 cursor-pointer"
          >
            <Upload className="h-3 w-3" />
            <span>เปลี่ยนเป็นไฟล์ชัด</span>
          </button>
        </div>
      )}

      {/* 2. Main Viewer Area with 2-finger pinch-to-zoom, 1-finger pan, and genuine raster width rendering */}
      <div
        ref={scrollContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={handleViewerDoubleClick}
        style={{ touchAction: 'none' }}
        className={`relative flex-1 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] overflow-auto ${
          zoom > 1 || isActual1to1
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-default'
        }`}
      >
        {/* Navigation Buttons */}
        {localPhotos.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrevPhoto();
              }}
              className="fixed left-2 sm:left-3 top-1/2 -translate-y-1/2 z-30 flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-blue-600 transition-colors border border-slate-700"
              title="รูปก่อนหน้า (ลูกศรซ้าย)"
            >
              <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNextPhoto();
              }}
              className="fixed right-2 sm:right-3 top-1/2 -translate-y-1/2 z-30 flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-blue-600 transition-colors border border-slate-700"
              title="รูปถัดไป (ลูกศรขวา)"
            >
              <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          </>
        )}

        {/* Flex wrapper with m-auto child so all 4 edges remain scrollable when zoomed in */}
        <div className="min-h-full min-w-full flex p-2 sm:p-6">
          <div className="m-auto flex items-center justify-center">
            <DrivePhotoImg
              key={`${currentPhoto}_${currentIndex}`}
              src={currentPhoto}
              alt={`รูปถ่ายที่ ${currentIndex + 1}`}
              highRes={true}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setNaturalDimensions({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                  if (img.naturalWidth <= 800 && img.naturalHeight <= 800) {
                    setEnableSharpen(true);
                  }
                }
              }}
              className="rounded-lg shadow-2xl select-none"
              style={computeImageStyle()}
            />
          </div>
        </div>

        {/* Gesture Hint overlay */}
        <div className="pointer-events-none fixed bottom-20 sm:bottom-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1 text-[10px] sm:text-[11px] font-medium text-slate-300 border border-slate-700 shadow-xl backdrop-blur-xs whitespace-nowrap">
          <Move className="h-3 w-3 text-blue-400 shrink-0" />
          <span>
            {zoom > 1 || isActual1to1
              ? 'ใช้นิ้วลากเพื่อเลื่อนดู • ถ่าง 2 นิ้วซูมเข้า/ออก • แตะ 2 ครั้งเพื่อรีเซ็ต'
              : 'ถ่าง 2 นิ้วเพื่อซูมขยาย (Pinch to Zoom) • แตะ 2 ครั้งเพื่อซูมด่วน'}
          </span>
        </div>
      </div>

      {/* 3. Bottom Zoom & Tool Controls */}
      <div className="z-20 border-t border-slate-800 bg-slate-900/95 px-2.5 py-2 sm:px-4 backdrop-blur-md shrink-0">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
          {/* Photo Counter */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-white">
              รูปที่ {currentIndex + 1} / {localPhotos.length}
            </span>
            <span>•</span>
            <span className="font-mono text-emerald-400 font-bold">
              ซูม {zoomPercent}
            </span>
            {rotation !== 0 && (
              <>
                <span>•</span>
                <span className="text-amber-400">หมุน {rotation}°</span>
              </>
            )}
          </div>

          {/* Zoom Buttons Toolbar */}
          <div className="flex flex-wrap items-center justify-center gap-1 bg-slate-800/90 p-1 rounded-xl border border-slate-700 shadow-md">
            {/* Zoom Out */}
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 1 && !isActual1to1}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 transition-colors"
              title="ซูมออก (-)"
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            {/* Current Zoom Level / Toggle */}
            <button
              type="button"
              onClick={() => {
                if (zoom < 2) applyZoomAtPoint(2);
                else if (zoom < 3.5) applyZoomAtPoint(3.5);
                else handleResetZoom();
              }}
              className="px-2 py-1 text-xs font-mono font-bold text-white hover:bg-slate-700 rounded-lg transition-colors min-w-[52px] text-center"
              title="แตะเพื่อสลับระดับการซูม (100% / 200% / 350%)"
            >
              {zoomPercent}
            </button>

            {/* Zoom In */}
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 transition-colors"
              title="ซูมเข้า (+)"
            >
              <ZoomIn className="h-4 w-4" />
            </button>

            <div className="h-4 w-px bg-slate-700 mx-0.5" />

            {/* Reset Fit */}
            <button
              type="button"
              onClick={handleResetZoom}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                zoom === 1 && !isActual1to1 && rotation === 0
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="รีเซ็ตพอดีจอ (กด 0)"
            >
              พอดีจอ
            </button>

            {/* 1:1 Actual Size Zoom */}
            <button
              type="button"
              onClick={handleSetActualSize}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                isActual1to1
                  ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="แสดงขนาดขยาย 1:1 ตามพิกเซลภาพ"
            >
              ขนาดจริง (1:1)
            </button>

            {/* Toggle Crisp Sharpen Filter */}
            <button
              type="button"
              onClick={() => setEnableSharpen((s) => !s)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors inline-flex items-center gap-1 ${
                enableSharpen
                  ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="เร่งความคมชัดตัวอักษรและเส้นตาราง (Unsharp Mask)"
            >
              <Sparkles className="h-3 w-3" />
              <span>เร่งคมชัด</span>
            </button>

            {/* Rotate */}
            <button
              type="button"
              onClick={handleRotate}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="หมุนภาพ 90 องศา (กด R)"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>

          {/* Thumbnails strip for fast switching */}
          {localPhotos.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-[260px] py-0.5">
              {localPhotos.map((pSrc, pIdx) => (
                <div
                  key={pIdx}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectPhoto(pIdx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectPhoto(pIdx);
                    }
                  }}
                  className={`h-9 w-12 rounded border overflow-hidden transition-all shrink-0 cursor-pointer ${
                    pIdx === currentIndex
                      ? 'border-blue-500 ring-2 ring-blue-500/50 scale-105'
                      : 'border-slate-700 opacity-60 hover:opacity-100'
                  }`}
                  title={`ดูรูปที่ ${pIdx + 1}`}
                >
                  <DrivePhotoImg
                    src={pSrc}
                    alt={`Thumbnail ${pIdx + 1}`}
                    className="h-9 w-12 object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
