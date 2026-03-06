# ADR-001: No Undo System

**Status:** Accepted

## Context

An earlier branch of this project (preserved under `old/` during the
reconciliation pass, then removed) implemented a working undo stack during its
"Phase 12 — Make It Feel Like A Game" polish pass. The implementation was
sound for that branch's feature set:

- Step-back within the current PC turn; `end_turn` committed and flushed the stack.
- Snapshots held `battle` **by reference** — safe because `applyCommand` deep-clones
  the entire state as its first statement, so the prev-state reference is never
  mutated. ~24 B per snapshot, not a full tree copy.
- RNG reconstructed on pop via `new DeterministicRNG(seed, skipCount)` — mulberry32
  can't seek backward, so reconstruction-from-seed is the only rewind path.
- `eventLog` sliced back to the snapshot length (not cleared — preserves the
  pre-undo log).
- Ctrl/Cmd+Z bound in `App.tsx`; an Undo button in `ActionPanel` showed stack depth.
- 13-test suite (`undo.test.ts`) proved the determinism roundtrip:
  `strike → undo → strike` produced bit-identical results.

The current branch independently implemented a reaction system
(`engine/reactions.ts`) for attack_of_opportunity and shield_block. This was
the right call for PF2e rules fidelity — reactions are core to the game system.

The two are architecturally incompatible.

## Decision

**This codebase will not implement an undo system.** The player cannot rewind
committed state.

The infrastructure that old's undo relied on (`loadGeneration` fence, RNG
reset-on-throw, `deepClone` first-statement, `DeterministicRNG` skipCount
constructor) is preserved because each piece is independently valuable. But
the undo stack, `undoGeneration` counter, `undo()` store action, Ctrl+Z binding,
and `undo.test.ts` are not part of this codebase and will not be added.

The gameplay mitigation is **two-stage commit** (see Alternatives below) —
giving the player complete tactical information *before* they spend an action,
rather than letting them take it back after.

## Rationale

Old's undo model depended on four invariants. Reactions break all four.

### 1. `dispatchCommand` is atomic

Old assumed: one PC command → one state delta → one snapshot. The snapshot is
captured at the top of `dispatchCommand`, and by the time the function returns,
the store's `battle` has advanced by exactly that command's effect.

Reactions make dispatch **multi-phase with interspersed async player input**:

```
PC dispatches Move
  → applyCommand applies Move        (RNG advances by N₁)
  → detectMoveReactions fires
  → AoO prompt queues
  → dispatchCommand RETURNS          ← snapshot push would happen here
  → [player deliberates on the prompt, unbounded time]
  → resolveReaction(true) called     ← separate store entry point
  → reaction_strike dispatched       (RNG advances by N₂)
  → Strike damage may trigger PC's Shield Block prompt
  → [another decision point]
  → resolveReaction(true) called
  → shield_block dispatched           (RNG advances by N₃)
  → _scheduleAiTurn finally fires
```

There is no single "before" to snapshot. By the time a Move's full
consequences have resolved, the RNG may have advanced by N₁, N₁+N₂, or
N₁+N₂+N₃ depending on player choices.

### 2. RNG callCount captured at push-time matches the pre-command state

`rngCallCountBefore` is captured at the **top** of `dispatchCommand`. But the
enemy's AoO rolls happen inside `resolveReaction()` — a **separate** store
entry point invoked seconds to minutes later. The captured count is stale by
the time the Move's full transaction completes.

You could push snapshots at each sub-step: one after the Move, one after each
reaction resolution. But then:

- "Undo" no longer means "take back my move." It means "rewind one micro-step,"
  which from the player's perspective is either confusing (why did my move
  come back but the enemy's reaction-spent flag stay?) or requires popping
  multiple frames with one keystroke (which means encoding transaction
  boundaries into the stack — see invariant 4).

### 3. Only the player advances state during their turn

Old gated undo-push on `!isAiTurn` — a clean binary: PC actions push, AI
actions don't. But attack_of_opportunity is an **enemy** action firing
**during the PC's turn**, triggered by a PC action. It's neither
clearly PC-originated (push) nor AI-originated (don't push).

Whatever gating rule you pick, some player will hit a case where undo does
the "wrong" thing — either restoring their move but leaving the enemy's AoO
damage on them (gating: push only on PC command), or restoring the AoO
but leaving them in the post-Move position (gating: push on every
engine-reducer call).

### 4. History is a stack, not a tree

```
Move ─► AoO prompt ─┬─ decline ─► (end, RNG = N₁)
                    └─ accept  ─► Strike ─► Shield Block prompt ─┬─ decline ─► (end, RNG = N₁+N₂)
                                                                 └─ accept  ─► (end, RNG = N₁+N₂+N₃)
```

Each prompt is a branch point. A linear undo stack cannot represent this
without encoding the decision sequence into each snapshot — at which point
you've reinvented event sourcing, and *that's a rearchitecture, not a port.*

## Consequences

### What we preserve from old's undo infrastructure

These are independently valuable and are being added (or kept) in this codebase:

| Piece | Why it stays |
|---|---|
| `deepClone` as `applyCommand`'s first statement | General immutability guarantee. Also enables a future event-sourced rewind if the rearchitecture is ever undertaken. |
| `DeterministicRNG(seed, skipCount)` constructor | Used by forecast dry-runs and replay tooling. The skip-count reconstruction was never undo-specific. |
| `loadGeneration` fence for deferred store writes | Prevents stale `setTimeout`/`rAF` callbacks from stomping fresh-battle state after Play Again. See `CLAUDE.md` Load-Bearing Invariants. |
| RNG reset-on-throw in `dispatchCommand`'s catch block | Ensures `rng.callCount` always matches the committed `battle`, even if a handler rolls then throws. Protects replay determinism. |
| `snapAllSprites()` | Fresh-load needs it too — sprites shouldn't tween from a stale position when a new battle loads. Just no undo-triggered calls. |

### What we give up

The player cannot see a dice result and then take the action back. In a
deterministic-seed game this has a silver lining: undo after seeing the roll
is reload-scumming by another name, and its absence preserves the integrity
of the seeded RNG.

### Gameplay mitigation: two-stage commit

**This is the substitute, and it's scoped as roadmap work** (see `ROADMAP.md`
Phase 15 — Preview & Confirm).

Instead of "commit, see result, rewind," the model is "preview, see forecast,
confirm." Concretely for Move:

1. Click Move → enter target mode (already exists)
2. Hover tile → path waypoints paint, ghost sprite appears at destination,
   **AoO threat markers** paint on every enemy whose reach the path passes through
3. Click tile → destination is **armed** (ghost stays placed); nothing dispatched
4. Esc / click elsewhere → dis-armed, ghost vanishes, zero action cost
5. Enter / re-click → `dispatchCommand` fires, action spent, reactions trigger

The ghost/arm state lives in `TargetMode`, which is already ephemeral UI
state. `detectMoveReactions()` runs inside `dispatchCommand`, so an
armed-but-cancelled move is **invisible to the engine** — no RNG advance,
no reaction queue, no snapshot needed.

| | Undo | Two-stage commit |
|---|---|---|
| RNG advances during preview? | Yes (Strike already rolled) | No (nothing dispatched) |
| Reactions fire during preview? | Yes | No |
| State snapshot needed? | Yes — full tree + `rngCallCount` | No — `TargetMode` is already ephemeral |
| Cascade problem? | Yes | No — nothing to cascade from |
| Player sees actual dice? | **Yes** (the problem) | **No** — sees forecast odds |

The last row is the trade-off: two-stage commit gives complete **tactical**
information (positioning, AoO threat, range, cover, expected-value damage
via `forecast.ts`) but preserves **outcome uncertainty** until commit. For
a deterministic tactics game, this is arguably the better design — the
player makes informed decisions without scumming the seed.

The AoO threat marker is the load-bearing part. Moving into reaction range
is the single most punishing mistake in PF2e, and the preview must surface
it. Computing the markers is cheap: run the existing `detectMoveReactions()`
against a **copy** of state with the ghost position substituted. No RNG,
no mutation.

## Alternatives considered

### Reaction-aware undo stack

Extend `UndoSnapshot` to include `pendingReaction` and `reactionQueue`; push a
frame at every `resolveReaction` call in addition to every `dispatchCommand`.

Rejected: the cascade problem (invariant 4) remains. Encoding transaction
boundaries into the stack requires knowing which frames "belong together" for
a single Ctrl+Z press, which means either:
- A "transaction open" marker frame — but cascades can nest (AoO → Shield Block),
  so you need a counter, not a marker
- Timestamp-based grouping — fragile, wrong if the player takes 5 minutes to
  answer a prompt

### Event-sourced rewind

Record every command + reaction decision in an append-only log. "Undo" replays
the log from the seed to (tip − 1). RNG position is never captured — it's
reconstructed by replay.

Rejected: correct but disproportionate. Requires rearchitecting the reducer's
single-command dispatch model around a replay loop, adding a command log
to the store, and making every reaction-prompt answer part of the logged
command stream. The current reducer is 2000+ lines; threading a replay
harness through it is a multi-week effort for a feature whose gameplay
value is largely covered by two-stage commit.

If playtesting shows forecast + two-stage commit is insufficient, this is
the path. The `deepClone`-on-entry invariant and the `DeterministicRNG`
skipCount constructor are both preserved specifically so this door stays open.

### Ironman-only design (accept the absence, no mitigation)

Just don't have undo and don't build a substitute. XCOM's default.

Rejected as a stopping point: without **some** preview of AoO threat, players
will repeatedly eat opportunity attacks they didn't see coming, which reads
as unfair rather than tactical. The forecast system already exists; extending
it to movement threat is cheap and closes the gap.
