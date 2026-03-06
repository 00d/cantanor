/**
 * Camp screen — between-battle view during a campaign.
 * Shows party HP, "Rest at Camp" button, briefing/debriefing text, and "Continue" button.
 */

import type { CampaignDefinition, CampaignProgress, PartySnapshot } from "../campaign/campaignTypes";

interface Props {
  definition: CampaignDefinition;
  progress: CampaignProgress;
  onHealAtCamp: () => void;
  onContinue: () => void;
  onExitCampaign?: () => void;
}

export function CampScreen({ definition, progress, onHealAtCamp, onContinue, onExitCampaign }: Props) {
  const currentStage = definition.stages[progress.currentStageIndex];
  const prevStageIndex = progress.currentStageIndex > 0 ? progress.currentStageIndex - 1 : null;
  const prevStage = prevStageIndex !== null ? definition.stages[prevStageIndex] : null;
  const isFinalStage = progress.currentStageIndex >= definition.stages.length;
  const allHealed = progress.partyState.every(
    (s) => s.hp >= s.maxHp && Object.keys(s.persistentConditions).length === 0,
  );

  return (
    <div className="camp-screen">
      <h2 className="camp-title">Camp</h2>
      <p className="camp-subtitle">{definition.name}</p>

      {/* Previous stage debriefing */}
      {prevStage?.debriefing && (
        <div className="camp-text-block debriefing">
          <div className="camp-text-label">Debriefing</div>
          <p>{prevStage.debriefing}</p>
        </div>
      )}

      {/* Party status */}
      <div className="camp-party">
        <div className="camp-section-label">Party</div>
        {progress.partyState.length === 0 && (
          <div className="camp-empty">No party data</div>
        )}
        {progress.partyState.map((snap: PartySnapshot) => (
          <div key={snap.unitId} className="camp-unit">
            <span className="camp-unit-name">{snap.unitId}</span>
            <span className="camp-unit-hp">
              {snap.hp}/{snap.maxHp} HP
            </span>
            {Object.keys(snap.persistentConditions).length > 0 && (
              <span className="camp-conditions">
                {Object.entries(snap.persistentConditions).map(([c, v]) => (
                  <span key={c} className="condition-tag">{c}{v > 1 ? ` ${v}` : ""}</span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="camp-actions">
        <button
          className="camp-btn heal"
          onClick={onHealAtCamp}
          disabled={allHealed || progress.partyState.length === 0}
        >
          Rest at Camp (Full Heal)
        </button>

        {!isFinalStage && currentStage && (
          <>
            {currentStage.briefing && (
              <div className="camp-text-block briefing">
                <div className="camp-text-label">Next: {currentStage.name}</div>
                <p>{currentStage.briefing}</p>
              </div>
            )}
            <button className="camp-btn continue" onClick={onContinue}>
              Continue to {currentStage.name}
            </button>
          </>
        )}

        {isFinalStage && (
          <div className="camp-complete">
            <div>Campaign Complete!</div>
            {onExitCampaign && (
              <button className="camp-btn continue" onClick={onExitCampaign}>
                Return to Menu
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
