/**
 * ExecutionEngineSelector Component
 *
 * Allows users to switch between Claude Code, Codex, and Gemini CLI execution engines
 * with appropriate configuration options for each.
 */

import React, { useState } from 'react';
import { Settings, Zap, Check, Monitor, Terminal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { relaunchApp } from '@/lib/updater';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { useEngineStatus } from '@/hooks/useEngineStatus';
import type { CodexExecutionMode } from '@/types/codex';

// ============================================================================
// Type Definitions
// ============================================================================

export type ExecutionEngine = 'claude' | 'codex' | 'gemini';
export type CodexRuntimeMode = 'auto' | 'native' | 'wsl';
export type ClaudeRuntimeMode = 'auto' | 'native' | 'wsl';

export interface ExecutionEngineConfig {
  engine: ExecutionEngine;
  // Claude-specific config
  claudeFastMode?: boolean;
  // Codex-specific config
  codexMode?: CodexExecutionMode;
  codexModel?: string;
  codexApiKey?: string;
  codexFastMode?: boolean;
  /** Codex reasoning effort level: minimal, low, medium, high, xhigh */
  codexReasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  // Gemini-specific config
  geminiModel?: string;
  geminiApprovalMode?: 'auto_edit' | 'yolo' | 'default';
}

interface CodexModeConfig {
  mode: CodexRuntimeMode;
  wslDistro: string | null;
  actualMode: 'native' | 'wsl';
  nativeAvailable: boolean;
  wslAvailable: boolean;
  availableDistros: string[];
  isWindows: boolean;
}

// Gemini WSL mode configuration (similar to Codex)
export type GeminiRuntimeMode = 'auto' | 'native' | 'wsl';

interface GeminiWslModeConfig {
  mode: GeminiRuntimeMode;
  wslDistro: string | null;
  wslAvailable: boolean;
  availableDistros: string[];
  wslEnabled: boolean;
  wslGeminiPath: string | null;
  wslGeminiVersion: string | null;
  nativeAvailable: boolean;
  isWindows: boolean;
}

// Claude WSL mode configuration
interface ClaudeWslModeConfig {
  mode: ClaudeRuntimeMode;
  wslDistro: string | null;
  wslAvailable: boolean;
  availableDistros: string[];
  wslEnabled: boolean;
  wslClaudePath: string | null;
  wslClaudeVersion: string | null;
  nativeAvailable: boolean;
  actualMode: 'native' | 'wsl';
  isWindows: boolean;
}

interface ExecutionEngineSelectorProps {
  value: ExecutionEngineConfig;
  onChange: (config: ExecutionEngineConfig) => void;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export const ExecutionEngineSelector: React.FC<ExecutionEngineSelectorProps> = ({
  value,
  onChange,
  className = '',
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // 使用全局缓存的引擎状态（包括模式配置）
  const {
    codexAvailable,
    codexVersion,
    geminiInstalled: geminiAvailable,
    geminiVersion,
    claudeInstalled,
    claudeVersion,
    codexModeConfig: cachedCodexModeConfig,
    geminiWslModeConfig: cachedGeminiWslModeConfig,
    claudeWslModeConfig: cachedClaudeWslModeConfig,
  } = useEngineStatus();

  // 本地状态用于跟踪用户修改（保存后立即更新 UI）
  const [localCodexModeConfig, setLocalCodexModeConfig] = useState<CodexModeConfig | null>(null);
  const [localGeminiWslModeConfig, setLocalGeminiWslModeConfig] = useState<GeminiWslModeConfig | null>(null);
  const [localClaudeWslModeConfig, setLocalClaudeWslModeConfig] = useState<ClaudeWslModeConfig | null>(null);

  // 使用本地修改的值，如果没有则使用缓存的值
  const codexModeConfig: CodexModeConfig | null = localCodexModeConfig || cachedCodexModeConfig || null;
  const geminiWslModeConfig: GeminiWslModeConfig | null = localGeminiWslModeConfig || cachedGeminiWslModeConfig || null;
  const claudeWslModeConfig: ClaudeWslModeConfig | null = localClaudeWslModeConfig || cachedClaudeWslModeConfig || null;

  const handleCodexRuntimeModeChange = async (mode: CodexRuntimeMode) => {
    if (!codexModeConfig) return;

    setSavingConfig(true);
    try {
      await api.setCodexModeConfig(mode, codexModeConfig.wslDistro);
      setLocalCodexModeConfig({ ...codexModeConfig, mode });
      // 使用 Tauri 原生对话框询问用户是否重启
      const shouldRestart = await ask('配置已保存。是否立即重启应用以使更改生效？', {
        title: '重启应用',
        kind: 'info',
        okLabel: '立即重启',
        cancelLabel: '稍后重启',
      });
      if (shouldRestart) {
        try {
          await relaunchApp();
        } catch (restartError) {
          console.error('[ExecutionEngineSelector] Failed to restart:', restartError);
          await message('配置已保存，但自动重启失败。请手动重启应用以使更改生效。', {
            title: '提示',
            kind: 'warning',
          });
        }
      }
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to save Codex mode config:', error);
      await message('保存配置失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleWslDistroChange = async (distro: string) => {
    if (!codexModeConfig) return;

    const newDistro = distro === '__default__' ? null : distro;
    setSavingConfig(true);
    try {
      await api.setCodexModeConfig(codexModeConfig.mode, newDistro);
      setLocalCodexModeConfig({ ...codexModeConfig, wslDistro: newDistro });
      // 使用 Tauri 原生对话框询问用户是否重启
      const shouldRestart = await ask('配置已保存。是否立即重启应用以使更改生效？', {
        title: '重启应用',
        kind: 'info',
        okLabel: '立即重启',
        cancelLabel: '稍后重启',
      });
      if (shouldRestart) {
        try {
          await relaunchApp();
        } catch (restartError) {
          console.error('[ExecutionEngineSelector] Failed to restart:', restartError);
          await message('配置已保存，但自动重启失败。请手动重启应用以使更改生效。', {
            title: '提示',
            kind: 'warning',
          });
        }
      }
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to save WSL distro:', error);
      await message('保存配置失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleGeminiRuntimeModeChange = async (mode: GeminiRuntimeMode) => {
    if (!geminiWslModeConfig) return;

    setSavingConfig(true);
    try {
      await api.setGeminiWslModeConfig(mode, geminiWslModeConfig.wslDistro);
      setLocalGeminiWslModeConfig({ ...geminiWslModeConfig, mode });
      // 使用 Tauri 原生对话框询问用户是否重启
      const shouldRestart = await ask('配置已保存。是否立即重启应用以使更改生效？', {
        title: '重启应用',
        kind: 'info',
        okLabel: '立即重启',
        cancelLabel: '稍后重启',
      });
      if (shouldRestart) {
        try {
          await relaunchApp();
        } catch (restartError) {
          console.error('[ExecutionEngineSelector] Failed to restart:', restartError);
          await message('配置已保存，但自动重启失败。请手动重启应用以使更改生效。', {
            title: '提示',
            kind: 'warning',
          });
        }
      }
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to save Gemini WSL mode config:', error);
      await message('保存配置失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleGeminiWslDistroChange = async (distro: string) => {
    if (!geminiWslModeConfig) return;

    const newDistro = distro === '__default__' ? null : distro;
    setSavingConfig(true);
    try {
      await api.setGeminiWslModeConfig(geminiWslModeConfig.mode, newDistro);
      setLocalGeminiWslModeConfig({ ...geminiWslModeConfig, wslDistro: newDistro });
      // 使用 Tauri 原生对话框询问用户是否重启
      const shouldRestart = await ask('配置已保存。是否立即重启应用以使更改生效？', {
        title: '重启应用',
        kind: 'info',
        okLabel: '立即重启',
        cancelLabel: '稍后重启',
      });
      if (shouldRestart) {
        try {
          await relaunchApp();
        } catch (restartError) {
          console.error('[ExecutionEngineSelector] Failed to restart:', restartError);
          await message('配置已保存，但自动重启失败。请手动重启应用以使更改生效。', {
            title: '提示',
            kind: 'warning',
          });
        }
      }
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to save Gemini WSL distro:', error);
      await message('保存配置失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleClaudeRuntimeModeChange = async (mode: ClaudeRuntimeMode) => {
    if (!claudeWslModeConfig) return;

    setSavingConfig(true);
    try {
      await api.setClaudeWslModeConfig(mode, claudeWslModeConfig.wslDistro);
      setLocalClaudeWslModeConfig({ ...claudeWslModeConfig, mode });
      // 使用 Tauri 原生对话框询问用户是否重启
      const shouldRestart = await ask('配置已保存。是否立即重启应用以使更改生效？', {
        title: '重启应用',
        kind: 'info',
        okLabel: '立即重启',
        cancelLabel: '稍后重启',
      });
      if (shouldRestart) {
        try {
          await relaunchApp();
        } catch (restartError) {
          console.error('[ExecutionEngineSelector] Failed to restart:', restartError);
          await message('配置已保存，但自动重启失败。请手动重启应用以使更改生效。', {
            title: '提示',
            kind: 'warning',
          });
        }
      }
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to save Claude WSL mode config:', error);
      await message('保存配置失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleClaudeWslDistroChange = async (distro: string) => {
    if (!claudeWslModeConfig) return;

    const newDistro = distro === '__default__' ? null : distro;
    setSavingConfig(true);
    try {
      await api.setClaudeWslModeConfig(claudeWslModeConfig.mode, newDistro);
      setLocalClaudeWslModeConfig({ ...claudeWslModeConfig, wslDistro: newDistro });
      // 使用 Tauri 原生对话框询问用户是否重启
      const shouldRestart = await ask('配置已保存。是否立即重启应用以使更改生效？', {
        title: '重启应用',
        kind: 'info',
        okLabel: '立即重启',
        cancelLabel: '稍后重启',
      });
      if (shouldRestart) {
        try {
          await relaunchApp();
        } catch (restartError) {
          console.error('[ExecutionEngineSelector] Failed to restart:', restartError);
          await message('配置已保存，但自动重启失败。请手动重启应用以使更改生效。', {
            title: '提示',
            kind: 'warning',
          });
        }
      }
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to save Claude WSL distro:', error);
      await message('保存配置失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleEngineChange = (engine: ExecutionEngine) => {
    if (engine === 'codex' && !codexAvailable) {
      alert('Codex CLI 未安装或不可用。请先安装 Codex CLI。');
      return;
    }

    if (engine === 'gemini' && !geminiAvailable) {
      alert('Gemini CLI 未安装或不可用。请运行 npm install -g @google/gemini-cli 安装。');
      return;
    }

    onChange({
      ...value,
      engine,
    });
  };

  const handleCodexModeChange = (mode: CodexExecutionMode) => {
    onChange({
      ...value,
      codexMode: mode,
    });
  };

  const handleClaudeFastModeChange = async (enabled: boolean) => {
    onChange({
      ...value,
      claudeFastMode: enabled,
    });
    try {
      await api.updateClaudeFastMode(enabled);
    } catch (error) {
      console.error('[ExecutionEngineSelector] Failed to persist Claude fast mode:', error);
      await message('保存 Claude Fast 模式失败: ' + (error instanceof Error ? error.message : String(error)), {
        title: '错误',
        kind: 'error',
      });
    }
  };

  const handleCodexFastModeChange = (enabled: boolean) => {
    onChange({
      ...value,
      codexFastMode: enabled,
    });
  };

  const handleGeminiApprovalModeChange = (mode: 'auto_edit' | 'yolo' | 'default') => {
    onChange({
      ...value,
      geminiApprovalMode: mode,
    });
  };

  // Get display name for current engine
  const getEngineDisplayName = () => {
    switch (value.engine) {
      case 'claude':
        return 'Claude Code';
      case 'codex':
        return 'Codex';
      case 'gemini':
        return 'Gemini';
      default:
        return 'Claude Code';
    }
  };

  return (
    <Popover
      open={showSettings}
      onOpenChange={setShowSettings}
      trigger={
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={showSettings}
          className={`h-8 justify-between border-border/50 bg-background/50 hover:bg-accent/50 ${className}`}
        >
          <div className="flex items-center gap-2">
            {value.engine === 'gemini' ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            <span>{getEngineDisplayName()}</span>
            {value.engine === 'codex' && value.codexMode && (
              <span className="text-xs text-muted-foreground">
                ({value.codexMode === 'read-only' ? '只读' : value.codexMode === 'full-auto' ? '编辑' : '完全访问'})
              </span>
            )}
            {((value.engine === 'claude' && value.claudeFastMode) || (value.engine === 'codex' && value.codexFastMode)) && (
              <span className="text-xs text-amber-600 dark:text-amber-400">Fast</span>
            )}
            {value.engine === 'gemini' && value.geminiApprovalMode && (
              <span className="text-xs text-muted-foreground">
                ({value.geminiApprovalMode === 'yolo' ? 'YOLO' : value.geminiApprovalMode === 'auto_edit' ? '自动编辑' : '默认'})
              </span>
            )}
          </div>
          <Settings className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      }
      content={
        <div className="space-y-4 p-4">
          {/* Engine Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">执行引擎</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={value.engine === 'claude' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => handleEngineChange('claude')}
              >
                <Check className={`mr-2 h-4 w-4 ${value.engine === 'claude' ? 'opacity-100' : 'opacity-0'}`} />
                Claude
              </Button>
              <Button
                variant={value.engine === 'codex' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => handleEngineChange('codex')}
                disabled={!codexAvailable}
              >
                <Check className={`mr-2 h-4 w-4 ${value.engine === 'codex' ? 'opacity-100' : 'opacity-0'}`} />
                Codex
              </Button>
              <Button
                variant={value.engine === 'gemini' ? 'default' : 'outline'}
                className="justify-start"
                onClick={() => handleEngineChange('gemini')}
                disabled={!geminiAvailable}
              >
                <Check className={`mr-2 h-4 w-4 ${value.engine === 'gemini' ? 'opacity-100' : 'opacity-0'}`} />
                Gemini
              </Button>
            </div>
          </div>

          {/* Claude-specific settings */}
          {value.engine === 'claude' && (
            <>
              <div className="h-px bg-border" />

              <label className="flex items-center justify-between gap-4 rounded-md border p-3 cursor-pointer">
                <div className="space-y-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Fast 模式
                  </div>
                  <p className="text-xs text-muted-foreground">
                    开启 Claude Opus fast mode，并优先使用 Opus 4.7 fast 配置。
                  </p>
                </div>
                <Switch
                  checked={!!value.claudeFastMode}
                  onCheckedChange={handleClaudeFastModeChange}
                />
              </label>
            </>
          )}

          {/* Codex-specific settings */}
          {value.engine === 'codex' && (
            <>
              <div className="h-px bg-border" />

              {/* Execution Mode */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">执行模式</Label>
                <Select
                  value={value.codexMode || 'read-only'}
                  onValueChange={(v) => handleCodexModeChange(v as CodexExecutionMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read-only">
                      <div>
                        <div className="font-medium">只读模式</div>
                        <div className="text-xs text-muted-foreground">安全模式，只能读取文件</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="full-auto">
                      <div>
                        <div className="font-medium">编辑模式</div>
                        <div className="text-xs text-muted-foreground">允许编辑文件</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="danger-full-access">
                      <div>
                        <div className="font-medium text-destructive">完全访问模式</div>
                        <div className="text-xs text-muted-foreground">⚠️ 允许网络访问</div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Fast Mode */}
              <label className="flex items-center justify-between gap-4 rounded-md border p-3 cursor-pointer">
                <div className="space-y-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Fast 模式
                  </div>
                  <p className="text-xs text-muted-foreground">
                    使用 Codex service_tier=fast；仅 GPT-5.5/GPT-5.4 支持。
                  </p>
                </div>
                <Switch
                  checked={!!value.codexFastMode}
                  onCheckedChange={handleCodexFastModeChange}
                />
              </label>

              {/* Status */}
              <div className="rounded-md border p-2 bg-muted/50">
                <div className="flex items-center gap-2 text-xs">
                  <div className={`h-2 w-2 rounded-full ${codexAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{codexAvailable ? '已安装' : '未安装'}</span>
                  {codexVersion && <span className="text-muted-foreground">• {codexVersion}</span>}
                </div>
              </div>

              {/* WSL Mode Configuration (Windows only) */}
              {codexModeConfig && (codexModeConfig.nativeAvailable || codexModeConfig.wslAvailable) && (
                <>
                  <div className="h-px bg-border" />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      运行环境
                    </Label>
                    <Select
                      value={codexModeConfig.mode}
                      onValueChange={(v) => handleCodexRuntimeModeChange(v as CodexRuntimeMode)}
                      disabled={savingConfig}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {codexModeConfig.isWindows && (
                          <SelectItem value="auto">
                            <div>
                              <div className="font-medium">自动检测</div>
                              <div className="text-xs text-muted-foreground">原生优先，WSL 后备</div>
                            </div>
                          </SelectItem>
                        )}
                        <SelectItem value="native" disabled={!codexModeConfig.nativeAvailable}>
                          <div className="flex items-center gap-2">
                            <Monitor className="h-3 w-3" />
                            <div>
                              <div className="font-medium">{codexModeConfig.isWindows ? 'Windows 原生' : 'Linux 原生'}</div>
                              <div className="text-xs text-muted-foreground">
                                {codexModeConfig.nativeAvailable ? (codexModeConfig.isWindows ? '使用 Windows 版 Codex' : '使用本机 Codex') : '未安装'}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                        {codexModeConfig.isWindows && (
                          <SelectItem value="wsl" disabled={!codexModeConfig.wslAvailable}>
                            <div className="flex items-center gap-2">
                              <Terminal className="h-3 w-3" />
                              <div>
                                <div className="font-medium">WSL</div>
                                <div className="text-xs text-muted-foreground">
                                  {codexModeConfig.wslAvailable ? '使用 WSL 中的 Codex' : '未安装'}
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* WSL Distro Selection (Windows only) */}
                  {codexModeConfig.isWindows && codexModeConfig.mode === 'wsl' && codexModeConfig.availableDistros.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">WSL 发行版</Label>
                      <Select
                        value={codexModeConfig.wslDistro || '__default__'}
                        onValueChange={handleWslDistroChange}
                        disabled={savingConfig}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            <div className="text-muted-foreground">默认（自动选择）</div>
                          </SelectItem>
                          {codexModeConfig.availableDistros.map((distro) => (
                            <SelectItem key={distro} value={distro}>
                              {distro}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Current Runtime Status */}
                  <div className="rounded-md border p-2 bg-muted/30 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">当前运行环境:</span>
                      <span className="font-medium">
                        {codexModeConfig.actualMode === 'wsl' ? (
                          <span className="flex items-center gap-1">
                            <Terminal className="h-3 w-3" />
                            WSL
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Monitor className="h-3 w-3" />
                            {codexModeConfig.isWindows ? 'Windows 原生' : 'Linux 原生'}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Gemini-specific settings */}
          {value.engine === 'gemini' && (
            <>
              <div className="h-px bg-border" />

              {/* Approval Mode */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">审批模式</Label>
                <Select
                  value={value.geminiApprovalMode || 'auto_edit'}
                  onValueChange={(v) => handleGeminiApprovalModeChange(v as 'auto_edit' | 'yolo' | 'default')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      <div>
                        <div className="font-medium">默认</div>
                        <div className="text-xs text-muted-foreground">每次操作需确认</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="auto_edit">
                      <div>
                        <div className="font-medium">自动编辑</div>
                        <div className="text-xs text-muted-foreground">自动批准文件编辑</div>
                      </div>
                    </SelectItem>
                    <SelectItem value="yolo">
                      <div>
                        <div className="font-medium text-destructive">YOLO 模式</div>
                        <div className="text-xs text-muted-foreground">⚠️ 自动批准所有操作</div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status */}
              <div className="rounded-md border p-2 bg-muted/50">
                <div className="flex items-center gap-2 text-xs">
                  <Sparkles className="h-3 w-3" />
                  <div className={`h-2 w-2 rounded-full ${geminiAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{geminiAvailable ? '已安装' : '未安装'}</span>
                  {geminiVersion && <span className="text-muted-foreground">• {geminiVersion}</span>}
                </div>
              </div>

              {/* WSL Mode Configuration (Windows only) */}
              {geminiWslModeConfig && (geminiWslModeConfig.nativeAvailable || geminiWslModeConfig.wslAvailable) && (
                <>
                  <div className="h-px bg-border" />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      运行环境
                    </Label>
                    <Select
                      value={geminiWslModeConfig.isWindows ? geminiWslModeConfig.mode : 'native'}
                      onValueChange={(v) => handleGeminiRuntimeModeChange(v as GeminiRuntimeMode)}
                      disabled={savingConfig}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {geminiWslModeConfig.isWindows && (
                          <SelectItem value="auto">
                            <div>
                              <div className="font-medium">自动检测</div>
                              <div className="text-xs text-muted-foreground">原生优先，WSL 后备</div>
                            </div>
                          </SelectItem>
                        )}
                        <SelectItem value="native" disabled={!geminiWslModeConfig.nativeAvailable}>
                          <div className="flex items-center gap-2">
                            <Monitor className="h-3 w-3" />
                            <div>
                              <div className="font-medium">{geminiWslModeConfig.isWindows ? 'Windows 原生' : 'Linux 原生'}</div>
                              <div className="text-xs text-muted-foreground">
                                {geminiWslModeConfig.nativeAvailable ? (geminiWslModeConfig.isWindows ? '使用 Windows 版 Gemini' : '使用本机 Gemini') : '未安装'}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                        {geminiWslModeConfig.isWindows && (
                          <SelectItem value="wsl" disabled={!geminiWslModeConfig.wslAvailable}>
                            <div className="flex items-center gap-2">
                              <Terminal className="h-3 w-3" />
                              <div>
                                <div className="font-medium">WSL</div>
                                <div className="text-xs text-muted-foreground">
                                  {geminiWslModeConfig.wslAvailable ? '使用 WSL 中的 Gemini' : '未安装'}
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* WSL Distro Selection (Windows only) */}
                  {geminiWslModeConfig.isWindows && geminiWslModeConfig.mode === 'wsl' && geminiWslModeConfig.availableDistros.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">WSL 发行版</Label>
                      <Select
                        value={geminiWslModeConfig.wslDistro || '__default__'}
                        onValueChange={handleGeminiWslDistroChange}
                        disabled={savingConfig}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            <div className="text-muted-foreground">默认（自动选择）</div>
                          </SelectItem>
                          {geminiWslModeConfig.availableDistros.map((distro) => (
                            <SelectItem key={distro} value={distro}>
                              {distro}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Current Runtime Status */}
                  <div className="rounded-md border p-2 bg-muted/30 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">当前运行环境:</span>
                      <span className="font-medium">
                        {geminiWslModeConfig.wslEnabled ? (
                          <span className="flex items-center gap-1">
                            <Terminal className="h-3 w-3" />
                            WSL
                            {geminiWslModeConfig.wslGeminiVersion && (
                              <span className="text-muted-foreground ml-1">({geminiWslModeConfig.wslGeminiVersion})</span>
                            )}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Monitor className="h-3 w-3" />
                            {geminiWslModeConfig.isWindows ? 'Windows 原生' : 'Linux 原生'}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Claude-specific settings */}
          {value.engine === 'claude' && (
            <>
              {/* Status */}
              <div className="rounded-md border p-2 bg-muted/50">
                <div className="flex items-center gap-2 text-xs">
                  <Zap className="h-3 w-3" />
                  <div className={`h-2 w-2 rounded-full ${claudeInstalled ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span>{claudeInstalled ? '已安装' : '未安装'}</span>
                  {claudeVersion && <span className="text-muted-foreground">• {claudeVersion}</span>}
                </div>
              </div>

              {/* WSL Mode Configuration (Windows only) */}
              {claudeWslModeConfig && (claudeWslModeConfig.nativeAvailable || claudeWslModeConfig.wslAvailable) && (
                <>
                  <div className="h-px bg-border" />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      运行环境
                    </Label>
                    <Select
                      value={claudeWslModeConfig.isWindows ? claudeWslModeConfig.mode : 'native'}
                      onValueChange={(v) => handleClaudeRuntimeModeChange(v as ClaudeRuntimeMode)}
                      disabled={savingConfig}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {claudeWslModeConfig.isWindows && (
                          <SelectItem value="auto">
                            <div>
                              <div className="font-medium">自动检测</div>
                              <div className="text-xs text-muted-foreground">原生优先，WSL 后备</div>
                            </div>
                          </SelectItem>
                        )}
                        <SelectItem value="native" disabled={!claudeWslModeConfig.nativeAvailable}>
                          <div className="flex items-center gap-2">
                            <Monitor className="h-3 w-3" />
                            <div>
                              <div className="font-medium">{claudeWslModeConfig.isWindows ? 'Windows 原生' : 'Linux 原生'}</div>
                              <div className="text-xs text-muted-foreground">
                                {claudeWslModeConfig.nativeAvailable ? (claudeWslModeConfig.isWindows ? '使用 Windows 版 Claude' : '使用本机 Claude') : '未安装'}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                        {claudeWslModeConfig.isWindows && (
                          <SelectItem value="wsl" disabled={!claudeWslModeConfig.wslAvailable}>
                            <div className="flex items-center gap-2">
                              <Terminal className="h-3 w-3" />
                              <div>
                                <div className="font-medium">WSL</div>
                                <div className="text-xs text-muted-foreground">
                                  {claudeWslModeConfig.wslAvailable ? '使用 WSL 中的 Claude' : '未安装'}
                                </div>
                              </div>
                            </div>
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* WSL Distro Selection (Windows only) */}
                  {claudeWslModeConfig.isWindows && claudeWslModeConfig.mode === 'wsl' && claudeWslModeConfig.availableDistros.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">WSL 发行版</Label>
                      <Select
                        value={claudeWslModeConfig.wslDistro || '__default__'}
                        onValueChange={handleClaudeWslDistroChange}
                        disabled={savingConfig}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            <div className="text-muted-foreground">默认（自动选择）</div>
                          </SelectItem>
                          {claudeWslModeConfig.availableDistros.map((distro) => (
                            <SelectItem key={distro} value={distro}>
                              {distro}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Current Runtime Status */}
                  <div className="rounded-md border p-2 bg-muted/30 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">当前运行环境:</span>
                      <span className="font-medium">
                        {claudeWslModeConfig.actualMode === 'wsl' ? (
                          <span className="flex items-center gap-1">
                            <Terminal className="h-3 w-3" />
                            WSL
                            {claudeWslModeConfig.wslClaudeVersion && (
                              <span className="text-muted-foreground ml-1">({claudeWslModeConfig.wslClaudeVersion})</span>
                            )}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Monitor className="h-3 w-3" />
                            {claudeWslModeConfig.isWindows ? 'Windows 原生' : 'Linux 原生'}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* Link to settings page */}
              <div className="text-xs text-muted-foreground">
                <p>更多 Claude Code 配置请前往设置页面。</p>
              </div>
            </>
          )}
        </div>
      }
      className="w-96"
      align="start"
      side="top"
    />
  );
};

export default ExecutionEngineSelector;
