/**
 * Combat log panel — scrolling list of battle events.
 * Auto-scrolls to bottom on new events.
 */

import { useEffect, useRef } from "react";
import { useBattleStore } from "../store/battleStore";

function formatEvent(event: Record<string, unknown>): string {
  const type = String(event["type"] ?? "");
  const payload = (event["payload"] as Record<string, unknown>) ?? {};
  const round = event["round"] != null ? `R${event["round"]}` : "";
  const actor = String(event["active_unit"] ?? "");

  switch (type) {
    case "turn_start":
      return `${round} — ${actor}'s turn begins`;
    case "move": {
      const from = payload["from"] as number[] | undefined;
      const to = payload["to"] as number[] | undefined;
      return `${actor} moves (${from?.[0]},${from?.[1]}) → (${to?.[0]},${to?.[1]})`;
    }
    case "strike": {
      const target = String(payload["target"] ?? "");
      const degree = String(payload["degree"] ?? "");
      const damageInfo = (payload["damage"] as Record<string, unknown>) ?? {};
      const total = Number(damageInfo["total"] ?? 0);
      if (degree === "critical_failure" || degree === "failure") {
        return `${actor} misses ${target} (${degree})`;
      }
      return `${actor} strikes ${target} for ${total} dmg (${degree})`;
    }
    case "cast_spell": {
      const target = String(payload["target"] ?? "");
      const spell = String(payload["spell_id"] ?? "spell");
      return `${actor} casts ${spell} on ${target}`;
    }
    case "save_damage":
    case "area_save_damage": {
      const target = String(payload["target"] ?? "area");
      const damageInfo = (payload["damage"] as Record<string, unknown>) ?? {};
      const total = Number(damageInfo["total"] ?? 0);
      const degree = String(payload["roll"]?.["degree"] ?? "unknown");
      return `${target} takes ${total} dmg (${degree})`;
    }
    case "battle_end": {
      const winner = payload["winner_team"];
      const outcome = payload["outcome"];
      if (outcome) return `Battle ended: ${outcome}`;
      return winner ? `Battle ended — ${winner} wins!` : "Battle ended — draw";
    }
    case "end_turn":
      return `${actor} ends turn`;
    case "command_error":
      return `ERROR: ${String(payload["error"] ?? "unknown")}`;
    default:
      return `${type}${actor ? ` (${actor})` : ""}`;
  }
}

export function CombatLogPanel() {
  const eventLog = useBattleStore((s) => s.eventLog);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLog.length]);

  return (
    <div className="combat-log-panel">
      <h3>Combat Log</h3>
      <div className="log-entries">
        {eventLog.length === 0 ? (
          <div className="log-empty">Awaiting battle…</div>
        ) : (
          eventLog.map((event, idx) => (
            <div key={idx} className={`log-entry log-${String(event["type"] ?? "")}`}>
              {formatEvent(event)}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
