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
  /** True when the ability targets allies rather than enemies. */
  allyTarget?: boolean;
  /** Index into the unit's weapons array (used for strike target mode). */
  weaponIndex?: number;
  /** Present when the ability targets a tile rather than a unit. The click
   *  handler reads this to dispatch with center_x/center_y (not target); the
   *  hover effect reads sizeFeet + shape to paint the footprint. Absent =
   *  single-target, which every pre-Phase-15 entry is.
   *
   *  For burst, the click is the centre. For cone/line, the click is the AIM
   *  point (direction from the caster) — the spell emanates from the caster's
   *  tile out to sizeFeet in that direction. */
  area?: {
    shape: "burst" | "cone" | "line";
    /** Burst: radius in feet. Cone/line: length in feet. */
    sizeFeet: number;
  };
}

// ---------------------------------------------------------------------------
// Transient state (direct mutation, no React re-renders)
// ---------------------------------------------------------------------------

export interface TransientState {
  animationQueue: BattleAnimation[];
  /** Count of sprites still mid-tween. Written unconditionally by
   *  tickSprites() every frame from the Pixi ticker. _scheduleAiTurn polls
   *  this to gate on settled visuals instead of a flat timer — AI doesn't
   *  act until the player's move has visibly landed. */
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

  /** Monotonic counter bumped on every loadBattle / loadSavedGame. Stale
   *  setTimeout / rAF callbacks capture this at schedule-time and compare
   *  at fire-time; gen-mismatch → silent return. Unlike `battle.battleId`
   *  (which comes from scenario JSON and doesn't change on Play Again),
   *  this catches same-scenario reloads. */
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
    } else if (type === "cast_spell" || type === "save_damage" || type === "area_save_damage") {
      const target = String(payload["target"] ?? "");
      const dmg = readDamage(payload);
      if (target && dmg) {
        animations.push({ type: "damage", unitId: target, amount: dmg.total, damageType: dmg.type });
      }
    } else if (type === "effect_tick" || type === "hazard_tick") {
      // Persistent damage / affliction ticks / spatial hazard zones
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
    // Note: "move" events aren't enqueued. Sprite slides are driven by
    // syncUnits→tickSprites reading battle.units[].x/y directly (14B).
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
        pendingReaction: null,
        reactionQueue: [],
      }));

      // If the first unit in initiative order is AI-controlled, kick off AI immediately.
      get()._scheduleAiTurn();
    },

    // -------------------------------------------------------------------------
    dispatchCommand: (command) => {
      const { battle, rng, eventLog, contentContext, orchestratorConfig, battleEnded } = get();
      if (!battle || !rng || battleEnded) return;

      // Capture RNG position BEFORE anything rolls. All current handlers
      // throw before their first roll, so resetting in the catch is a no-op
      // today. But it buys a guarantee: after dispatchCommand returns —
      // success OR throw — rng.callCount exactly matches the committed
      // battle state. Future handlers with roll-then-validate patterns won't
      // silently drift the RNG and desync a later save/load or replay.
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
            // Queue reactions and process
            set({ reactionQueue: triggers });
            get()._processNextReaction();
          } else {
            get()._scheduleAiTurn();
          }
        }
      } catch (err) {
        if (err instanceof ReductionError) {
          console.warn("Command rejected:", err.message);
        } else {
          console.error("Unexpected reducer error:", err);
        }
        // Reset the RNG to where it was before the try. `battle.seed` is safe
        // to read here: `battle` is the pre-try scope capture; the throw
        // happened before set({battle:nextState}) so the store's battle is
        // still this same object.
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
            // Scenarios reuse IDs (`hero`, `goblin_0`) so collision is likely.
            setTimeout(() => {
              if (get().loadGeneration !== genAtCatch) return;
              get().dispatchCommand({ type: "end_turn", actor: failedActorId });
            }, 0);
          }
        }
      }
    },

    // -------------------------------------------------------------------------
    // Animation-gated AI dispatch.
    //
    // Instead of a flat delay, poll transient state on requestAnimationFrame
    // until both:
    //   • animationQueue is empty (hit-flash / float-text drained), AND
    //   • activeAnimCount is 0 (every sprite tween has settled per tickSprites)
    // …then wait a short grace period so the player registers the landed state
    // before the AI acts again.
    //
    // We do NOT wait for float-text / hit-flash to FINISH — those are cosmetic
    // overlays and should overlap with the next action. Only sprite POSITIONS
    // gate: the AI shouldn't start its move while the player's mover is still
    // visually mid-slide.
    // -------------------------------------------------------------------------
    _scheduleAiTurn: () => {
      const { battle, orchestratorConfig, battleEnded, isAiTurn } = get();
      if (!battle || !orchestratorConfig || battleEnded || isAiTurn) return;
      if (!isAiUnit(battle, orchestratorConfig)) return;

      set({ isAiTurn: true });

      // Capture load-generation so we can abort if a new battle is loaded
      // mid-poll. battleId is NOT sufficient here: Play Again reloads the
      // same scenario → same battleId, and a stale poll would survive into
      // the fresh battle and fire act() against it.
      const genAtSchedule = get().loadGeneration;

      const act = () => {
        const state = get();
        // Two abort reasons, two behaviours.
        //
        // Gen-mismatch: we're a stale timer from a PREVIOUS battle. The new
        // gen's loadBattle() has already bumped loadGeneration and (if the
        // fresh battle's first unit is AI) fired its OWN _scheduleAiTurn,
        // which has already set isAiTurn:true and kicked off its own rAF
        // poll. Writing false here would stomp that flag — the fresh poll
        // would still run, but the UI would un-dim (End Turn button re-enables,
        // action buttons light up) and the player could click during what's
        // supposed to be a locked AI turn. Silent return: the gen fence is
        // the only thing we're allowed to read across the discontinuity.
        if (state.loadGeneration !== genAtSchedule) return;
        // Same-gen abort: battle ended or was cleared WHILE OUR poll was in
        // flight, on the same generation. Now it IS correct to release
        // isAiTurn — we're the only loop on this gen, no one else will. If
        // we don't release it, battleEnded:true + isAiTurn:true is a UI dead
        // end: the overlay shows but all inputs stay dimmed.
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
      // settles because tickSprites isn't being called — headless, tab
      // backgrounded, Pixi app paused). Act anyway: stale visuals are better
      // than a soft-lock.
      const MAX_POLL_FRAMES = 120;
      // Require this many consecutive settled frames before firing. A single
      // settled read is not trustworthy: on frame 1 after dispatch the Pixi
      // ticker drains the animation queue to 0 and tickSprites writes
      // activeAnimCount=0, but syncUnits — which actually ARMS the tween —
      // lives in a passive useEffect and doesn't run until AFTER that rAF
      // batch. One frame later the tween is armed and the counter reads
      // nonzero. Two is exactly enough to bridge that gap; costs ~16ms/turn.
      const SETTLE_FRAMES = 2;
      let polls = 0;
      let settledStreak = 0;

      const pollSettled = () => {
        const s = get();
        // Same split as act(). This is the HIGHER-RISK site: act() has a
        // 120ms window, but pollSettled runs once per frame for up to ~2s
        // while waiting for sprites to settle. Play Again during an AI turn
        // almost always lands HERE, not in act(). No orchestratorConfig
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
        // AI always accepts reactions. Gen-fence the deferred accept so a
        // Play Again mid-prompt doesn't auto-resolve against the fresh battle.
        const genAtSchedule = get().loadGeneration;
        setTimeout(() => {
          if (get().loadGeneration !== genAtSchedule) return;
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

      if (accept) {
        if (pendingReaction.reactionType === "attack_of_opportunity" ||
            pendingReaction.reactionType === "reactive_strike") {
          get().dispatchCommand({
            type: "reaction_strike",
            actor: pendingReaction.reactorId,
            target: pendingReaction.provokerId,
          });
        } else if (pendingReaction.reactionType === "shield_block") {
          const damageAmount = Number(pendingReaction.data?.["damageAmount"] ?? 0);
          get().dispatchCommand({
            type: "shield_block",
            actor: pendingReaction.reactorId,
            damage_amount: damageAmount,
          });
        }
      }

      set({ pendingReaction: null });
      get()._processNextReaction();
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
        pendingReaction: null,
        reactionQueue: [],
        transient: { animationQueue: [], activeAnimCount: 0 },
      }));
      get()._scheduleAiTurn();
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
      try {
        const result = await loadScenarioFromUrl(stage.scenarioUrl);
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
    setTargetMode: (mode) => set({ targetMode: mode }),
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
