import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { api, type UsageStats, type ProjectUsage } from "@/lib/api";
import type { CodexUsageStats, GeminiUsageStats, EngineType, ModelUsage } from "@/types/usage";
import { ENGINE_COLORS, ENGINE_LABELS } from "@/types/usage";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { GeminiIcon } from "@/components/icons/GeminiIcon";
import {
  Calendar,
  Filter,
  Loader2,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Layers
} from "lucide-react";

interface UsageDashboardProps {
  /**
   * Callback when back button is clicked
   */
  onBack: () => void;
}

// Cache for storing fetched data
const dataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes cache - increased for better performance

/**
 * Optimized UsageDashboard component with caching and progressive loading
 */
export const UsageDashboard: React.FC<UsageDashboardProps> = ({ onBack }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [sessionStats, setSessionStats] = useState<ProjectUsage[] | null>(null);
  const [selectedDateRange, setSelectedDateRange] = useState<"today" | "7d" | "30d" | "all">("7d");
  const [activeTab, setActiveTab] = useState("overview");
  const [hasLoadedTabs, setHasLoadedTabs] = useState<Set<string>>(new Set(["overview"]));

  // Multi-engine state
  const [selectedEngine, setSelectedEngine] = useState<EngineType | "all">("all");
  const [codexStats, setCodexStats] = useState<CodexUsageStats | null>(null);
  const [geminiStats, setGeminiStats] = useState<GeminiUsageStats | null>(null);

  // Pagination states
  const [projectsPage, setProjectsPage] = useState(1);
  const [sessionsPage, setSessionsPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Memoized formatters to prevent recreation on each render
  const formatCurrency = useMemo(() => (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }, []);

  const formatNumber = useMemo(() => (num: number): string => {
    return new Intl.NumberFormat('en-US').format(num);
  }, []);

  const formatTokens = useMemo(() => (num: number): string => {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return formatNumber(num);
  }, [formatNumber]);

  const getModelDisplayName = useCallback((model: string): string => {
    const modelMap: Record<string, string> = {
      "claude-opus-4-7": "Opus 4.7",
      "claude-opus-4.7": "Opus 4.7",
      "claude-sonnet-4-6": "Sonnet 4.6",
      "claude-sonnet-4.6": "Sonnet 4.6",
      "claude-haiku-4-5": "Haiku 4.5",
      "claude-4-opus": "Opus 4",
      "claude-4-sonnet": "Sonnet 4",
      "claude-3.5-sonnet": "Sonnet 3.5",
      "claude-3-opus": "Opus 3",
    };
    return modelMap[model] || model;
  }, []);

  // Function to get cached data or null
  const getCachedData = useCallback((key: string) => {
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }, []);

  // Function to set cached data
  const setCachedData = useCallback((key: string, data: any) => {
    dataCache.set(key, { data, timestamp: Date.now() });
  }, []);

  const loadUsageStats = useCallback(async () => {
    const cacheKey = `usage-${selectedDateRange}`;

    // Check cache first
    const cachedStats = getCachedData(`${cacheKey}-stats`);
    const cachedSessions = getCachedData(`${cacheKey}-sessions`);
    const cachedCodex = getCachedData(`${cacheKey}-codex`);
    const cachedGemini = getCachedData(`${cacheKey}-gemini`);

    if (cachedStats && cachedSessions && cachedCodex !== undefined && cachedGemini !== undefined) {
      setStats(cachedStats);
      setSessionStats(cachedSessions);
      setCodexStats(cachedCodex);
      setGeminiStats(cachedGemini);
      setLoading(false);
      return;
    }

    try {
      // Always show loading when fetching
      setLoading(true);
      setError(null);

      // Get today's date range
      const today = new Date();
      // 🚀 修复时区问题：使用本地日期格式而不是 ISO 字符串
      const formatLocalDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      let statsData: UsageStats;
      let sessionData: ProjectUsage[] = [];
      let startDateStr: string | undefined;
      let endDateStr: string | undefined;

      if (selectedDateRange === "today") {
        // Today only - 使用本地日期字符串避免时区问题
        const todayDateStr = formatLocalDate(today);
        startDateStr = todayDateStr;
        endDateStr = todayDateStr;
        const [statsResult, sessionResult] = await Promise.all([
          api.getUsageByDateRange(todayDateStr, todayDateStr),
          api.getSessionStats()
        ]);
        statsData = statsResult;
        sessionData = sessionResult;
      } else if (selectedDateRange === "all") {
        // Fetch all data in parallel
        const [statsResult, sessionResult] = await Promise.all([
          api.getUsageStats(),
          api.getSessionStats()
        ]);
        statsData = statsResult;
        sessionData = sessionResult;
      } else {
        const endDate = new Date();
        const startDate = new Date();
        const days = selectedDateRange === "7d" ? 7 : 30;
        startDate.setDate(startDate.getDate() - days);

        startDateStr = formatLocalDate(startDate);
        endDateStr = formatLocalDate(endDate);

        // 🚀 修复时区问题：统一使用本地日期格式
        const formatDateForSessionApi = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}${month}${day}`;
        };

        // Fetch all data in parallel for better performance
        const [statsResult, sessionResult] = await Promise.all([
          api.getUsageByDateRange(startDateStr, endDateStr),
          api.getSessionStats(
            formatDateForSessionApi(startDate),
            formatDateForSessionApi(endDate),
            'desc'
          )
        ]);

        statsData = statsResult;
        sessionData = sessionResult;
      }

      // Update Claude state
      setStats(statsData);
      setSessionStats(sessionData);

      // Cache Claude data
      setCachedData(`${cacheKey}-stats`, statsData);
      setCachedData(`${cacheKey}-sessions`, sessionData);

      // Fetch Codex and Gemini stats in parallel (non-blocking)
      Promise.allSettled([
        api.getCodexUsageStats(startDateStr, endDateStr),
        api.getGeminiUsageStats(startDateStr, endDateStr),
      ]).then(([codexResult, geminiResult]) => {
        const codexData = codexResult.status === 'fulfilled' ? codexResult.value : null;
        const geminiData = geminiResult.status === 'fulfilled' ? geminiResult.value : null;

        setCodexStats(codexData);
        setGeminiStats(geminiData);

        // Cache multi-engine data
        setCachedData(`${cacheKey}-codex`, codexData);
        setCachedData(`${cacheKey}-gemini`, geminiData);
      });
    } catch (err: any) {
      console.error("Failed to load usage stats:", err);
      setError("Failed to load usage statistics. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [selectedDateRange, getCachedData, setCachedData]);  // ⚡ 移除 stats, sessionStats 依赖，避免无限循环

  // Load data on mount and when date range changes
  useEffect(() => {
    // Reset pagination when date range changes
    setProjectsPage(1);
    setSessionsPage(1);
    loadUsageStats();
  }, [loadUsageStats])

  // Preload adjacent tabs when idle
  useEffect(() => {
    if (!stats || loading) return;
    
    const tabOrder = ["overview", "models", "projects", "sessions", "timeline"];
    const currentIndex = tabOrder.indexOf(activeTab);
    
    // Use requestIdleCallback if available, otherwise setTimeout
    const schedulePreload = (callback: () => void) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 2000 });
      } else {
        setTimeout(callback, 100);
      }
    };
    
    // Preload adjacent tabs
    schedulePreload(() => {
      if (currentIndex > 0) {
        setHasLoadedTabs(prev => new Set([...prev, tabOrder[currentIndex - 1]]));
      }
      if (currentIndex < tabOrder.length - 1) {
        setHasLoadedTabs(prev => new Set([...prev, tabOrder[currentIndex + 1]]));
      }
    });
  }, [activeTab, stats, loading])

  // Aggregate multi-engine statistics
  const aggregatedStats = useMemo(() => {
    const claudeCost = stats?.total_cost || 0;
    const codexCost = codexStats?.total_cost || 0;
    const geminiCost = geminiStats?.total_cost || 0;

    const claudeTokens = stats?.total_tokens || 0;
    const codexTokens = codexStats?.total_tokens || 0;
    const geminiTokens = geminiStats?.total_tokens || 0;

    const claudeSessions = stats?.total_sessions || 0;
    const codexSessions = codexStats?.total_sessions || 0;
    const geminiSessions = geminiStats?.total_sessions || 0;

    // Token breakdown
    const totalInputTokens = (stats?.total_input_tokens || 0) +
                             (codexStats?.total_input_tokens || 0) +
                             (geminiStats?.total_input_tokens || 0);
    const totalOutputTokens = (stats?.total_output_tokens || 0) +
                              (codexStats?.total_output_tokens || 0) +
                              (geminiStats?.total_output_tokens || 0);
    const totalCacheCreation = (stats?.total_cache_creation_tokens || 0) +
                               (codexStats?.total_cache_creation_tokens || 0) +
                               (geminiStats?.total_cache_creation_tokens || 0);
    const totalCacheRead = (stats?.total_cache_read_tokens || 0) +
                           (codexStats?.total_cache_read_tokens || 0) +
                           (geminiStats?.total_cache_read_tokens || 0);

    return {
      totalCost: claudeCost + codexCost + geminiCost,
      totalTokens: claudeTokens + codexTokens + geminiTokens,
      totalSessions: claudeSessions + codexSessions + geminiSessions,
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreation,
      totalCacheRead,
      byEngine: [
        { engine: 'claude' as EngineType, cost: claudeCost, tokens: claudeTokens, sessions: claudeSessions },
        { engine: 'codex' as EngineType, cost: codexCost, tokens: codexTokens, sessions: codexSessions },
        { engine: 'gemini' as EngineType, cost: geminiCost, tokens: geminiTokens, sessions: geminiSessions },
      ],
    };
  }, [stats, codexStats, geminiStats]);

  // Get current stats based on selected engine
  const currentStats = useMemo(() => {
    if (selectedEngine === 'all') {
      return {
        total_cost: aggregatedStats.totalCost,
        total_tokens: aggregatedStats.totalTokens,
        total_sessions: aggregatedStats.totalSessions,
        total_input_tokens: aggregatedStats.totalInputTokens,
        total_output_tokens: aggregatedStats.totalOutputTokens,
        total_cache_creation_tokens: aggregatedStats.totalCacheCreation,
        total_cache_read_tokens: aggregatedStats.totalCacheRead,
        by_model: [
          ...(stats?.by_model || []).map(m => ({ ...m, engine: 'claude' as EngineType })),
          ...(codexStats?.by_model || []).map(m => ({ ...m, engine: 'codex' as EngineType })),
          ...(geminiStats?.by_model || []).map(m => ({ ...m, engine: 'gemini' as EngineType })),
        ].sort((a, b) => b.total_cost - a.total_cost),
        by_project: [
          ...(stats?.by_project || []).map(p => ({ ...p, engine: 'claude' as EngineType })),
          ...(codexStats?.by_project || []).map(p => ({ ...p, engine: 'codex' as EngineType })),
          ...(geminiStats?.by_project || []).map(p => ({ ...p, engine: 'gemini' as EngineType })),
        ].sort((a, b) => b.total_cost - a.total_cost),
        by_date: (() => {
          // Merge by_date from all engines, grouping by date
          const merged = new Map<string, { date: string; total_cost: number; total_tokens: number; models_used: string[] }>();
          const addEntries = (entries: any[] | undefined) => {
            for (const d of (entries || [])) {
              const existing = merged.get(d.date);
              if (existing) {
                existing.total_cost += d.total_cost;
                existing.total_tokens += d.total_tokens;
              } else {
                merged.set(d.date, { date: d.date, total_cost: d.total_cost, total_tokens: d.total_tokens, models_used: d.models_used || [] });
              }
            }
          };
          addEntries(stats?.by_date);
          addEntries(codexStats?.by_date);
          addEntries(geminiStats?.by_date);
          return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
        })(),
      };
    }
    if (selectedEngine === 'claude') return stats;
    if (selectedEngine === 'codex') return codexStats;
    if (selectedEngine === 'gemini') return geminiStats;
    return stats;
  }, [selectedEngine, stats, codexStats, geminiStats, aggregatedStats]);

  // Memoize expensive computations
  const summaryCards = useMemo(() => {
    if (!currentStats) return null;

    const totalCost = currentStats.total_cost || 0;
    const totalSessions = currentStats.total_sessions || 0;
    const totalTokens = currentStats.total_tokens || 0;

    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 shimmer-hover">
          <div>
            <p className="text-caption text-muted-foreground">{t('usageDashboard.totalCost')}</p>
            <p className="text-display-2 mt-1">
              {formatCurrency(totalCost)}
            </p>
          </div>
        </Card>

        <Card className="p-4 shimmer-hover">
          <div>
            <p className="text-caption text-muted-foreground">{t('usageDashboard.totalSessions')}</p>
            <p className="text-display-2 mt-1">
              {formatNumber(totalSessions)}
            </p>
          </div>
        </Card>

        <Card className="p-4 shimmer-hover">
          <div>
            <p className="text-caption text-muted-foreground">{t('usageDashboard.totalTokens')}</p>
            <p className="text-display-2 mt-1">
              {formatTokens(totalTokens)}
            </p>
          </div>
        </Card>

        <Card className="p-4 shimmer-hover">
          <div>
            <p className="text-caption text-muted-foreground">{t('usageDashboard.averageCostPerSession')}</p>
            <p className="text-display-2 mt-1">
              {formatCurrency(
                totalSessions > 0
                  ? totalCost / totalSessions
                  : 0
              )}
            </p>
          </div>
        </Card>
      </div>
    );
  }, [currentStats, formatCurrency, formatNumber, formatTokens, t]);

  // Memoize the most used models section
  const mostUsedModels = useMemo(() => {
    if (!currentStats?.by_model) return null;

    return currentStats.by_model.slice(0, 3).map((model: ModelUsage & { engine?: EngineType }) => {
      const engineColor = model.engine ? ENGINE_COLORS[model.engine] : ENGINE_COLORS.claude;
      const EngineIcon = model.engine === 'codex' ? CodexIcon :
                         model.engine === 'gemini' ? GeminiIcon : ClaudeIcon;
      return (
        <div key={`${model.engine || 'claude'}-${model.model}`} className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {selectedEngine === 'all' && (
              <EngineIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: engineColor }} />
            )}
            <Badge
              variant="outline"
              className="text-caption"
              style={{ borderColor: selectedEngine === 'all' ? engineColor : undefined }}
            >
              {getModelDisplayName(model.model)}
            </Badge>
            <span className="text-caption text-muted-foreground">
              {model.session_count} sessions
            </span>
          </div>
          <span className="text-body-small font-medium">
            {formatCurrency(model.total_cost)}
          </span>
        </div>
      );
    });
  }, [currentStats, formatCurrency, getModelDisplayName, selectedEngine]);

  // Memoize top projects section
  const topProjects = useMemo(() => {
    if (!currentStats?.by_project) return null;

    return currentStats.by_project.slice(0, 3).map((project: ProjectUsage & { engine?: EngineType }) => {
      const engineColor = project.engine ? ENGINE_COLORS[project.engine] : ENGINE_COLORS.claude;
      const EngineIcon = project.engine === 'codex' ? CodexIcon :
                         project.engine === 'gemini' ? GeminiIcon : ClaudeIcon;
      return (
        <div key={`${project.engine || 'claude'}-${project.project_path}`} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {selectedEngine === 'all' && (
              <EngineIcon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: engineColor }} />
            )}
            <div className="flex flex-col">
              <span className="text-body-small font-medium truncate max-w-[180px]" title={project.project_path}>
                {project.project_path}
              </span>
              <span className="text-caption text-muted-foreground">
                {project.session_count} sessions
              </span>
            </div>
          </div>
          <span className="text-body-small font-medium">
            {formatCurrency(project.total_cost)}
          </span>
        </div>
      );
    });
  }, [currentStats, formatCurrency, selectedEngine]);

  // Memoize timeline chart data
  const timelineChartData = useMemo(() => {
    const byDate = currentStats?.by_date;
    if (!byDate || byDate.length === 0) return null;

    const maxCost = Math.max(...byDate.map((d: any) => d.total_cost), 0);
    const halfMaxCost = maxCost / 2;

    return {
      maxCost,
      halfMaxCost,
      bars: byDate.map((day: any) => ({
        ...day,
        heightPercent: maxCost > 0 ? (day.total_cost / maxCost) * 100 : 0,
        date: new Date(day.date.replace(/-/g, '/')),
      }))
    };
  }, [currentStats?.by_date]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto flex flex-col h-full">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('usageDashboard.backToHome')}
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-heading-1">{t('usageDashboard.title')}</h1>
              <p className="mt-1 text-body-small text-muted-foreground">
                {t('usageDashboard.subtitle')}
              </p>
            </div>
            {/* Date Range Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <div className="flex space-x-1">
                {(["today", "7d", "30d", "all"] as const).map((range) => (
                  <Button
                    key={range}
                    variant={selectedDateRange === range ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDateRange(range)}
                    disabled={loading}
                  >
                    {range === "today" ? t('usageDashboard.today') : range === "all" ? t('usageDashboard.all') : range === "7d" ? t('usageDashboard.last7Days') : t('usageDashboard.last30Days')}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Engine Selector */}
          <div className="mt-4">
            <div className="flex items-center space-x-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <div className="flex space-x-1">
                <Button
                  variant={selectedEngine === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedEngine("all")}
                  disabled={loading}
                  className="gap-1.5"
                >
                  <span>全部引擎</span>
                </Button>
                <Button
                  variant={selectedEngine === "claude" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedEngine("claude")}
                  disabled={loading}
                  className="gap-1.5"
                  style={{ borderColor: selectedEngine === "claude" ? ENGINE_COLORS.claude : undefined }}
                >
                  <ClaudeIcon className="h-3.5 w-3.5" />
                  <span>Claude</span>
                  {stats && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {formatCurrency(stats.total_cost)}
                    </Badge>
                  )}
                </Button>
                <Button
                  variant={selectedEngine === "codex" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedEngine("codex")}
                  disabled={loading}
                  className="gap-1.5"
                  style={{ borderColor: selectedEngine === "codex" ? ENGINE_COLORS.codex : undefined }}
                >
                  <CodexIcon className="h-3.5 w-3.5" />
                  <span>Codex</span>
                  {codexStats && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {formatCurrency(codexStats.total_cost)}
                    </Badge>
                  )}
                </Button>
                <Button
                  variant={selectedEngine === "gemini" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedEngine("gemini")}
                  disabled={loading}
                  className="gap-1.5"
                  style={{ borderColor: selectedEngine === "gemini" ? ENGINE_COLORS.gemini : undefined }}
                >
                  <GeminiIcon className="h-3.5 w-3.5" />
                  <span>Gemini</span>
                  {geminiStats && (
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {formatCurrency(geminiStats.total_cost)}
                    </Badge>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-body-small text-destructive">
              {error}
              <Button onClick={() => loadUsageStats()} size="sm" className="ml-4">
                Try Again
              </Button>
            </div>
          ) : currentStats ? (
            <div className="space-y-6">
              {/* Engine Stats Cards (only show in "all" mode) */}
              {selectedEngine === "all" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {aggregatedStats.byEngine.map((engine) => {
                    const EngineIcon = engine.engine === 'claude' ? ClaudeIcon :
                                       engine.engine === 'codex' ? CodexIcon : GeminiIcon;
                    const engineColor = ENGINE_COLORS[engine.engine];
                    return (
                      <Card
                        key={engine.engine}
                        className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                        style={{ borderLeft: `4px solid ${engineColor}` }}
                        onClick={() => setSelectedEngine(engine.engine)}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <EngineIcon className="h-5 w-5" style={{ color: engineColor }} />
                          <span className="font-medium">{ENGINE_LABELS[engine.engine]}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">成本</p>
                            <p className="font-semibold">{formatCurrency(engine.cost)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">会话</p>
                            <p className="font-semibold">{formatNumber(engine.sessions)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Token</p>
                            <p className="font-semibold">{formatTokens(engine.tokens)}</p>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Summary Cards */}
              {summaryCards}

              {/* Tabs for different views */}
              <Tabs value={activeTab} onValueChange={(value) => {
                setActiveTab(value);
                setHasLoadedTabs(prev => new Set([...prev, value]));
              }} className="w-full">
                <TabsList className="grid grid-cols-5 w-full mb-6 h-auto p-1">
                  <TabsTrigger value="overview" className="py-2.5 px-3">{t('common.overview')}</TabsTrigger>
                  <TabsTrigger value="models" className="py-2.5 px-3">{t('usage.byModel')}</TabsTrigger>
                  <TabsTrigger value="projects" className="py-2.5 px-3">{t('usage.byProject')}</TabsTrigger>
                  <TabsTrigger value="sessions" className="py-2.5 px-3">{t('common.sessions')}</TabsTrigger>
                  <TabsTrigger value="timeline" className="py-2.5 px-3">{t('common.timeline')}</TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-6 mt-6">
                  <Card className="p-6">
                    <h3 className="text-label mb-4">{t('usageDashboard.tokenStats')}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-caption text-muted-foreground">{t('usageDashboard.inputTokens')}</p>
                        <p className="text-heading-4">{formatTokens(currentStats?.total_input_tokens || 0)}</p>
                      </div>
                      <div>
                        <p className="text-caption text-muted-foreground">{t('usageDashboard.outputTokens')}</p>
                        <p className="text-heading-4">{formatTokens(currentStats?.total_output_tokens || 0)}</p>
                      </div>
                      <div>
                        <p className="text-caption text-muted-foreground">{t('usageDashboard.cacheWrite')}</p>
                        <p className="text-heading-4">{formatTokens(currentStats?.total_cache_creation_tokens || 0)}</p>
                      </div>
                      <div>
                        <p className="text-caption text-muted-foreground">{t('usageDashboard.cacheRead')}</p>
                        <p className="text-heading-4">{formatTokens(currentStats?.total_cache_read_tokens || 0)}</p>
                      </div>
                    </div>
                  </Card>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="p-6">
                      <h3 className="text-label mb-4">{t('usageDashboard.mostUsedModels')}</h3>
                      <div className="space-y-3">
                        {mostUsedModels}
                      </div>
                    </Card>

                    <Card className="p-6">
                      <h3 className="text-label mb-4">{t('usageDashboard.topProjects')}</h3>
                      <div className="space-y-3">
                        {topProjects}
                      </div>
                    </Card>
                  </div>
                </TabsContent>

                {/* Models Tab - Lazy render and cache */}
                <TabsContent value="models" className="space-y-6 mt-6">
                  {hasLoadedTabs.has("models") && currentStats && (
                    <div style={{ display: activeTab === "models" ? "block" : "none" }}>
                      <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold">{t('usageDashboard.modelStats')}</h3>
                          <span className="text-xs text-muted-foreground">
                            {currentStats.by_model?.length || 0} 个模型
                          </span>
                        </div>
                        <div className="space-y-4">
                          {(currentStats.by_model || []).map((model: ModelUsage & { engine?: EngineType }) => {
                            const engineColor = model.engine ? ENGINE_COLORS[model.engine] : ENGINE_COLORS.claude;
                            const EngineIcon = model.engine === 'codex' ? CodexIcon :
                                               model.engine === 'gemini' ? GeminiIcon : ClaudeIcon;
                            return (
                              <div key={`${model.engine || 'claude'}-${model.model}`} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3">
                                    {selectedEngine === 'all' && (
                                      <EngineIcon
                                        className="h-4 w-4 flex-shrink-0"
                                        style={{ color: engineColor }}
                                      />
                                    )}
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                      style={{ borderColor: selectedEngine === 'all' ? engineColor : undefined }}
                                    >
                                      {getModelDisplayName(model.model)}
                                    </Badge>
                                    <span className="text-sm text-muted-foreground">
                                      {model.session_count} sessions
                                    </span>
                                  </div>
                                  <span className="text-sm font-semibold">
                                    {formatCurrency(model.total_cost)}
                                  </span>
                                </div>
                                <div className="grid grid-cols-4 gap-2 text-xs">
                                  <div>
                                    <span className="text-muted-foreground">Input: </span>
                                    <span className="font-medium">{formatTokens(model.input_tokens)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Output: </span>
                                    <span className="font-medium">{formatTokens(model.output_tokens)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Cache W: </span>
                                    <span className="font-medium">{formatTokens(model.cache_creation_tokens || 0)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Cache R: </span>
                                    <span className="font-medium">{formatTokens(model.cache_read_tokens || 0)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    </div>
                  )}
                </TabsContent>

                {/* Projects Tab - Lazy render and cache */}
                <TabsContent value="projects" className="space-y-6 mt-6">
                  {hasLoadedTabs.has("projects") && currentStats && (
                    <div style={{ display: activeTab === "projects" ? "block" : "none" }}>
                      <Card className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold">{t('usageDashboard.projectStats')}</h3>
                        <span className="text-xs text-muted-foreground">
                          {currentStats.by_project?.length || 0} {t('usageDashboard.totalProjects')}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          const projects = currentStats.by_project || [];
                          const startIndex = (projectsPage - 1) * ITEMS_PER_PAGE;
                          const endIndex = startIndex + ITEMS_PER_PAGE;
                          const paginatedProjects = projects.slice(startIndex, endIndex);
                          const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);

                          return (
                            <>
                              {paginatedProjects.map((project: ProjectUsage & { engine?: EngineType }) => {
                                const engineColor = project.engine ? ENGINE_COLORS[project.engine] : ENGINE_COLORS.claude;
                                const EngineIcon = project.engine === 'codex' ? CodexIcon :
                                                   project.engine === 'gemini' ? GeminiIcon : ClaudeIcon;
                                return (
                                  <div key={`${project.engine || 'claude'}-${project.project_path}`} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                    <div className="flex items-center gap-2 truncate">
                                      {selectedEngine === 'all' && (
                                        <EngineIcon
                                          className="h-4 w-4 flex-shrink-0"
                                          style={{ color: engineColor }}
                                        />
                                      )}
                                      <div className="flex flex-col truncate">
                                        <span className="text-sm font-medium truncate" title={project.project_path}>
                                          {project.project_path}
                                        </span>
                                        <div className="flex items-center space-x-3 mt-1">
                                          <span className="text-caption text-muted-foreground">
                                            {project.session_count} sessions
                                          </span>
                                          <span className="text-caption text-muted-foreground">
                                            {formatTokens(project.total_tokens)} tokens
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-semibold">{formatCurrency(project.total_cost)}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatCurrency(project.total_cost / project.session_count)}/session
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}

                              {/* Pagination Controls */}
                              {totalPages > 1 && (
                                <div className="flex items-center justify-between pt-4">
                                  <span className="text-xs text-muted-foreground">
                                    Showing {startIndex + 1}-{Math.min(endIndex, projects.length)} of {projects.length}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setProjectsPage(prev => Math.max(1, prev - 1))}
                                      disabled={projectsPage === 1}
                                    >
                                      <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-sm">
                                      Page {projectsPage} of {totalPages}
                                    </span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setProjectsPage(prev => Math.min(totalPages, prev + 1))}
                                      disabled={projectsPage === totalPages}
                                    >
                                      <ChevronRight className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </>
                          );
                          })()}
                        </div>
                      </Card>
                    </div>
                  )}
                </TabsContent>

                {/* Sessions Tab - Lazy render and cache */}
                <TabsContent value="sessions" className="space-y-6 mt-6">
                  {hasLoadedTabs.has("sessions") && (
                    <div style={{ display: activeTab === "sessions" ? "block" : "none" }}>
                      <Card className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold">{t('usageDashboard.sessionStats')}</h3>
                        {sessionStats && sessionStats.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {sessionStats.length} {t('usageDashboard.totalSessionsCount')}
                          </span>
                        )}
                      </div>
                      <div className="space-y-3">
                        {sessionStats && sessionStats.length > 0 ? (() => {
                          const startIndex = (sessionsPage - 1) * ITEMS_PER_PAGE;
                          const endIndex = startIndex + ITEMS_PER_PAGE;
                          const paginatedSessions = sessionStats.slice(startIndex, endIndex);
                          const totalPages = Math.ceil(sessionStats.length / ITEMS_PER_PAGE);
                          
                          return (
                            <>
                              {paginatedSessions.map((session, index) => (
                                <div key={`${session.project_path}-${session.project_name}-${startIndex + index}`} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                  <div className="flex flex-col">
                                    <div className="flex items-center space-x-2">
                                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]" title={session.project_path}>
                                        {session.project_path.split('/').slice(-2).join('/')}
                                      </span>
                                    </div>
                                    <span className="text-sm font-medium mt-1">
                                      {session.project_name}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-semibold">{formatCurrency(session.total_cost)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {session.last_used ? new Date(session.last_used).toLocaleDateString() : 'N/A'}
                                    </p>
                                  </div>
                                </div>
                              ))}
                              
                              {/* Pagination Controls */}
                              {totalPages > 1 && (
                                <div className="flex items-center justify-between pt-4">
                                  <span className="text-xs text-muted-foreground">
                                    Showing {startIndex + 1}-{Math.min(endIndex, sessionStats.length)} of {sessionStats.length}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setSessionsPage(prev => Math.max(1, prev - 1))}
                                      disabled={sessionsPage === 1}
                                    >
                                      <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-sm">
                                      Page {sessionsPage} of {totalPages}
                                    </span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setSessionsPage(prev => Math.min(totalPages, prev + 1))}
                                      disabled={sessionsPage === totalPages}
                                    >
                                      <ChevronRight className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </>
                          );
                        })() : (
                          <div className="text-center py-8 text-sm text-muted-foreground">
                            {t('usageDashboard.noSessionData')}
                          </div>
                          )}
                        </div>
                      </Card>
                    </div>
                  )}
                </TabsContent>

                {/* Timeline Tab - Lazy render and cache */}
                <TabsContent value="timeline" className="space-y-6 mt-6">
                  {hasLoadedTabs.has("timeline") && currentStats && (
                    <div style={{ display: activeTab === "timeline" ? "block" : "none" }}>
                      <Card className="p-6">
                      <h3 className="text-sm font-semibold mb-6 flex items-center space-x-2">
                        <Calendar className="h-4 w-4" />
                        <span>{t('usageDashboard.dailyUsage')}</span>
                      </h3>
                      {timelineChartData ? (
                        <div className="relative pr-4">

                          {/* Chart container - SVG bar chart */}
                          <div className="relative border-b border-border" style={{ height: '256px' }}>
                            <svg width="100%" height="256" style={{ overflow: 'visible' }}>
                              <defs>
                                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" style={{ stopColor: 'var(--color-primary)', stopOpacity: 1 }} />
                                  <stop offset="100%" style={{ stopColor: 'var(--color-primary)', stopOpacity: 0.6 }} />
                                </linearGradient>
                              </defs>
                              {timelineChartData.bars.map((day, index) => {
                                const barCount = timelineChartData.bars.length;
                                const totalWidth = 100;
                                const barWidthPercent = totalWidth / barCount;
                                const gapPercent = barWidthPercent * 0.4;
                                const actualBarWidth = barWidthPercent - gapPercent;
                                const x = `${index * barWidthPercent + gapPercent / 2}%`;
                                const barHeight = Math.max(day.total_cost > 0 ? 2 : 0, Math.round(256 * day.heightPercent / 100));
                                const y = 256 - barHeight;
                                const centerX = `${index * barWidthPercent + barWidthPercent / 2}%`;
                                const formattedDate = day.date.toLocaleDateString('en-US', {
                                  weekday: 'short',
                                  month: 'short',
                                  day: 'numeric'
                                });
                                const cnDate = `${day.date.getMonth() + 1}/${day.date.getDate()}`;

                                return (
                                  <g key={day.date.toISOString()} className="group">
                                    {/* Cost label above bar */}
                                    {day.total_cost > 0 && (
                                      <text
                                        x={centerX}
                                        y={y - 6}
                                        textAnchor="middle"
                                        style={{ fontSize: '10px', fill: 'var(--color-muted-foreground)' }}
                                      >
                                        {formatCurrency(day.total_cost)}
                                      </text>
                                    )}
                                    <rect
                                      x={x}
                                      y={y}
                                      width={`${actualBarWidth}%`}
                                      height={barHeight}
                                      rx="4"
                                      fill="url(#barGradient)"
                                      className="hover:opacity-80 transition-opacity cursor-pointer"
                                    />
                                    <title>{`${formattedDate}\n${formatCurrency(day.total_cost)}\n${formatTokens(day.total_tokens)} tokens`}</title>
                                    <text
                                      x={centerX}
                                      y={256 + 16}
                                      textAnchor="middle"
                                      style={{ fontSize: '11px', fill: 'var(--color-muted-foreground)' }}
                                    >
                                      {cnDate}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          </div>

                          {/* X-axis label */}
                          <div className="mt-10 text-center text-xs text-muted-foreground">
                            {t('usageDashboard.dailyUsageTrend')}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          {t('usageDashboard.noUsageData')}
                        </div>
                        )}
                      </Card>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};