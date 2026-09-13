'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Download, Upload } from 'lucide-react';
import { Dialog } from './dialog';
import { backupFilename, buildBackup, parseBackupJson } from '@/lib/backup';
import { downloadBlob } from '@/lib/storage';
import type { WorkoutState } from '@/lib/types';

type BackupDialogProps = {
  open: boolean;
  onClose: () => void;
  state: WorkoutState;
  onRestore: (next: WorkoutState) => Promise<void>;
};

type Pending = { state: WorkoutState; filename: string; migratedFrom: number };

export function BackupDialog({
  open,
  onClose,
  state,
  onRestore,
}: BackupDialogProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const report = (text: string, error = false) => {
    setMessage(text);
    setIsError(error);
  };

  const onExport = () => {
    const payload = buildBackup(state);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, backupFilename());
    report('Backup downloaded.');
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = parseBackupJson(await file.text());
    if (!result.ok) {
      setPending(null);
      report(`${result.error} Your saved data has not been changed.`, true);
      return;
    }
    setPending({
      state: result.state,
      filename: file.name,
      migratedFrom: result.migratedFrom,
    });
    report('');
  };

  const confirmRestore = async () => {
    if (!pending) return;
    try {
      await onRestore(pending.state);
      const weeks = Object.keys(pending.state.weeks).length;
      report(
        `Restored ${weeks} ${weeks === 1 ? 'week' : 'weeks'} from ${pending.filename}.`,
      );
      setPending(null);
    } catch {
      report('Could not save the restored data. Your data is unchanged.', true);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setPending(null);
        onClose();
      }}
      title="Backup & restore"
      description="Your training data is stored only in this browser on this device. Export a JSON backup before switching phones or browsers, then import it to restore."
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExport}
          className="rounded-control bg-ocean-blue hover:bg-ocean-deep inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-[14px] font-semibold text-white transition-colors duration-150"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export JSON backup
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft inline-flex min-h-11 flex-1 items-center justify-center gap-2 border px-4 text-[14px] font-semibold transition-colors duration-150"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Import backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Choose a JSON backup file to import"
          onChange={onFile}
        />
      </div>

      {pending ? (
        <div className="rounded-control border-sunset-orange/50 bg-orange-soft mt-4 border p-3">
          <p className="text-ocean-deep flex items-center gap-2 text-[14px] font-bold">
            <AlertTriangle
              className="text-sunset-orange h-4 w-4"
              aria-hidden="true"
            />
            Replace all local data?
          </p>
          <p className="text-ocean-deep mt-1.5 text-[13px] leading-relaxed">
            <span className="font-semibold">{pending.filename}</span> is valid
            {pending.migratedFrom < 3
              ? ` (schema v${pending.migratedFrom}, it will be upgraded)`
              : null}
            . Importing permanently replaces every week and exercise name saved
            in this browser. This cannot be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmRestore}
              className="rounded-control bg-sunset-orange min-h-11 flex-1 px-4 text-[14px] font-semibold text-white transition-colors duration-150 hover:brightness-95"
            >
              Replace my data
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(null);
                report('Import cancelled. Nothing was changed.');
              }}
              className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft min-h-11 flex-1 border px-4 text-[14px] font-semibold transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={[
          'mt-3 min-h-5 text-[13px]',
          isError ? 'text-sunset-orange font-semibold' : 'text-muted',
        ].join(' ')}
      >
        {message}
      </p>
    </Dialog>
  );
}
