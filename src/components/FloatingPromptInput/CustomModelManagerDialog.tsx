import React, { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, RefreshCw, Download, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CustomModel,
  addCustomModel,
  getCustomModels,
  removeCustomModel,
} from "./customModelStorage";
import { api, AnthropicModelInfo } from "@/lib/api";

interface CustomModelManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 自定义模型管理对话框
 *
 * 三块布局：
 *   1. 已添加模型列表（可删除）
 *   2. 手动添加（modelId + 显示名）
 *   3. 从 Provider /v1/models 接口拉取（多选 → 批量添加）
 */
export const CustomModelManagerDialog: React.FC<CustomModelManagerDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const [list, setList] = useState<CustomModel[]>([]);

  const [manualModelId, setManualModelId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [remoteModels, setRemoteModels] = useState<AnthropicModelInfo[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());

  // 打开时刷新本地列表
  useEffect(() => {
    if (open) {
      setList(getCustomModels());
      setManualError(null);
      setFetchError(null);
    }
  }, [open]);

  const handleAddManual = () => {
    const id = manualModelId.trim();
    if (!id) {
      setManualError("请填写 Model ID");
      return;
    }
    addCustomModel({
      modelId: id,
      name: manualName.trim() || id,
      source: "manual",
    });
    setManualModelId("");
    setManualName("");
    setManualError(null);
    setList(getCustomModels());
  };

  const handleRemove = (id: string) => {
    removeCustomModel(id);
    setList(getCustomModels());
  };

  const handleFetch = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const result = await api.fetchAnthropicModels();
      setRemoteModels(result);
      // 默认全部选中本地未存在的
      const existingIds = new Set(getCustomModels().map((m) => m.modelId));
      setSelectedRemote(
        new Set(result.filter((m) => !existingIds.has(m.id)).map((m) => m.id)),
      );
      if (result.length === 0) {
        setFetchError("接口返回空列表，请检查 Provider 是否支持 /v1/models");
      }
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
      setRemoteModels([]);
    } finally {
      setFetching(false);
    }
  };

  const handleImportSelected = () => {
    if (selectedRemote.size === 0) return;
    for (const modelId of selectedRemote) {
      const remote = remoteModels.find((m) => m.id === modelId);
      if (!remote) continue;
      addCustomModel({
        modelId: remote.id,
        name: remote.display_name || remote.id,
        source: "api",
      });
    }
    setSelectedRemote(new Set());
    setList(getCustomModels());
  };

  const toggleRemote = (id: string) => {
    setSelectedRemote((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>管理自定义模型</DialogTitle>
          <DialogDescription>
            添加自定义 Claude 兼容模型。手动输入 Model ID 或从当前 Provider 接口拉取。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {/* 已添加列表 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">已添加的模型</h3>
              <span className="text-xs text-muted-foreground">{list.length} 个</span>
            </div>
            {list.length === 0 ? (
              <div className="text-xs text-muted-foreground border border-dashed border-border/50 rounded-md p-4 text-center">
                暂未添加自定义模型
              </div>
            ) : (
              <div className="border border-border/50 rounded-md divide-y divide-border/40 max-h-48 overflow-y-auto">
                {list.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 p-2.5 hover:bg-accent/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{m.name}</div>
                      <div className="text-xs text-muted-foreground truncate font-mono">
                        {m.modelId}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded",
                        m.source === "api"
                          ? "bg-blue-500/10 text-blue-500"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {m.source === "api" ? "API" : "手动"}
                    </span>
                    <button
                      onClick={() => handleRemove(m.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 手动添加 */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">手动添加</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                placeholder="Model ID (如 claude-3-5-sonnet-20241022)"
                value={manualModelId}
                onChange={(e) => setManualModelId(e.target.value)}
                inputSize="sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddManual();
                }}
              />
              <Input
                placeholder="显示名称（可选）"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                inputSize="sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddManual();
                }}
              />
            </div>
            {manualError && (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                {manualError}
              </div>
            )}
            <Button
              size="sm"
              onClick={handleAddManual}
              disabled={!manualModelId.trim()}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </Button>
          </section>

          {/* 接口拉取 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">从 Provider 接口拉取</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetch}
                disabled={fetching}
                className="gap-1.5 h-7"
              >
                {fetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {remoteModels.length > 0 ? "重新拉取" : "拉取列表"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              调用当前 Provider 的 <code className="font-mono">/v1/models</code> 接口（需先在「代理商」中配置 Auth Token / API Key）。
            </p>
            {fetchError && (
              <div className="flex items-start gap-1.5 text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md p-2">
                <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span className="break-all">{fetchError}</span>
              </div>
            )}
            {remoteModels.length > 0 && (
              <>
                <div className="border border-border/50 rounded-md divide-y divide-border/40 max-h-56 overflow-y-auto">
                  {remoteModels.map((m) => {
                    const checked = selectedRemote.has(m.id);
                    const existing = list.some((x) => x.modelId === m.id);
                    return (
                      <label
                        key={m.id}
                        className={cn(
                          "flex items-center gap-3 p-2.5 cursor-pointer hover:bg-accent/40",
                          existing && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRemote(m.id)}
                          className="h-3.5 w-3.5 rounded border-border accent-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {m.display_name || m.id}
                          </div>
                          <div className="text-xs text-muted-foreground truncate font-mono">
                            {m.id}
                          </div>
                        </div>
                        {existing && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            已添加
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    已选 {selectedRemote.size} / {remoteModels.length}
                  </span>
                  <Button
                    size="sm"
                    onClick={handleImportSelected}
                    disabled={selectedRemote.size === 0}
                    className="gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    批量添加 {selectedRemote.size > 0 && `(${selectedRemote.size})`}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-border/40 pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
