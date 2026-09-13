'use client';

import { useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { Dialog } from './dialog';
import { MovementPicker } from './movement-picker';
import { substitutesFor } from '@/lib/movements';
import type { Equipment, Movement, WorkoutState } from '@/lib/types';

export type SubstituteTarget = {
  dayId: string;
  slotId: string;
  movementId: string;
  name: string;
  /** Set when this week already holds logged sets for the slot. */
  hasSetsThisWeek: boolean;
};

type SubstituteDialogProps = {
  open: boolean;
  onClose: () => void;
  state: WorkoutState;
  target: SubstituteTarget | null;
  onSubstitute: (movementId: string, permanent: boolean) => void;
  onCreateMovement: (
    movement: Omit<Movement, 'id' | 'custom'>,
  ) => string | null;
};

const EQUIPMENT: Equipment[] = [
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'bodyweight',
  'other',
];

export function SubstituteDialog({
  open,
  onClose,
  state,
  target,
  onSubstitute,
  onCreateMovement,
}: SubstituteDialogProps) {
  const [permanent, setPermanent] = useState(false);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftGroup, setDraftGroup] = useState('');
  const [draftEquipment, setDraftEquipment] = useState<Equipment>('barbell');

  const close = () => {
    setPermanent(false);
    setConfirmClear(null);
    setCreating(false);
    setDraftName('');
    setDraftGroup('');
    onClose();
  };

  const commit = (movementId: string) => {
    onSubstitute(movementId, permanent);
    close();
  };

  const pick = (movementId: string) => {
    // Logged sets belong to the movement being replaced, so never discard them
    // silently — make the athlete say so.
    if (target?.hasSetsThisWeek) {
      setConfirmClear(movementId);
      return;
    }
    commit(movementId);
  };

  const createAndPick = () => {
    const id = onCreateMovement({
      name: draftName,
      group: draftGroup.trim() || target?.name || 'Other',
      equipment: draftEquipment,
    });
    if (!id) return;
    setCreating(false);
    pick(id);
  };

  const suggested = target
    ? substitutesFor(state.movements, target.movementId)
    : [];
  const pendingName = confirmClear
    ? (state.movements[confirmClear]?.name ?? 'that exercise')
    : '';

  return (
    <Dialog
      open={open}
      onClose={close}
      title={target ? `Replace ${target.name}` : 'Replace exercise'}
      description="Swaps apply to this week only unless you make them permanent. The exercise you replace keeps its own history, and the one you pick brings its own."
    >
      {confirmClear ? (
        <div className="rounded-control border-sunset-orange/50 bg-orange-soft border p-3">
          <p className="text-ocean-deep flex items-center gap-2 text-[14px] font-bold">
            <AlertTriangle
              className="text-sunset-orange h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            Clear this week&apos;s sets?
          </p>
          <p className="text-ocean-deep mt-1.5 text-[13px] leading-relaxed">
            You have already logged sets for {target?.name} this week. Those
            sets belong to {target?.name}, not to {pendingName}, so swapping
            clears them from this week. Earlier weeks are untouched.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => commit(confirmClear)}
              className="rounded-control bg-sunset-orange min-h-11 flex-1 px-4 text-[14px] font-semibold text-white transition-colors duration-150 hover:brightness-95"
            >
              Clear and swap
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(null)}
              className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft min-h-11 flex-1 border px-4 text-[14px] font-semibold transition-colors duration-150"
            >
              Keep my sets
            </button>
          </div>
        </div>
      ) : creating ? (
        <div className="flex flex-col gap-2">
          <label className="text-ocean-deep text-[13px] font-semibold">
            Exercise name
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="border-hairline bg-card text-ocean-deep focus:border-ocean-blue mt-1 h-11 w-full rounded-[10px] border px-3 font-normal transition-colors duration-150"
            />
          </label>
          <label className="text-ocean-deep text-[13px] font-semibold">
            Muscle group
            <input
              value={draftGroup}
              onChange={(event) => setDraftGroup(event.target.value)}
              placeholder={target?.name ? 'e.g. Chest' : 'e.g. Legs'}
              className="border-hairline bg-card text-ocean-deep focus:border-ocean-blue mt-1 h-11 w-full rounded-[10px] border px-3 font-normal transition-colors duration-150"
            />
          </label>
          <label className="text-ocean-deep text-[13px] font-semibold">
            Equipment
            <select
              value={draftEquipment}
              onChange={(event) =>
                setDraftEquipment(event.target.value as Equipment)
              }
              className="border-hairline bg-card text-ocean-deep focus:border-ocean-blue mt-1 h-11 w-full rounded-[10px] border px-3 font-normal transition-colors duration-150"
            >
              {EQUIPMENT.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={draftName.trim() === ''}
              onClick={createAndPick}
              className="rounded-control bg-ocean-blue hover:bg-ocean-deep min-h-11 flex-1 px-4 text-[14px] font-semibold text-white transition-colors duration-150 disabled:opacity-40"
            >
              Add and use it
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft min-h-11 flex-1 border px-4 text-[14px] font-semibold transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label className="border-hairline bg-surface rounded-control mb-3 flex items-start gap-3 border p-3">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(event) => setPermanent(event.target.checked)}
              className="accent-ocean-blue mt-0.5 h-5 w-5 shrink-0"
            />
            <span className="text-ocean-deep text-[13px] leading-relaxed">
              <span className="font-semibold">Also change my routine</span> —
              keep this swap for future weeks, not just this one.
            </span>
          </label>

          <MovementPicker
            movements={state.movements}
            suggested={suggested}
            suggestedLabel="Similar exercises"
            excludeId={target?.movementId}
            onPick={pick}
          />

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-control border-hairline bg-card text-ocean-deep hover:bg-mist-soft mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 border px-4 text-[14px] font-semibold transition-colors duration-150"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add a custom exercise
          </button>
        </div>
      )}
    </Dialog>
  );
}
