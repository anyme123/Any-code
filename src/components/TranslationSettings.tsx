import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { api, type TranslationConfig, type TranslationCacheStats } from '@/lib/api';
import { translationMiddleware } from '@/lib/translationMiddleware';
import { Loader2, RefreshCw, Settings, Languages, Database, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface TranslationSettingsProps {
  onClose?: () => void;
}

export const TranslationSettings: React.FC<TranslationSettingsProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TranslationConfig | null>(null);
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 加载初始数据
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [configData, statsData] = await Promise.all([
        api.getTranslationConfig(),
        api.getTranslationCacheStats().catch(() => null)
      ]);

      setConfig(configData);
      setCacheStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('translation.loadFailed'));
      console.error('Failed to load translation settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      await api.updateTranslationConfig(config);
      await translationMiddleware.updateConfig(config);

      setSuccess(t('translation.configSaved'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'));
      console.error('Failed to save translation config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config) return;

    if (!config.api_key.trim()) {
      setError(t('translation.pleaseEnterApiKey'));
      return;
    }

    try {
      setTestingConnection(true);
      setError(null);

      await api.translateText('Hello', 'zh');

      setSuccess(t('translation.connectionSuccess'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('errors.connectionFailed');
      setError(`${t('errors.connectionFailed')}: ${errorMessage}`);
      console.error('Translation connection test failed:', err);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleClearCache = async () => {
    try {
      setClearingCache(true);
      setError(null);

      await api.clearTranslationCache();
      await loadData();

      setSuccess(t('translation.cacheCleared'));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'));
      console.error('Failed to clear translation cache:', err);
    } finally {
      setClearingCache(false);
    }
  };

  const handleConfigChange = (key: keyof TranslationConfig, value: any) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>{t('translation.loadingSettings')}</span>
      </div>
    );
  }

  if (!config) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{t('translation.configLoadFailed')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Languages className="h-6 w-6" />
          <h2 className="text-2xl font-bold">{t('translation.title')}</h2>
        </div>
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            {t('buttons.close')}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="text-green-600">{success}</AlertDescription>
        </Alert>
      )}

      {/* Basic Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>{t('translation.basicSettings')}</span>
          </CardTitle>
          <CardDescription>
            {t('translation.basicSettingsDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="translation-enabled" className="text-sm font-medium">
              {t('translation.enableTranslation')}
            </Label>
            <Switch
              id="translation-enabled"
              checked={config.enabled}
              onCheckedChange={(enabled) => handleConfigChange('enabled', enabled)}
            />
          </div>

          {/* #171: 思考输出翻译开关（默认关闭以节省 tokens 与延迟） */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 flex-1">
              <Label htmlFor="translate-thinking" className="text-sm font-medium">
                翻译思考输出
              </Label>
              <p className="text-xs text-muted-foreground">
                开启后将翻译模型的 thinking 内容（会增加 token 消耗与延迟）
              </p>
            </div>
            <Switch
              id="translate-thinking"
              checked={(() => {
                try { return localStorage.getItem('translate_thinking_output') === 'true'; }
                catch { return false; }
              })()}
              onCheckedChange={(enabled) => {
                try {
                  localStorage.setItem('translate_thinking_output', String(enabled));
                  setSuccess(enabled ? '已启用思考输出翻译' : '已关闭思考输出翻译');
                  setTimeout(() => setSuccess(null), 2000);
                } catch (err) {
                  console.error('Failed to toggle translate_thinking_output:', err);
                }
              }}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="api-base-url">{t('translation.apiBaseUrl')}</Label>
              <Input
                id="api-base-url"
                value={config.api_base_url}
                onChange={(e) => handleConfigChange('api_base_url', e.target.value)}
                placeholder="https://api.siliconflow.cn/v1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">{t('translation.translationModel')}</Label>
              <Input
                id="model"
                value={config.model}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                placeholder="tencent/Hunyuan-MT-7B"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="timeout">{t('translation.requestTimeout')}</Label>
              <Input
                id="timeout"
                type="number"
                value={config.timeout_seconds}
                onChange={(e) => handleConfigChange('timeout_seconds', parseInt(e.target.value) || 30)}
                min="5"
                max="300"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cache-ttl">{t('translation.cacheTtl')}</Label>
              <Input
                id="cache-ttl"
                type="number"
                value={config.cache_ttl_seconds}
                onChange={(e) => handleConfigChange('cache_ttl_seconds', parseInt(e.target.value) || 3600)}
                min="300"
                max="86400"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key" className="flex items-center space-x-2">
              <span>{t('translation.apiKey')}</span>
              {!config.api_key && (
                <Badge variant="destructive" className="text-xs">{t('translation.apiKeyRequired')}</Badge>
              )}
            </Label>
            <Input
              id="api-key"
              type="password"
              value={config.api_key}
              onChange={(e) => handleConfigChange('api_key', e.target.value)}
              placeholder={t('translation.apiKeyPlaceholder')}
              className={!config.api_key ? "border-red-300" : ""}
            />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t('translation.apiKeyDescription')}
              </p>
              <p className="text-xs text-blue-600">
                {t('translation.apiKeyHint')}
              </p>
              {!config.api_key && (
                <p className="text-xs text-red-600">
                  {t('translation.apiKeyWarning')}
                </p>
              )}
            </div>
          </div>

          <div className="flex space-x-2 pt-4">
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('translation.saveConfig')}
            </Button>

            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testingConnection || !config.enabled || !config.api_key.trim()}
            >
              {testingConnection && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('translation.testConnection')}
            </Button>
          </div>

          {!config.api_key.trim() && (
            <Alert className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>{t('translation.apiKeyNeeded')}</strong>
                <br />
                1. {t('translation.apiKeyStep1')}
                <br />
                2. {t('translation.apiKeyStep2')}
                <br />
                3. {t('translation.apiKeyStep3')}
                <br />
                4. {t('translation.apiKeyStep4')}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Cache Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="h-5 w-5" />
            <span>{t('translation.cacheManagement')}</span>
          </CardTitle>
          <CardDescription>
            {t('translation.cacheManagementDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {cacheStats ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {cacheStats.total_entries}
                  </div>
                  <div className="text-sm text-muted-foreground">{t('translation.totalCacheEntries')}</div>
                </div>

                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {cacheStats.active_entries}
                  </div>
                  <div className="text-sm text-muted-foreground">{t('translation.activeCacheEntries')}</div>
                </div>

                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">
                    {cacheStats.expired_entries}
                  </div>
                  <div className="text-sm text-muted-foreground">{t('translation.expiredCacheEntries')}</div>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                {t('translation.cacheStatsFailed')}
              </div>
            )}

            <div className="flex space-x-2">
              <Button
                variant="outline"
                onClick={loadData}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {t('translation.refreshStats')}
              </Button>

              <Button
                variant="destructive"
                onClick={handleClearCache}
                disabled={clearingCache}
              >
                {clearingCache && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('translation.clearCache')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage Guide */}
      <Card>
        <CardHeader>
          <CardTitle>{t('translation.usageGuide')}</CardTitle>
          <CardDescription>
            {t('translation.usageGuideDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2">{t('translation.features')}</h4>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li><strong>{t('translation.featureTransparent')}</strong></li>
                <li><strong>{t('translation.featureSmartDetection')}</strong></li>
                <li><strong>{t('translation.featureBidirectional')}</strong></li>
                <li><strong>{t('translation.featureCacheOptimization')}</strong></li>
                <li><strong>{t('translation.featureFallback')}</strong></li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-sm mb-2">{t('translation.workflow')}</h4>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>{t('translation.workflowStep1')}</li>
                <li>{t('translation.workflowStep2')}</li>
                <li>{t('translation.workflowStep3')}</li>
                <li>{t('translation.workflowStep4')}</li>
                <li>{t('translation.workflowStep5')}</li>
                <li>{t('translation.workflowStep6')}</li>
              </ol>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Badge variant="secondary">{t('translation.version')}: 1.0.0</Badge>
              <Badge variant="outline">Hunyuan-MT-7B</Badge>
              <Badge variant={config.enabled ? "default" : "secondary"}>
                {t('translation.statusLabel')}: {config.enabled ? t('autoCompact.statusEnabled') : t('autoCompact.statusDisabled')}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
