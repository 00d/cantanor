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
import { type ReactionTrigger, detectMoveReactions, detectDamageReactions } from "../engine/reactions";
import type { CampaignDefinition, CampaignProgress } from "../campaign/campaignTypes";
import { snapshotParty, applyPartySnapshot, healPartyAtCamp, resetAbilitiesForBattle } from "../campaign/campaignState";
import { writeCampaignSave, readCampaignSave, clearCampaignSave } from "../campaign/campaignPersistence";

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

export interface HealAnimation {
  type: "heal";
  unitId: string;
  amount: number;
}

export interface MissAnimation {
  type: "miss";
  unitId: string;
}

export type BattleAnimation = DamageAnimation | HealAnimation | MissAnimation;

// ---------------------------------------------------------------------------
// Target mode
// ---------------------------------------------------------------------------

export interface TargetMode {
  type: "move" | "strike" | "spell" | "feat" | "item" | "interact";
  range?: number;
  contentEntryId?: string;
  /** True when the ability targets allies rather than enemies. Ignored when
   *  `area` is set — area spells hit everyone in the blast. */
  allyTarget?: boolean;
  /** Index into the unit's weapons array (used for strike target mode). */
  weaponIndex?: number;
  /** Set when the ability targets a tile (AoE centre) rather than a unit.
   *  When present, the canvas click handler dispatches with center_x/center_y
   *  and materializeRawCommand rewrites cast_spell → area_save_damage. Only
   *  burst is wired; shape is in the schema for future line/cone work. */
  area?: {
    shape: "burst";
    radiusFeet: number;
  };
}

// ---------------------------------------------------------------------------
// Proposed path (move-preview before commit)
// ---------------------------------------------------------------------------

/** Temporary Dijkstra-derived path the player is previewing before committing
 *  a move. Set on hover while in move target mode; cleared on commit, cancel,
 *  or any state reset.
 *
 *  Two-phase flow:
 *    1. Hover (locked=false) — path updates as the mouse moves over reachable tiles.
 *    2. Click  (locked=true)  — path freezes; chevrons turn green to signal "confirm."
 *    3. Confirm-click on the same destination → dispatchCommand, clear.
 *       Click elsewhere / Escape → unlock (back to phase 1). */
export interface ProposedPath {
  /** Waypoints in travel order — element 0 is the start, last is destination. */
  tiles: Array<[number, number]>;
  /** Total movement cost in tiles (PF2e alternating diagonal accounted for). */
  cost: number;
  /** When true the path is "locked in" — hover no longer updates it and the
   *  rendering switches to the confirmed colour. The next click on the same
   *  destination commits; any other click or Escape unlocks. */
  locked: boolean;
}

// ---------------------------------------------------------------------------
// Transient state (direct mutation, no React re-renders)
// ---------------------------------------------------------------------------

export interface TransientState {
  animationQueue: BattleAnimation[];
  /**
   * Count of sprites with an in-flight position tween (0 ≤ lerpT < 1).
   * Written unconditionally every Pixi tick by tickSprites. Read by
   * _scheduleAiTurn's rAF poll (M2) to gate AI on sprite settlement.
   * Direct mutation — no React re-render.
   */
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
   * battleId this changes on Play Again of the same scenario, so in-flight
   * setTimeout/rAF callbacks can detect "this is a fresh load" even when the
   * underlying scenario identity is unchanged. See CLAUDE.md Load-Bearing
   * Invariants.
   */
  loadGeneration: number;

  // Reaction state
  pendingReaction: ReactionTrigger | null;
  reactionQueue: ReactionTrigger[];

  // Campaign state
  campaignDefinition: CampaignDefinition | null;
  campaignProgress: CampaignProgress | null;
  /** True when the player is at the camp screen between battles. */
  showCampScreen: boolean;

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
  /** Dijkstra path the player is previewing before committing a move. */
  proposedPath: ProposedPath | null;

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
  setProposedPath: (path: ProposedPath | null) => void;
  toggleGrid: () => void;
  clearBattle: () => void;
  reloadLastBattle: (url?: string) => Promise<void>;
  /** Restores state from localStorage. Returns true if a save was found and loaded. */
  loadSavedGame: () => boolean;
  /** Internal — schedules one AI step after a short delay. */
  _scheduleAiTurn: () => void;
  /** Resolve a pending reaction (accept or decline). */
  resolveReaction: (accept: boolean) => void;
  /** Internal — process next reaction in queue. */
  _processNextReaction: () => void;

  // Campaign actions
  loadCampaign: (definition: CampaignDefinition) => void;
  advanceCampaignStage: () => void;
  saveCampaignProgress: () => void;
  healCampaignParty: () => void;
  startCampaignStage: (stageIndex?: number) => Promise<void>;
  loadSavedCampaign: () => boolean;
  clearCampaign: () => void;
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
      // in the blast and had line-of-effect from the center. Fan out to one
      // damage number per hit target. Targets that crit-succeeded their save
      // take 0 → readDamage returns null → no float text (correct: a number
      // would be noise, the combat log already says who saved).
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
    }
    // No "move" branch. Slide-tweens are armed by spriteManager's syncUnits
    // directly from the battle state — it sees the unit's new position in
    // the next React effect and lerps toward it. Pushing a move entry here
    // was dead work: effectRenderer drained it with no visual, and it
    // couldn't bridge the syncUnits race anyway (see SETTLE_FRAMES comment
    // in _scheduleAiTurn — the queue drains before syncUnits runs).
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

    pendingReaction: null,
    reactionQueue: [],

    campaignDefinition: null,
    campaignProgress: null,
    showCampScreen: false,

    lastScenarioUrl: null,

    tiledMap: null,
    tiledMapUrl: null,
    showGrid: true,

    selectedUnitId: null,
    hoveredTilePos: null,
    targetMode: null,
    proposedPath: null,

    transient: { animationQueue: [], activeAnimCount: 0 },

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
        proposedPath: null,
        // M0.3: reaction queue is battle-scoped; a stale prompt from the
        // previous battle references units that don't exist in the new one.
        pendingReaction: null,
        reactionQueue: [],
        transient: { animationQueue: [], activeAnimCount: 0 },
      }));

      // Route through _processNextReaction so _scheduleAiTurn has exactly
      // one caller. reactionQueue is empty (just reset above) so this takes
      // the queue-empty branch: clear pendingReaction (idempotent), schedule
      // AI if the first unit in initiative order is AI-controlled.
      get()._processNextReaction();
    },

    // -------------------------------------------------------------------------
    dispatchCommand: (command) => {
      const { battle, rng, eventLog, contentContext, orchestratorConfig, battleEnded } = get();
      if (!battle || !rng || battleEnded) return;

      // Snapshot the RNG position NOW, before anything rolls. applyCommand
      // advances rng in-place (passed by reference), so reading .callCount
      // after the reducer returns would give us the post-action count. Used
      // in the catch block to reset the RNG on a mid-roll throw — ensures
      // rng.callCount always matches the committed battle state (M0.2).
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
          // Detect reaction triggers after move/strike commands
          const cmdType = String(cmd["type"] ?? "");
          let triggers: ReactionTrigger[] = [];

          if (cmdType === "move") {
            // fromX/fromY from the move event
            const moveEvent = newEvents.find(e => e["type"] === "move");
            if (moveEvent) {
              const payload = moveEvent["payload"] as Record<string, unknown>;
              const from = payload["from"] as number[];
              if (from) {
                triggers = detectMoveReactions(nextState, String(cmd["actor"]), from[0], from[1]);
              }
            }
          } else if (cmdType === "strike" || cmdType === "reaction_strike") {
            // Check for Shield Block triggers after strike damage
            const strikeEvent = newEvents.find(e => e["type"] === "strike" || e["type"] === "reaction_strike");
            if (strikeEvent) {
              const payload = strikeEvent["payload"] as Record<string, unknown>;
              const dmg = payload["damage"] as Record<string, unknown> | null;
              if (dmg && Number(dmg["total"] ?? 0) > 0) {
                const targetId = String(payload["target"]);
                const damageType = String(dmg["damage_type"] ?? "physical");
                triggers = detectDamageReactions(nextState, targetId, Number(dmg["total"]), damageType);
              }
            }
          }

          if (triggers.length > 0) {
            // Prepend, don't replace — a nested reaction dispatch (inside
            // resolveReaction) must not discard reactions the outer dispatch
            // queued. Prepend so cascading reactions (e.g. shield_block
            // triggered by a reaction_strike) resolve before the next outer
            // reaction fires — PF2e-correct: you block the damage you just
            // took before the next enemy swings.
            set((s) => ({ reactionQueue: [...triggers, ...s.reactionQueue] }));
          }
          // Always route through _processNextReaction. It schedules AI when
          // the queue is empty and surfaces the next prompt when it isn't.
          // Correct for BOTH outer dispatches (queue was empty before) and
          // nested reaction dispatches (queue may hold outer reactions).
          get()._processNextReaction();
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
            // Scenarios reuse ids (`hero`, `goblin_0`) so collision isn't rare.
            setTimeout(() => {
              if (get().loadGeneration !== genAtCatch) return;
              get().dispatchCommand({ type: "end_turn", actor: failedActorId });
            }, 0);
          }
        }
      }
    },

    // -------------------------------------------------------------------------
    // Animation-gated AI (M2): instead of a fixed delay, poll the transient
    // slice every frame and fire act() only once:
    //   • animationQueue is empty (processAnimationQueue has drained it), AND
    //   • activeAnimCount is 0 (every sprite tween has settled per tickSprites)
    // …for two consecutive frames, then wait a short grace so the player
    // registers the landed state before the AI acts again.
    //
    // Reaction prompts do NOT gate the poll: this function has a single caller
    // (_processNextReaction's queue-empty branch) which clears pendingReaction
    // before calling. The invariant is asserted at entry, not per-frame.
    //
    // We deliberately do NOT wait for float-text / hit-flash to finish — those
    // are cosmetic overlays and should overlap with the next action, not block
    // it. Only sprite positions gate.
    // -------------------------------------------------------------------------
    _scheduleAiTurn: () => {
      const { battle, orchestratorConfig, battleEnded, isAiTurn, pendingReaction } = get();
      if (!battle || !orchestratorConfig || battleEnded || isAiTurn) return;
      // Invariant: _scheduleAiTurn has exactly one caller (_processNextReaction's
      // queue-empty branch) and that caller clears pendingReaction immediately
      // before calling us. This guard is an assertion, not a defense — if it
      // ever trips, the single-gateway refactor has been broken.
      if (pendingReaction !== null) return;
      if (!isAiUnit(battle, orchestratorConfig)) return;

      set({ isAiTurn: true });

      // Capture load-generation so we can abort if a new battle is loaded
      // mid-poll. battleId is not sufficient here: Play Again reloads the
      // same scenario → same battleId, and a stale poll would otherwise
      // survive into the fresh battle and fire act() against it.
      const genAtSchedule = get().loadGeneration;

      const act = () => {
        const state = get();
        // Two abort reasons, two behaviours.
        //
        // Gen-mismatch: we're a stale timer from a PREVIOUS battle. The new
        // gen's loadBattle() has already bumped loadGeneration and may have
        // set isAiTurn:true via its own _scheduleAiTurn. Writing false here
        // would stomp that flag — the fresh poll would still run, but the UI
        // would un-dim and the player could click during what's supposed to
        // be a locked AI turn. Silent return.
        if (state.loadGeneration !== genAtSchedule) return;
        // Same-gen abort: the battle ended or was cleared while our poll was
        // in flight. Now it IS correct to release isAiTurn — we're the only
        // loop on this gen, no one else will. If we don't, battleEnded:true +
        // isAiTurn:true is a UI dead end (overlay shows, inputs stay dimmed).
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

        const rawCmd = getAiCommand(state.battle, policy, state.contentContext);

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
    _processNextReaction: () => {
      const { reactionQueue, battle, orchestratorConfig, battleEnded } = get();
      if (!battle || !orchestratorConfig || battleEnded) {
        set({ pendingReaction: null, reactionQueue: [] });
        return;
      }

      if (reactionQueue.length === 0) {
        set({ pendingReaction: null });
        get()._scheduleAiTurn();
        return;
      }

      const [next, ...rest] = reactionQueue;
      set({ reactionQueue: rest, pendingReaction: next });

      // Check if the reactor is AI-controlled — auto-resolve
      const reactor = battle.units[next.reactorId];
      if (reactor && !orchestratorConfig.playerTeams.includes(reactor.team)) {
        // AI always accepts reactions. Fence on BOTH loadGeneration (Play
        // Again mid-prompt) and reaction identity (cascade replaced
        // pendingReaction before the timer fired — e.g. test code or a fast
        // PC click raced the auto-resolve; the stale timer would otherwise
        // resolve the NEW pendingReaction with the OLD one's accept).
        const genAtQueue = get().loadGeneration;
        setTimeout(() => {
          if (get().loadGeneration !== genAtQueue) return;
          if (get().pendingReaction !== next) return;
          get().resolveReaction(true);
        }, 300);
      }
      // If player-controlled, the UI will show a prompt
    },

    // -------------------------------------------------------------------------
    resolveReaction: (accept: boolean) => {
      const { pendingReaction, battle } = get();
      if (!pendingReaction || !battle) {
        set({ pendingReaction: null });
        get()._processNextReaction();
        return;
      }

      // Clear BEFORE dispatch. The nested dispatchCommand may detect a
      // cascading reaction (reaction_strike → shield_block) and set a fresh
      // pendingReaction via its _processNextReaction tail. Clearing AFTER
      // would clobber the cascade — the original bug this restructure fixes.
      set({ pendingReaction: null });

      if (accept) {
        let cmd: Record<string, unknown> | null = null;
        if (pendingReaction.reactionType === "attack_of_opportunity" ||
            pendingReaction.reactionType === "reactive_strike") {
          cmd = {
            type: "reaction_strike",
            actor: pendingReaction.reactorId,
            target: pendingReaction.provokerId,
          };
        } else if (pendingReaction.reactionType === "shield_block") {
          cmd = {
            type: "shield_block",
            actor: pendingReaction.reactorId,
            damage_amount: Number(pendingReaction.data?.["damageAmount"] ?? 0),
          };
        }
        if (cmd) {
          get().dispatchCommand(cmd);
          // dispatchCommand's success tail calls _processNextReaction, which
          // either arms the next prompt (pendingReaction set) or schedules AI
          // (isAiTurn set). If dispatch THREW before reaching its tail (e.g.
          // target died from a previous reaction), NEITHER is set and turn
          // flow is stranded — queue non-empty would never surface the next
          // prompt, queue empty would never schedule AI. Recover by calling
          // _processNextReaction ourselves. The double-call hazard when
          // dispatch succeeded is excluded by the condition: one of the two
          // flags is always set on success.
          const post = get();
          if (post.pendingReaction === null && !post.isAiTurn) {
            get()._processNextReaction();
          }
          return;
        }
      }

      // Declined, or unrecognized reaction type — move to next in queue.
      get()._processNextReaction();
    },

    // -------------------------------------------------------------------------
    reloadLastBattle: async (urlOverride?: string) => {
      const url = urlOverride ?? get().lastScenarioUrl;
      if (!url) return;
      const genAtStart = get().loadGeneration;
      try {
        const result = await loadScenarioFromUrl(url);
        if (get().loadGeneration !== genAtStart) return;
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
        proposedPath: null,
        pendingReaction: null,
        reactionQueue: [],
        transient: { animationQueue: [], activeAnimCount: 0 },
      }));
      // Single-gateway: see loadBattle tail comment.
      get()._processNextReaction();
      return true;
    },

    // -------------------------------------------------------------------------
    // Campaign actions
    // -------------------------------------------------------------------------
    loadCampaign: (definition) => {
      const progress: CampaignProgress = {
        campaignId: definition.campaignId,
        currentStageIndex: 0,
        completedStages: [],
        partyState: [],
      };
      set({
        campaignDefinition: definition,
        campaignProgress: progress,
        showCampScreen: false,
      });
      writeCampaignSave(definition, progress);
    },

    advanceCampaignStage: () => {
      const { campaignDefinition, campaignProgress, battle } = get();
      if (!campaignDefinition || !campaignProgress || !battle) return;

      const currentStage = campaignDefinition.stages[campaignProgress.currentStageIndex];
      if (!currentStage) return; // bounds safety
      const partySnaps = snapshotParty(battle);

      const nextIndex = Math.min(
        campaignProgress.currentStageIndex + 1,
        campaignDefinition.stages.length,
      );

      const newProgress: CampaignProgress = {
        ...campaignProgress,
        currentStageIndex: nextIndex,
        completedStages: [...campaignProgress.completedStages, currentStage.stageId],
        partyState: partySnaps,
      };

      clearSavedGame(); // clear stale battle save
      set({
        campaignProgress: newProgress,
        showCampScreen: true,
        battle: null,
        rng: null,
        eventLog: [],
        battleEnded: false,
        battleOutcome: null,
        orchestratorConfig: null,
        contentContext: null,
        contentEntries: [],
        isAiTurn: false,
        tiledMap: null,
        tiledMapUrl: null,
        selectedUnitId: null,
        hoveredTilePos: null,
        targetMode: null,
        proposedPath: null,
        pendingReaction: null,
        reactionQueue: [],
        transient: { animationQueue: [], activeAnimCount: 0 },
      });

      writeCampaignSave(campaignDefinition, newProgress);
    },

    saveCampaignProgress: () => {
      const { campaignDefinition, campaignProgress } = get();
      if (campaignDefinition && campaignProgress) {
        writeCampaignSave(campaignDefinition, campaignProgress);
      }
    },

    healCampaignParty: () => {
      const { campaignProgress, campaignDefinition } = get();
      if (!campaignProgress || !campaignDefinition) return;
      const healedParty = healPartyAtCamp(campaignProgress.partyState);
      const newProgress = { ...campaignProgress, partyState: healedParty };
      set({ campaignProgress: newProgress });
      writeCampaignSave(campaignDefinition, newProgress);
    },

    startCampaignStage: async (stageIndex?: number) => {
      const { campaignDefinition, campaignProgress } = get();
      if (!campaignDefinition || !campaignProgress) return;

      const idx = stageIndex ?? campaignProgress.currentStageIndex;
      if (idx >= campaignDefinition.stages.length) return;

      const stage = campaignDefinition.stages[idx];
      // Gen-fence the async load: if the player clicks something else that
      // loads a different battle while this fetch is in flight, the captured
      // gen will be stale by the time the await resolves.
      const genAtStart = get().loadGeneration;
      try {
        const result = await loadScenarioFromUrl(stage.scenarioUrl);
        if (get().loadGeneration !== genAtStart) return;
        // Apply party snapshot if we have one
        let battleState = result.battle;
        if (campaignProgress.partyState.length > 0) {
          const mergedUnits = applyPartySnapshot(battleState.units, campaignProgress.partyState);
          // Reset spell/feat uses for new battle (items stay consumed)
          // Build ability defaults from content pack entries (usesPerDay)
          const abilityDefaults: Record<string, number> = {};
          for (const [entryId, entry] of Object.entries(result.contentContext.entryLookup)) {
            if (entry.usesPerDay != null) {
              abilityDefaults[entryId] = entry.usesPerDay;
            }
          }
          if (Object.keys(abilityDefaults).length > 0) {
            for (const unitId of Object.keys(mergedUnits)) {
              const unit = mergedUnits[unitId];
              if (unit.team !== "pc") continue;
              mergedUnits[unitId] = {
                ...unit,
                abilitiesRemaining: resetAbilitiesForBattle(unit.abilitiesRemaining, abilityDefaults),
              };
            }
          }
          battleState = { ...battleState, units: mergedUnits };
        }

        get().loadBattle(
          battleState,
          result.enginePhase,
          result.tiledMap,
          result.contentContext,
          result.rawScenario,
          result.tiledMapUrl,
        );
        set({
          showCampScreen: false,
          lastScenarioUrl: stage.scenarioUrl,
        });
      } catch (err) {
        console.error("Failed to load campaign stage:", err);
      }
    },

    loadSavedCampaign: () => {
      const saved = readCampaignSave();
      if (!saved) return false;
      set({
        campaignDefinition: saved.definition,
        campaignProgress: saved.progress,
        showCampScreen: true,
      });
      return true;
    },

    clearCampaign: () => {
      clearCampaignSave();
      set({
        campaignDefinition: null,
        campaignProgress: null,
        showCampScreen: false,
      });
    },

    // -------------------------------------------------------------------------
    selectUnit: (unitId) => set({ selectedUnitId: unitId }),
    setHoverTile: (pos) => set({ hoveredTilePos: pos }),
    setTargetMode: (mode) => set({ targetMode: mode, proposedPath: null }),
    setProposedPath: (path) => set({ proposedPath: path }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),

    clearBattle: () => {
      clearSavedGame();
      // Only clear campaign if explicitly ending the campaign (via clearCampaign)
      const { campaignDefinition, campaignProgress } = get();
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
        proposedPath: null,
        pendingReaction: null,
        reactionQueue: [],
        transient: { animationQueue: [], activeAnimCount: 0 },
        // Preserve campaign state
        campaignDefinition,
        campaignProgress,
        showCampScreen: false,
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
