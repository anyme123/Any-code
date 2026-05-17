import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Save,
  X,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Sparkles,
  Key,
} from 'lucide-react';
import { type GeminiProviderConfig } from '@/lib/api';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  geminiProviderPresets,
  generateThirdPartyEnv,
  extractApiKeyFromEnv,
  extractBaseUrlFromEnv,
  extractModelFromEnv,
  type ProviderCategory,
} from '@/config/geminiProviderPresets';
import { useTranslation } from "@/hooks/useTranslation";

interface GeminiProviderFormProps {
  initialData?: GeminiProviderConfig;
  onSubmit: (formData: Omit<GeminiProviderConfig, 'id'>) => Promise<void>;
  onCancel: () => void;
}

export default function GeminiProviderForm({
  initialData,
  onSubmit,
  onCancel
}: GeminiProviderFormProps) {
  const { t } = useTranslation();
  // 预设选择
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  // 基础字段
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [websiteUrl, setWebsiteUrl] = useState(initialData?.websiteUrl || '');
  const [category, setCategory] = useState<ProviderCategory>(
    initialData?.category || 'custom'
  );

  // Gemini 特有字段
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('auto-gemini-3');

  // 状态
  const [loading, setLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const isEditing = !!initialData;

  // 初始化编辑模式的数据
  useEffect(() => {
    if (initialData) {
      setApiKey(extractApiKeyFromEnv(initialData.env));
      setBaseUrl(extractBaseUrlFromEnv(initialData.env));
      setModelName(extractModelFromEnv(initialData.env) || 'auto-gemini-3');
    }
  }, [initialData]);

  // 预设选择变更处理
  const handlePresetChange = useCallback((presetId: string) => {
    setSelectedPreset(presetId);
    const preset = geminiProviderPresets.find(p => p.id === presetId);
    if (preset) {
      setName(preset.name);
      setDescription(preset.description || '');
      setWebsiteUrl(preset.websiteUrl);
      setCategory(preset.category || 'custom');
      setApiKey(''); // 清空 API Key，用户需要填写
      setBaseUrl(extractBaseUrlFromEnv(preset.env));
      setModelName(extractModelFromEnv(preset.env) || 'auto-gemini-3');
    }
  }, []);

  // 验证表单
  const validateForm = (): string | null => {
    if (!name.trim()) {
      return t('provider.providerNameRequired');
    }
    // 官方供应商不需要额外验证
    if (category === 'official') {
      return null;
    }
    // 第三方供应商需要 API Key
    if (!apiKey.trim()) {
      return t('provider.apiKeyRequired');
    }
    // 第三方供应商需要 Base URL
    if (!baseUrl.trim()) {
      return t('provider.baseUrlRequired');
    }
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      return t('provider.baseUrlInvalid');
    }
    return null;
  };

  // 提交表单
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const error = validateForm();
    if (error) {
      setToastMessage({ message: error, type: 'error' });
      return;
    }

    try {
      setLoading(true);

      // 构建环境变量
      let finalEnv: Record<string, string>;

      if (category === 'official') {
        // 官方供应商不需要环境变量
        finalEnv = {};
      } else {
        // 第三方供应商需要环境变量
        finalEnv = generateThirdPartyEnv(apiKey, baseUrl, modelName);
      }

      const submitData: Omit<GeminiProviderConfig, 'id'> = {
        name: name.trim(),
        description: description.trim(),
        websiteUrl: websiteUrl.trim(),
        category,
        env: finalEnv,
        isOfficial: category === 'official',
      };

      await onSubmit(submitData);
    } catch (error) {
      console.error('Failed to save Gemini provider config:', error);
      setToastMessage({
        message: t('provider.saveConfigFailed', { error: String(error) }),
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onCancel();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 预设选择器（仅新建时显示） */}
      {!isEditing && (
        <Card className="p-4">
          <div className="space-y-2">
            <Label>{t('provider.selectPreset')}</Label>
            <Select value={selectedPreset} onValueChange={handlePresetChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('provider.selectPresetPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {geminiProviderPresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <div className="flex items-center gap-2">
                      <span>{preset.name}</span>
                      {preset.category === 'official' && (
                        <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded">
                          {t('provider.official')}
                        </span>
                      )}
                      {preset.isPartner && (
                        <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-1.5 py-0.5 rounded">
                          {t('provider.partner')}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('provider.presetHelp')}
            </p>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-4">
        {/* 基本信息 */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Info className="h-4 w-4" />
            {t('provider.basicInfo')}
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('provider.providerName')} *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('provider.providerNamePlaceholder')}
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">{t('provider.category')}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ProviderCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="official">{t('provider.categoryOfficial')}</SelectItem>
                  <SelectItem value="third_party">{t('provider.categoryThirdParty')}</SelectItem>
                  <SelectItem value="custom">{t('provider.categoryCustom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('provider.descriptionLabel')}</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('provider.descriptionPlaceholder')}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="websiteUrl">{t('provider.websiteUrlLabel')}</Label>
            <Input
              id="websiteUrl"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={loading}
            />
          </div>
        </div>

        {/* Gemini 配置 */}
        {category !== 'official' && (
          <div className="space-y-4 pt-4 border-t">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Key className="h-4 w-4" />
              {t('provider.geminiConfig')}
            </h3>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="apiKey">{t('provider.apiKey')} *</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza..."
                  disabled={loading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-8 w-8 p-0"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('provider.apiKeyWriteToGemini')}
              </p>
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="baseUrl">{t('provider.baseUrlLabel')} *</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                {t('provider.baseUrlWriteToGemini')}
              </p>
            </div>

            {/* Model Name */}
            <div className="space-y-2">
              <Label htmlFor="modelName">{t('provider.modelLabel')}</Label>
              <Input
                id="modelName"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="auto-gemini-3"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                {t('provider.modelWriteToGemini')}
              </p>
            </div>
          </div>
        )}

        {/* 官方供应商说明 */}
        {category === 'official' && (
          <div className="pt-4 border-t">
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-md">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  {t('provider.googleOAuthTitle')}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {t('provider.googleOAuthDescription')}
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleClose}
          disabled={loading}
        >
          <X className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('buttons.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className={cn(
            "transition-all duration-200",
            loading && "scale-95 opacity-80"
          )}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              {isEditing ? t('provider.updating') : t('provider.adding')}
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" aria-hidden="true" />
              {isEditing ? t('provider.updateConfig') : t('provider.addConfig')}
            </>
          )}
        </Button>
      </div>

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center p-4 pointer-events-none">
          <div className="pointer-events-auto">
            <Toast
              message={toastMessage.message}
              type={toastMessage.type}
              onDismiss={() => setToastMessage(null)}
            />
          </div>
        </div>
      )}
    </form>
  );
}
