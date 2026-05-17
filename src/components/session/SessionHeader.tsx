import React from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { FolderOpen, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Project } from "@/lib/api";

interface SessionHeaderProps {
  projectPath: string;
  setProjectPath: (path: string) => void;
  handleSelectPath: () => void;
  recentProjects: Project[];
  isLoading: boolean;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  projectPath,
  setProjectPath,
  handleSelectPath,
  recentProjects,
  isLoading
}) => {
  const { t } = useTranslation();
  
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="flex-shrink min-h-0 overflow-y-auto border-b border-[var(--surface-hairline-soft)] bg-[var(--surface-panel-muted)] p-6"
    >
      {/* Header section */}
      <div className="mx-auto max-w-3xl space-y-4">
        {!projectPath && (
          <div className="app-workbench-surface mb-6 rounded-xl p-6 text-center">
            <FolderOpen className="h-10 w-10 mx-auto mb-3 text-primary" />
            <h3 className="text-lg font-semibold mb-2">{t('sessionHeader.selectProjectDirectory')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('sessionHeader.selectProjectPrompt')}
            </p>
          </div>
        )}

        {/* Project path input */}
        <div className="space-y-2">
          <Label htmlFor="project-path" className="text-sm font-medium">
            {t('sessionHeader.projectPath')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="project-path"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder={t('sessionHeader.projectPathPlaceholder')}
              className="flex-1"
              disabled={isLoading}
            />
            <Button
              onClick={handleSelectPath}
              variant="outline"
              disabled={isLoading}
              className="gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              {t('sessionHeader.browse')}
            </Button>
          </div>
        </div>

        {/* Recent projects list */}
        {!projectPath && recentProjects.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{t('sessionHeader.recentProjects')}</span>
            </div>
            <div className="grid gap-2">
              {recentProjects.map((project) => (
                <Button
                  key={project.id}
                  variant="outline"
                  className="justify-start h-auto py-3 px-4 bg-[var(--surface-panel)]"
                  onClick={() => {
                    setProjectPath(project.path);
                  }}
                >
                  <div className="flex flex-col items-start gap-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 w-full">
                      <FolderOpen className="h-4 w-4 flex-shrink-0 text-primary" />
                      <span className="font-medium text-sm truncate">
                        {project.path.split('/').pop() || project.path.split('\\').pop()}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate w-full">
                      {project.path}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
