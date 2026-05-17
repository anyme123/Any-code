import { Zap, Brain, Sparkles, Crown, Gauge, Wand2, Feather, ClipboardList } from "lucide-react";
import { ModelConfig, ThinkingModeConfig } from "./types";
import { getCachedModelNames } from "@/lib/modelNameParser";

/**
 * Default model display names (used when no cache is available).
 * Intentionally version-less so they never go stale.
 */
const DEFAULT_MODEL_NAMES: Record<string, string> = {
  sonnet: "Claude Sonnet 4.6",
  opus: "Claude Opus 4.7",
  haiku: "Claude Haiku 4.5",
};

/**
 * Get available models with dynamically updated display names.
 * Reads cached model names from localStorage (populated by stream init messages).
 * Falls back to version-less defaults if no cache exists yet.
 */
export function getModels(): ModelConfig[] {
  const cached = getCachedModelNames();
  const sonnetName = cached["sonnet"] || DEFAULT_MODEL_NAMES.sonnet;
  const opusName = cached["opus"] || DEFAULT_MODEL_NAMES.opus;
  const haikuName = cached["haiku"] || DEFAULT_MODEL_NAMES.haiku;
  const sonnet1mName = cached["sonnet"]
    ? `${cached["sonnet"]} 1M`
    : `${DEFAULT_MODEL_NAMES.sonnet} 1M`;
  const opus1mName = cached["opus"]
    ? `${cached["opus"]} 1M`
    : `${DEFAULT_MODEL_NAMES.opus} 1M`;

  return [
    {
      id: "default",
      name: "Claude Default",
      description: "Use Claude Code's recommended model for your account",
      icon: <Gauge className="h-4 w-4" />
    },
    {
      id: "best",
      name: "Claude Best",
      description: "Most capable available model, currently equivalent to Opus",
      icon: <Wand2 className="h-4 w-4" />
    },
    {
      id: "sonnet",
      name: sonnetName,
      description: "Fast and efficient for most coding tasks",
      icon: <Zap className="h-4 w-4" />
    },
    {
      id: "sonnet1m",
      name: sonnet1mName,
      description: "Sonnet with 1 million token context",
      icon: <Brain className="h-4 w-4" />
    },
    {
      id: "opus",
      name: opusName,
      description: "Most capable model with advanced reasoning & coding",
      icon: <Sparkles className="h-4 w-4" />
    },
    {
      id: "opus1m",
      name: opus1mName,
      description: "Opus with 1 million token context",
      icon: <Crown className="h-4 w-4" />
    },
    {
      id: "haiku",
      name: haikuName,
      description: "Fast and efficient for simple tasks",
      icon: <Feather className="h-4 w-4" />
    },
    {
      id: "opusplan",
      name: "Claude Opus Plan",
      description: "Opus for plan mode, Sonnet for execution",
      icon: <ClipboardList className="h-4 w-4" />
    }
  ];
}

/**
 * Static model list for backward compatibility.
 * Prefer using getModels() for dynamic names.
 */
export const MODELS: ModelConfig[] = getModels();

/**
 * Thinking modes configuration
 * Claude adaptive effort levels.
 * Controls effort via CLAUDE_CODE_EFFORT_LEVEL env var.
 *
 * Note: Names and descriptions are translation keys that will be resolved at runtime
 */
export const THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "off",
    name: "promptInput.thinkingModeOff",
    description: "promptInput.normalSpeed",
    level: 0,
  },
  {
    id: "adaptive",
    effort: "low",
    name: "promptInput.thinkingEffortLow",
    description: "promptInput.thinkingEffortLowDesc",
    level: 1,
  },
  {
    id: "adaptive",
    effort: "medium",
    name: "promptInput.thinkingEffortMedium",
    description: "promptInput.thinkingEffortMediumDesc",
    level: 2,
  },
  {
    id: "adaptive",
    effort: "high",
    name: "promptInput.thinkingEffortHigh",
    description: "promptInput.thinkingEffortHighDesc",
    level: 3,
  },
  {
    id: "adaptive",
    effort: "xhigh",
    name: "promptInput.thinkingEffortXHigh",
    description: "promptInput.thinkingEffortXHighDesc",
    level: 4,
  },
  {
    id: "adaptive",
    effort: "max",
    name: "promptInput.thinkingEffortMax",
    description: "promptInput.thinkingEffortMaxDesc",
    level: 5,
  }
];
