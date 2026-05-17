import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Edit,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  loadConfig,
  addProvider,
  updateProvider,
  deleteProvider,
  testAPIConnection,
  PRESET_PROVIDERS,
  detectApiFormat,
  type PromptEnhancementProvider,
} from "@/lib/promptEnhancementService";
import { cn } from "@/lib/utils";
import { PromptContextConfigSettings } from "@/components/PromptContextConfigSettings";
import { AcemcpConfigSettings } from "@/components/AcemcpConfigSettings";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "@/hooks/useTranslation";

interface PromptEnhancementSettingsProps {
  className?: string;
}

export const PromptEnhancementSettings: React.FC<PromptEnhancementSettingsProps> = ({
  className
}) => {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<PromptEnhancementProvider[]>([]);
  const [editingProvider, setEditingProvider] = useState<PromptEnhancementProvider | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ providerId: string; success: boolean; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; provider: PromptEnhancementProvider | null }>({ show: false, provider: null });

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = () => {
    const config = loadConfig();
    setProviders(config.providers);
  };

  const handleAdd = () => {
    setEditingProvider({
      id: Date.now().toString(),
      name: '',
      apiUrl: '',
      apiKey: '',
      model: '',
      // ⚡ 不设置默认值，让用户决定是否需要
      enabled: true,
    });
    setShowDialog(true);
  };

  const handleEdit = (provider: PromptEnhancementProvider) => {
    setEditingProvider({ ...provider });
    setShowDialog(true);
  };

  const handleSave = () => {
    if (!editingProvider || !editingProvider.name || !editingProvider.apiUrl || !editingProvider.apiKey) {
      return;
    }

    const existing = providers.find(p => p.id === editingProvider.id);
    if (existing) {
      updateProvider(editingProvider.id, editingProvider);
    } else {
      addProvider(editingProvider);
    }

    loadProviders();
    setShowDialog(false);
    setEditingProvider(null);
  };

  const handleDelete = (provider: PromptEnhancementProvider) => {
    // ⚡ 显示自定义确认对话框，而不是浏览器 confirm
    setDeleteConfirm({ show: true, provider });
  };

  const confirmDelete = () => {
    if (deleteConfirm.provider) {
      deleteProvider(deleteConfirm.provider.id);
      loadProviders();
    }
    setDeleteConfirm({ show: false, provider: null });
  };

  const cancelDelete = () => {
    setDeleteConfirm({ show: false, provider: null });
  };

  const handleTest = async (provider: PromptEnhancementProvider) => {
    setTestingId(provider.id);
    setTestResult(null);

    const result = await testAPIConnection(provider);
    setTestResult({ providerId: provider.id, ...result });
    setTestingId(null);

    setTimeout(() => setTestResult(null), 5000);
  };

  const handleToggle = (id: string, enabled: boolean) => {
    updateProvider(id, { enabled });
    loadProviders();
  };

  const handleUsePreset = (presetKey: keyof typeof PRESET_PROVIDERS) => {
    const preset = PRESET_PROVIDERS[presetKey];
    setEditingProvider({
      id: Date.now().toString(),
      name: preset.name,
      apiUrl: preset.apiUrl,
      apiKey: '',
      model: preset.model,
      enabled: true,
      apiFormat: preset.apiFormat,
      // ⚡ 不设置 temperature 和 maxTokens，让用户自己决定
    });
    setShowDialog(true);
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Acemcp 配置 */}
      <AcemcpConfigSettings />

      <Separator />

      {/* 上下文配置 */}
      <PromptContextConfigSettings />

      <Separator />

      {/* API Provider Configuration */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{t('promptEnhancement.title')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('promptEnhancement.subtitle')}
            </p>
          </div>
          <Button onClick={handleAdd} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t('promptEnhancement.addProvider')}
          </Button>
        </div>

      {/* Quick Add Presets */}
      <Card className="p-4 bg-muted/30">
        <h4 className="text-sm font-medium mb-3">{t('promptEnhancement.quickAddPresets')}</h4>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => handleUsePreset('openai')}>
            <Sparkles className="h-3 w-3 mr-1" />
            OpenAI
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleUsePreset('deepseek')}>
            <Sparkles className="h-3 w-3 mr-1" />
            Deepseek
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleUsePreset('qwen')}>
            <Sparkles className="h-3 w-3 mr-1" />
            Qwen
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleUsePreset('siliconflow')}>
            <Sparkles className="h-3 w-3 mr-1" />
            SiliconFlow
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleUsePreset('gemini')}>
            <Sparkles className="h-3 w-3 mr-1" />
            Google Gemini
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleUsePreset('anthropic')}>
            <Sparkles className="h-3 w-3 mr-1" />
            Anthropic Claude
          </Button>
        </div>
      </Card>

      {/* Provider List */}
      {providers.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h4 className="font-medium mb-2">{t('promptEnhancement.noProviders')}</h4>
          <p className="text-sm text-muted-foreground mb-4">
            {t('promptEnhancement.noProvidersDescription')}
          </p>
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            {t('promptEnhancement.addFirstProvider')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <Card key={provider.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium">{provider.name}</h4>
                    <Badge variant={provider.enabled ? "default" : "outline"} className="text-xs">
                      {provider.enabled ? t('buttons.enable') : t('buttons.disable')}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>{t('promptEnhancement.modelName')}: {provider.model}</div>
                    <div className="truncate">API: {provider.apiUrl}</div>
                    <div className="flex items-center gap-2">
                      <span>{t('promptEnhancement.apiFormat')}: {
                        provider.apiFormat
                          ? (provider.apiFormat === 'gemini' ? 'Gemini' :
                             provider.apiFormat === 'anthropic' ? 'Anthropic' : 'OpenAI')
                          : `${t('promptEnhancement.autoDetect')} (${
                              detectApiFormat(provider.apiUrl) === 'gemini' ? 'Gemini' :
                              detectApiFormat(provider.apiUrl) === 'anthropic' ? 'Anthropic' : 'OpenAI'
                            })`
                      }</span>
                      {provider.temperature !== undefined && <span>| Temp: {provider.temperature}</span>}
                      {provider.maxTokens !== undefined && <span>| Token: {provider.maxTokens}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(provider)}
                    disabled={testingId === provider.id}
                  >
                    {testingId === provider.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      t('buttons.test')
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggle(provider.id, !provider.enabled)}
                  >
                    {provider.enabled ? t('buttons.disable') : t('buttons.enable')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(provider)}
                  >
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(provider)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Test Result */}
              {testResult && testResult.providerId === provider.id && testingId === null && (
                <div className={cn(
                  "mt-3 p-2 rounded-md text-sm flex items-center gap-2",
                  testResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                )}>
                  {testResult.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  {testResult.message}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingProvider && providers.find(p => p.id === editingProvider.id) ? t('promptEnhancement.editProvider') : t('promptEnhancement.addProvider')}
            </DialogTitle>
          </DialogHeader>

          {editingProvider && (
            <div className="space-y-4">
              <div>
                <Label>{t('promptEnhancement.providerName')}</Label>
                <Input
                  value={editingProvider.name}
                  onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })}
                  placeholder={t('promptEnhancement.providerNamePlaceholder')}
                />
              </div>

              <div>
                <Label>{t('promptEnhancement.apiUrl')}</Label>
                <Input
                  value={editingProvider.apiUrl}
                  onChange={(e) => setEditingProvider({ ...editingProvider, apiUrl: e.target.value })}
                  placeholder={t('promptEnhancement.apiUrlPlaceholder')}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('promptEnhancement.apiUrlHint')}
                </p>
              </div>

              <div>
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={editingProvider.apiKey}
                  onChange={(e) => setEditingProvider({ ...editingProvider, apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>

              <div>
                <Label>{t('promptEnhancement.modelName')}</Label>
                <Input
                  value={editingProvider.model}
                  onChange={(e) => setEditingProvider({ ...editingProvider, model: e.target.value })}
                  placeholder="gpt-5.5"
                />
              </div>

              <div>
                <Label>{t('promptEnhancement.apiFormat')}</Label>
                <Select
                  value={editingProvider.apiFormat || 'auto'}
                  onValueChange={(value) => setEditingProvider({
                    ...editingProvider,
                    apiFormat: value === 'auto' ? undefined : value as 'openai' | 'gemini' | 'anthropic'
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {t('promptEnhancement.autoDetect')} {editingProvider.apiUrl ? `(${
                        detectApiFormat(editingProvider.apiUrl) === 'gemini' ? 'Gemini' :
                        detectApiFormat(editingProvider.apiUrl) === 'anthropic' ? 'Anthropic' : 'OpenAI'
                      })` : ''}
                    </SelectItem>
                    <SelectItem value="openai">{t('promptEnhancement.openaiFormat')}</SelectItem>
                    <SelectItem value="anthropic">{t('promptEnhancement.anthropicFormat')}</SelectItem>
                    <SelectItem value="gemini">{t('promptEnhancement.geminiFormat')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('promptEnhancement.apiFormatHint')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t('promptEnhancement.temperatureOptional')}</Label>
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={editingProvider.temperature || ''}
                    onChange={(e) => setEditingProvider({
                      ...editingProvider,
                      temperature: e.target.value ? parseFloat(e.target.value) : undefined
                    })}
                    placeholder={t('promptEnhancement.temperaturePlaceholder')}
                  />
                </div>
                <div>
                  <Label>{t('promptEnhancement.maxTokensOptional')}</Label>
                  <Input
                    type="number"
                    value={editingProvider.maxTokens || ''}
                    onChange={(e) => setEditingProvider({
                      ...editingProvider,
                      maxTokens: e.target.value ? parseInt(e.target.value) : undefined
                    })}
                    placeholder={t('promptEnhancement.maxTokensPlaceholder')}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowDialog(false);
              setEditingProvider(null);
            }}>
              {t('buttons.cancel')}
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-2" />
              {t('buttons.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirm.show} onOpenChange={(open) => !open && cancelDelete()}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('promptEnhancement.confirmDeleteProvider')}</DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {t('promptEnhancement.confirmDeleteMessage').replace('{name}', deleteConfirm.provider?.name || '')}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {t('promptEnhancement.cannotUndo')}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>
              {t('buttons.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              {t('promptEnhancement.confirmDeleteButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

