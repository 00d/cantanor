# TypeScript Technical Specification
## Detailed Implementation Patterns for Browser Port

**Version:** 1.0
**Date:** February 6, 2026
**Companion Document:** TYPESCRIPT_BROWSER_REFACTORING_PLAN.md

---

## TypeScript Project Structure

```
project-root/
├── src/
│   ├── engine/
│   │   ├── core/
│   │   │   ├── State.ts
│   │   │   ├── Commands.ts
│   │   │   ├── Reducer.ts
│   │   │   ├── RNG.ts
│   │   │   ├── TurnOrder.ts
│   │   │   ├── IDs.ts
│   │   │   ├── Objectives.ts
│   │   │   └── Forecast.ts
│   │   ├── grid/
│   │   │   ├── Map.ts
│   │   │   ├── Movement.ts
│   │   │   ├── LOS.ts
│   │   │   ├── LOE.ts
│   │   │   └── Areas.ts
│   │   ├── rules/
│   │   │   ├── Checks.ts
│   │   │   ├── Saves.ts
│   │   │   ├── Damage.ts
│   │   │   ├── Conditions.ts
│   │   │   └── Degrees.ts
│   │   ├── effects/
│   │   │   ├── Lifecycle.ts
│   │   │   ├── Registry.ts
│   │   │   └── handlers/
│   │   │       ├── TempHP.ts
│   │   │       ├── Condition.ts
│   │   │       ├── Affliction.ts
│   │   │       └── Summon.ts
│   │   └── io/
│   │       ├── ScenarioLoader.ts
│   │       ├── ContentPackLoader.ts
│   │       ├── CommandAuthoring.ts
│   │       └── EventLog.ts
│   ├── rendering/
│   │   ├── PixiApp.ts
│   │   ├── TileRenderer.ts
│   │   ├── SpriteManager.ts
│   │   ├── EffectRenderer.ts
│   │   ├── CameraController.ts
│   │   ├── InputHandler.ts
│   │   └── AssetLoader.ts
│   ├── ui/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── PartyPanel.tsx
│   │   │   ├── CombatLog.tsx
│   │   │   ├── ActionPanel.tsx
│   │   │   ├── TurnOrderDisplay.tsx
│   │   │   └── TargetPanel.tsx
│   │   ├── hooks/
│   │   │   ├── useGameState.ts
│   │   │   └── useTransientUpdate.ts
│   │   └── styles/
│   │       └── global.css
│   ├── store/
│   │   └── gameStore.ts
│   ├── utils/
│   │   ├── hash.ts
│   │   └── logger.ts
│   └── main.tsx
├── public/
│   ├── assets/
│   │   ├── sprites/
│   │   │   ├── units.json
│   │   │   ├── units.png
│   │   │   ├── tiles.json
│   │   │   └── tiles.png
│   │   ├── icons/
│   │   └── packs/
│   │       ├── phase7_baseline_v1.json
│   │       └── phase9_baseline_v1.json
│   └── index.html
├── tests/
│   ├── unit/
│   │   ├── engine/
│   │   └── rendering/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## Core Type Definitions

### State Types (`src/engine/core/State.ts`)

```typescript
/**
 * Core state interfaces mirroring Python dataclasses.
 * All fields are readonly to enforce immutability.
 */

export type Position = readonly [x: number, y: number];

export interface UnitState {
  readonly unit_id: string;
  readonly team: 'pc' | 'enemy' | 'neutral';
  readonly hp: number;
  readonly max_hp: number;
  readonly x: number;
  readonly y: number;
  readonly initiative: number;
  readonly attack_mod: number;
  readonly ac: number;
  readonly damage: string; // e.g., "1d8+4"
  readonly temp_hp?: number;
  readonly temp_hp_source?: string;
  readonly temp_hp_owner_effect_id?: string;
  readonly attack_damage_type?: string;
  readonly attack_damage_bypass?: readonly string[];
  readonly fortitude?: number;
  readonly reflex?: number;
  readonly will?: number;
  readonly actions_remaining?: number;
  readonly reaction_available?: boolean;
  readonly conditions?: Readonly<Record<string, number>>;
  readonly condition_immunities?: readonly string[];
  readonly resistances?: Readonly<Record<string, number>>;
  readonly weaknesses?: Readonly<Record<string, number>>;
  readonly immunities?: readonly string[];
}

export interface MapState {
  readonly width: number;
  readonly height: number;
  readonly blocked: readonly Position[];
}

export interface EffectState {
  readonly effect_id: string;
  readonly kind: string;
  readonly source_unit_id: string | null;
  readonly target_unit_id: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly duration_rounds: number | null;
  readonly tick_timing: 'turn_start' | 'turn_end' | null;
}

export interface BattleState {
  readonly battle_id: string;
  readonly seed: number;
  readonly round_number: number;
  readonly turn_index: number;
  readonly turn_order: readonly string[];
  readonly units: Readonly<Record<string, UnitState>>;
  readonly battle_map: MapState;
  readonly effects: Readonly<Record<string, EffectState>>;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly event_sequence: number;
}

// Computed properties (like Python @property decorators)
export function getActiveUnitId(state: BattleState): string {
  return state.turn_order[state.turn_index];
}

export function getActiveUnit(state: BattleState): UnitState | undefined {
  return state.units[getActiveUnitId(state)];
}

export function isUnitAlive(unit: UnitState): boolean {
  return unit.hp > 0;
}
```

### Command Types (`src/engine/core/Commands.ts`)

```typescript
/**
 * Command type definitions using discriminated unions.
 * TypeScript will enforce exhaustive checking in switch statements.
 */

interface BaseCommand {
  actor: string;
}

export interface MoveCommand extends BaseCommand {
  type: 'move';
  x: number;
  y: number;
}

export interface StrikeCommand extends BaseCommand {
  type: 'strike';
  target: string;
}

export interface EndTurnCommand extends BaseCommand {
  type: 'end_turn';
}

export interface SaveDamageCommand extends BaseCommand {
  type: 'save_damage';
  target: string;
  dc: number;
  save_type: 'Fortitude' | 'Reflex' | 'Will';
  damage: string;
  mode: 'basic';
}

export interface AreaSaveDamageCommand extends BaseCommand {
  type: 'area_save_damage';
  center_x: number;
  center_y: number;
  radius_feet: number;
  dc: number;
  save_type: 'Fortitude' | 'Reflex' | 'Will';
  damage: string;
  mode: 'basic';
  include_actor: boolean;
}

export interface ApplyEffectCommand extends BaseCommand {
  type: 'apply_effect';
  target: string;
  effect_kind: string;
  payload: Record<string, unknown>;
  duration_rounds: number | null;
  tick_timing: 'turn_start' | 'turn_end' | null;
}

export interface CastSpellCommand extends BaseCommand {
  type: 'cast_spell';
  spell_id: string;
  target: string;
  dc: number;
  save_type: 'Fortitude' | 'Reflex' | 'Will';
  damage: string;
  damage_type?: string;
  mode?: 'basic';
  action_cost?: number;
}

export interface UseFeatCommand extends BaseCommand {
  type: 'use_feat';
  feat_id: string;
  target: string;
  effect_kind: string;
  payload: Record<string, unknown>;
  duration_rounds?: number | null;
  tick_timing?: 'turn_start' | 'turn_end' | null;
  action_cost?: number;
}

export interface UseItemCommand extends BaseCommand {
  type: 'use_item';
  item_id: string;
  target: string;
  effect_kind: string;
  payload: Record<string, unknown>;
  duration_rounds?: number | null;
  tick_timing?: 'turn_start' | 'turn_end' | null;
  action_cost?: number;
}

export interface InteractCommand extends BaseCommand {
  type: 'interact';
  interact_id: string;
  flag?: string;
  flag_value?: boolean;
  effect_kind?: string;
  payload?: Record<string, unknown>;
  action_cost?: number;
}

export interface SpawnUnitCommand extends BaseCommand {
  type: 'spawn_unit';
  unit: Partial<UnitState> & { id: string };
  placement_policy: 'exact' | 'nearest_open';
  spend_action: boolean;
}

export interface SetFlagCommand extends BaseCommand {
  type: 'set_flag';
  flag: string;
  value: boolean;
}

export interface TriggerHazardSourceCommand extends BaseCommand {
  type: 'trigger_hazard_source';
  hazard_id: string;
  source_name: string;
  source_type: string;
  center_x?: number;
  center_y?: number;
  target?: string;
  model_path?: string;
}

export interface RunHazardRoutineCommand extends BaseCommand {
  type: 'run_hazard_routine';
  hazard_id: string;
  source_name: string;
  source_type: string;
  target_policy: 'as_configured' | 'explicit' | 'nearest_enemy' | 'nearest_enemy_area_center' | 'all_enemies';
  center_x?: number;
  center_y?: number;
  target?: string;
  model_path?: string;
}

// Union type for all commands
export type Command =
  | MoveCommand
  | StrikeCommand
  | EndTurnCommand
  | SaveDamageCommand
  | AreaSaveDamageCommand
  | ApplyEffectCommand
  | CastSpellCommand
  | UseFeatCommand
  | UseItemCommand
  | InteractCommand
  | SpawnUnitCommand
  | SetFlagCommand
  | TriggerHazardSourceCommand
  | RunHazardRoutineCommand;
```

### Event Types (`src/engine/io/EventLog.ts`)

```typescript
/**
 * Event types for battle log and UI updates.
 */

interface BaseEvent {
  event_id: string;
  round: number;
  active_unit: string;
}

export interface StrikeHitEvent extends BaseEvent {
  type: 'strike_hit';
  payload: {
    attacker: string;
    target: string;
    roll: number;
    degree: 'critical_success' | 'success' | 'failure' | 'critical_failure';
    damage: number;
    damage_type?: string;
  };
}

export interface MovementEvent extends BaseEvent {
  type: 'movement';
  payload: {
    unit: string;
    from_x: number;
    from_y: number;
    to_x: number;
    to_y: number;
  };
}

export interface DamageEvent extends BaseEvent {
  type: 'damage';
  payload: {
    target: string;
    damage: number;
    damage_type?: string;
    temp_hp_consumed?: number;
    new_hp: number;
  };
}

export interface EffectApplyEvent extends BaseEvent {
  type: 'effect_apply';
  payload: {
    effect_id: string;
    effect_kind: string;
    target: string;
  };
}

export interface ConditionChangeEvent extends BaseEvent {
  type: 'condition_change';
  payload: {
    unit: string;
    condition: string;
    old_value: number;
    new_value: number;
  };
}

export interface UnitDeathEvent extends BaseEvent {
  type: 'unit_death';
  payload: {
    unit: string;
  };
}

export interface TurnStartEvent extends BaseEvent {
  type: 'turn_start';
  payload: {
    unit: string;
    round: number;
  };
}

export interface BattleEndEvent extends BaseEvent {
  type: 'battle_end';
  payload: {
    result: 'victory' | 'defeat' | 'draw';
  };
}

export type GameEvent =
  | StrikeHitEvent
  | MovementEvent
  | DamageEvent
  | EffectApplyEvent
  | ConditionChangeEvent
  | UnitDeathEvent
  | TurnStartEvent
  | BattleEndEvent;
```

---

## Reducer Implementation Pattern

### Core Reducer (`src/engine/core/Reducer.ts`)

```typescript
import { BattleState } from './State';
import { Command } from './Commands';
import { GameEvent } from '../io/EventLog';

export interface ReductionResult {
  newState: BattleState;
  events: GameEvent[];
}

export class ReductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReductionError';
  }
}

/**
 * Main reducer function - processes a command and returns new state + events.
 * Pure function: does not mutate input state.
 */
export function reduceCommand(
  state: BattleState,
  command: Command
): ReductionResult {
  // Create event accumulator
  const events: GameEvent[] = [];

  // Validate actor is active
  assertActorTurn(state, command.actor);

  // Dispatch based on command type (exhaustive checking)
  switch (command.type) {
    case 'move':
      return reduceMoveCommand(state, command, events);
    case 'strike':
      return reduceStrikeCommand(state, command, events);
    case 'end_turn':
      return reduceEndTurnCommand(state, command, events);
    case 'cast_spell':
      return reduceCastSpellCommand(state, command, events);
    case 'use_feat':
      return reduceUseFeatCommand(state, command, events);
    // ... other command types
    default:
      // TypeScript will error if any command type is not handled
      const _exhaustive: never = command;
      throw new ReductionError(`Unknown command type: ${(command as any).type}`);
  }
}

function assertActorTurn(state: BattleState, actorId: string): void {
  const activeUnitId = state.turn_order[state.turn_index];
  if (activeUnitId !== actorId) {
    throw new ReductionError(
      `Actor ${actorId} is not active unit ${activeUnitId}`
    );
  }
}

/**
 * Immutable state update helper.
 * Uses structural sharing for performance.
 */
function updateState<K extends keyof BattleState>(
  state: BattleState,
  key: K,
  value: BattleState[K]
): BattleState {
  return { ...state, [key]: value };
}

function updateUnit(
  state: BattleState,
  unitId: string,
  updates: Partial<UnitState>
): BattleState {
  const unit = state.units[unitId];
  if (!unit) {
    throw new ReductionError(`Unit ${unitId} not found`);
  }

  return updateState(state, 'units', {
    ...state.units,
    [unitId]: { ...unit, ...updates },
  });
}

function appendEvent(
  events: GameEvent[],
  state: BattleState,
  type: GameEvent['type'],
  payload: Record<string, unknown>
): void {
  const newSeq = state.event_sequence + 1;
  events.push({
    event_id: `evt_${newSeq.toString().padStart(4, '0')}`,
    round: state.round_number,
    active_unit: state.turn_order[state.turn_index],
    type,
    payload,
  } as GameEvent);
}
```

### Example Command Reducer

```typescript
function reduceStrikeCommand(
  state: BattleState,
  command: StrikeCommand,
  events: GameEvent[]
): ReductionResult {
  const attacker = state.units[command.actor];
  const target = state.units[command.target];

  if (!attacker || !target) {
    throw new ReductionError('Invalid unit IDs');
  }

  if (!isUnitAlive(attacker) || !isUnitAlive(target)) {
    throw new ReductionError('Strike requires alive units');
  }

  // Check line of effect
  if (!hasLineOfEffect(state, attacker, target)) {
    throw new ReductionError('No line of effect to target');
  }

  // Calculate cover bonus
  const coverBonus = coverACBonusForUnits(state, attacker, target);
  const effectiveAC = target.ac + coverBonus;

  // Roll attack with RNG
  const rng = new DeterministicRNG(state.seed + state.event_sequence);
  const attackRoll = rng.d20();
  const totalAttack = attackRoll + attacker.attack_mod;

  // Resolve check
  const degree = resolveCheck(totalAttack, effectiveAC);

  // Append strike event
  appendEvent(events, state, 'strike_hit', {
    attacker: command.actor,
    target: command.target,
    roll: attackRoll,
    degree,
    cover_bonus: coverBonus,
  });

  // Apply damage on success/crit
  let newState = state;
  if (degree === 'success' || degree === 'critical_success') {
    const damageRoll = rollDamage(rng, attacker.damage);
    const finalDamage = degree === 'critical_success' ? damageRoll * 2 : damageRoll;

    const { newHP, tempHPConsumed } = applyDamageToPool(
      target.hp,
      target.temp_hp || 0,
      finalDamage,
      target.resistances || {},
      target.weaknesses || {},
      target.immunities || [],
      attacker.attack_damage_type,
      attacker.attack_damage_bypass || []
    );

    newState = updateUnit(newState, command.target, {
      hp: newHP,
      temp_hp: Math.max(0, (target.temp_hp || 0) - tempHPConsumed),
    });

    appendEvent(events, newState, 'damage', {
      target: command.target,
      damage: finalDamage,
      temp_hp_consumed: tempHPConsumed,
      new_hp: newHP,
    });

    // Check for death
    if (newHP <= 0) {
      appendEvent(events, newState, 'unit_death', {
        unit: command.target,
      });
    }
  }

  // Spend action
  newState = updateUnit(newState, command.actor, {
    actions_remaining: Math.max(0, attacker.actions_remaining! - 1),
  });

  // Increment event sequence
  newState = updateState(newState, 'event_sequence', state.event_sequence + events.length);

  return { newState, events };
}
```

---

## Grid Algorithm Patterns

### Line of Effect (`src/engine/grid/LOE.ts`)

```typescript
import { BattleState, Position, UnitState } from '../core/State';
import { inBounds, isBlocked } from './Map';
import { linePoints } from './Areas';

export type CoverGrade = 'none' | 'standard' | 'greater' | 'blocked';

/**
 * Bresenham line algorithm with diagonal corner pinch check.
 */
export function hasTileLineOfEffect(
  state: BattleState,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): boolean {
  if (!inBounds(state, sourceX, sourceY) || !inBounds(state, targetX, targetY)) {
    return false;
  }

  const path = linePoints(sourceX, sourceY, targetX, targetY);

  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i];
    const [prevX, prevY] = path[i - 1];

    const stepX = x - prevX;
    const stepY = y - prevY;

    // Check diagonal corner pinch
    if (Math.abs(stepX) === 1 && Math.abs(stepY) === 1) {
      const sideA: Position = [prevX + stepX, prevY];
      const sideB: Position = [prevX, prevY + stepY];

      const sideABlocked = inBounds(state, sideA[0], sideA[1]) && isBlocked(state, sideA[0], sideA[1]);
      const sideBBlocked = inBounds(state, sideB[0], sideB[1]) && isBlocked(state, sideB[0], sideB[1]);

      if (sideABlocked && sideBBlocked) {
        return false;
      }
    }

    // Allow targeting occupied endpoint
    if (i === path.length - 1) {
      return !isBlocked(state, x, y);
    }

    if (isBlocked(state, x, y)) {
      return false;
    }
  }

  return true;
}

export function coverGradeBetweenTiles(
  state: BattleState,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): CoverGrade {
  if (!hasTileLineOfEffect(state, sourceX, sourceY, targetX, targetY)) {
    return 'blocked';
  }

  const sx = Math.sign(sourceX - targetX);
  const sy = Math.sign(sourceY - targetY);

  if (sx === 0 && sy === 0) {
    return 'none';
  }

  // Check perpendicular tiles
  let candidates: Position[];
  if (sx === 0) {
    candidates = [[targetX - 1, targetY], [targetX + 1, targetY]];
  } else if (sy === 0) {
    candidates = [[targetX, targetY - 1], [targetX, targetY + 1]];
  } else {
    candidates = [[targetX + sx, targetY], [targetX, targetY + sy]];
  }

  const blockedCount = candidates.filter(
    ([x, y]) => inBounds(state, x, y) && isBlocked(state, x, y)
  ).length;

  if (blockedCount >= 2) return 'greater';
  if (blockedCount === 1) return 'standard';
  return 'none';
}

export function coverACBonusFromGrade(grade: CoverGrade): number {
  switch (grade) {
    case 'standard': return 2;
    case 'greater': return 4;
    default: return 0;
  }
}

export function hasLineOfEffect(
  state: BattleState,
  source: UnitState,
  target: UnitState
): boolean {
  if (!isUnitAlive(source) || !isUnitAlive(target)) {
    return false;
  }
  return hasTileLineOfEffect(state, source.x, source.y, target.x, target.y);
}

export function coverACBonusForUnits(
  state: BattleState,
  source: UnitState,
  target: UnitState
): number {
  if (!isUnitAlive(source) || !isUnitAlive(target)) {
    return 0;
  }
  const grade = coverGradeBetweenTiles(state, source.x, source.y, target.x, target.y);
  return coverACBonusFromGrade(grade);
}
```

---

## PixiJS Rendering Architecture

### Main PixiJS Application (`src/rendering/PixiApp.ts`)

```typescript
import * as PIXI from 'pixi.js';
import { BattleState } from '../engine/core/State';
import { TileRenderer } from './TileRenderer';
import { SpriteManager } from './SpriteManager';
import { EffectRenderer } from './EffectRenderer';
import { CameraController } from './CameraController';
import { InputHandler } from './InputHandler';

export class PixiApp {
  private app: PIXI.Application;
  private tileRenderer: TileRenderer;
  private spriteManager: SpriteManager;
  private effectRenderer: EffectRenderer;
  private cameraController: CameraController;
  private inputHandler: InputHandler;

  constructor(canvasElement: HTMLCanvasElement) {
    // Initialize PixiJS app with WebGL renderer
    this.app = new PIXI.Application({
      view: canvasElement,
      width: 600,
      height: 600,
      backgroundColor: 0x1a1a1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Create render layers
    this.tileRenderer = new TileRenderer(this.app);
    this.spriteManager = new SpriteManager(this.app);
    this.effectRenderer = new EffectRenderer(this.app);
    this.cameraController = new CameraController(this.app);
    this.inputHandler = new InputHandler(this.app, this.cameraController);

    // Set up ticker
    this.app.ticker.add(this.update.bind(this));
  }

  public renderBattle(state: BattleState): void {
    this.tileRenderer.render(state.battle_map);
    this.spriteManager.update(state.units);
    this.cameraController.focusOnActiveUnit(state);
  }

  public playAnimation(animation: Animation): void {
    this.effectRenderer.playAnimation(animation);
  }

  private update(delta: number): void {
    this.cameraController.update(delta);
    this.effectRenderer.update(delta);
  }

  public destroy(): void {
    this.app.destroy(true);
  }
}
```

### Sprite Manager (`src/rendering/SpriteManager.ts`)

```typescript
import * as PIXI from 'pixi.js';
import { UnitState } from '../engine/core/State';

export class SpriteManager {
  private container: PIXI.Container;
  private sprites: Map<string, PIXI.Sprite> = new Map();

  constructor(app: PIXI.Application) {
    this.container = new PIXI.Container();
    app.stage.addChild(this.container);
  }

  public update(units: Record<string, UnitState>): void {
    // Remove sprites for dead/missing units
    for (const [unitId, sprite] of this.sprites.entries()) {
      if (!units[unitId] || !units[unitId].hp > 0) {
        this.container.removeChild(sprite);
        this.sprites.delete(unitId);
      }
    }

    // Update or create sprites
    for (const unit of Object.values(units)) {
      if (unit.hp <= 0) continue;

      let sprite = this.sprites.get(unit.unit_id);
      if (!sprite) {
        sprite = this.createSprite(unit);
        this.sprites.set(unit.unit_id, sprite);
        this.container.addChild(sprite);
      }

      // Update position (tile to pixel conversion)
      sprite.x = unit.x * 64 + 32; // Center of tile
      sprite.y = unit.y * 64 + 32;

      // Update tint based on team
      sprite.tint = this.getTeamColor(unit.team);
    }
  }

  private createSprite(unit: UnitState): PIXI.Sprite {
    const texture = PIXI.Texture.from('units/' + this.getSpriteKey(unit));
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = 64;
    sprite.height = 64;
    return sprite;
  }

  private getSpriteKey(unit: UnitState): string {
    // Map unit IDs to sprite names
    if (unit.unit_id.includes('fighter')) return 'fighter';
    if (unit.unit_id.includes('kobold')) return 'kobold';
    return 'default';
  }

  private getTeamColor(team: string): number {
    switch (team) {
      case 'pc': return 0x4CAF50; // Green
      case 'enemy': return 0xF44336; // Red
      default: return 0xFFFFFF; // White
    }
  }
}
```

---

## React UI Patterns

### Main App Component (`src/ui/App.tsx`)

```tsx
import React, { useEffect, useRef } from 'react';
import { PixiApp } from '../rendering/PixiApp';
import { useGameStore } from '../store/gameStore';
import { PartyPanel } from './components/PartyPanel';
import { CombatLog } from './components/CombatLog';
import { ActionPanel } from './components/ActionPanel';
import './styles/global.css';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiAppRef = useRef<PixiApp | null>(null);

  const battle = useGameStore((state) => state.battle);

  // Initialize PixiJS app
  useEffect(() => {
    if (canvasRef.current && !pixiAppRef.current) {
      pixiAppRef.current = new PixiApp(canvasRef.current);
    }

    return () => {
      pixiAppRef.current?.destroy();
      pixiAppRef.current = null;
    };
  }, []);

  // Update PixiJS when battle state changes
  useEffect(() => {
    if (battle && pixiAppRef.current) {
      pixiAppRef.current.renderBattle(battle);
    }
  }, [battle]);

  return (
    <div className="app-container">
      <header className="header-bar">
        <div>Turn: {battle?.turn_order[battle.turn_index]}</div>
        <div>Round: {battle?.round_number}</div>
      </header>

      <div className="main-content">
        <div className="canvas-container">
          <canvas ref={canvasRef} />
        </div>

        <div className="ui-panel">
          <PartyPanel />
          <CombatLog />
          <ActionPanel />
        </div>
      </div>
    </div>
  );
}
```

### Party Panel with Transient Updates (`src/ui/components/PartyPanel.tsx`)

```tsx
import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTransientHPBar } from '../hooks/useTransientUpdate';

function UnitCard({ unitId }: { unitId: string }) {
  const unit = useGameStore((state) => state.battle?.units[unitId]);
  const hpBarRef = useTransientHPBar(unitId);

  if (!unit) return null;

  return (
    <div className="unit-card">
      <div className="unit-name">{unitId}</div>
      <div className="hp-bar-container">
        <div ref={hpBarRef} className="hp-bar-fill" />
      </div>
      <div className="unit-stats">
        HP: {unit.hp}/{unit.max_hp}
      </div>
      <div className="unit-stats">
        AC: {unit.ac} | ATK: +{unit.attack_mod}
      </div>
    </div>
  );
}

export function PartyPanel() {
  const units = useGameStore((state) => {
    const battle = state.battle;
    if (!battle) return [];
    return Object.values(battle.units).filter((u) => u.team === 'pc');
  });

  return (
    <div className="party-panel">
      <h2>Party</h2>
      {units.map((unit) => (
        <UnitCard key={unit.unit_id} unitId={unit.unit_id} />
      ))}
    </div>
  );
}
```

### Transient Update Hook (`src/ui/hooks/useTransientUpdate.ts`)

```typescript
import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';

/**
 * Hook for high-frequency DOM updates without React re-renders.
 * Uses Zustand's subscribe API to bypass React reconciliation.
 */
export function useTransientHPBar(unitId: string) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to HP changes
    const unsubscribe = useGameStore.subscribe(
      (state) => state.battle?.units[unitId]?.hp,
      (hp) => {
        if (barRef.current && hp !== undefined) {
          const maxHp = useGameStore.getState().battle?.units[unitId]?.max_hp || 1;
          const percent = Math.max(0, Math.min(100, (hp / maxHp) * 100));

          // Direct DOM manipulation - no React re-render
          barRef.current.style.width = `${percent}%`;

          // Optional: Add visual feedback
          if (percent < 25) {
            barRef.current.style.backgroundColor = '#f44336'; // Red
          } else if (percent < 50) {
            barRef.current.style.backgroundColor = '#ff9800'; // Orange
          } else {
            barRef.current.style.backgroundColor = '#4caf50'; // Green
          }
        }
      }
    );

    return unsubscribe;
  }, [unitId]);

  return barRef;
}
```

---

## Performance Optimization Patterns

### Object Pooling for Damage Numbers

```typescript
// src/rendering/EffectRenderer.ts
class DamageNumberPool {
  private pool: PIXI.BitmapText[] = [];
  private active: Set<PIXI.BitmapText> = new Set();

  constructor(private container: PIXI.Container) {}

  public spawn(damage: number, x: number, y: number): void {
    let text = this.pool.pop();
    if (!text) {
      text = new PIXI.BitmapText('', {
        fontName: 'DamageFont',
        fontSize: 24,
      });
    }

    text.text = damage.toString();
    text.x = x;
    text.y = y;
    text.alpha = 1;

    this.container.addChild(text);
    this.active.add(text);

    // Animate upward and fade
    this.animateDamageNumber(text);
  }

  private animateDamageNumber(text: PIXI.BitmapText): void {
    const startY = text.y;
    const duration = 1000; // 1 second
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);

      text.y = startY - progress * 50; // Move up 50px
      text.alpha = 1 - progress; // Fade out

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.recycle(text);
      }
    };

    animate();
  }

  private recycle(text: PIXI.BitmapText): void {
    this.container.removeChild(text);
    this.active.delete(text);
    this.pool.push(text);
  }
}
```

### Batch State Updates

```typescript
// src/store/gameStore.ts
export const useGameStore = create<GameStore>((set, get) => ({
  // ... state

  dispatchCommandBatch: (commands: Command[]) => {
    const { battle } = get();
    if (!battle) return;

    let currentState = battle;
    const allEvents: GameEvent[] = [];

    // Process all commands in one batch
    for (const command of commands) {
      const { newState, events } = reduceCommand(currentState, command);
      currentState = newState;
      allEvents.push(...events);
    }

    // Single React update for entire batch
    set({ battle: currentState });

    // Queue animations
    const animations = eventsToAnimations(allEvents);
    get().transient.animationQueue.push(...animations);
  },
}));
```

---

## Conclusion

This technical specification provides concrete TypeScript patterns for implementing the browser port. Key takeaways:

1. **Type Safety**: Use discriminated unions and readonly types for immutability
2. **Pure Functions**: Reducer pattern ensures deterministic behavior
3. **Separation of Concerns**: Engine, rendering, and UI are independent layers
4. **Performance**: Object pooling, transient updates, and batching prevent bottlenecks
5. **Maintainability**: Clear module boundaries and comprehensive types

These patterns should be applied consistently throughout the codebase to ensure a maintainable, performant browser game.
