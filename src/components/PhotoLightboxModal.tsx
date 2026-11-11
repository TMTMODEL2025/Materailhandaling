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
  RefreshCw,
  Check,
} from 'lucide-react';
import { DrivePhotoImg } from './DrivePhotoImg';
import {
  extractDriveFileId,
  formatDriveImageUrl,
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
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Touch pinch-to-zoom tracking
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync index when initialIndex changes or modal opens
  useEffect(() => {
    if (isOpen) {
      const validIndex = Math.max(0, Math.min(initialIndex, photos.length - 1));
      setCurrentIndex(validIndex);
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
    }
  }, [isOpen, initialIndex, photos.length]);

  // Reset zoom & pan when switching photo
  const handleSelectPhoto = (idx: number) => {
    setCurrentIndex(idx);
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleNextPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % photos.length);
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, [photos.length]);

  const handlePrevPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, [photos.length]);

  const handleZoomIn = () => {
    setZoom((z) => Math.min(6, parseFloat((z + (z >= 2 ? 0.75 : 0.4)).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(0.6, parseFloat((z - (z > 2 ? 0.75 : 0.4)).toFixed(2)));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleSetActualSize = () => {
    setZoom(2.5);
    setPan({ x: 0, y: 0 });
  };

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    setZoom((z) => {
      const next = Math.max(0.6, Math.min(6, parseFloat((z + delta).toFixed(2))));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Mouse dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    e.preventDefault();
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch drag & pinch-to-zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && zoom > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - pan.x,
        y: e.touches[0].clientY - pan.y,
      });
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDistRef.current = Math.hypot(dx, dy);
      touchStartZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging && zoom > 1) {
      setPan({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    } else if (e.touches.length === 2 && touchStartDistRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const scale = currentDist / touchStartDistRef.current;
      const nextZoom = Math.max(0.6, Math.min(6, parseFloat((touchStartZoomRef.current * scale).toFixed(2))));
      setZoom(nextZoom);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartDistRef.current = null;
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
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex] || '';
  const fileId = extractDriveFileId(currentPhoto);
  const directDriveViewUrl = fileId ? getDriveDirectViewUrl(currentPhoto) : null;
  const highResSourceUrl = formatDriveImageUrl(currentPhoto, true);

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-70 flex flex-col bg-slate-950/95 backdrop-blur-md select-none animate-in fade-in duration-150"
      onWheel={handleWheel}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-2.5 text-white z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                {title || (vehicleNo ? `รูปถ่ายงานซ่อม เบอร์รถ ${vehicleNo}` : 'ดูรูปถ่ายความละเอียดสูง')}
              </h3>
              {sequenceNo && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 border border-slate-700 shrink-0">
                  #{sequenceNo}
                </span>
              )}
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30 shrink-0 hidden sm:inline-flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5" />
                โหมดซูมความละเอียดสูง (HD/4K)
              </span>
            </div>
            {subtitle && (
              <p className="text-[11px] text-slate-400 truncate max-w-xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-2">
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

      {/* 2. Main Viewer Area */}
      <div
        className="relative flex-1 overflow-hidden flex items-center justify-center cursor-default bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {/* Previous Image Button */}
        {photos.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrevPhoto();
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-blue-600 transition-colors border border-slate-700"
            title="รูปก่อนหน้า (ลูกศรซ้าย)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Next Image Button */}
        {photos.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNextPhoto();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-sm hover:bg-blue-600 transition-colors border border-slate-700"
            title="รูปถัดไป (ลูกศรขวา)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {/* High-Res Image Display Container */}
        <div
          className="relative max-h-[82vh] max-w-[92vw] flex items-center justify-center transition-transform will-change-transform"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 150ms cubic-bezier(0.2, 0, 0, 1)',
            transformOrigin: 'center center',
          }}
        >
          <DrivePhotoImg
            key={`${currentPhoto}_${currentIndex}`}
            src={currentPhoto}
            alt={`รูปถ่ายที่ ${currentIndex + 1}`}
            highRes={true}
            className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-2xl pointer-events-none"
            style={{
              imageRendering: 'auto',
            }}
          />
        </div>

        {/* Drag Hint overlay when zoomed */}
        {zoom > 1 && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3 py-1 text-[11px] font-medium text-slate-300 border border-slate-700 shadow-lg backdrop-blur-xs">
            <Move className="h-3 w-3 text-blue-400" />
            <span>คลิกค้างแล้วลากเพื่อเลื่อนดูรอยซ่อม • หมุนล้อเมาส์เพื่อซูม</span>
          </div>
        )}
      </div>

      {/* 3. Floating Bottom Zoom & Tool Controls */}
      <div className="z-20 border-t border-slate-800 bg-slate-900/95 px-3 py-2 sm:px-4 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
          {/* Photo Counter */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-white">
              รูปที่ {currentIndex + 1} จาก {photos.length}
            </span>
            <span>•</span>
            <span className="font-mono text-emerald-400 font-bold">
              ซูม {zoomPercent}%
            </span>
            {rotation !== 0 && (
              <>
                <span>•</span>
                <span className="text-amber-400">หมุน {rotation}°</span>
              </>
            )}
          </div>

          {/* Interactive Zoom Toolbar Buttons */}
          <div className="flex items-center gap-1 bg-slate-800/90 p-1 rounded-xl border border-slate-700 shadow-md">
            {/* Zoom Out */}
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.6}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-40 transition-colors"
              title="ซูมออก (-)"
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            {/* Quick Zoom Presets */}
            <button
              type="button"
              onClick={() => {
                if (zoom === 1) setZoom(2);
                else if (zoom === 2) setZoom(3);
                else setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="px-2.5 py-1 text-xs font-mono font-bold text-white hover:bg-slate-700 rounded-lg transition-colors min-w-[50px] text-center"
              title="คลิกเพื่อสลับขนาดซูม (100% / 200% / 300%)"
            >
              {zoomPercent}%
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
                zoom === 1 && rotation === 0
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="รีเซ็ตพอดีจอ (กด 0)"
            >
              พอดีจอ
            </button>

            {/* 1:1 Actual / 2.5x High-Res Zoom */}
            <button
              type="button"
              onClick={handleSetActualSize}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                zoom >= 2.4 && zoom <= 2.6
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="ซูมคมชัด 100% ขนาดจริง (2.5x)"
            >
              ขนาดจริง
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
