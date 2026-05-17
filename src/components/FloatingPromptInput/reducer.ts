import { ModelType, ThinkingMode, ThinkingEffort, ExecutionEngineConfig } from "./types";

export interface InputState {
  prompt: string;
  selectedModel: ModelType;
  selectedThinkingMode: ThinkingMode;
  selectedThinkingEffort?: ThinkingEffort;
  isExpanded: boolean;
  showCostPopover: boolean;
  cursorPosition: number;
  executionEngineConfig: ExecutionEngineConfig;
  enableProjectContext: boolean;
}

export type InputAction =
  | { type: "SET_PROMPT"; payload: string }
  | { type: "SET_MODEL"; payload: ModelType }
  | { type: "SET_THINKING_MODE"; payload: { mode: ThinkingMode; effort?: ThinkingEffort } }
  | { type: "SET_EXPANDED"; payload: boolean }
  | { type: "SET_SHOW_COST_POPOVER"; payload: boolean }
  | { type: "SET_CURSOR_POSITION"; payload: number }
  | { type: "SET_EXECUTION_ENGINE_CONFIG"; payload: ExecutionEngineConfig }
  | { type: "SET_ENABLE_PROJECT_CONTEXT"; payload: boolean }
  | { type: "RESET_INPUT" };

export const initialState: InputState = {
  prompt: "",
  selectedModel: "default",
  selectedThinkingMode: "off",
  selectedThinkingEffort: undefined,
  isExpanded: false,
  showCostPopover: false,
  cursorPosition: 0,
  executionEngineConfig: {
    engine: "claude",
    codexMode: "read-only",
    codexModel: "gpt-5.5",
    geminiModel: "auto-gemini-3",
  },
  enableProjectContext: false,
};

export function inputReducer(state: InputState, action: InputAction): InputState {
  switch (action.type) {
    case "SET_PROMPT":
      return { ...state, prompt: action.payload };
    case "SET_MODEL":
      return { ...state, selectedModel: action.payload };
    case "SET_THINKING_MODE":
      return { ...state, selectedThinkingMode: action.payload.mode, selectedThinkingEffort: action.payload.effort };
    case "SET_EXPANDED":
      return { ...state, isExpanded: action.payload };
    case "SET_SHOW_COST_POPOVER":
      return { ...state, showCostPopover: action.payload };
    case "SET_CURSOR_POSITION":
      return { ...state, cursorPosition: action.payload };
    case "SET_EXECUTION_ENGINE_CONFIG":
      return { ...state, executionEngineConfig: action.payload };
    case "SET_ENABLE_PROJECT_CONTEXT":
      return { ...state, enableProjectContext: action.payload };
    case "RESET_INPUT":
      return { ...state, prompt: "", isExpanded: false };
    default:
      return state;
  }
}