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
// Undo stack
//
// One snapshot per PC-originated, non-end_turn dispatch. The stack holds the
// steps WITHIN the current PC turn — end_turn flushes it. That's the chosen
// "step-back" granularity: the player can rewind their own mistakes, but once
// they commit (E), the turn is locked in and the AI responds.
//
// `battle` is held BY REFERENCE. This is safe because applyCommand() does
// deepClone(state) as its first statement — the prev-state object is never
// touched again once the reducer returns. Verified by sweep: zero mutation
// sites on store.battle outside the reducer. Holding a reference means each
// snapshot costs ~24 bytes of overhead, not a full state tree.
//
// `rngCallCount` is captured at the TOP of dispatchCommand, before applyCommand
// runs. This matters because the RNG is passed by reference into the reducer
// and advanced in-place. By the time we'd normally push (post-applyCommand),
// rng.callCount already reflects the new state, not the state we're saving.
// We want the pre-roll count so undo-pop can reconstruct the RNG to exactly
// where it was before the undone action rolled anything.
//
// `eventLogLength` lets us trim the log back without storing a whole copy.
// The log is append-only (fresh array via spread every dispatch, never
// mutated), so slicing to a remembered length is safe.
//
// Not snapshotted: everything in SavedGame that isn't here.
//   - orchestratorConfig/contentContext/enginePhase/tiledMap — immutable
//     mid-battle (only change on loadBattle, which flushes the stack anyway)
//   - battleEnded/battleOutcome — derived; undo sets both false (you can only
//     have reached an ended-battle state via a PC action on a non-ended state,
//     so the pre-action state is definitionally not-ended)
//   - selectedUnitId/targetMode — UI state; undo clears targetMode (aiming
//     context is invalid after a state discontinuity) and leaves selection
//     alone (the player re-selects if they want)
// ---------------------------------------------------------------------------

interface UndoSnapshot {
  battle: BattleState;
  rngCallCount: number;
  eventLogLength: number;
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

export interface HealAnimation {
  type: "heal";
  unitId: string;
  amount: number;
}

export interface MissAnimation {
  type: "miss";
  unitId: string;
}

export interface MoveAnimation {
  type: "move";
  unitId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export type BattleAnimation = DamageAnimation | HealAnimation | MissAnimation | MoveAnimation;

// ---------------------------------------------------------------------------
// Target mode
// ---------------------------------------------------------------------------

export interface TargetMode {
  type: "move" | "strike" | "spell" | "feat" | "item" | "interact";
  range?: number;
  contentEntryId?: string;
  /** True when the ability targets allies rather than enemies. */
  allyTarget?: boolean;
  /** Present when the ability targets a tile rather than a unit — the click
   *  handler reads this to dispatch with center_x/center_y and the hover
   *  effect reads radiusFeet to paint the blast footprint. Absent =
   *  single-target (the default for every existing spell/feat/item). */
  area?: {
    shape: "burst";
    radiusFeet: number;
  };
}

// ---------------------------------------------------------------------------
// Transient state (direct mutation, no React re-renders)
// ---------------------------------------------------------------------------

export interface TransientState {
  animationQueue: BattleAnimation[];
  /** Number of sprites with an in-flight position tween. Written every
   *  frame by tickSprites(); read by _scheduleAiTurn's settle-poll so the AI
   *  waits for the previous action's visual to land before thinking. */
  activeAnimCount: number;
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

  /**
   * Monotonic counter bumped every time a battle is (re)loaded. Unlike
   * battleId this changes on Play Again of the same scenario, so rendering
   * code and in-flight rAF polls can detect "this is a fresh load" even when
   * the underlying scenario identity is unchanged.
   */
  loadGeneration: number;

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

  // Undo — step-back stack within the current PC turn.
  // Reactive so the UI can show the stack depth on the Undo button.
  undoStack: UndoSnapshot[];
  /** Monotonic, bumped on every undo(). Drives the sprite-snap in App.tsx —
   *  can't reuse loadGeneration for this because loadGeneration's effect also
   *  re-centres the camera, which undo must not do (the player panned there
   *  for a reason; undoing a move shouldn't throw that away). */
  undoGeneration: number;

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
  /** Pop one undo snapshot. No-op if the stack is empty. */
  undo: () => void;
  /** Internal — schedules one AI step after a short delay. */
  _scheduleAiTurn: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Translate engine events into visual animation cues for the PixiJS layer.
 *
 * Damage info is nested under `payload.damage` for strike / cast_spell /
 * save_damage / area_save_damage / effect_tick events. The total key varies:
 * strike uses `total`, save-based events use `applied_total` — we try both.
 */
function eventsToAnimations(events: Record<string, unknown>[]): BattleAnimation[] {
  const animations: BattleAnimation[] = [];

  function readDamage(payload: Record<string, unknown>): { total: number; type: string } | null {
    const dmg = payload["damage"];
    if (!dmg || typeof dmg !== "object") return null;
    const d = dmg as Record<string, unknown>;
    const total = Number(d["applied_total"] ?? d["total"] ?? 0);
    if (total <= 0) return null;
    return { total, type: String(d["damage_type"] ?? "physical") };
  }

  for (const event of events) {
    const type = String(event["type"] ?? "");
    const payload = (event["payload"] as Record<string, unknown>) ?? {};

    if (type === "strike") {
      const target = String(payload["target"] ?? "");
      if (!target) continue;
      const dmg = readDamage(payload);
      if (dmg) {
        animations.push({ type: "damage", unitId: target, amount: dmg.total, damageType: dmg.type });
      } else {
        // Miss — strike landed no damage
        animations.push({ type: "miss", unitId: target });
      }
    } else if (type === "cast_spell" || type === "save_damage") {
      const target = String(payload["target"] ?? "");
      const dmg = readDamage(payload);
      if (target && dmg) {
        animations.push({ type: "damage", unitId: target, amount: dmg.total, damageType: dmg.type });
      }
    } else if (type === "area_save_damage") {
      // Area events carry a resolutions array — one entry per unit that was
      // in the blast and had line of effect from the center. Fan out to one
      // damage number per hit target. Targets that crit-succeeded their save
      // take 0 → readDamage returns null → they get no float text (correct:
      // a number would be noise, the log already says who saved).
      const resolutions = payload["resolutions"];
      if (Array.isArray(resolutions)) {
        for (const res of resolutions) {
          if (!res || typeof res !== "object") continue;
          const r = res as Record<string, unknown>;
          const target = String(r["target"] ?? "");
          const dmg = readDamage(r);
          if (target && dmg) {
            animations.push({ type: "damage", unitId: target, amount: dmg.total, damageType: dmg.type });
          }
        }
      }
    } else if (type === "effect_tick") {
      // Persistent damage / affliction ticks
      const target = String(payload["target"] ?? "");
      const dmg = readDamage(payload);
      if (target && dmg) {
        animations.push({ type: "damage", unitId: target, amount: dmg.total, damageType: dmg.type });
      }
    } else if (type === "effect_apply") {
      // Temp-HP grants are the closest thing we have to a heal right now
      const target = String(payload["target"] ?? "");
      const kind = String(payload["kind"] ?? "");
      if (target && kind === "temp_hp") {
        const granted = Number(payload["granted"] ?? 0);
        if (granted > 0) {
          animations.push({ type: "heal", unitId: target, amount: granted });
        }
      }
    } else if (type === "move") {
      const actor = String(payload["actor"] ?? "");
      const from = payload["from"] as number[] | undefined;
      const to = payload["to"] as number[] | undefined;
      if (actor && from && to) {
        animations.push({
          type: "move",
          unitId: actor,
          fromX: from[0], fromY: from[1],
          toX: to[0], toY: to[1],
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

    loadGeneration: 0,

    lastScenarioUrl: null,

    tiledMap: null,
    tiledMapUrl: null,
    showGrid: true,

    selectedUnitId: null,
    hoveredTilePos: null,
    targetMode: null,

    transient: { animationQueue: [], activeAnimCount: 0 },

    undoStack: [],
    undoGeneration: 0,

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

      set((s) => ({
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
        loadGeneration: s.loadGeneration + 1,
        tiledMap,
        tiledMapUrl,
        selectedUnitId: initialSelectedId,
        hoveredTilePos: null,
        targetMode: null,
        transient: { animationQueue: [], activeAnimCount: 0 },
        // Undo stack is turn-scoped; a new battle is a new world. Any stale
        // snapshots reference the previous battle's deep-frozen state tree —
        // popping one would swap in a completely unrelated BattleState.
        undoStack: [],
      }));

      // If the first unit in initiative order is AI-controlled, kick off AI immediately.
      get()._scheduleAiTurn();
    },

    // -------------------------------------------------------------------------
    dispatchCommand: (command) => {
      const {
        battle, rng, eventLog, contentContext, orchestratorConfig,
        battleEnded, isAiTurn, undoStack,
      } = get();
      if (!battle || !rng || battleEnded) return;

      // Snapshot the RNG position NOW, before anything rolls. applyCommand
      // advances rng in-place (passed by reference), so reading .callCount
      // after the reducer returns would give us the post-action count — wrong
      // for an undo snapshot, which needs to reconstruct the pre-action RNG.
      // Also used in the catch block to reset the RNG on a mid-roll throw.
      const rngCallCountBefore = rng.callCount;

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
        const [nextState, newEvents] = applyCommand(battle, cmd as unknown as RawCommand, rng);
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

        // ── Undo stack maintenance ────────────────────────────────────────
        // Gate on isAiTurn as read at the TOP of this function. The AI loop
        // sets isAiTurn:true in _scheduleAiTurn before act() calls us, and
        // we set it back to false below — so the value destructured at entry
        // reliably answers "did this dispatch come from the AI loop?".
        //
        // end_turn flushes: that's the commit point. The PC pressed E, the
        // turn is locked, the AI is about to respond. Step-back granularity
        // means you can undo Move→Strike→Move within a turn but not across
        // the end_turn boundary.
        //
        // AI dispatches touch nothing. The stack was already flushed by the
        // PC's end_turn, so this is a no-op either way — but explicitly
        // skipping makes the intent legible and guards against a future
        // phase where AI actions somehow happen with a non-empty PC stack.
        //
        // Read the type from `cmd` (post-materialize), not `command` —
        // materialize can rewrite cast_spell→area_save_damage but it never
        // rewrites TO end_turn, so today the distinction is academic. Reading
        // cmd is still correct: what we want to know is "what did the reducer
        // actually do", and that's cmd.
        const undoPatch =
          isAiTurn
            ? {}
            : cmd["type"] === "end_turn"
              ? { undoStack: [] }
              : { undoStack: [...undoStack, {
                  battle,
                  rngCallCount: rngCallCountBefore,
                  eventLogLength: eventLog.length,
                }] };

        set({
          battle: nextState,
          eventLog: [...eventLog, ...newEvents, ...endEvent],
          battleEnded: ended,
          battleOutcome: outcome,
          isAiTurn: false,
          selectedUnitId: newSelectedId,
          ...undoPatch,
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
        // Reset the RNG to where it was before the try. All current handlers
        // throw before their first roll, so today this is a no-op (callCount
        // hasn't moved). But it costs one compare-and-construct, and it buys
        // us a guarantee: after dispatchCommand returns — success OR throw —
        // rng.callCount exactly matches the committed battle state. Future
        // handlers with roll-then-validate patterns won't silently drift the
        // RNG and desync a later replay.
        //
        // battle.seed is safe to read here: `battle` is the pre-try scope
        // capture; the throw happened before set({battle:nextState}) so the
        // store's battle is still this same object.
        if (rng.callCount !== rngCallCountBefore) {
          set({ rng: new DeterministicRNG(battle.seed, rngCallCountBefore) });
        }
        // Anti-deadlock: if the active unit is AI-controlled and its command failed,
        // force an end_turn so the game doesn't soft-lock.
        const { battle: currentBattle, orchestratorConfig: cfg, loadGeneration: genAtCatch } = get();
        if (currentBattle && cfg) {
          const failedActorId = activeUnitId(currentBattle);
          const failedActor = currentBattle.units[failedActorId];
          if (failedActor && !cfg.playerTeams.includes(failedActor.team)) {
            // Gen-fence the deferred dispatch. `failedActorId` is a closure
            // capture from THIS gen; setTimeout(0) fires on the next macrotask.
            // If Play Again runs in between (synchronous onClick → loadBattle
            // → gen++), we'd end_turn against the NEW battle with a stale ID.
            // Scenarios reuse ids (`hero`, `goblin_0`) so collision isn't rare,
            // and since loadBattle just set isAiTurn:false, the undo gate would
            // read the stale dispatch as PC-originated and flush the fresh
            // stack. Same bug class as the act()/pollSettled() stomp; same cure.
            setTimeout(() => {
              if (get().loadGeneration !== genAtCatch) return;
              get().dispatchCommand({ type: "end_turn", actor: failedActorId });
            }, 0);
          }
        }
      }
    },

    // -------------------------------------------------------------------------
    // Animation-gated AI scheduling.
    //
    // The old implementation used a flat setTimeout(420) — a magic number
    // picked to be "long enough" for the previous frame's float-text to land.
    // With movement tweens in play that guess is wrong: a 5-tile slide takes
    // ~280ms but a damage number lingers for 900ms, and chaining Move→Strike
    // →EndTurn would spawn the damage flash while the sprite is still
    // mid-slide.
    //
    // Instead we poll the transient slice on requestAnimationFrame until BOTH
    //   • animationQueue is drained (processAnimationQueue has consumed
    //     every pending cue), AND
    //   • activeAnimCount is 0 (every sprite tween has settled, per
    //     tickSprites)
    // …then wait a short grace period so the player registers the landed
    // state before the AI acts again.
    //
    // We deliberately do NOT wait for float-text / hit-flash to finish —
    // those are cosmetic overlays and should overlap with the next action,
    // not block it. Only sprite positions gate.
    // -------------------------------------------------------------------------
    _scheduleAiTurn: () => {
      const { battle, orchestratorConfig, battleEnded, isAiTurn } = get();
      if (!battle || !orchestratorConfig || battleEnded || isAiTurn) return;
      if (!isAiUnit(battle, orchestratorConfig)) return;

      set({ isAiTurn: true });

      // Capture load-generation so we can abort if a new battle is loaded
      // mid-poll. battleId is not sufficient here: Play Again reloads the
      // same scenario → same battleId, and a stale poll would otherwise
      // survive into the fresh battle and fire act() against it.
      const genAtSchedule = get().loadGeneration;

      const act = () => {
        const state = get();
        // Two abort reasons, two behaviours. They used to share a branch
        // that did set({isAiTurn:false}) — that was the stomp.
        //
        // Gen-mismatch: we're a stale timer from a PREVIOUS battle. The new
        // gen's loadBattle() has already bumped loadGeneration and then
        // called _scheduleAiTurn() (store:474). If that fresh battle's first
        // unit is AI, the NEW _scheduleAiTurn has already set isAiTurn:true
        // and fired its own rAF poll. Writing false here would stomp that
        // flag — the fresh poll would still run, but the UI would un-dim
        // (End Turn button re-enables, action buttons light up) and the
        // player could click during what's supposed to be a locked AI turn.
        // Silent return. The gen fence is the only thing we're allowed to
        // read across the discontinuity; everything else is the new gen's
        // state and we mustn't touch it.
        if (state.loadGeneration !== genAtSchedule) return;
        // Same-gen abort: the battle ended or was cleared WHILE OUR poll was
        // in flight, on the same generation. Now it IS correct to release
        // isAiTurn — we're the only loop on this gen, no one else will. If
        // we don't release it, battleEnded:true + isAiTurn:true is a UI dead
        // end: the overlay shows but all the inputs stay dimmed.
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
        get().dispatchCommand(cmd as unknown as RawCommand);
      };

      const GRACE_MS = 120;
      // Hard cap on poll frames. At 60fps this is ~2s — if we're still
      // waiting after that, something has wedged (e.g. a tween that never
      // settles because tickSprites isn't being called). Better to act on
      // stale visuals than to soft-lock the game.
      const MAX_POLL_FRAMES = 120;
      // Require this many consecutive settled frames before firing. A single
      // settled read is not trustworthy: on frame 1 after dispatch the Pixi
      // ticker drains the animation queue and writes activeAnimCount=0, but
      // syncUnits — which actually arms the tween — lives in a passive
      // useEffect and doesn't run until AFTER that rAF batch. One frame
      // later the tween is armed and the counter reads nonzero. Two is
      // exactly enough to bridge that gap; costs ~16ms per AI turn.
      const SETTLE_FRAMES = 2;
      let polls = 0;
      let settledStreak = 0;

      const pollSettled = () => {
        const s = get();
        // Same split as act(). This is the HIGHER-RISK site: act() has a
        // 120ms window, but pollSettled runs once per frame for up to ~2s
        // while waiting for sprites to settle. Play Again during an AI
        // turn almost always lands HERE, not in act(). No orchestratorConfig
        // check needed — config only nulls via clearBattle(), which also
        // nulls battle, so !s.battle already covers it.
        if (s.loadGeneration !== genAtSchedule) return;
        if (!s.battle || s.battleEnded) {
          set({ isAiTurn: false });
          return;
        }
        const t = s.transient;
        const settled = t.animationQueue.length === 0 && t.activeAnimCount === 0;
        settledStreak = settled ? settledStreak + 1 : 0;
        if (settledStreak >= SETTLE_FRAMES || ++polls >= MAX_POLL_FRAMES) {
          setTimeout(act, GRACE_MS);
        } else {
          requestAnimationFrame(pollSettled);
        }
      };

      requestAnimationFrame(pollSettled);
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
      set((s) => ({
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
        loadGeneration: s.loadGeneration + 1,
        tiledMap: saved.tiledMap,
        tiledMapUrl: saved.tiledMapUrl ?? null,
        lastScenarioUrl: saved.lastScenarioUrl,
        selectedUnitId: saved.selectedUnitId,
        hoveredTilePos: null,
        targetMode: null,
        transient: { animationQueue: [], activeAnimCount: 0 },
        // Undo doesn't persist across save/load. The step-back stack is an
        // in-session affordance, not a replay log. If the player reloads
        // mid-turn, they've chosen a new starting point.
        undoStack: [],
      }));
      get()._scheduleAiTurn();
      return true;
    },

    // -------------------------------------------------------------------------
    undo: () => {
      const { undoStack, eventLog, transient } = get();
      if (undoStack.length === 0) return;
      const snap = undoStack[undoStack.length - 1];

      // The RNG can't be seeked — mulberry32's state lives in a closure that
      // has no rewind. The only way back is a fresh instance fast-forwarded
      // through skipCount dummy rolls. Same trick loadSavedGame uses.
      const rng = new DeterministicRNG(snap.battle.seed, snap.rngCallCount);

      set((s) => ({
        battle: snap.battle,
        rng,
        // slice, not replace — the log from [0, snap) is still true history.
        // Only the undone action's events get dropped.
        eventLog: eventLog.slice(0, snap.eventLogLength),
        undoStack: undoStack.slice(0, -1),
        undoGeneration: s.undoGeneration + 1,
        // The pre-action state was definitionally not-ended: battleEnded
        // is a dispatchCommand entry guard, so we could only have PUSHED
        // this snapshot from a not-ended state.
        battleEnded: false,
        battleOutcome: null,
        // Aiming context is now nonsense — the armed spell might have been
        // the thing we just undid, or the blue move tiles are stale. Clear it.
        // The player re-arms if they want to retry.
        targetMode: null,
      }));

      // Flush pending animation cues — they describe the undone action.
      // Anything already drained into the effect renderer (float-text,
      // hit-flash) keeps going; those are cosmetic and the player has
      // already seen them — that's why they're hitting undo.
      // activeAnimCount needs no touch: tickSprites rewrites it every frame.
      transient.animationQueue.length = 0;

      // Sprite snap happens in App.tsx, keyed on undoGeneration. Can't call
      // it from here without importing rendering into the store, which would
      // invert the layering. App.tsx already imports snapAllSprites for the
      // fresh-load path; undo just needs a parallel signal.
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
        transient: { animationQueue: [], activeAnimCount: 0 },
        undoStack: [],
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
