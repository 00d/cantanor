/**
 * Sprite sheet descriptor types for the animation system.
 *
 * Animation states map to battle events:
 *   idle   — default standing pose
 *   walk   — during move commands
 *   attack — during strike commands
 *   cast   — during spell commands
 *   hit    — when taking damage
 *   death  — when HP reaches 0
 */

/** Animation state names used by the sprite system. */
export type AnimationStateName = "idle" | "walk" | "attack" | "cast" | "hit" | "death";

/** Definition of a single animation sequence within a sprite sheet. */
export interface AnimationDef {
  /** Frame indices into the sprite sheet (left-to-right, top-to-bottom). */
  frames: number[];
  /** Playback speed (seconds per frame). */
  speed: number;
  /** Whether the animation loops (idle/walk) or plays once (attack/hit/death). */
  loop: boolean;
}

/**
 * JSON descriptor for a sprite sheet file.
 * Referenced by path in UnitState.spriteSheet.
 *
 * Example:
 * ```json
 * {
 *   "texture": "/sprites/warrior.png",
 *   "frameWidth": 32,
 *   "frameHeight": 32,
 *   "animations": {
 *     "idle":   { "frames": [0,1,2,3], "speed": 0.1, "loop": true },
 *     "attack": { "frames": [4,5,6,7], "speed": 0.2, "loop": false }
 *   }
 * }
 * ```
 */
export interface SpriteSheetDescriptor {
  /** Path to the texture image (relative to public root). */
  texture: string;
  /** Width of each frame in pixels. */
  frameWidth: number;
  /** Height of each frame in pixels. */
  frameHeight: number;
  /** Animation definitions keyed by state name. */
  animations: Partial<Record<AnimationStateName, AnimationDef>>;
}

/** Runtime state tracking for a playing animation. */
export interface AnimationState {
  /** Current animation name. */
  current: AnimationStateName;
  /** Current frame index within the animation's frames array. */
  frameIndex: number;
  /** Accumulated time since last frame advance (seconds). */
  elapsed: number;
  /** Whether the animation has completed (for non-looping animations). */
  finished: boolean;
}

/** A fully loaded sprite sheet with sliced frame textures. */
export interface LoadedSpriteSheet {
  /** The original descriptor. */
  descriptor: SpriteSheetDescriptor;
  /** Frame textures sliced from the sheet, indexed by frame number. */
  frames: unknown[]; // Texture[] — kept as unknown to avoid PixiJS import in type file
}
