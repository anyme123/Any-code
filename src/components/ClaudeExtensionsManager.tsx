import React, { useState, useEffect } from "react";
import {
  Bot,
  FolderOpen,
  Plus,
  Package,
  Sparkles,
  Loader2,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Terminal,
  Zap,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";

interface ClaudeExtensionsManagerProps {
  projectPath?: string;
  className?: string;
  onBack?: () => void;
}

interface PluginComponentItem {
  name: string;
  description?: string;
}

interface PluginInfo {
  name: string;
  description?: string;
  version: string;
  author?: string;
  marketplace?: string;
  path: string;
  enabled: boolean;
  components: {
    commands: number;
    agents: number;
    skills: number;
    hooks: number;
    mcpServers: number;
    commandList: PluginComponentItem[];
    skillList: PluginComponentItem[];
    agentList: PluginComponentItem[];
  };
}

interface AgentFile {
  name: string;
  path: string;
  scope: 'project' | 'user';
  description?: string;
}

interface SkillFile {
  name: string;
  path: string;
  scope: 'project' | 'user';
  description?: string;
}

/**
 * Claude 扩展管理器
 * 
 * 根据官方文档管理：
 * - Subagents: .claude/agents/ 下的 Markdown 文件
 * - Agent Skills: .claude/skills/ 下的 SKILL.md 文件
 * - Slash Commands: 已有独立管理器
 */
export const ClaudeExtensionsManager: React.FC<ClaudeExtensionsManagerProps> = ({
  projectPath,
  className,
  onBack
}) => {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [agents, setAgents] = useState<AgentFile[]>([]);
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [activeTab, setActiveTab] = useState("plugins");
  const [loading, setLoading] = useState(false);
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());

  // Toggle plugin expansion
  const togglePluginExpand = (pluginPath: string) => {
    setExpandedPlugins(prev => {
      const next = new Set(prev);
      if (next.has(pluginPath)) {
        next.delete(pluginPath);
      } else {
        next.add(pluginPath);
      }
      return next;
    });
  };

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<'agent' | 'skill'>('agent');
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content: '',
    scope: 'project' as 'project' | 'user',
  });

  // Plugin management state
  const [togglingPlugins, setTogglingPlugins] = useState<Set<string>>(new Set());
  const [uninstallingPlugins, setUninstallingPlugins] = useState<Set<string>>(new Set());
  const [reinstallingPlugins, setReinstallingPlugins] = useState<Set<string>>(new Set());

  // Build plugin key from name and marketplace (matching the installed_plugins.json key format)
  const getPluginKey = (plugin: PluginInfo): string => {
    if (plugin.marketplace) {
      return `${plugin.name}@${plugin.marketplace}`;
    }
    return plugin.name;
  };

  // Toggle plugin enabled/disabled
  const handleTogglePlugin = async (plugin: PluginInfo) => {
    const key = getPluginKey(plugin);
    setTogglingPlugins(prev => new Set(prev).add(key));
    try {
      const newEnabled = await api.togglePluginEnabled(key);
      setPlugins(prev =>
        prev.map(p =>
          getPluginKey(p) === key ? { ...p, enabled: newEnabled } : p
        )
      );
    } catch (error) {
      console.error('[ClaudeExtensions] Failed to toggle plugin:', error);
      alert(`${t('extensions.toggleFailed')}: ${error}`);
    } finally {
      setTogglingPlugins(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Uninstall plugin with confirmation
  const handleUninstallPlugin = async (plugin: PluginInfo) => {
    const key = getPluginKey(plugin);
    if (!window.confirm(t('extensions.confirmUninstall').replace('{name}', plugin.name))) {
      return;
    }
    setUninstallingPlugins(prev => new Set(prev).add(key));
    try {
      await api.uninstallPlugin(key);
      setPlugins(prev => prev.filter(p => getPluginKey(p) !== key));
    } catch (error) {
      console.error('[ClaudeExtensions] Failed to uninstall plugin:', error);
      alert(`${t('extensions.uninstallFailed')}: ${error}`);
    } finally {
      setUninstallingPlugins(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Reinstall plugin
  const handleReinstallPlugin = async (plugin: PluginInfo) => {
    const source = plugin.marketplace
      ? `${plugin.marketplace}:${plugin.name}`
      : plugin.name;
    const key = getPluginKey(plugin);
    setReinstallingPlugins(prev => new Set(prev).add(key));
    try {
      await api.reinstallPlugin(source);
      // Reload the plugin list to reflect any changes
      await loadPlugins();
    } catch (error) {
      console.error('[ClaudeExtensions] Failed to reinstall plugin:', error);
      alert(`${t('extensions.reinstallFailed')}: ${error}`);
    } finally {
      setReinstallingPlugins(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Open a specific plugin's directory in file explorer
  const handleOpenPluginDir = async (plugin: PluginInfo) => {
    try {
      await api.openDirectoryInExplorer(plugin.path);
    } catch (error) {
      console.error('Failed to open plugin directory:', error);
    }
  };

  // 加载插件
  const loadPlugins = async () => {
    try {
      setLoading(true);
      const result = await api.listPlugins(projectPath);
      setPlugins(result);
    } catch (error) {
      console.error('[ClaudeExtensions] Failed to load plugins:', error);
    } finally {
      setLoading(false);
    }
  };

  // 加载子代理
  const loadAgents = async () => {
    try {
      setLoading(true);
      const result = await api.listSubagents(projectPath);
      setAgents(result);
    } catch (error) {
      console.error('[ClaudeExtensions] Failed to load agents:', error);
    } finally {
      setLoading(false);
    }
  };

  // 加载 Agent Skills
  const loadSkills = async () => {
    try {
      setLoading(true);
      const result = await api.listAgentSkills(projectPath);
      setSkills(result);
    } catch (error) {
      console.error('[ClaudeExtensions] Failed to load skills:', error);
    } finally {
      setLoading(false);
    }
  };

  // 打开目录
  const handleOpenPluginsDir = async () => {
    try {
      const dirPath = await api.openPluginsDirectory(projectPath);
      await api.openDirectoryInExplorer(dirPath);
    } catch (error) {
      console.error('Failed to open plugins directory:', error);
    }
  };

  const handleOpenAgentsDir = async () => {
    try {
      const dirPath = await api.openAgentsDirectory(projectPath);
      await api.openDirectoryInExplorer(dirPath);
    } catch (error) {
      console.error('Failed to open agents directory:', error);
    }
  };

  const handleOpenSkillsDir = async () => {
    try {
      const dirPath = await api.openSkillsDirectory(projectPath);
      await api.openDirectoryInExplorer(dirPath);
    } catch (error) {
      console.error('Failed to open skills directory:', error);
    }
  };

  // Open create dialog
  const openCreateDialog = (type: 'agent' | 'skill') => {
    setDialogType(type);
    setFormData({
      name: '',
      description: '',
      content: type === 'agent'
        ? t('extensions.defaultAgentContent')
        : t('extensions.defaultSkillContent'),
      scope: projectPath ? 'project' : 'user',
    });
    setDialogOpen(true);
  };

  // Handle create
  const handleCreate = async () => {
    if (!formData.name.trim()) {
      alert(t('placeholders.enterName'));
      return;
    }
    if (!formData.description.trim()) {
      alert(t('placeholders.enterDescription'));
      return;
    }

    setCreating(true);
    try {
      if (dialogType === 'agent') {
        await api.createSubagent(
          formData.name.trim(),
          formData.description.trim(),
          formData.content,
          formData.scope,
          projectPath
        );
        await loadAgents();
      } else {
        await api.createSkill(
          formData.name.trim(),
          formData.description.trim(),
          formData.content,
          formData.scope,
          projectPath
        );
        await loadSkills();
      }
      setDialogOpen(false);
    } catch (error) {
      console.error('Failed to create:', error);
      alert(`${t('errors.createFailed')}: ${error}`);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    loadPlugins();
    loadAgents();
    loadSkills();
  }, [projectPath]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Back button */}
      {onBack && (
        <div className="flex items-center gap-3 mb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('common.backToHome')}
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{t('extensions.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('extensions.subtitle')}</p>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="plugins">
            <Package className="h-4 w-4 mr-2" />
            {t('extensions.plugins')}
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Bot className="h-4 w-4 mr-2" />
            {t('extensions.subagents')}
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Sparkles className="h-4 w-4 mr-2" />
            {t('extensions.skills')}
          </TabsTrigger>
        </TabsList>

        {/* Plugins Tab */}
        <TabsContent value="plugins" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{t('extensions.plugins')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('extensions.pluginsDescription')}
              </p>
            </div>
          </div>

          {/* Plugin list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : plugins.length > 0 ? (
            <div className="space-y-2">
              {plugins.map((plugin) => {
                const isExpanded = expandedPlugins.has(plugin.path);
                const hasDetails = (plugin.components.commandList?.length > 0) ||
                                   (plugin.components.skillList?.length > 0) ||
                                   (plugin.components.agentList?.length > 0);
                const pluginKey = getPluginKey(plugin);
                const isToggling = togglingPlugins.has(pluginKey);
                const isUninstalling = uninstallingPlugins.has(pluginKey);
                const isReinstalling = reinstallingPlugins.has(pluginKey);
                const isBusy = isToggling || isUninstalling || isReinstalling;
                return (
                <Card key={plugin.path} className={cn("p-4", !plugin.enabled && "opacity-60")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <Package className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{plugin.name}</h4>
                          <Badge variant="outline" className="text-xs">
                            v{plugin.version}
                          </Badge>
                          {plugin.enabled ? (
                            <Badge variant="default" className="text-xs bg-green-600">
                              {t('extensions.enabled')}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {t('extensions.disabled')}
                            </Badge>
                          )}
                          {plugin.marketplace && (
                            <Badge variant="secondary" className="text-xs">
                              {plugin.marketplace}
                            </Badge>
                          )}
                        </div>
                        {plugin.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {plugin.description}
                          </p>
                        )}
                        {/* Component counts with expand button */}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          {hasDetails && (
                            <button
                              onClick={() => togglePluginExpand(plugin.path)}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </button>
                          )}
                          {plugin.components.commands > 0 && (
                            <span className="flex items-center gap-1">
                              <Terminal className="h-3 w-3" />
                              {plugin.components.commands} {t('extensions.commands')}
                            </span>
                          )}
                          {plugin.components.skills > 0 && (
                            <span className="flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {plugin.components.skills} {t('extensions.skills')}
                            </span>
                          )}
                          {plugin.components.agents > 0 && (
                            <span className="flex items-center gap-1">
                              <Bot className="h-3 w-3" />
                              {plugin.components.agents} {t('extensions.agents')}
                            </span>
                          )}
                          {plugin.components.hooks > 0 && <span>{t('extensions.hooks')}</span>}
                          {plugin.components.mcpServers > 0 && <span>MCP</span>}
                        </div>

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="mt-3 space-y-3 border-t pt-3">
                            {/* Commands list */}
                            {plugin.components.commandList?.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium mb-2 flex items-center gap-1">
                                  <Terminal className="h-3 w-3" />
                                  {t('extensions.commands')}
                                </h5>
                                <div className="space-y-1 ml-4">
                                  {plugin.components.commandList.map((cmd, idx) => (
                                    <div key={idx} className="text-xs">
                                      <code className="text-primary">/{cmd.name}</code>
                                      {cmd.description && (
                                        <span className="text-muted-foreground ml-2">- {cmd.description}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Skills list */}
                            {plugin.components.skillList?.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium mb-2 flex items-center gap-1">
                                  <Zap className="h-3 w-3" />
                                  {t('extensions.skills')}
                                </h5>
                                <div className="space-y-1 ml-4">
                                  {plugin.components.skillList.map((skill, idx) => (
                                    <div key={idx} className="text-xs">
                                      <span className="font-medium">{skill.name}</span>
                                      {skill.description && (
                                        <span className="text-muted-foreground ml-2 line-clamp-1">- {skill.description}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Agents list */}
                            {plugin.components.agentList?.length > 0 && (
                              <div>
                                <h5 className="text-xs font-medium mb-2 flex items-center gap-1">
                                  <Bot className="h-3 w-3" />
                                  {t('extensions.agents')}
                                </h5>
                                <div className="space-y-1 ml-4">
                                  {plugin.components.agentList.map((agent, idx) => (
                                    <div key={idx} className="text-xs">
                                      <span className="font-medium">{agent.name}</span>
                                      {agent.description && (
                                        <span className="text-muted-foreground ml-2">- {agent.description}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {plugin.author && (
                          <p className="text-xs text-muted-foreground mt-1">{t('extensions.author')}: {plugin.author}</p>
                        )}
                      </div>
                    </div>

                    {/* Plugin management actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Enable/Disable toggle */}
                      <Switch
                        checked={plugin.enabled}
                        onCheckedChange={() => handleTogglePlugin(plugin)}
                        disabled={isBusy}
                        aria-label={plugin.enabled ? t('extensions.disable') : t('extensions.enable')}
                      />

                      {/* Reinstall button */}
                      {plugin.marketplace && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReinstallPlugin(plugin)}
                          disabled={isBusy}
                          title={t('extensions.reinstall')}
                        >
                          {isReinstalling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}

                      {/* Open plugin directory */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenPluginDir(plugin)}
                        disabled={isBusy}
                        title={t('extensions.openDirectory')}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>

                      {/* Uninstall button */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUninstallPlugin(plugin)}
                        disabled={isBusy}
                        title={t('extensions.uninstall')}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {isUninstalling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              )})}
            </div>
          ) : (
            <Card className="p-6 text-center border-dashed">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h4 className="font-medium mb-2">{t('extensions.noPlugins')}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {t('extensions.pluginsLocation')}
              </p>
              <div className="text-xs text-muted-foreground mb-4">
                {t('extensions.pluginCommand')}
              </div>
              <Button variant="outline" size="sm" onClick={handleOpenPluginsDir}>
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('extensions.openDirectory')}
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* Subagents Tab */}
        <TabsContent value="agents" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{t('extensions.subagentsTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('extensions.subagentsDescription')}
              </p>
            </div>
            <Button size="sm" onClick={() => openCreateDialog('agent')}>
              <Plus className="h-4 w-4 mr-2" />
              {t('extensions.newSubagent')}
            </Button>
          </div>

          {/* Subagent list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : agents.length > 0 ? (
            <div className="space-y-2">
              {agents.map((agent) => (
                <Card
                  key={agent.path}
                  className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={async () => {
                    const editor = (typeof localStorage !== 'undefined' && localStorage.getItem('preferred_editor')) || 'auto';
                    try { await api.openPathInEditor(agent.path, undefined, undefined, editor); }
                    catch { await api.openFileWithDefaultApp(agent.path); }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <Bot className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{agent.name}</h4>
                          <Badge variant={agent.scope === 'project' ? 'default' : 'outline'} className="text-xs">
                            {agent.scope}
                          </Badge>
                        </div>
                        {agent.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {agent.description}
                          </p>
                        )}
                        <code className="text-xs text-muted-foreground mt-2 block truncate">
                          {agent.path}
                        </code>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}

              {/* Open directory button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleOpenAgentsDir}
              >
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                {t('extensions.openSubagentsDir')}
              </Button>
            </div>
          ) : (
            <Card className="p-6 text-center border-dashed">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h4 className="font-medium mb-2">{t('extensions.noSubagents')}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {t('extensions.subagentsLocation')}
              </p>
              <Button variant="outline" size="sm" onClick={handleOpenAgentsDir}>
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('extensions.openDirectory')}
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* Agent Skills Tab */}
        <TabsContent value="skills" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{t('extensions.skillsTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('extensions.skillsDescription')}
              </p>
            </div>
            <Button size="sm" onClick={() => openCreateDialog('skill')}>
              <Plus className="h-4 w-4 mr-2" />
              {t('extensions.newSkill')}
            </Button>
          </div>

          {/* Agent Skills list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : skills.length > 0 ? (
            <div className="space-y-2">
              {skills.map((skill) => (
                <Card
                  key={skill.path}
                  className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={async () => {
                    const editor = (typeof localStorage !== 'undefined' && localStorage.getItem('preferred_editor')) || 'auto';
                    try { await api.openPathInEditor(skill.path, undefined, undefined, editor); }
                    catch { await api.openFileWithDefaultApp(skill.path); }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <Sparkles className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{skill.name}</h4>
                          <Badge variant={skill.scope === 'project' ? 'default' : 'outline'} className="text-xs">
                            {skill.scope}
                          </Badge>
                        </div>
                        {skill.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {skill.description}
                          </p>
                        )}
                        <code className="text-xs text-muted-foreground mt-2 block truncate">
                          {skill.path}
                        </code>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}

              {/* Open directory button */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleOpenSkillsDir}
              >
                <FolderOpen className="h-3.5 w-3.5 mr-2" />
                {t('extensions.openSkillsDir')}
              </Button>
            </div>
          ) : (
            <Card className="p-6 text-center border-dashed">
              <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h4 className="font-medium mb-2">{t('extensions.noSkills')}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {t('extensions.skillsLocation')}
              </p>
              <Button variant="outline" size="sm" onClick={handleOpenSkillsDir}>
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('extensions.openDirectory')}
              </Button>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Official docs and resources */}
      <div className="text-xs text-muted-foreground border-t pt-4 space-y-3">
        <div>
          <p className="mb-2 font-medium">{t('extensions.officialDocs')}</p>
          <ul className="space-y-1 ml-4">
            <li>- <a href="https://docs.claude.com/en/docs/claude-code/plugins" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t('extensions.pluginsDocs')}</a></li>
            <li>- <a href="https://docs.claude.com/en/docs/claude-code/subagents" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t('extensions.subagentsDocs')}</a></li>
            <li>- <a href="https://docs.claude.com/en/docs/claude-code/agent-skills" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t('extensions.skillsDocs')}</a></li>
          </ul>
        </div>

        <div>
          <p className="mb-2 font-medium">{t('extensions.officialResources')}</p>
          <ul className="space-y-1 ml-4">
            <li>- <a href="https://github.com/anthropics/skills" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
              {t('extensions.anthropicSkillsRepo')}
              <span className="text-muted-foreground">(13.7k)</span>
            </a></li>
          </ul>
          <p className="text-muted-foreground mt-2 ml-4 text-[11px]">
            {t('extensions.skillsRepoDescription')}
          </p>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {dialogType === 'agent' ? t('extensions.createSubagent') : t('extensions.createSkill')}
            </DialogTitle>
            <DialogDescription>
              {dialogType === 'agent'
                ? t('extensions.subagentDescription')
                : t('extensions.skillDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t('extensions.name')}</Label>
              <Input
                id="name"
                placeholder={dialogType === 'agent' ? 'code-reviewer' : 'python-helper'}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t('extensions.nameHint')}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">{t('extensions.description')}</Label>
              <Input
                id="description"
                placeholder={dialogType === 'agent'
                  ? 'Expert code reviewer for quality and security'
                  : 'Python development best practices and patterns'}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="scope">{t('extensions.scope')}</Label>
              <Select
                value={formData.scope}
                onValueChange={(value: 'project' | 'user') =>
                  setFormData({ ...formData, scope: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectPath && (
                    <SelectItem value="project">{t('extensions.projectScope')}</SelectItem>
                  )}
                  <SelectItem value="user">{t('extensions.userScope')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="content">
                {dialogType === 'agent' ? t('extensions.systemPromptLabel') : t('extensions.guidanceContent')}
              </Label>
              <Textarea
                id="content"
                className="min-h-[150px] font-mono text-sm"
                placeholder={dialogType === 'agent'
                  ? t('extensions.systemPromptPlaceholder')
                  : t('extensions.guidancePlaceholder')}
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('buttons.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('messages.creating')}
                </>
              ) : (
                t('buttons.create')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

