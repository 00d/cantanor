/**
 * Zustand store for battle state management with frequency segregation.
 *
 * State update tiers:
 *   - Core battle state (BattleState) — immutable updates, triggers React re-renders
 *   - Orchestration config — enemy policy + objectives parsed at scenario load
 *   - UI state — selection, hover, target mode — lightweight re-renders
 *   - Transient state — animations — mutated directly, no React re-renders
 *
 * After every player command the store runs:
 *   1. materializeRawCommand   — fill in content-pack spell / feat / item fields
 *   2. applyCommand            — deterministic engine step
 *   3. checkBattleEnd          — objectives + alive-teams check
 *   4. _scheduleAiTurn         — if the next active unit is AI-controlled
 */

import { create } from "zustand";
import { BattleState, activeUnitId, unitAlive } from "../engine/state";
import { DeterministicRNG } from "../engine/rng";
import { applyCommand, ReductionError } from "../engine/reducer";
import { RawCommand } from "../engine/commands";
import type { ResolvedTiledMap } from "../io/tiledTypes";
import {
  type ContentContext,
  type ContentPackEntry,
  type ResolvedEntry,
} from "../io/contentPackLoader";
import {
  type OrchestratorConfig,
  type BattleOutcome,
  buildOrchestratorConfig,
  checkBattleEnd,
  getAiCommand,
  isAiUnit,
  materializeRawCommand,
} from "../io/battleOrchestrator";
import { loadScenarioFromUrl } from "../io/scenarioLoader";

// ---------------------------------------------------------------------------
// Re-export useful types for consumers
// ---------------------------------------------------------------------------
export type { BattleOutcome };

// ---------------------------------------------------------------------------
// Save / load (localStorage)
// ---------------------------------------------------------------------------

const SAVE_KEY = "cantanor_save";

interface SavedGame {
  version: 1;
  battle: BattleState;
  rngCallCount: number;
  orchestratorConfig: OrchestratorConfig;
  contentContext: ContentContext;
  enginePhase: number;
  tiledMap: ResolvedTiledMap | null;
  tiledMapUrl: string | null;
  lastScenarioUrl: string | null;
  selectedUnitId: string | null;
  battleEnded: boolean;
  battleOutcome: BattleOutcome | null;
}

export function hasSavedGame(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

function writeSave(saved: SavedGame): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
  } catch (err) {
    console.warn("Save failed:", err);
  }
}

function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    if (parsed.version !== 1) return null;
    if (typeof parsed.rngCallCount !== "number" || parsed.rngCallCount < 0 || parsed.rngCallCount > 100_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSavedGame(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

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
  /** True when the ability targets allies rather than enemies. */
  allyTarget?: boolean;
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

  // Orchestration — loaded from scenario, drives AI and battle-end detection
  orchestratorConfig: OrchestratorConfig | null;
  contentContext: ContentContext | null;
  /** Flat list of content entries for the ActionPanel, sorted by kind then id. */
  contentEntries: Array<ContentPackEntry & { resolvedEntry: ResolvedEntry }>;

  // Battle outcome
  battleEnded: boolean;
  battleOutcome: BattleOutcome | null;

  // AI state
  isAiTurn: boolean;

  // Last loaded scenario URL — used by "Play Again"
  lastScenarioUrl: string | null;

  // Tiled map reference — null when using a legacy hand-written scenario
  tiledMap: ResolvedTiledMap | null;
  /** URL of the .tmj file — needed by tilesetLoader to resolve relative image paths. */
  tiledMapUrl: string | null;

  // Grid overlay toggle (applies to Tiled maps only)
  showGrid: boolean;

  // UI state — lightweight selection/hover
  selectedUnitId: string | null;
  hoveredTilePos: [number, number] | null;
  targetMode: TargetMode | null;

  // Transient state — direct updates, bypasses React
  transient: TransientState;

  // Actions
  loadBattle: (
    state: BattleState,
    enginePhase: number,
    tiledMap: ResolvedTiledMap | null,
    contentContext: ContentContext,
    rawScenario: Record<string, unknown>,
    tiledMapUrl?: string | null,
  ) => void;
  dispatchCommand: (command: RawCommand | Record<string, unknown>) => void;
  selectUnit: (unitId: string | null) => void;
  setHoverTile: (pos: [number, number] | null) => void;
  setTargetMode: (mode: TargetMode | null) => void;
  toggleGrid: () => void;
  clearBattle: () => void;
  reloadLastBattle: (url?: string) => Promise<void>;
  /** Restores state from localStorage. Returns true if a save was found and loaded. */
  loadSavedGame: () => boolean;
  /** Internal — schedules one AI step after a short delay. */
  _scheduleAiTurn: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
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
        animations.push({
          type: "move",
          unitId: actor,
          fromX: from[0],
          fromY: from[1],
          toX: to[0],
          toY: to[1],
        });
      }
    } else if (type === "condition_applied" || type === "condition_cleared") {
      const target = String(payload["target"] ?? "");
      const condition = String(payload["condition"] ?? "");
      if (target && condition) {
        animations.push({
          type: "condition",
          unitId: target,
          condition,
          applied: type === "condition_applied",
        });
      }
    }
  }
  return animations;
}

function buildContentEntries(
  ctx: ContentContext,
): Array<ContentPackEntry & { resolvedEntry: ResolvedEntry }> {
  return Object.entries(ctx.entryLookup)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, re]) => ({
      id,
      kind: re.kind,
      sourceRef: re.sourceRef ?? undefined,
      tags: re.tags,
      payload: re.payload,
      ...(re.usesPerDay != null && { usesPerDay: re.usesPerDay }),
      resolvedEntry: re,
    }));
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useBattleStore = create<BattleStore>()((set, get) => ({
    battle: null,
    rng: null,
    eventLog: [],
    enginePhase: 9,

    orchestratorConfig: null,
    contentContext: null,
    contentEntries: [],

    battleEnded: false,
    battleOutcome: null,
    isAiTurn: false,

    lastScenarioUrl: null,

    tiledMap: null,
    tiledMapUrl: null,
    showGrid: true,

    selectedUnitId: null,
    hoveredTilePos: null,
    targetMode: null,

    transient: { animationQueue: [] },

    // -------------------------------------------------------------------------
    loadBattle: (state, enginePhase = 9, tiledMap = null, contentContext, rawScenario, tiledMapUrl = null) => {
      const rng = new DeterministicRNG(state.seed);
      const orchestratorConfig = buildOrchestratorConfig(rawScenario);
      const contentEntries = buildContentEntries(contentContext);

      // Auto-select the first unit if it is player-controlled
      const firstId = state.turnOrder[state.turnIndex];
      const firstUnit = state.units[firstId];
      const initialSelectedId =
        firstUnit && orchestratorConfig.playerTeams.includes(firstUnit.team)
          ? firstId
          : null;

      set({
        battle: state,
        rng,
        eventLog: [],
        enginePhase,
        orchestratorConfig,
        contentContext,
        contentEntries,
        battleEnded: false,
        battleOutcome: null,
        isAiTurn: false,
        tiledMap,
        tiledMapUrl,
        selectedUnitId: initialSelectedId,
        hoveredTilePos: null,
        targetMode: null,
      });

      // If the first unit in initiative order is AI-controlled, kick off AI immediately.
      get()._scheduleAiTurn();
    },

    // -------------------------------------------------------------------------
    dispatchCommand: (command) => {
      const { battle, rng, eventLog, contentContext, orchestratorConfig, battleEnded } = get();
      if (!battle || !rng || battleEnded) return;

      // Materialize content-entry commands before sending to the reducer
      let cmd: Record<string, unknown> = command as Record<string, unknown>;
      if (contentContext && cmd["content_entry_id"]) {
        try {
          cmd = materializeRawCommand(cmd, contentContext);
        } catch (err) {
          console.warn("Content entry materialization failed:", err);
          return;
        }
      }

      try {
        const [nextState, newEvents] = applyCommand(battle, cmd as RawCommand, rng);
        const animations = eventsToAnimations(newEvents);

        // Check battle-end conditions after every command
        let ended = false;
        let outcome: BattleOutcome | null = null;
        if (orchestratorConfig) {
          const result = checkBattleEnd(nextState, orchestratorConfig);
          ended = result.ended;
          outcome = result.outcome;
        }

        const endEvent: Record<string, unknown>[] = ended
          ? [{
              type: "battle_end",
              round: nextState.roundNumber,
              active_unit: activeUnitId(nextState),
              payload: { outcome },
            }]
          : [];

        // Auto-follow: if the new active unit is player-controlled, select them.
        // During AI turns, preserve the player's current selection.
        const nextActiveId = activeUnitId(nextState);
        const nextUnit = nextState.units[nextActiveId];
        const isNextPC =
          nextUnit && orchestratorConfig?.playerTeams.includes(nextUnit.team);
        const newSelectedId = isNextPC ? nextActiveId : get().selectedUnitId;

        set({
          battle: nextState,
          eventLog: [...eventLog, ...newEvents, ...endEvent],
          battleEnded: ended,
          battleOutcome: outcome,
          isAiTurn: false,
          selectedUnitId: newSelectedId,
        });

        // Auto-save after every successful command (skip if battle ended)
        if (!ended && rng && orchestratorConfig && contentContext) {
          const { tiledMap, tiledMapUrl, lastScenarioUrl } = get();
          writeSave({
            version: 1,
            battle: nextState,
            rngCallCount: rng.callCount,
            orchestratorConfig,
            contentContext,
            enginePhase: get().enginePhase,
            tiledMap,
            tiledMapUrl,
            lastScenarioUrl,
            selectedUnitId: newSelectedId,
            battleEnded: false,
            battleOutcome: null,
          });
        } else if (ended) {
          // Clear save when battle ends so Continue doesn't resume a finished battle
          clearSavedGame();
        }

        const transient = get().transient;
        transient.animationQueue.push(...animations);

        if (!ended) {
          get()._scheduleAiTurn();
        }
      } catch (err) {
        if (err instanceof ReductionError) {
          console.warn("Command rejected:", err.message);
        } else {
          console.error("Unexpected reducer error:", err);
        }
        // Anti-deadlock: if the active unit is AI-controlled and its command failed,
        // force an end_turn so the game doesn't soft-lock.
        const { battle: currentBattle, orchestratorConfig } = get();
        if (currentBattle && orchestratorConfig) {
          const failedActorId = activeUnitId(currentBattle);
          const failedActor = currentBattle.units[failedActorId];
          if (failedActor && !orchestratorConfig.playerTeams.includes(failedActor.team)) {
            setTimeout(() => get().dispatchCommand({ type: "end_turn", actor: failedActorId }), 0);
          }
        }
      }
    },

    // -------------------------------------------------------------------------
    _scheduleAiTurn: () => {
      const { battle, orchestratorConfig, battleEnded, isAiTurn } = get();
      if (!battle || !orchestratorConfig || battleEnded || isAiTurn) return;
      if (!isAiUnit(battle, orchestratorConfig)) return;

      set({ isAiTurn: true });

      setTimeout(() => {
        const state = get();
        if (!state.battle || !state.orchestratorConfig || state.battleEnded) {
          set({ isAiTurn: false });
          return;
        }
        const policy = state.orchestratorConfig.enemyPolicy;
        if (!policy.enabled) {
          set({ isAiTurn: false });
          // Safety net: if the active unit is not player-controlled, auto-end
          // their turn so the game never hangs waiting for an AI that won't act.
          const activeId = activeUnitId(state.battle);
          const activeUnit = state.battle.units[activeId];
          if (activeUnit && !state.orchestratorConfig.playerTeams.includes(activeUnit.team)) {
            get().dispatchCommand({ type: "end_turn", actor: activeId });
          }
          return;
        }

        const rawCmd = getAiCommand(state.battle, policy);

        // Materialize if needed
        let cmd = rawCmd;
        if (state.contentContext && rawCmd["content_entry_id"]) {
          try {
            cmd = materializeRawCommand(rawCmd, state.contentContext);
          } catch {
            cmd = { type: "end_turn", actor: activeUnitId(state.battle) };
          }
        }

        set({ isAiTurn: false });
        get().dispatchCommand(cmd as RawCommand);
      }, 420);
    },

    // -------------------------------------------------------------------------
    reloadLastBattle: async (urlOverride?: string) => {
      const url = urlOverride ?? get().lastScenarioUrl;
      if (!url) return;
      try {
        const result = await loadScenarioFromUrl(url);
        get().loadBattle(
          result.battle,
          result.enginePhase,
          result.tiledMap,
          result.contentContext,
          result.rawScenario,
          result.tiledMapUrl,
        );
        set({ lastScenarioUrl: url });
      } catch (err) {
        console.error("Failed to reload battle:", err);
      }
    },

    // -------------------------------------------------------------------------
    loadSavedGame: () => {
      const saved = readSave();
      if (!saved) return false;
      const rng = new DeterministicRNG(saved.battle.seed, saved.rngCallCount);
      const contentEntries = buildContentEntries(saved.contentContext);
      set({
        battle: saved.battle,
        rng,
        eventLog: [],
        enginePhase: saved.enginePhase,
        orchestratorConfig: saved.orchestratorConfig,
        contentContext: saved.contentContext,
        contentEntries,
        battleEnded: saved.battleEnded,
        battleOutcome: saved.battleOutcome,
        isAiTurn: false,
        tiledMap: saved.tiledMap,
        tiledMapUrl: saved.tiledMapUrl ?? null,
        lastScenarioUrl: saved.lastScenarioUrl,
        selectedUnitId: saved.selectedUnitId,
        hoveredTilePos: null,
        targetMode: null,
        transient: { animationQueue: [] },
      });
      get()._scheduleAiTurn();
      return true;
    },

    // -------------------------------------------------------------------------
    selectUnit: (unitId) => set({ selectedUnitId: unitId }),
    setHoverTile: (pos) => set({ hoveredTilePos: pos }),
    setTargetMode: (mode) => set({ targetMode: mode }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),

    clearBattle: () => {
      clearSavedGame();
      set({
        battle: null,
        rng: null,
        eventLog: [],
        orchestratorConfig: null,
        contentContext: null,
        contentEntries: [],
        battleEnded: false,
        battleOutcome: null,
        isAiTurn: false,
        tiledMap: null,
        tiledMapUrl: null,
        selectedUnitId: null,
        hoveredTilePos: null,
        targetMode: null,
        transient: { animationQueue: [] },
      });
    },
  }));

// ---------------------------------------------------------------------------
// Selector helpers
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
