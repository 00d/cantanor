/**
 * Runtime registry for effect handlers.
 * Mirrors engine/effects/registry.py
 */

import { Effect } from "./base";

export type EffectHandler = (effect: Effect) => Record<string, unknown>;

export class EffectRegistry {
  private handlers: Map<string, EffectHandler> = new Map();

  register(kind: string, handler: EffectHandler): void {
    this.handlers.set(kind, handler);
  }

  resolve(effect: Effect): Record<string, unknown> {
    const handler = this.handlers.get(effect.kind);
    if (!handler) {
      return {
        status: "noop",
        reason: `no handler for kind=${effect.kind}`,
      };
    }
    return handler(effect);
  }
}
