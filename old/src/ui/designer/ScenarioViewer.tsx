/**
 * Scenario Viewer - Main designer mode interface
 */

import { ScenarioFileBrowser } from "./ScenarioFileBrowser";
import { ScenarioInspector } from "./ScenarioInspector";
import { useDesignerStore } from "../../store/designerStore";

export function ScenarioViewer() {
  const scenarioData = useDesignerStore((s) => s.scenarioData);
  const tiledMapPath = useDesignerStore((s) => s.tiledMapPath);

  return (
    <div className="scenario-viewer">
      <div className="viewer-layout">
        {/* Left panel: File Browser */}
        <div className="viewer-browser">
          <ScenarioFileBrowser />
        </div>

        {/* Right panel: Inspector */}
        <div className="viewer-inspector">
          {scenarioData || tiledMapPath ? (
            <ScenarioInspector />
          ) : (
            <div className="inspector-empty">
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <h3>No Scenario Loaded</h3>
                <p>Select a scenario from the browser to get started</p>
                <div className="empty-hint">
                  <strong>Designer Tools - Quick Start:</strong>
                  <ul>
                    <li>Browse scenarios on the left</li>
                    <li>Click to load and inspect</li>
                    <li>Edit properties in the inspector</li>
                    <li>Preview changes in real-time</li>
                    <li>Export modified scenarios as JSON</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
