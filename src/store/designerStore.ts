/**
 * Designer mode state management - for scenario editing and authoring tools
 */

import { create } from "zustand";

export type DesignerMode = "browse" | "inspect" | "preview";

export interface ScenarioData {
  // Raw scenario JSON data
  battle_id: string;
  seed: number;
  engine_phase?: number;
  map: {
    width: number;
    height: number;
    blocked?: [number, number][];
  };
  units: Array<Record<string, unknown>>;
  commands: Array<Record<string, unknown>>;
  objectives?: Array<Record<string, unknown>>;
  flags?: Record<string, boolean>;
  content_packs?: string[];
  enemy_policy?: Record<string, unknown>;
  mission_events?: Array<Record<string, unknown>>;
  hazard_routines?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface DesignerStore {
  // Current mode
  mode: DesignerMode;
  setMode: (mode: DesignerMode) => void;

  // Scenario being edited
  scenarioPath: string | null;
  scenarioData: ScenarioData | null;
  hasUnsavedChanges: boolean;

  // Load scenario
  loadScenario: (path: string, data: ScenarioData) => void;

  // Load Tiled map (read-only in designer — editing happens in Tiled)
  tiledMapPath: string | null;
  setTiledMapPath: (path: string | null) => void;

  // Clear scenario
  clearScenario: () => void;

  // Update scenario properties
  updateBattleId: (battleId: string) => void;
  updateSeed: (seed: number) => void;
  updateMapSize: (width: number, height: number) => void;
  updateEnginePhase: (phase: number) => void;

  // Export
  getExportData: () => ScenarioData | null;
  markSaved: () => void;
}

export const useDesignerStore = create<DesignerStore>((set, get) => ({
  // Initial state
  mode: "browse",
  scenarioPath: null,
  scenarioData: null,
  tiledMapPath: null,
  hasUnsavedChanges: false,

  // Mode management
  setMode: (mode) => set({ mode }),

  // Load scenario
  loadScenario: (path, data) =>
    set({
      scenarioPath: path,
      scenarioData: data,
      tiledMapPath: null,
      hasUnsavedChanges: false,
      mode: "inspect",
    }),

  // Load Tiled map
  setTiledMapPath: (path) =>
    set({
      tiledMapPath: path,
      scenarioPath: null,
      scenarioData: null,
      hasUnsavedChanges: false,
      mode: path ? "inspect" : "browse",
    }),

  // Clear scenario
  clearScenario: () =>
    set({
      scenarioPath: null,
      scenarioData: null,
      tiledMapPath: null,
      hasUnsavedChanges: false,
      mode: "browse",
    }),

  // Update battle ID
  updateBattleId: (battleId) => {
    const { scenarioData } = get();
    if (!scenarioData) return;
    set({
      scenarioData: { ...scenarioData, battle_id: battleId },
      hasUnsavedChanges: true,
    });
  },

  // Update seed
  updateSeed: (seed) => {
    const { scenarioData } = get();
    if (!scenarioData) return;
    set({
      scenarioData: { ...scenarioData, seed },
      hasUnsavedChanges: true,
    });
  },

  // Update map size
  updateMapSize: (width, height) => {
    const { scenarioData } = get();
    if (!scenarioData) return;
    set({
      scenarioData: {
        ...scenarioData,
        map: {
          ...scenarioData.map,
          width,
          height,
        },
      },
      hasUnsavedChanges: true,
    });
  },

  // Update engine phase
  updateEnginePhase: (phase) => {
    const { scenarioData } = get();
    if (!scenarioData) return;
    set({
      scenarioData: { ...scenarioData, engine_phase: phase },
      hasUnsavedChanges: true,
    });
  },

  // Export
  getExportData: () => {
    const { scenarioData } = get();
    return scenarioData;
  },

  markSaved: () => set({ hasUnsavedChanges: false }),
}));
