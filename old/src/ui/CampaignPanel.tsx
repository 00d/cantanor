/**
 * Campaign panel — shows stage list with locked/unlocked states.
 */

import type { CampaignDefinition, CampaignProgress } from "../campaign/campaignTypes";

interface Props {
  definition: CampaignDefinition;
  progress: CampaignProgress;
  onSelectStage: (stageIndex: number) => void;
}

export function CampaignPanel({ definition, progress, onSelectStage }: Props) {
  return (
    <div className="campaign-panel">
      <div className="campaign-header">
        <h3>{definition.name}</h3>
        <p className="campaign-description">{definition.description}</p>
      </div>
      <div className="campaign-stages">
        {definition.stages.map((stage, idx) => {
          const isCompleted = progress.completedStages.includes(stage.stageId);
          const isCurrent = idx === progress.currentStageIndex;
          const isLocked = idx > progress.currentStageIndex;
          return (
            <button
              key={stage.stageId}
              className={`campaign-stage-btn ${isCompleted ? "completed" : ""} ${isCurrent ? "current" : ""} ${isLocked ? "locked" : ""}`}
              disabled={isLocked}
              onClick={() => onSelectStage(idx)}
            >
              <span className="stage-number">{idx + 1}</span>
              <span className="stage-name">{stage.name}</span>
              {isCompleted && <span className="stage-check">✓</span>}
              {isLocked && <span className="stage-lock">🔒</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
