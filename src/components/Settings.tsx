import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Save,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  api,
  type ClaudeSettings,
  type ClaudeExecutionConfig
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Toast, ToastContainer } from "@/components/ui/toast";
import { StorageTab } from "./StorageTab";
import { PromptEnhancementSettings } from "./PromptEnhancementSettings";
import { useTranslation } from "@/hooks/useTranslation";
import { useNavigation } from "@/contexts/NavigationContext";
import ProviderManager from "./ProviderManager";
import CodexProviderManager from "./CodexProviderManager";
import GeminiProviderManager from "./GeminiProviderManager";
import { TranslationSettings } from "./TranslationSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { PermissionsSettings } from "./settings/PermissionsSettings";
import { EnvironmentSettings } from "./settings/EnvironmentSettings";
import { HooksSettings } from "./settings/HooksSettings";

interface SettingsProps {
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Optional initial tab to display
   */
  initialTab?: string;
  /**
   * Optional callback when back is triggered
   */
  onBack?: () => void;
}

interface PermissionRule {
  id: string;
  value: string;
}

interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * 全面的设置界面，用于管理 Claude Code 设置
 * 提供无代码界面来编辑 settings.json 文件
 * Comprehensive Settings UI for managing Claude Code settings
 * Provides a no-code interface for editing the settings.json file
 */
export const Settings: React.FC<SettingsProps> = ({
  className,
  initialTab,
}) => {
  const { t } = useTranslation();
  const { goBack } = useNavigation();
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab || "general");

  // ⚡ 监听切换到提示词API标签的事件（内部事件）
  useEffect(() => {
    const handleSwitchTab = () => {
      setActiveTab("prompt-api");
    };

    window.addEventListener('switch-to-prompt-api-tab', handleSwitchTab);
    return () => window.removeEventListener('switch-to-prompt-api-tab', handleSwitchTab);
  }, []);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Permission rules state
  const [allowRules, setAllowRules] = useState<PermissionRule[]>([]);
  const [denyRules, setDenyRules] = useState<PermissionRule[]>([]);
  
  // Environment variables state
  const [envVars, setEnvVars] = useState<EnvironmentVariable[]>([]);
  
  // Execution config state
  const [executionConfig, setExecutionConfig] = useState<ClaudeExecutionConfig | null>(null);
  const [disableRewindGitOps, setDisableRewindGitOps] = useState(false);
  const [showRewindGitConfirmDialog, setShowRewindGitConfirmDialog] = useState(false);
  const [disableAutoCommitAfterResponse, setDisableAutoCommitAfterResponse] = useState(false);
  
  // Hooks state
  const [userHooksChanged, setUserHooksChanged] = useState(false);
  const getUserHooks = React.useRef<(() => any) | null>(null);

  // Provider sub-tabs state
  const [providerSubTab, setProviderSubTab] = useState("claude");
  
  // 挂载时加载设置
  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  /**
   * Loads the current Claude settings
   */
  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedSettings = await api.getClaudeSettings();
      
      // Ensure loadedSettings is an object
      if (!loadedSettings || typeof loadedSettings !== 'object') {
        console.warn("Loaded settings is not an object:", loadedSettings);
        setSettings({});
        return;
      }
      
      setSettings(loadedSettings);

      // Load execution config
      try {
        const execConfig = await api.getClaudeExecutionConfig();
        setExecutionConfig(execConfig);
        setDisableRewindGitOps(execConfig.disable_rewind_git_operations || false);
        setDisableAutoCommitAfterResponse(execConfig.disable_auto_commit_after_response || false);
      } catch (err) {
        console.error("Failed to load execution config:", err);
        // Continue with default values
      }

      // Parse permissions
      if (loadedSettings.permissions && typeof loadedSettings.permissions === 'object') {
        if (Array.isArray(loadedSettings.permissions.allow)) {
          setAllowRules(
            loadedSettings.permissions.allow.map((rule: string, index: number) => ({
              id: `allow-${index}`,
              value: rule,
            }))
          );
        }
        if (Array.isArray(loadedSettings.permissions.deny)) {
          setDenyRules(
            loadedSettings.permissions.deny.map((rule: string, index: number) => ({
              id: `deny-${index}`,
              value: rule,
            }))
          );
        }
      }

      // Parse environment variables
      if (loadedSettings.env && typeof loadedSettings.env === 'object' && !Array.isArray(loadedSettings.env)) {
        setEnvVars(
          Object.entries(loadedSettings.env).map(([key, value], index) => ({
            id: `env-${index}`,
            key,
            value: value as string,
            enabled: true, // 默认启用所有现有的环境变量
          }))
        );
      }

    } catch (err) {
      console.error("Failed to load settings:", err);
      setError(t('errors.loadFailed'));
      setSettings({});
    } finally {
      setLoading(false);
    }
  };

  /**
   * Saves the current settings
   */
  const saveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      setToast(null);

      // 🔥 修复：保存前重新读取最新的 settings.json 以获取当前代理商配置
      // 这样可以避免用户切换代理商后，保存设置时覆盖刚切换的代理商配置
      const latestSettings = await api.getClaudeSettings();
      const latestAnthropicVars = Object.fromEntries(
        Object.entries(latestSettings?.env || {}).filter(([key]) => key.startsWith('ANTHROPIC_'))
      );

      // Build the settings object
      const updatedSettings: ClaudeSettings = {
        ...settings,
        permissions: {
          allow: allowRules.map(rule => rule.value).filter(v => v.trim()),
          deny: denyRules.map(rule => rule.value).filter(v => v.trim()),
        },
        env: {
          // 使用最新读取的 ANTHROPIC_* 变量（这些变量由代理商设置页面管理）
          ...latestAnthropicVars,
          // UI 中配置的环境变量完全由用户管理（支持删除）
          ...envVars
            .filter(envVar => envVar.enabled) // 只保存启用的环境变量
            .reduce((acc, { key, value }) => {
              if (key.trim() && value.trim()) {
                acc[key] = value;
              }
              return acc;
            }, {} as Record<string, string>),
        },
      };

      await api.saveClaudeSettings(updatedSettings);
      setSettings(updatedSettings);

      // Save execution config if changed
      if (executionConfig) {
        const updatedExecConfig = {
          ...executionConfig,
          disable_rewind_git_operations: disableRewindGitOps,
          disable_auto_commit_after_response: disableAutoCommitAfterResponse,
        };
        await api.updateClaudeExecutionConfig(updatedExecConfig);
        setExecutionConfig(updatedExecConfig);
      }

      // Save user hooks if changed
      if (userHooksChanged && getUserHooks.current) {
        const hooks = getUserHooks.current();
        await api.updateHooksConfig('user', hooks);
        setUserHooksChanged(false);
      }

      setToast({ message: t('messages.saved'), type: "success" });
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError(t('errors.saveFailed'));
      setToast({ message: t('errors.saveFailed'), type: "error" });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Updates a simple setting value
   */
  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  /**
   * Handle rewind git operations toggle with confirmation
   */
  const handleRewindGitOpsToggle = (checked: boolean) => {
    if (checked) {
      // Show confirmation dialog when enabling
      setShowRewindGitConfirmDialog(true);
    } else {
      // Directly disable without confirmation
      setDisableRewindGitOps(false);
    }
  };

  /**
   * Confirm enabling disable rewind git operations
   */
  const confirmEnableRewindGitOpsDisable = () => {
    setDisableRewindGitOps(true);
    setShowRewindGitConfirmDialog(false);
  };

  /**
   * Cancel enabling disable rewind git operations
   */
  const cancelEnableRewindGitOpsDisable = () => {
    setShowRewindGitConfirmDialog(false);
  };

  /**
   * Adds a new permission rule
   */
  const addPermissionRule = (type: "allow" | "deny") => {
    const newRule: PermissionRule = {
      id: `${type}-${Date.now()}`,
      value: "",
    };
    
    if (type === "allow") {
      setAllowRules(prev => [...prev, newRule]);
    } else {
      setDenyRules(prev => [...prev, newRule]);
    }
  };

  /**
   * Updates a permission rule
   */
  const updatePermissionRule = (type: "allow" | "deny", id: string, value: string) => {
    if (type === "allow") {
      setAllowRules(prev => prev.map(rule => 
        rule.id === id ? { ...rule, value } : rule
      ));
    } else {
      setDenyRules(prev => prev.map(rule => 
        rule.id === id ? { ...rule, value } : rule
      ));
    }
  };

  /**
   * Removes a permission rule
   */
  const removePermissionRule = (type: "allow" | "deny", id: string) => {
    if (type === "allow") {
      setAllowRules(prev => prev.filter(rule => rule.id !== id));
    } else {
      setDenyRules(prev => prev.filter(rule => rule.id !== id));
    }
  };

  /**
   * Adds a new environment variable
   */
  const addEnvVar = () => {
    const newVar: EnvironmentVariable = {
      id: `env-${Date.now()}`,
      key: "",
      value: "",
      enabled: true, // 默认启用新的环境变量
    };
    setEnvVars(prev => [...prev, newVar]);
  };

  /**
   * Updates an environment variable
   */
  const updateEnvVar = (id: string, field: "key" | "value" | "enabled", value: string | boolean) => {
    setEnvVars(prev => prev.map(envVar => 
      envVar.id === id ? { ...envVar, [field]: value } : envVar
    ));
  };

  /**
   * Removes an environment variable
   */
  const removeEnvVar = (id: string) => {
    setEnvVars(prev => prev.filter(envVar => envVar.id !== id));
  };

  return (
    <div className={cn("flex flex-col h-full bg-background text-foreground", className)}>
      <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center justify-between p-4 border-b border-border"
        >
        <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={goBack}
          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
          <p className="text-xs text-muted-foreground">
              {t('common.configureClaudePreferences')}
          </p>
          </div>
        </div>
        
        <Button
          onClick={saveSettings}
          disabled={saving || loading}
          size="sm"
          className={cn(
            "gap-2 bg-primary hover:bg-primary/90",
            "transition-all duration-200",
            saving && "scale-95 opacity-80"
          )}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('common.savingSettings')}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" aria-hidden="true" />
              {t('common.saveSettings')}
            </>
          )}
        </Button>
      </motion.div>
      
      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-4 mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 flex items-center gap-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid grid-cols-8 w-full">
              <TabsTrigger value="general">{t('settings.general')}</TabsTrigger>
              <TabsTrigger value="permissions">{t('settings.permissions')}</TabsTrigger>
              <TabsTrigger value="environment">{t('settings.environment')}</TabsTrigger>
              <TabsTrigger value="hooks">{t('settings.hooks')}</TabsTrigger>
              <TabsTrigger value="translation">{t('settings.translation')}</TabsTrigger>
              <TabsTrigger value="prompt-api">{t('settings.promptApi')}</TabsTrigger>
              <TabsTrigger value="provider">{t('settings.provider')}</TabsTrigger>
              <TabsTrigger value="storage">{t('settings.storage')}</TabsTrigger>
            </TabsList>
            
            {/* General Settings */}
            <TabsContent value="general" className="space-y-6">
              <GeneralSettings
                settings={settings}
                updateSetting={updateSetting}
                disableRewindGitOps={disableRewindGitOps}
                handleRewindGitOpsToggle={handleRewindGitOpsToggle}
                disableAutoCommitAfterResponse={disableAutoCommitAfterResponse}
                onAutoCommitAfterResponseChange={setDisableAutoCommitAfterResponse}
                setToast={setToast}
              />
            </TabsContent>
            
            {/* Permissions Settings */}
            <TabsContent value="permissions" className="space-y-6">
              <PermissionsSettings
                allowRules={allowRules}
                denyRules={denyRules}
                addPermissionRule={addPermissionRule}
                updatePermissionRule={updatePermissionRule}
                removePermissionRule={removePermissionRule}
              />
            </TabsContent>
            
            {/* Environment Variables */}
            <TabsContent value="environment" className="space-y-6">
              <EnvironmentSettings
                envVars={envVars}
                addEnvVar={addEnvVar}
                updateEnvVar={updateEnvVar}
                removeEnvVar={removeEnvVar}
              />
            </TabsContent>
            
            {/* Hooks Settings */}
            <TabsContent value="hooks" className="space-y-6">
              <HooksSettings
                activeTab={activeTab}
                setUserHooksChanged={setUserHooksChanged}
                getUserHooks={getUserHooks}
              />
            </TabsContent>

            {/* Translation Tab */}
            <TabsContent value="translation">
              <TranslationSettings />
            </TabsContent>
            
            {/* Prompt Enhancement API Tab */}
            <TabsContent value="prompt-api">
              <PromptEnhancementSettings />
            </TabsContent>
            
            {/* Provider Tab */}
            <TabsContent value="provider" className="space-y-4">
              <Tabs value={providerSubTab} onValueChange={setProviderSubTab} className="w-full">
                <TabsList className="grid grid-cols-3 w-96">
                  <TabsTrigger value="claude">{t('settings.claudeProvider')}</TabsTrigger>
                  <TabsTrigger value="codex">{t('settings.codexProvider')}</TabsTrigger>
                  <TabsTrigger value="gemini">{t('settings.geminiProvider')}</TabsTrigger>
                </TabsList>
                <TabsContent value="claude">
                  <ProviderManager onBack={() => {}} />
                </TabsContent>
                <TabsContent value="codex">
                  <CodexProviderManager />
                </TabsContent>
                <TabsContent value="gemini">
                  <GeminiProviderManager />
                </TabsContent>
              </Tabs>
            </TabsContent>
            
            {/* Storage Tab */}
            <TabsContent value="storage">
              <StorageTab />
            </TabsContent>
            
          </Tabs>
        </div>
      )}
      </div>
      
      {/* Confirmation Dialog for Disabling Rewind Git Operations */}
      <Dialog open={showRewindGitConfirmDialog} onOpenChange={setShowRewindGitConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠️ {t('dialogs.confirmGitOps')}</DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p>{t('dialogs.gitOpsWarning')}</p>
              <ul className="list-disc pl-5 space-y-2 text-sm">
                <li className="text-green-600 dark:text-green-400">
                  <strong>{t('dialogs.gitOpsCanDo')}</strong>
                </li>
                <li className="text-red-600 dark:text-red-400">
                  <strong>{t('dialogs.gitOpsCannotDo')}</strong>
                </li>
              </ul>
              <p className="text-yellow-600 dark:text-yellow-400 font-medium">
                ⚠️ {t('dialogs.gitOpsNote')}
              </p>
              <p className="text-muted-foreground">
                {t('dialogs.gitOpsUseCase')}
              </p>
              <p className="font-medium">{t('dialogs.confirmDeleteMessage')}</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelEnableRewindGitOpsDisable}
            >
              {t('buttons.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmEnableRewindGitOpsDisable}
            >
              {t('dialogs.confirmEnable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast Notification */}
      <ToastContainer>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastContainer>
    </div>
  );
};  
