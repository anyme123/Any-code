import React, { useState, useEffect } from "react";
import { ArrowLeft, Clock, Plus, Trash2, CheckSquare, Square, FilePenLine, Loader2, Zap, Bot, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn, filterValidSessions } from "@/lib/utils";
import { formatUnixTimestamp, formatISOTimestamp, truncateText, getFirstLine } from "@/lib/date-utils";
import type { Session, ClaudeMdFile } from "@/lib/api";
import { api } from "@/lib/api";
import { useTranslation } from '@/hooks/useTranslation';

interface SessionListProps {
  /**
   * Array of sessions to display
   */
  sessions: Session[];
  /**
   * The current project path being viewed
   */
  projectPath: string;
  /**
   * Callback to go back to project list
   */
  onBack: () => void;
  /**
   * Callback when a session is clicked
   */
  onSessionClick?: (session: Session) => void;
  /**
   * Callback when a session should be deleted
   */
  onSessionDelete?: (sessionId: string, projectId: string) => Promise<void>;
  /**
   * Callback when multiple sessions should be deleted
   */
  onSessionsBatchDelete?: (sessionIds: string[], projectId: string) => Promise<void>;
  /**
   * Callback when a CLAUDE.md file should be edited
   */
  onEditClaudeFile?: (file: ClaudeMdFile) => void;
  /**
   * Callback when new session button is clicked
   */
  onNewSession?: (projectPath: string) => void;
  /**
   * Callback when a session should be converted
   */
  onSessionConvert?: (sessionId: string, targetEngine: 'claude' | 'codex', projectId: string, projectPath: string) => Promise<void>;
  /**
   * Optional className for styling
   */
  className?: string;
}

const ITEMS_PER_PAGE = 20;

/**
 * Session filter type
 */
type SessionFilter = 'all' | 'claude' | 'codex' | 'gemini';

/**
 * SessionList component - Displays paginated sessions for a specific project
 *
 * @example
 * <SessionList
 *   sessions={sessions}
 *   projectPath="/Users/example/project"
 *   onBack={() => setSelectedProject(null)}
 *   onSessionClick={(session) => console.log('Selected session:', session)}
 * />
 */
export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  projectPath,
  onBack,
  onSessionClick,
  onSessionDelete,
  onSessionsBatchDelete,
  onEditClaudeFile,
  onNewSession,
  onSessionConvert,
  className,
}) => {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [claudeMdFiles, setClaudeMdFiles] = useState<ClaudeMdFile[]>([]);
  const [loadingClaudeMd, setLoadingClaudeMd] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Conversion dialog state
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [sessionToConvert, setSessionToConvert] = useState<Session | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Multi-selection mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  // Session filter state
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');

  // Load CLAUDE.md files on mount
  useEffect(() => {
    if (onEditClaudeFile && projectPath) {
      loadClaudeMdFiles();
    }
  }, [projectPath, onEditClaudeFile]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedSessions(new Set());
    setIsSelectionMode(false);
  }, [sessionFilter]);

  const loadClaudeMdFiles = async () => {
    try {
      setLoadingClaudeMd(true);
      const files = await api.findClaudeMdFiles(projectPath);
      setClaudeMdFiles(files);
    } catch (err) {
      console.error('Failed to load CLAUDE.md files:', err);
      setClaudeMdFiles([]);
    } finally {
      setLoadingClaudeMd(false);
    }
  };

  const handleEditClaudeMd = () => {
    if (!onEditClaudeFile) return;

    // Find the main CLAUDE.md file (at project root)
    const mainFile = claudeMdFiles.find(f => f.relative_path === 'CLAUDE.md');

    if (mainFile) {
      onEditClaudeFile(mainFile);
    } else if (claudeMdFiles.length > 0) {
      // If no main CLAUDE.md, open the first one found
      onEditClaudeFile(claudeMdFiles[0]);
    }
  };

  // 🔧 过滤掉空白无用的会话（没有 first_message 或 id 为空的）
  // 使用共享的会话验证函数，确保与项目计数逻辑一致
  const validSessions = filterValidSessions(sessions);

  // 🆕 根据筛选器过滤会话类型
  const filteredSessions = validSessions.filter(session => {
    if (sessionFilter === 'all') return true;

    // Claude: explicitly 'claude' or undefined (legacy sessions)
    if (sessionFilter === 'claude') {
      return !session.engine || session.engine === 'claude';
    }

    // Codex: only 'codex'
    if (sessionFilter === 'codex') {
      return session.engine === 'codex';
    }

    // Gemini: only 'gemini'
    if (sessionFilter === 'gemini') {
      return session.engine === 'gemini';
    }

    return true;
  });

  // 🔧 按活跃度排序：优先使用最后一条消息时间，其次第一条消息时间，最后使用创建时间
  const sortedSessions = [...filteredSessions].sort((a, b) => {
    // 获取会话 A 的最后活跃时间
    const timeA = a.last_message_timestamp
      ? new Date(a.last_message_timestamp).getTime()
      : a.message_timestamp
      ? new Date(a.message_timestamp).getTime()
      : a.created_at * 1000;

    // 获取会话 B 的最后活跃时间
    const timeB = b.last_message_timestamp
      ? new Date(b.last_message_timestamp).getTime()
      : b.message_timestamp
      ? new Date(b.message_timestamp).getTime()
      : b.created_at * 1000;

    return timeB - timeA; // 降序：最新的在前
  });

  // Calculate pagination
  const totalPages = Math.ceil(sortedSessions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentSessions = sortedSessions.slice(startIndex, endIndex);

  // Smart pagination adjustment: if current page becomes empty after deletion, go to previous page
  React.useEffect(() => {
    if (sortedSessions.length > 0 && currentSessions.length === 0 && currentPage > 1) {
      // Current page is empty but not the first page, go to previous page
      setCurrentPage(currentPage - 1);
    }
  }, [sortedSessions.length, currentSessions.length, currentPage]);

  // Handle delete button click
  const handleDeleteClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation(); // Prevent triggering onSessionClick
    setSessionToDelete(session);
    setDeleteDialogOpen(true);
  };

  // Confirm deletion
  const confirmDelete = async () => {
    if (!sessionToDelete || !onSessionDelete) return;

    try {
      setIsDeleting(true);
      // Call the parent handler which will handle both Claude and Codex sessions
      await onSessionDelete(sessionToDelete.id, sessionToDelete.project_id);
      setDeleteDialogOpen(false);
      setSessionToDelete(null);
    } catch (error) {
      console.error("Failed to delete session:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Cancel deletion
  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setSessionToDelete(null);
  };

  // Toggle selection mode
  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedSessions(new Set());
  };

  // Toggle session selection
  const toggleSessionSelection = (sessionId: string) => {
    const newSelected = new Set(selectedSessions);
    if (newSelected.has(sessionId)) {
      newSelected.delete(sessionId);
    } else {
      newSelected.add(sessionId);
    }
    setSelectedSessions(newSelected);
  };

  // Select all sessions on current page
  const selectAllOnPage = () => {
    if (selectedSessions.size === currentSessions.length) {
      setSelectedSessions(new Set());
    } else {
      const newSelected = new Set(currentSessions.map(s => s.id));
      setSelectedSessions(newSelected);
    }
  };

  // Batch delete selected sessions
  const handleBatchDelete = async () => {
    if (selectedSessions.size === 0 || !onSessionsBatchDelete) return;

    try {
      setIsDeleting(true);
      const sessionIds = Array.from(selectedSessions);
      // Get the project_id from the first session
      const firstSession = sessions.find(s => s.id === sessionIds[0]);
      if (firstSession) {
        // Parent handler will separate Claude/Codex sessions and delete accordingly
        await onSessionsBatchDelete(sessionIds, firstSession.project_id);
        setSelectedSessions(new Set());
        setIsSelectionMode(false);
      }
    } catch (error) {
      console.error("Failed to batch delete sessions:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle convert button click
  const handleConvertClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setSessionToConvert(session);
    setConvertDialogOpen(true);
  };

  // Confirm conversion
  const confirmConvert = async () => {
    if (!sessionToConvert || !onSessionConvert) return;

    try {
      setIsConverting(true);
      const targetEngine = sessionToConvert.engine === 'codex' ? 'claude' : 'codex';
      await onSessionConvert(sessionToConvert.id, targetEngine, sessionToConvert.project_id, projectPath);
      setConvertDialogOpen(false);
      setSessionToConvert(null);
    } catch (error) {
      console.error("Failed to convert session:", error);
    } finally {
      setIsConverting(false);
    }
  };

  // Cancel conversion
  const cancelConvert = () => {
    setConvertDialogOpen(false);
    setSessionToConvert(null);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* 🎯 重构后的布局：项目信息 + Edit CLAUDE.md 按钮在同一行 */}
      <div className="app-workbench-surface flex items-center justify-between gap-4 rounded-xl p-4">
        {/* 左侧：返回按钮 + 项目信息 */}
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <Button
            variant="outline"
            size="default"
            onClick={onBack}
            className="h-10 px-4 flex-shrink-0 bg-[var(--surface-panel)]"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span>{t('sessionList.backToProjects')}</span>
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-medium truncate">{projectPath}</h2>
            <p className="text-xs text-muted-foreground">
              {filteredSessions.length} {sessionFilter === 'all' ? 'session' : sessionFilter} session{filteredSessions.length !== 1 ? 's' : ''}
              {sessionFilter === 'all' && sessions.length !== validSessions.length && (
                <span className="text-muted-foreground/70"> ({sessions.length - validSessions.length} hidden)</span>
              )}
            </p>
          </div>
        </div>

        {/* 右侧：Edit CLAUDE.md 按钮 */}
        {onEditClaudeFile && (
          <Button
            variant="outline"
            size="default"
            onClick={handleEditClaudeMd}
            disabled={loadingClaudeMd || claudeMdFiles.length === 0}
            className="h-10 px-4 flex-shrink-0"
            title={claudeMdFiles.length > 0 ? "Edit CLAUDE.md" : "No CLAUDE.md found"}
          >
            {loadingClaudeMd ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FilePenLine className="h-4 w-4 mr-2" />
            )}
            <span>Edit CLAUDE.md</span>
          </Button>
        )}
      </div>

      {/* 🆕 会话类型筛选器 */}
      <Tabs value={sessionFilter} onValueChange={(value) => {
        setSessionFilter(value as SessionFilter);
        setCurrentPage(1); // Reset to first page when filter changes
      }}>
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="all" className="flex items-center gap-2">
            {t('sessionList.all')}
            {validSessions.length > 0 && (
              <span className="text-xs opacity-70">({validSessions.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="claude" className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            Claude
            {validSessions.filter(s => !s.engine || s.engine === 'claude').length > 0 && (
              <span className="text-xs opacity-70">
                ({validSessions.filter(s => !s.engine || s.engine === 'claude').length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="codex" className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5" />
            Codex
            {validSessions.filter(s => s.engine === 'codex').length > 0 && (
              <span className="text-xs opacity-70">
                ({validSessions.filter(s => s.engine === 'codex').length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="gemini" className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Gemini
            {validSessions.filter(s => s.engine === 'gemini').length > 0 && (
              <span className="text-xs opacity-70">
                ({validSessions.filter(s => s.engine === 'gemini').length})
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 🎯 新布局：批量管理会话 + 新建会话按钮在同一行 */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--surface-hairline-soft)] bg-[var(--surface-panel-muted)] p-3">
        {/* 左侧：批量管理会话 */}
        <div className="flex items-center gap-2 flex-1">
          {onSessionsBatchDelete && validSessions.length > 0 && (
            <>
              {isSelectionMode ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllOnPage}
                  >
                    {selectedSessions.size === currentSessions.length ? (
                      <>
                        <CheckSquare className="h-4 w-4 mr-2" />
                        {t('sessionList.deselectAll')}
                      </>
                    ) : (
                      <>
                        <Square className="h-4 w-4 mr-2" />
                        {t('sessionList.selectAllOnPage')}
                      </>
                    )}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t('sessionList.selectedCount', { count: selectedSessions.size })}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t('sessionList.batchManage')}
                </span>
              )}
            </>
          )}
        </div>

        {/* 右侧：批量操作按钮 + 新建会话按钮 */}
        <div className="flex items-center gap-2">
          {isSelectionMode && selectedSessions.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? t('sessionList.deleting') : t('sessionList.deleteSelected', { count: selectedSessions.size })}
            </Button>
          )}

          {onSessionsBatchDelete && validSessions.length > 0 && (
            <Button
              variant={isSelectionMode ? "default" : "outline"}
              size="sm"
              onClick={toggleSelectionMode}
              disabled={isDeleting}
            >
              {isSelectionMode ? t('sessionList.cancelSelection') : t('sessionList.batchSelection')}
            </Button>
          )}

          {/* 新建会话按钮 */}
          {onNewSession && (
            <Button
              onClick={() => onNewSession(projectPath)}
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('claude.newSession')}
            </Button>
          )}
        </div>
      </div>

      {/* Compact session list */}
      <div
        className="overflow-hidden rounded-xl border border-[var(--surface-hairline-soft)] divide-y divide-[var(--surface-hairline-soft)] bg-[var(--surface-panel)]"
        role="list"
        aria-label={t('sessionList.sessionListLabel')}
        aria-live="polite"
      >
        {currentSessions.map((session) => {
          const firstMessagePreview = session.first_message
            ? truncateText(getFirstLine(session.first_message), 80)
            : session.id;
          const timeDisplay = session.last_message_timestamp
            ? formatISOTimestamp(session.last_message_timestamp)
            : session.message_timestamp
            ? formatISOTimestamp(session.message_timestamp)
            : formatUnixTimestamp(session.created_at);
          // Use engine + id as unique key to avoid conflicts between engines
          const uniqueKey = `${session.engine || 'claude'}-${session.id}`;

          return (
            <div
              key={uniqueKey}
              role="listitem"
              className={cn(
                "relative flex items-center group hover:bg-accent/50 transition-colors",
                session.todo_data && "bg-primary/5 border-l-2 border-l-primary",
                isSelectionMode && selectedSessions.has(session.id) && "bg-primary/10"
              )}
            >
              {/* Checkbox in selection mode */}
              {isSelectionMode && (
                <div className="px-3 py-2.5">
                  <Checkbox
                    checked={selectedSessions.has(session.id)}
                    onCheckedChange={() => toggleSessionSelection(session.id)}
                    aria-label={t('sessionList.selectSession', { name: firstMessagePreview })}
                  />
                </div>
              )}

              <button
                onClick={() => {
                  if (isSelectionMode) {
                    toggleSessionSelection(session.id);
                  } else {
                    onSessionClick?.(session);
                  }
                }}
                className="flex-1 text-left px-4 py-2.5 min-w-0"
                aria-label={t('sessionList.sessionAriaLabel', { name: firstMessagePreview, time: timeDisplay })}
              >
              <div className="flex items-center justify-between gap-3">
                {/* Session info */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  {/* First message preview with engine badge */}
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors flex-1 min-w-0">
                      {firstMessagePreview}
                    </p>
                    {/* 🆕 Engine type badge */}
                    {session.engine === 'codex' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-info/10 text-info border border-info/20 shrink-0">
                        <Bot className="h-3 w-3" />
                        Codex
                      </span>
                    ) : session.engine === 'gemini' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 shrink-0">
                        <Sparkles className="h-3 w-3" />
                        Gemini
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 shrink-0">
                        <Zap className="h-3 w-3" />
                        Claude
                      </span>
                    )}
                  </div>

                  {/* Session ID (small and subtle) */}
                  <p className="text-xs font-mono text-muted-foreground truncate" aria-label={t('sessionList.sessionIdLabel', { id: session.id })}>
                    {session.id}
                  </p>
                </div>

                {/* Timestamp - 优先显示最后一条消息时间 */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <time dateTime={session.last_message_timestamp || session.message_timestamp || new Date(session.created_at * 1000).toISOString()}>
                    {timeDisplay}
                  </time>
                </div>
              </div>
            </button>

            {/* Convert button - shown on hover (hidden in selection mode) */}
            {!isSelectionMode && onSessionConvert && (
              <button
                onClick={(e) => handleConvertClick(e, session)}
                className="px-3 py-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-primary/10 text-primary"
                aria-label={t('sessionList.convertTo', { engine: session.engine === 'codex' ? 'Claude' : 'Codex' })}
                title={t('sessionList.experimentalConvert', { engine: session.engine === 'codex' ? 'Claude' : 'Codex' })}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            {/* Delete button - shown on hover (hidden in selection mode) */}
            {!isSelectionMode && onSessionDelete && (
              <button
                onClick={(e) => handleDeleteClick(e, session)}
                className="px-3 py-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-destructive/10 text-destructive"
                aria-label={t('sessionList.deleteSession', { name: firstMessagePreview })}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          );
        })}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sessionList.confirmDelete')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              {t('sessionList.deleteWarning')}
            </p>
            {sessionToDelete && (
              <div className="mt-3 p-3 bg-muted rounded-md">
                <p className="text-sm font-medium text-foreground">
                  {sessionToDelete.first_message
                    ? truncateText(getFirstLine(sessionToDelete.first_message), 60)
                    : sessionToDelete.id}
                </p>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {sessionToDelete.id}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelDelete}
              disabled={isDeleting}
            >
              {t('sessionList.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? t('sessionList.deleting') : t('sessionList.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert confirmation dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sessionList.convertTitle')}</DialogTitle>
            <DialogDescription>
              {t('sessionList.convertDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {/* 实验性功能警告 */}
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
              <div className="flex items-start gap-2">
                <span className="text-yellow-600 dark:text-yellow-400 text-lg shrink-0">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">
                    {t('sessionList.experimentalFeature')}
                  </p>
                  <p className="text-xs text-yellow-600/90 dark:text-yellow-400/90 mt-1">
                    {t('sessionList.experimentalWarning')}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              {t('sessionList.confirmConvertTo', { engine: sessionToConvert?.engine === 'codex' ? 'Claude' : 'Codex' })}
            </p>
            <div className="space-y-3">
              {sessionToConvert && (
                <div className="p-3 bg-muted rounded-md">
                  <div className="flex items-center gap-2 mb-2">
                    {sessionToConvert.engine === 'codex' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-info/10 text-info border border-info/20">
                        <Bot className="h-3 w-3" />
                        Codex
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                        <Zap className="h-3 w-3" />
                        Claude
                      </span>
                    )}
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    {sessionToConvert.engine === 'codex' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                        <Zap className="h-3 w-3" />
                        Claude
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-info/10 text-info border border-info/20">
                        <Bot className="h-3 w-3" />
                        Codex
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {sessionToConvert.first_message
                      ? truncateText(getFirstLine(sessionToConvert.first_message), 60)
                      : sessionToConvert.id}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    {sessionToConvert.id}
                  </p>
                </div>
              )}
              <div className="p-3 bg-info/5 border border-info/20 rounded-md">
                <p className="text-sm text-info">
                  ℹ️ {t('sessionList.convertNotes')}
                </p>
                <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                  <li>{t('sessionList.convertNote1')}</li>
                  <li>{t('sessionList.convertNote2')}</li>
                  <li>{t('sessionList.convertNote3')}</li>
                  <li>{t('sessionList.convertNote4')}</li>
                </ul>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelConvert}
              disabled={isConverting}
            >
              {t('sessionList.cancel')}
            </Button>
            <Button
              onClick={confirmConvert}
              disabled={isConverting}
              className="bg-primary"
            >
              {isConverting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('sessionList.converting')}
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('sessionList.confirmConvert')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
