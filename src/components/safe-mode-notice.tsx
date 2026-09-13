'use client';

import { AlertTriangle, Download } from 'lucide-react';
import { downloadBlob } from '@/lib/storage';

type SafeModeNoticeProps = {
  error: string;
  raw: unknown;
  onOpenBackup: () => void;
};

/**
 * Shown when stored data exists but could not be read. The app is read-only in
 * this state by design — writing would overwrite a log we failed to parse — so
 * the only things offered here are rescuing the raw data and restoring a backup.
 */
export function SafeModeNotice({
  error,
  raw,
  onOpenBackup,
}: SafeModeNoticeProps) {
  const onDownloadRaw = () => {
    const blob = new Blob([JSON.stringify(raw, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(
      blob,
      `weekly-practice-log-unreadable-${new Date().toISOString().slice(0, 10)}.json`,
    );
  };

  return (
    <section
      role="alert"
      aria-labelledby="safe-mode-heading"
      className="rounded-card border-sunset-orange/50 bg-orange-soft mb-3.5 border p-4"
    >
      <h2
        id="safe-mode-heading"
        className="text-ocean-deep flex items-center gap-2 text-[16px] font-bold"
      >
        <AlertTriangle
          className="text-sunset-orange h-4 w-4 shrink-0"
          aria-hidden="true"
        />
        Your saved data could not be read
      </h2>
      <p className="text-ocean-deep mt-2 text-[13px] leading-relaxed">
        {error} Logging is turned off so nothing overwrites it. Your data is
        still on this device — download a copy before doing anything else.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onDownloadRaw}
          className="rounded-control bg-ocean-blue hover:bg-ocean-deep inline-flex min-h-11 items-center gap-2 px-4 text-[14px] font-semibold text-white transition-colors duration-150"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download raw data
        </button>
        <button
          type="button"
          onClick={onOpenBackup}
          className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 items-center gap-2 border px-4 text-[14px] font-semibold transition-colors duration-150"
        >
          Restore a backup
        </button>
      </div>
    </section>
  );
}
