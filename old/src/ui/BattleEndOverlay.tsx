/**
 * Full-screen overlay shown when a battle concludes.
 * Displays victory / defeat heading, battle stats, and navigation buttons.
 */

import { useBattleStore } from "../store/battleStore";
import { unitAlive } from "../engine/state";

interface Props {
  onNewScenario: () => void;
}

export function BattleEndOverlay({ onNewScenario }: Props) {
  const battle = useBattleStore((s) => s.battle);
  const battleOutcome = useBattleStore((s) => s.battleOutcome);
  const eventLog = useBattleStore((s) => s.eventLog);
  const reloadLastBattle = useBattleStore((s) => s.reloadLastBattle);
  const campaignDefinition = useBattleStore((s) => s.campaignDefinition);
  const campaignProgress = useBattleStore((s) => s.campaignProgress);
  const advanceCampaignStage = useBattleStore((s) => s.advanceCampaignStage);
  const clearCampaign = useBattleStore((s) => s.clearCampaign);

  if (!battle) return null;

  const isVictory = battleOutcome === "victory";
  const isDraw = battleOutcome === "draw";

  const allUnits = Object.values(battle.units);
  const pcAlive = allUnits.filter((u) => u.team === "pc" && unitAlive(u)).length;
  const enemyAlive = allUnits.filter((u) => u.team !== "pc" && unitAlive(u)).length;
  const roundsPlayed = battle.roundNumber;
  const strikeEvents = eventLog.filter((e) => e["type"] === "strike").length;

  function heading() {
    if (isDraw) return "DRAW";
    return isVictory ? "VICTORY" : "DEFEAT";
  }

  function subheading() {
    if (isDraw) return "Both sides fell.";
    return isVictory ? "The enemies have been vanquished!" : "Your party has been defeated.";
  }

  return (
    <div className="battle-end-backdrop">
      <div className={`battle-end-card ${isVictory ? "victory" : isDraw ? "draw" : "defeat"}`}>
        <h1 className="battle-end-heading">{heading()}</h1>
        <p className="battle-end-subheading">{subheading()}</p>

        <div className="battle-end-stats">
          <div className="stat-row">
            <span className="stat-label">Rounds</span>
            <span className="stat-value">{roundsPlayed}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Strikes landed</span>
            <span className="stat-value">{strikeEvents}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">PCs standing</span>
            <span className="stat-value">{pcAlive}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Enemies remaining</span>
            <span className="stat-value">{enemyAlive}</span>
          </div>
        </div>

        <div className="battle-end-actions">
          {campaignDefinition && campaignProgress && isVictory ? (
            <>
              <button
                className="btn-play-again"
                onClick={advanceCampaignStage}
              >
                {campaignProgress.currentStageIndex < campaignDefinition.stages.length - 1
                  ? "Continue Campaign"
                  : "Campaign Complete!"}
              </button>
            </>
          ) : (
            <>
              {campaignDefinition && campaignProgress ? (
                <>
                  <button
                    className="btn-play-again"
                    onClick={() => {
                      // Retry the current campaign stage (re-applies party snapshot)
                      const store = useBattleStore.getState();
                      store.startCampaignStage(campaignProgress.currentStageIndex);
                    }}
                  >
                    Retry Stage
                  </button>
                  <button
                    className="btn-new-scenario"
                    onClick={() => {
                      clearCampaign();
                      onNewScenario();
                    }}
                  >
                    Abandon Campaign
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-play-again"
                    onClick={() => reloadLastBattle()}
                  >
                    Play Again
                  </button>
                  <button
                    className="btn-new-scenario"
                    onClick={onNewScenario}
                  >
                    New Scenario
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
