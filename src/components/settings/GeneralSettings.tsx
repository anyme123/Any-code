import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LanguageSelector } from "../LanguageSelector";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "@/hooks/useTranslation";
import { api, type ClaudeSettings } from "@/lib/api";

interface GeneralSettingsProps {
  settings: ClaudeSettings | null;
  updateSetting: (key: string, value: any) => void;
  disableRewindGitOps: boolean;
  handleRewindGitOpsToggle: (checked: boolean) => void;
  disableAutoCommit: boolean;
  handleAutoCommitToggle: (checked: boolean) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  updateSetting,
  disableRewindGitOps,
  handleRewindGitOpsToggle,
  disableAutoCommit,
  handleAutoCommitToggle,
  setToast
}) => {
  const { t } = useTranslation();
  const { themeMode, setThemeMode } = useTheme();

  // Custom Claude path state
  const [customClaudePath, setCustomClaudePath] = useState<string>("");
  const [isCustomPathMode, setIsCustomPathMode] = useState(false);
  const [customPathError, setCustomPathError] = useState<string | null>(null);

  // Custom Codex path state
  const [customCodexPath, setCustomCodexPath] = useState<string>("");
  const [isCodexCustomPathMode, setIsCodexCustomPathMode] = useState(false);
  const [codexPathError, setCodexPathError] = useState<string | null>(null);
  const [codexPathValid, setCodexPathValid] = useState<boolean | null>(null);
  const [validatingCodexPath, setValidatingCodexPath] = useState(false);

  // Prompt Suggestions state
  const [enablePromptSuggestion, setEnablePromptSuggestion] = useState(() => {
    try {
      const stored = localStorage.getItem('enable_prompt_suggestion');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  /**
   * 初始化时加载当前 Codex 路径，并在 refresh 事件触发时同步
   */
  useEffect(() => {
    let cancelled = false;

    const loadCodexPath = async () => {
      try {
        const path = await api.getCodexPath();
        if (cancelled) return;

        if (path) {
          setCustomCodexPath(path);
          setCodexPathValid(true);
          setCodexPathError(null);
        } else {
          setCodexPathValid(null);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to load Codex path:", error);
      }
    };

    loadCodexPath();

    const handleRefresh = () => {
      loadCodexPath();
    };

    window.addEventListener('refresh-codex-status', handleRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('refresh-codex-status', handleRefresh);
    };
  }, []);

  /**
   * Handle setting custom Claude CLI path
   */
  const handleSetCustomPath = async () => {
    if (!customClaudePath.trim()) {
      setCustomPathError(t('generalSettings.enterValidPath'));
      return;
    }

    try {
      setCustomPathError(null);
      await api.setCustomClaudePath(customClaudePath.trim());

      // Clear the custom path field and exit custom mode
      setCustomClaudePath("");
      setIsCustomPathMode(false);

      // Show success message
      setToast({ message: t('generalSettings.customPathSuccess'), type: "success" });

      // Trigger status refresh
      window.dispatchEvent(new CustomEvent('validate-claude-installation'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('generalSettings.setCustomPathFailed');
      setCustomPathError(errorMessage);
    }
  };

  /**
   * Handle clearing custom Claude CLI path
   */
  const handleClearCustomPath = async () => {
    try {
      await api.clearCustomClaudePath();

      // Exit custom mode
      setIsCustomPathMode(false);
      setCustomClaudePath("");
      setCustomPathError(null);

      // Show success message
      setToast({ message: t('generalSettings.restoredAutoDetect'), type: "success" });

      // Trigger status refresh
      window.dispatchEvent(new CustomEvent('validate-claude-installation'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('generalSettings.clearCustomPathFailed');
      setToast({ message: errorMessage, type: "error" });
    }
  };

  /**
   * Validate Codex path and update status
   */
  const handleValidateCodexPath = async (path: string) => {
    if (!path.trim()) {
      setCodexPathValid(null);
      return;
    }

    setValidatingCodexPath(true);
    try {
      const isValid = await api.validateCodexPath(path.trim());
      setCodexPathValid(isValid);
      if (!isValid) {
        setCodexPathError(t('generalSettings.codexPathInvalid'));
      } else {
        setCodexPathError(null);
      }
    } catch (error) {
      setCodexPathValid(false);
      setCodexPathError(t('generalSettings.codexPathValidationError'));
    } finally {
      setValidatingCodexPath(false);
    }
  };

  /**
   * Handle setting custom Codex path
   */
  const handleSetCodexCustomPath = async () => {
    if (!customCodexPath.trim()) {
      setCodexPathError(t('generalSettings.enterValidPath'));
      return;
    }

    // First validate the path
    setValidatingCodexPath(true);
    try {
      const isValid = await api.validateCodexPath(customCodexPath.trim());
      if (!isValid) {
        setCodexPathError(t('generalSettings.codexPathInvalid'));
        setCodexPathValid(false);
        return;
      }

      // Path is valid, save it
      await api.setCodexCustomPath(customCodexPath.trim());

      // Update state
      setCodexPathValid(true);
      setCodexPathError(null);
      setIsCodexCustomPathMode(false);
      setCustomCodexPath("");

      // Show success message
      setToast({ message: t('generalSettings.codexPathSuccess'), type: "success" });

      // Trigger Codex status refresh
      window.dispatchEvent(new CustomEvent('refresh-codex-status'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('generalSettings.setCustomPathFailed');
      setCodexPathError(errorMessage);
    } finally {
      setValidatingCodexPath(false);
    }
  };

  /**
   * Handle clearing custom Codex path
   */
  const handleClearCodexCustomPath = async () => {
    try {
      await api.setCodexCustomPath(null);

      // Exit custom mode
      setIsCodexCustomPathMode(false);
      setCustomCodexPath("");
      setCodexPathError(null);
      setCodexPathValid(null);

      // Show success message
      setToast({ message: t('generalSettings.codexRestoredAutoDetect'), type: "success" });

      // Trigger Codex status refresh
      window.dispatchEvent(new CustomEvent('refresh-codex-status'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('generalSettings.clearCustomPathFailed');
      setToast({ message: errorMessage, type: "error" });
    }
  };

  /**
   * Handle Prompt Suggestions toggle
   */
  const handlePromptSuggestionToggle = (checked: boolean) => {
    setEnablePromptSuggestion(checked);
    try {
      localStorage.setItem('enable_prompt_suggestion', checked.toString());
      // Dispatch custom event to sync with FloatingPromptInput
      window.dispatchEvent(new CustomEvent('prompt-suggestion-toggle', { detail: { enabled: checked } }));
    } catch {
      // Ignore localStorage errors
    }
  };

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-4">{t('settings.general')}</h3>
        
        <div className="space-y-4">
          {/* Language Selector */}
          <LanguageSelector />

          {/* Theme Selector */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="theme">{t('settings.theme')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.themeDescription')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={themeMode === 'light' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setThemeMode('light')}
              >
                {t('settings.themeLight')}
              </Button>
              <Button
                variant={themeMode === 'dark' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setThemeMode('dark')}
              >
                {t('settings.themeDark')}
              </Button>
              <Button
                variant={themeMode === 'system' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setThemeMode('system')}
              >
                {t('settings.themeSystem')}
              </Button>
            </div>
          </div>

          {/* Show System Initialization Info */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="showSystemInit">{t('generalSettings.showSystemInit')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('generalSettings.showSystemInitDescription')}
              </p>
            </div>
            <Switch
              id="showSystemInit"
              checked={settings?.showSystemInitialization !== false}
              onCheckedChange={(checked) => updateSetting("showSystemInitialization", checked)}
            />
          </div>

          {/* Hide Warmup Messages */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="hideWarmup">{t('generalSettings.hideWarmup')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('generalSettings.hideWarmupDescription')}
              </p>
            </div>
            <Switch
              id="hideWarmup"
              checked={settings?.hideWarmupMessages === true}
              onCheckedChange={(checked) => updateSetting("hideWarmupMessages", checked)}
            />
          </div>

          {/* Include Co-authored By */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="coauthored">{t('generalSettings.includeCoauthored')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('generalSettings.includeCoauthoredDescription')}
              </p>
            </div>
            <Switch
              id="coauthored"
              checked={settings?.includeCoAuthoredBy !== false}
              onCheckedChange={(checked) => updateSetting("includeCoAuthoredBy", checked)}
            />
          </div>

          {/* Verbose Output */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="verbose">{t('generalSettings.verboseOutput')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('generalSettings.verboseOutputDescription')}
              </p>
            </div>
            <Switch
              id="verbose"
              checked={settings?.verbose === true}
              onCheckedChange={(checked) => updateSetting("verbose", checked)}
            />
          </div>

          {/* Prompt Suggestions */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="promptSuggestion">{t('generalSettings.promptSuggestion')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('generalSettings.promptSuggestionDescription')}
              </p>
            </div>
            <Switch
              id="promptSuggestion"
              checked={enablePromptSuggestion}
              onCheckedChange={handlePromptSuggestionToggle}
            />
          </div>

          {/* Disable Rewind Git Operations */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="disableRewindGitOps">{t('generalSettings.disableRewindGitOps')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('generalSettings.disableRewindGitOpsDescription')}
              </p>
            </div>
            <Switch
              id="disableRewindGitOps"
              checked={disableRewindGitOps}
              onCheckedChange={handleRewindGitOpsToggle}
            />
          </div>

          {/* Disable Auto-commit After Each AI Response */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="disableAutoCommit">禁用对话后自动 git 提交</Label>
              <p className="text-xs text-muted-foreground">
                关闭后，AI 每轮回复都会执行 git commit；开启此项后保留回滚记录但不再自动提交。
              </p>
            </div>
            <Switch
              id="disableAutoCommit"
              checked={disableAutoCommit}
              onCheckedChange={handleAutoCommitToggle}
            />
          </div>

          {/* Preferred Editor for code path jumps (#179) */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="preferredEditor">代码路径跳转编辑器</Label>
              <p className="text-xs text-muted-foreground">
                点击对话中的文件路径时使用的编辑器（需要相应 CLI 已安装到 PATH）
              </p>
            </div>
            <select
              id="preferredEditor"
              className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              defaultValue={(() => {
                try { return localStorage.getItem('preferred_editor') || 'auto'; }
                catch { return 'auto'; }
              })()}
              onChange={(e) => {
                try { localStorage.setItem('preferred_editor', e.target.value); }
                catch (err) { console.error('Failed to save preferred_editor:', err); }
              }}
            >
              <option value="auto">自动检测</option>
              <option value="cursor">Cursor</option>
              <option value="code">VS Code</option>
              <option value="idea">JetBrains IDEA</option>
              <option value="webstorm">WebStorm</option>
              <option value="pycharm">PyCharm</option>
              <option value="system">系统默认</option>
            </select>
          </div>

          {/* #171: 设置导出 */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label>导出设置</Label>
              <p className="text-xs text-muted-foreground">
                导出当前 Claude 设置为 JSON 文件（不包含 API Key 等敏感信息）
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const current = await api.getClaudeSettings();
                  const sanitized: any = JSON.parse(JSON.stringify(current || {}));
                  if (sanitized?.env && typeof sanitized.env === 'object') {
                    for (const k of Object.keys(sanitized.env)) {
                      if (/KEY|TOKEN|SECRET/i.test(k)) {
                        sanitized.env[k] = '***REDACTED***';
                      }
                    }
                  }
                  const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `any-code-settings-${new Date().toISOString().slice(0, 10)}.json`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  setToast({ message: '设置已导出', type: 'success' });
                } catch (err) {
                  console.error('Failed to export settings:', err);
                  setToast({ message: '导出失败：' + String(err), type: 'error' });
                }
              }}
            >
              <Download className="h-4 w-4 mr-1" />
              导出 JSON
            </Button>
          </div>

          {/* Cleanup Period */}
          <div className="space-y-2">
            <Label htmlFor="cleanup">{t('generalSettings.chatRetentionDays')}</Label>
            <Input
              id="cleanup"
              type="number"
              min="1"
              placeholder="30"
              value={settings?.cleanupPeriodDays || ""}
              onChange={(e) => {
                const value = e.target.value ? parseInt(e.target.value) : undefined;
                updateSetting("cleanupPeriodDays", value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t('generalSettings.chatRetentionDaysDescription')}
            </p>
          </div>
          

          {/* Custom Claude Path Configuration */}
          <div className="space-y-4">
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label className="text-sm font-medium">{t('generalSettings.customClaudePath')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('generalSettings.customClaudePathDescription')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsCustomPathMode(!isCustomPathMode);
                    setCustomPathError(null);
                    setCustomClaudePath("");
                  }}
                >
                  {isCustomPathMode ? t('buttons.cancel') : t('generalSettings.setCustomPath')}
                </Button>
              </div>

              <AnimatePresence>
                {isCustomPathMode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3"
                  >
                    <div className="space-y-2">
                      <Input
                        placeholder={t('common.pathToClaudeCli')}
                        value={customClaudePath}
                        onChange={(e) => {
                          setCustomClaudePath(e.target.value);
                          setCustomPathError(null);
                        }}
                        className={cn(customPathError && "border-red-500")}
                      />
                      {customPathError && (
                        <p className="text-xs text-red-500">{customPathError}</p>
                      )}
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSetCustomPath}
                        disabled={!customClaudePath.trim()}
                      >
                        {t('generalSettings.setPath')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClearCustomPath}
                      >
                        {t('generalSettings.restoreAutoDetect')}
                      </Button>
                    </div>

                    <div className="p-3 bg-muted rounded-md">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">
                            <strong>{t('generalSettings.currentPath')}:</strong> {t('generalSettings.notSet')}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t('generalSettings.pathValidationHint')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Custom Codex Path Configuration */}
          <div className="space-y-4">
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label className="text-sm font-medium">{t('generalSettings.customCodexPath')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('generalSettings.customCodexPathDescription')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsCodexCustomPathMode(!isCodexCustomPathMode);
                    setCodexPathError(null);
                    setCustomCodexPath("");
                    setCodexPathValid(null);
                  }}
                >
                  {isCodexCustomPathMode ? t('buttons.cancel') : t('generalSettings.setCustomPath')}
                </Button>
              </div>

              <AnimatePresence>
                {isCodexCustomPathMode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3"
                  >
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder={t('generalSettings.codexPathPlaceholder')}
                          value={customCodexPath}
                          onChange={(e) => {
                            setCustomCodexPath(e.target.value);
                            setCodexPathError(null);
                            setCodexPathValid(null);
                          }}
                          onBlur={() => {
                            if (customCodexPath.trim()) {
                              handleValidateCodexPath(customCodexPath);
                            }
                          }}
                          className={cn(
                            "flex-1",
                            codexPathError && "border-red-500",
                            codexPathValid === true && "border-green-500"
                          )}
                        />
                        {validatingCodexPath && (
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        )}
                        {!validatingCodexPath && codexPathValid === true && (
                          <span className="text-green-500 text-sm flex items-center">✓ {t('common.valid')}</span>
                        )}
                        {!validatingCodexPath && codexPathValid === false && (
                          <span className="text-red-500 text-sm flex items-center">✗ {t('common.invalid')}</span>
                        )}
                      </div>
                      {codexPathError && (
                        <p className="text-xs text-red-500">{codexPathError}</p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSetCodexCustomPath}
                        disabled={!customCodexPath.trim() || validatingCodexPath}
                      >
                        {validatingCodexPath ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            {t('messages.validating')}
                          </>
                        ) : (
                          t('generalSettings.setPath')
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClearCodexCustomPath}
                      >
                        {t('generalSettings.restoreAutoDetect')}
                      </Button>
                    </div>

                    <div className="p-3 bg-muted rounded-md">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs text-muted-foreground">
                            <strong>{t('generalSettings.codexPathHint')}</strong>
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t('generalSettings.codexCommonPaths')}
                          </p>
                          <ul className="text-xs text-muted-foreground mt-1 ml-3 list-disc">
                            <li>C:\Users\username\AppData\Roaming\npm\codex.ps1</li>
                            <li>D:\nodejs\node_global\codex.ps1</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
