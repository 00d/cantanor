/**
 * Zustand store for battle state management with frequency segregation.
 *
 * - Core battle state (BattleState) triggers React re-renders on dispatch
 * - Transient state (camera, animations) is updated directly without re-renders
 * - UI state (selection, hover, target mode) triggers lightweight re-renders
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { BattleState, activeUnitId, unitAlive } from "../engine/state";
import { DeterministicRNG } from "../engine/rng";
import { applyCommand, ReductionError } from "../engine/reducer";
import { RawCommand } from "../engine/commands";
import type { ResolvedTiledMap } from "../io/tiledTypes";

// ---------------------------------------------------------------------------
// Animation types (for PixiJS rendering layer)
// ---------------------------------------------------------------------------

export interface DamageAnimation {
  type: "damage";
  unitId: string;
  amount: number;
  damageType: string;
}

export interface MoveAnimation {
  type: "move";
  unitId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface ConditionAnimation {
  type: "condition";
  unitId: string;
  condition: string;
  applied: boolean;
}

export type BattleAnimation = DamageAnimation | MoveAnimation | ConditionAnimation;

// ---------------------------------------------------------------------------
// Target mode
// ---------------------------------------------------------------------------

export interface TargetMode {
  type: "move" | "strike" | "spell" | "feat" | "item" | "interact";
  range?: number;
  contentEntryId?: string;
}

// ---------------------------------------------------------------------------
// Transient state (direct mutation, no React re-renders)
// ---------------------------------------------------------------------------

export interface TransientState {
  animationQueue: BattleAnimation[];
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface BattleStore {
  // Core battle state — immutable updates, triggers re-renders
  battle: BattleState | null;
  rng: DeterministicRNG | null;
  eventLog: Record<string, unknown>[];
  enginePhase: number;

  // Tiled map reference — null when using a legacy hand-written scenario
  tiledMap: ResolvedTiledMap | null;

  // Grid overlay toggle (applies to Tiled maps only)
  showGrid: boolean;

  // UI state — lightweight selection/hover
  selectedUnitId: string | null;
  hoveredTilePos: [number, number] | null;
  targetMode: TargetMode | null;

  // Transient state — direct updates, bypasses React
  transient: TransientState;

  // Actions
  loadBattle: (state: BattleState, enginePhase?: number, tiledMap?: ResolvedTiledMap | null) => void;
  dispatchCommand: (command: RawCommand) => void;
  selectUnit: (unitId: string | null) => void;
  setHoverTile: (pos: [number, number] | null) => void;
  setTargetMode: (mode: TargetMode | null) => void;
  toggleGrid: () => void;
  clearBattle: () => void;
}

// ---------------------------------------------------------------------------
// Event → Animation mapping
// ---------------------------------------------------------------------------

function eventsToAnimations(events: Record<string, unknown>[]): BattleAnimation[] {
  const animations: BattleAnimation[] = [];
  for (const event of events) {
    const type = String(event["type"] ?? "");
    const payload = (event["payload"] as Record<string, unknown>) ?? {};

    if (type === "damage" || type === "strike") {
      const target = String(payload["target"] ?? "");
      const total = Number(payload["total"] ?? payload["damage_total"] ?? 0);
      const damageType = String(payload["damage_type"] ?? "physical");
      if (target && total > 0) {
        animations.push({ type: "damage", unitId: target, amount: total, damageType });
      }
    } else if (type === "move") {
      const actor = String(event["actor"] ?? payload["actor"] ?? "");
      const from = payload["from"] as number[] | undefined;
      const to = payload["to"] as number[] | undefined;
      if (actor && from && to) {
        animations.push({ type: "move", unitId: actor, fromX: from[0], fromY: from[1], toX: to[0], toY: to[1] });
      }
    } else if (type === "condition_applied" || type === "condition_cleared") {
      const target = String(payload["target"] ?? "");
      const condition = String(payload["condition"] ?? "");
      if (target && condition) {
        animations.push({ type: "condition", unitId: target, condition, applied: type === "condition_applied" });
      }
    }
  }
  return animations;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useBattleStore = create<BattleStore>()(
  subscribeWithSelector((set, get) => ({
    battle: null,
    rng: null,
    eventLog: [],
    enginePhase: 7,

    tiledMap: null,
    showGrid: true,

    selectedUnitId: null,
    hoveredTilePos: null,
    targetMode: null,

    transient: {
      animationQueue: [],
    },

    loadBattle: (state, enginePhase = 7, tiledMap = null) => {
      const rng = new DeterministicRNG(state.seed);
      set({ battle: state, rng, eventLog: [], enginePhase, tiledMap, selectedUnitId: null, targetMode: null });
    },

    dispatchCommand: (command) => {
      const { battle, rng, eventLog } = get();
      if (!battle || !rng) return;

      try {
        const [nextState, newEvents] = applyCommand(battle, command, rng);
        const animations = eventsToAnimations(newEvents);

        set({
          battle: nextState,
          eventLog: [...eventLog, ...newEvents],
        });

        // Direct transient update — no re-render
        const transient = get().transient;
        transient.animationQueue.push(...animations);
      } catch (err) {
        if (err instanceof ReductionError) {
          console.warn("Command rejected:", err.message);
        } else {
          console.error("Unexpected reducer error:", err);
        }
      }
    },

    selectUnit: (unitId) => {
      set({ selectedUnitId: unitId });
    },

    setHoverTile: (pos) => {
      set({ hoveredTilePos: pos });
    },

    setTargetMode: (mode) => {
      set({ targetMode: mode });
    },

    toggleGrid: () => {
      set((s) => ({ showGrid: !s.showGrid }));
    },

    clearBattle: () => {
      set({
        battle: null,
        rng: null,
        eventLog: [],
        tiledMap: null,
        selectedUnitId: null,
        hoveredTilePos: null,
        targetMode: null,
      });
    },
  })),
);

// ---------------------------------------------------------------------------
// Selector helpers (memoized access patterns)
// ---------------------------------------------------------------------------

export function selectActiveUnit(store: BattleStore) {
  if (!store.battle) return null;
  const id = activeUnitId(store.battle);
  return store.battle.units[id] ?? null;
}

export function selectAliveUnits(store: BattleStore) {
  if (!store.battle) return [];
  return Object.values(store.battle.units).filter(unitAlive);
}

export function selectUnitsByTeam(store: BattleStore, team: string) {
  if (!store.battle) return [];
  return Object.values(store.battle.units).filter((u) => u.team === team);
}
