import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { DrivePhotoImg } from './DrivePhotoImg';
import {
  extractDriveFileId,
  getDriveDirectViewUrl,
} from '../services/googleSheets';

interface PhotoLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: string[];
  initialIndex?: number;
  title?: string;
  subtitle?: string;
  vehicleNo?: string;
  sequenceNo?: string;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  isOpen,
  onClose,
  photos,
  initialIndex = 0,
  title,
  subtitle,
  vehicleNo,
  sequenceNo,
}) => {
  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isActual1to1, setIsActual1to1] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Dragging / Panning states for scroll container
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const modalRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync index and reset states when modal opens or initialIndex changes
  useEffect(() => {
    if (isOpen) {
      const validIndex = Math.max(0, Math.min(initialIndex, photos.length - 1));
      setCurrentIndex(validIndex);
      setZoom(1);
      setRotation(0);
      setNaturalDimensions(null);
      setIsActual1to1(false);
    }
  }, [isOpen, initialIndex, photos.length]);

  const handleSelectPhoto = (idx: number) => {
    setCurrentIndex(idx);
    setZoom(1);
    setRotation(0);
    setNaturalDimensions(null);
    setIsActual1to1(false);
  };

  const handleNextPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % photos.length);
    setZoom(1);
    setRotation(0);
    setNaturalDimensions(null);
    setIsActual1to1(false);
  }, [photos.length]);

  const handlePrevPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
    setZoom(1);
    setRotation(0);
    setNaturalDimensions(null);
    setIsActual1to1(false);
  }, [photos.length]);

  const handleZoomIn = () => {
    setIsActual1to1(false);
    setZoom((z) => Math.min(6, parseFloat((z + (z >= 2 ? 0.5 : 0.25)).toFixed(2))));
  };

  const handleZoomOut = () => {
    setIsActual1to1(false);
    setZoom((z) => {
      const next = Math.max(1, parseFloat((z - (z > 2 ? 0.5 : 0.25)).toFixed(2)));
      return next;
    });
  };

  const handleResetZoom = () => {
    setIsActual1to1(false);
    setZoom(1);
    setRotation(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  const handleSetActualSize = () => {
    setIsActual1to1((prev) => {
      const next = !prev;
      if (next) {
        setZoom(2.5);
      } else {
        setZoom(1);
      }
      return next;
    });
  };

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };

  // Mouse wheel zoom inside scroll container
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      setIsActual1to1(false);
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      setZoom((z) => Math.max(1, Math.min(6, parseFloat((z + delta).toFixed(2)))));
    }
  };

  // Mouse drag panning on the scroll container
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1 && !isActual1to1) return;
    if (!scrollContainerRef.current) return;
    // Don't drag if clicking buttons or links
    if ((e.target as HTMLElement).closest('button, a')) return;

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

  // Touch drag support
  const handleTouchStart = (e: React.TouchEvent) => {
    if ((zoom <= 1 && !isActual1to1) || !scrollContainerRef.current) return;
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        scrollLeft: scrollContainerRef.current.scrollLeft,
        scrollTop: scrollContainerRef.current.scrollTop,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || !scrollContainerRef.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStart.x;
    const dy = e.touches[0].clientY - dragStart.y;
    scrollContainerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    scrollContainerRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
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
  }, [isOpen, handleNextPhoto, handlePrevPhoto, onClose]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!modalRef.current) return;
    if (!document.fullscreenElement) {
      modalRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex] || '';
  const fileId = extractDriveFileId(currentPhoto);
  const directDriveViewUrl = fileId ? getDriveDirectViewUrl(currentPhoto) : null;

  // Calculate actual pixel width for the img tag (NO CSS transform: scale!)
  // When zoom === 1: Fit container nicely
  // When zoom > 1: Expand actual layout width inside overflow: auto container
  const computeImageStyle = (): React.CSSProperties => {
    if (isActual1to1 && naturalDimensions) {
      return {
        width: `${naturalDimensions.width}px`,
        maxWidth: 'none',
        height: 'auto',
        transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
      };
    }

    if (zoom <= 1) {
      return {
        maxWidth: '92vw',
        maxHeight: '78vh',
        width: 'auto',
        height: 'auto',
        objectFit: 'contain',
        transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
      };
    }

    // Zoomed: Increase physical element width so browser decodes full 4K raster pixels
    // Base width calculation: approximate fit width or use natural dimensions
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const baseWidth = naturalDimensions
      ? Math.min(viewportWidth * 0.85, naturalDimensions.width)
      : Math.round(viewportWidth * 0.75);

    const targetWidth = Math.round(baseWidth * zoom);

    return {
      width: `${targetWidth}px`,
      maxWidth: 'none',
      height: 'auto',
      transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    };
  };

  const zoomPercent = isActual1to1 && naturalDimensions
    ? '100% (1:1)'
    : `${Math.round(zoom * 100)}%`;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-70 flex flex-col bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-150"
      onWheel={handleWheel}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-2.5 text-white z-20 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                {title || (vehicleNo ? `รูปถ่ายงานซ่อม เบอร์รถ ${vehicleNo}` : 'ดูรูปถ่ายความละเอียดสูง')}
              </h3>
              {sequenceNo && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 border border-slate-700 shrink-0">
                  #{sequenceNo}
                </span>
              )}
              {naturalDimensions ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30 shrink-0 inline-flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>ความละเอียดจริง: {naturalDimensions.width} × {naturalDimensions.height} px</span>
                </span>
              ) : (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 border border-slate-700 animate-pulse">
                  กำลังดึงความละเอียดจริงจาก Google Drive...
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-slate-400 truncate max-w-xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {directDriveViewUrl && (
            <a
              href={directDriveViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="เปิดรูปต้นฉบับใน Google Drive แท็บใหม่"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden md:inline">เปิดดูใน Drive</span>
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
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:bg-rose-600 hover:text-white transition-colors"
            title="ปิดหน้าต่าง (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 2. Main Viewer Area with overflow: auto for genuine raster zoom */}
      <div
        ref={scrollContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative flex-1 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] ${
          zoom > 1 || isActual1to1
            ? 'overflow-auto cursor-grab active:cursor-grabbing'
            : 'overflow-hidden flex items-center justify-center cursor-default'
        }`}
      >
        {/* Navigation Buttons */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrevPhoto();
              }}
              className="fixed left-3 top-1/2 -translate-y-1/2 z-30 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-blue-600 transition-colors border border-slate-700"
              title="รูปก่อนหน้า (ลูกศรซ้าย)"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNextPhoto();
              }}
              className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-blue-600 transition-colors border border-slate-700"
              title="รูปถัดไป (ลูกศรขวา)"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {/* Center container for the image */}
        <div
          className={`min-h-full min-w-full flex items-center justify-center p-4 ${
            zoom > 1 || isActual1to1 ? 'p-12' : ''
          }`}
        >
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
              }
            }}
            className="rounded-lg shadow-2xl transition-all select-none"
            style={computeImageStyle()}
          />
        </div>

        {/* Drag Hint overlay when zoomed */}
        {(zoom > 1 || isActual1to1) && (
          <div className="pointer-events-none fixed bottom-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3.5 py-1 text-[11px] font-medium text-slate-300 border border-slate-700 shadow-xl backdrop-blur-xs">
            <Move className="h-3 w-3 text-blue-400" />
            <span>คลิกค้างแล้วลากเพื่อเลื่อนดูรอยซ่อม • หมุนล้อเมาส์พร้อมกด Ctrl เพื่อซูม</span>
          </div>
        )}
      </div>

      {/* 3. Floating Bottom Zoom & Tool Controls */}
      <div className="z-20 border-t border-slate-800 bg-slate-900/95 px-3 py-2 sm:px-4 backdrop-blur-md shrink-0">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
          {/* Photo Counter */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-white">
              รูปที่ {currentIndex + 1} จาก {photos.length}
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
          <div className="flex items-center gap-1 bg-slate-800/90 p-1 rounded-xl border border-slate-700 shadow-md">
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
                if (zoom === 1) setZoom(2);
                else if (zoom === 2) setZoom(3);
                else handleResetZoom();
              }}
              className="px-2.5 py-1 text-xs font-mono font-bold text-white hover:bg-slate-700 rounded-lg transition-colors min-w-[55px] text-center"
              title="คลิกเพื่อสลับขนาดซูม (พอดีจอ / 200% / 300%)"
            >
              {zoomPercent}
            </button>

            {/* Zoom In */}
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 6}
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
              title="แสดงขนาดจริงตามพิกเซลของภาพ (100% 1:1 Actual Size คมชัดสูงสุด ไม่แตก)"
            >
              ขนาดจริง (1:1)
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
          {photos.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-[260px] py-0.5">
              {photos.map((pSrc, pIdx) => (
                <button
                  key={pIdx}
                  type="button"
                  onClick={() => handleSelectPhoto(pIdx)}
                  className={`h-9 w-12 rounded border overflow-hidden transition-all shrink-0 ${
                    pIdx === currentIndex
                      ? 'border-blue-500 ring-2 ring-blue-500/50 scale-105'
                      : 'border-slate-700 opacity-60 hover:opacity-100'
                  }`}
                  title={`ดูรูปที่ ${pIdx + 1}`}
                >
                  <DrivePhotoImg
                    src={pSrc}
                    alt={`Thumbnail ${pIdx + 1}`}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
