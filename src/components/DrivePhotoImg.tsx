import React, { useState, useEffect } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import {
  formatDriveImageUrl,
  getDriveThumbnailUrl,
  isLegacyAppSheetPhotoPath,
  resolveDriveImageSrc,
} from '../services/googleSheets';

interface DrivePhotoImgProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
}

export const DrivePhotoImg: React.FC<DrivePhotoImgProps> = ({
  src,
  alt,
  className = '',
  onClick,
}) => {
  const trimmed = (src || '').trim();
  const isLegacyPath = isLegacyAppSheetPhotoPath(trimmed);
  const initialFormatted = formatDriveImageUrl(trimmed);
  const needsAsyncResolve =
    isLegacyPath && initialFormatted === trimmed;

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    needsAsyncResolve ? null : initialFormatted
  );
  const [isLoading, setIsLoading] = useState<boolean>(needsAsyncResolve);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setHasError(false);

    const formatted = formatDriveImageUrl(trimmed);
    const legacy = isLegacyAppSheetPhotoPath(trimmed);
    if (!legacy || formatted !== trimmed) {
      setResolvedSrc(formatted);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void resolveDriveImageSrc(trimmed).then((result) => {
      if (cancelled) return;
      if (result) {
        setResolvedSrc(result);
        setHasError(false);
      } else {
        setResolvedSrc(null);
        setHasError(true);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [trimmed]);

  if (isLoading) {
    return (
      <div
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] font-medium text-slate-500 animate-pulse ${className}`}
      >
        <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="truncate">กำลังดึงรูปจาก Drive...</span>
      </div>
    );
  }

  if (hasError || !resolvedSrc) {
    const shortName = trimmed.includes('/')
      ? trimmed.split('/').pop()
      : trimmed;
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500"
        title={trimmed}
      >
        <ImageIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="max-w-[200px] truncate">{shortName || 'ไม่พบไฟล์รูปภาพ'}</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      onClick={onClick}
      onError={(e) => {
        const fallback = getDriveThumbnailUrl(trimmed);
        if (
          fallback &&
          fallback !== trimmed &&
          e.currentTarget.src !== fallback
        ) {
          e.currentTarget.src = fallback;
        } else {
          setHasError(true);
        }
      }}
      className={className}
    />
  );
};
