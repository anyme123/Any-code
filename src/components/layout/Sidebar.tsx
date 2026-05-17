import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Settings,
  BarChart2,
  Terminal,
  Layers,
  FileText,
  Package,
  FileCode,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { View } from '@/types/navigation';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UnifiedEngineStatus } from '@/components/UnifiedEngineStatus';
import { UpdateBadge } from '@/components/common/UpdateBadge';
import { ThemeToggle } from '@/components/ui/theme-toggle';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  className?: string;
  onAboutClick?: () => void;
  onUpdateClick?: () => void;
}

interface NavItem {
  view: View;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
}

const STORAGE_KEY = 'sidebar_expanded';

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  className,
  onAboutClick,
  onUpdateClick
}) => {
  const { t } = useTranslation();

  // 展开/收起状态，从 localStorage 读取
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== null ? stored === 'true' : true; // 默认展开
  });

  // 持久化状态到 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded));
  }, [isExpanded]);

  // 会话页面时自动收起
  useEffect(() => {
    if (currentView === 'claude-code-session' || currentView === 'claude-tab-manager') {
      setIsExpanded(false);
    }
  }, [currentView]);

  const mainNavItems: NavItem[] = [
    { view: 'projects', icon: FolderOpen, label: t('common.ccProjectsTitle') },
    { view: 'claude-tab-manager', icon: Terminal, label: t('sidebar.sessionManagement') },
    { view: 'editor', icon: FileText, label: t('sidebar.claudePrompts') },
    { view: 'codex-editor', icon: FileCode, label: t('sidebar.codexPrompts') },
    { view: 'gemini-editor', icon: Sparkles, label: t('sidebar.geminiPrompts') },
    { view: 'usage-dashboard', icon: BarChart2, label: t('sidebar.usageStats') },
    { view: 'mcp', icon: Layers, label: t('sidebar.mcpTools') },
    { view: 'claude-extensions', icon: Package, label: t('sidebar.extensions') },
  ];

  const bottomNavItems: NavItem[] = [
    { view: 'settings', icon: Settings, label: t('navigation.settings') },
  ];

  const NavButton = ({ item }: { item: NavItem }) => {
    const isActive = currentView === item.view;

    const buttonContent = (
      <Button
        variant="ghost"
        className={cn(
          "relative rounded-lg transition-colors duration-150",
          isExpanded ? "w-full justify-start px-3 h-9" : "w-9 h-9",
          isActive
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/70"
        )}
        onClick={() => onNavigate(item.view)}
      >
        {isActive && isExpanded && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" aria-hidden="true" />
        )}
        <item.icon className="w-4 h-4" strokeWidth={isActive ? 2.4 : 2} />
        {isExpanded && (
          <span className="ml-2.5 min-w-0 truncate text-sm font-medium">{item.label}</span>
        )}
        {!isExpanded && <span className="sr-only">{item.label}</span>}
      </Button>
    );

    // 收起模式显示 Tooltip
    if (!isExpanded) {
      return (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-medium">{item.label}</span>
              {item.shortcut && (
                <span className="text-xs text-muted-foreground bg-muted px-1 rounded border">
                  {item.shortcut}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return buttonContent;
  };

  return (
    <div
      className={cn(
        "app-workbench-sidebar flex flex-col h-full transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
        isExpanded ? "w-56 px-3 py-3" : "w-14 items-center px-2 py-3",
        className
      )}
    >
      <div className={cn(
        "mb-3 flex h-10 w-full items-center",
        isExpanded ? "justify-between" : "justify-center"
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--surface-hairline-soft)] bg-[var(--surface-panel)] text-primary">
            <Terminal className="h-4 w-4" />
          </div>
          {isExpanded && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--text-strong)]">Any Code</div>
              <div className="truncate text-[11px] text-muted-foreground">Claude Workbench</div>
            </div>
          )}
        </div>
      </div>
      
      {/* 主导航区域 - overflow-y-auto + min-h-0 确保窗口过小时底部按钮仍可见 */}
      <div className={cn("flex-1 flex flex-col w-full min-h-0 overflow-y-auto", isExpanded ? "gap-1" : "items-center gap-1.5")}>
        {mainNavItems.map((item) => (
          <NavButton key={item.view} item={item} />
        ))}
      </div>

      {/* 底部状态区域 */}
      <div className={cn(
        "flex flex-col w-full mt-auto pt-3 border-t border-[var(--surface-hairline-soft)]",
        isExpanded ? "gap-3" : "items-center gap-2"
      )}>
        {/* 多引擎状态指示器 */}
        <div className={cn(isExpanded ? "w-full" : "flex justify-center w-full")}>
          <UnifiedEngineStatus
            compact={!isExpanded}
          />
        </div>

        {/* 更新徽章（展开模式） */}
        {isExpanded && (
          <div className="px-2">
            <UpdateBadge onClick={onUpdateClick} />
          </div>
        )}

        {/* 操作按钮行 */}
        <div className={cn(
          "flex items-center gap-1",
          isExpanded ? "justify-between px-1" : "flex-col"
        )}>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ThemeToggle size="sm" className="w-8 h-8" />
                </div>
              </TooltipTrigger>
              {!isExpanded && (
                <TooltipContent side="right">
                  <p>{t('sidebar.themeToggle')}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          {onAboutClick && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onAboutClick}
                    className="w-8 h-8 text-muted-foreground hover:text-foreground"
                    aria-label={t('sidebar.about')}
                  >
                    <HelpCircle className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                {!isExpanded && (
                  <TooltipContent side="right">
                    <p>{t('sidebar.about')}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* 设置和展开/收起按钮 */}
        <div className={cn(
          "flex items-center gap-1 pt-2 border-t border-[var(--surface-hairline-soft)]",
          isExpanded ? "justify-between px-2" : "flex-col"
        )}>
          {bottomNavItems.map((item) => (
            <NavButton key={item.view} item={item} />
          ))}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="w-8 h-8 text-muted-foreground hover:text-foreground"
                  aria-label={isExpanded ? t('sidebar.collapseSidebar') : t('sidebar.expandSidebar')}
                >
                  {isExpanded ? (
                    <ChevronLeft className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{isExpanded ? t('sidebar.collapseSidebar') : t('sidebar.expandSidebar')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
};
