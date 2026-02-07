/**
 * Event log helpers and replay hash generation.
 * Mirrors engine/io/event_log.py
 *
 * Note: SHA-256 in browser uses SubtleCrypto (async). A sync fallback is
 * provided for determinism tests using a simple digest approach.
 */

export function canonicalEventLog(events: Record<string, unknown>[]): string {
  return JSON.stringify(events, Object.keys(events[0] ?? {}).sort(), undefined);
}

/** Canonical JSON serialization matching Python's sort_keys=True */
function sortedJson(obj: unknown): string {
  if (Array.isArray(obj)) {
    return "[" + obj.map(sortedJson).join(",") + "]";
  }
  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) =>
        JSON.stringify(k) +
        ":" +
        sortedJson((obj as Record<string, unknown>)[k]),
    );
    return "{" + pairs.join(",") + "}";
  }
  return JSON.stringify(obj);
}

export function canonicalEventLogSorted(
  events: Record<string, unknown>[],
): string {
  return sortedJson(events);
}

/** Async SHA-256 hash matching Python's hashlib.sha256 */
export async function replayHash(
  events: Record<string, unknown>[],
): Promise<string> {
  const payload = canonicalEventLogSorted(events);
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sync replay hash using a simpler approach (for testing/debug) */
export function replayHashSync(events: Record<string, unknown>[]): string {
  const payload = canonicalEventLogSorted(events);
  // Simple djb2-like hash for sync use — not crypto-grade
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash = hash >>> 0; // convert to unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}
