# Any Code

> 🚀 专业的 AI 代码助手桌面应用 - 多引擎、现代化、高效、功能完备的 GUI 工具包

[![Release](https://img.shields.io/github/v/release/anyme123/any-code?style=flat-square)](https://github.com/anyme123/any-code/releases)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat-square)](https://github.com/anyme123/any-code)
[![Made with Tauri](https://img.shields.io/badge/Made%20with-Tauri-FFC131?style=flat-square&logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-Latest-orange?style=flat-square&logo=rust)](https://rust-lang.org/)

---

## 📖 简介

Any Code 是一个为 AI 驱动的代码开发工作流量身打造的专业桌面应用，支持 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview)、[OpenAI Codex](https://openai.com/index/openai-codex/) 和 [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) 三大 AI 引擎。提供完整的项目管理、会话控制、成本追踪、智能翻译和高级功能扩展。通过直观的可视化界面和创新的多引擎架构，让您更高效地使用 AI 进行辅助开发。

### 为什么选择 Any Code？

- ✅ **三引擎架构** - 支持 Claude Code、OpenAI Codex 和 Google Gemini 三大引擎，一键切换，无缝集成
- ✅ **完整的会话管理** - 多标签页会话、历史记录、实时流式输出、跨引擎统一管理
- ✅ **精确的成本追踪** - 多模型定价、Token 统计、使用分析仪表板、成本优化建议
- ✅ **强大的扩展系统** - MCP 集成、Hooks 自动化、Claude 扩展管理、自定义工具
- ✅ **智能翻译中间件** - 中英文透明翻译、渐进式翻译、翻译缓存、8 种内容提取策略
- ✅ **自动上下文管理** - 智能监控、自动压缩、Token 优化、压缩历史管理
- ✅ **开发者友好** - Git 集成、代码上下文搜索、Slash 命令、多项目管理
- ✅ **现代化 UI/UX** - 深色/浅色主题、流畅动画、响应式设计、国际化支持

---

## ✨ 核心特性

### 🚀 三引擎架构 🆕

<table>
<tr>
<td width="33%">

**Claude Code CLI 引擎**
- 官方 Claude Code CLI 完整集成
- 支持所有 Claude 模型（Opus、Sonnet 等）
- Plan Mode 只读分析模式
- 完整的工具调用和 MCP 支持
- 智能 Hooks 自动化系统

</td>
<td width="33%">

**OpenAI Codex 引擎**
- OpenAI Codex API 深度集成
- 三种执行模式：
  - Full Auto（全自动执行）
  - Danger Full Access（完全访问权限）
  - Read-only（只读模式）
- 可配置模型和输出 Schema
- JSON 格式流式输出

</td>
<td width="33%">

**Google Gemini 引擎** 🆕
- Gemini CLI 完整集成
- 支持多种 Gemini 模型：
  - Gemini 3 Pro (Preview)
  - Gemini 2.5 Pro/Flash
  - Gemini 2.0 Flash (Exp)
- 三种认证方式：
  - Google OAuth（推荐）
  - API Key
  - Vertex AI
- 百万级上下文窗口

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

**统一会话管理**
- 一键切换 Claude、Codex 和 Gemini 引擎
- 统一的会话列表和历史
- 引擎特定的图标和标识
- 独立的引擎配置和优化
- 无缝的切换体验

</td>
<td width="50%">

**智能引擎选择**
- 根据任务类型推荐引擎
- 成本效益分析
- 性能对比展示
- 一键应用最佳配置

</td>
</tr>
</table>

---

### 🎯 会话管理

<table>
<tr>
<td width="50%">

**可视化项目管理**
- 直观的项目和会话浏览器
- 实时会话状态监控
- 支持多项目并行管理
- 会话历史完整保留
- 多引擎会话统一展示

**多标签页会话**
- 同时管理多个会话（Claude + Codex）
- 后台会话继续运行
- 快速切换和恢复
- 会话独立状态管理
- 标签页拖拽排序

</td>
<td width="50%">

**实时流式输出**
- 流畅的 AI 响应显示
- 支持 Markdown 实时渲染
- 代码高亮和语法支持
- 进度和状态指示器
- 思维过程可视化

**高级会话控制**
- Continue（继续对话）
- Resume（恢复会话）
- Cancel（取消执行）
- 消息撤回和回滚
- 历史记录导航

</td>
</tr>
</table>

---

### 💰 智能成本追踪

<table>
<tr>
<td width="50%">

**精确计费**
- 支持多模型定价计算
  - Opus 4.1: $15/$75 (input/output)
  - Sonnet 4.5: $3/$15
  - Sonnet 3.5: $3/$15
- Cache 读写分离计费
- 实时成本更新

**详细统计**
- Token 分类统计
  - 输入/输出 Tokens
  - Cache 创建/读取 Tokens
- 会话时长追踪
- API 执行时间分析

</td>
<td width="50%">

**使用分析仪表板**
- 总成本和 Token 使用概览
- 按模型统计成本分布
- 按项目分析使用情况
- 按日期查看使用趋势
- 导出使用报告

**成本优化建议**
- Cache 命中率分析
- 成本节省计算
- 效率评分系统
- 最佳实践推荐

</td>
</tr>
</table>

---

### 🔧 开发者工具

#### MCP (Model Context Protocol) 集成

- **完整的 MCP 服务器管理**
  - 添加/删除/配置 MCP 服务器
  - 支持 stdio 和 SSE 传输协议
  - 从 Claude Desktop 导入配置
  - 连接状态监控和测试
  - 项目级和用户级配置

- **MCP 服务器市场**
  - 内置常用 MCP 服务器模板
  - 一键安装流行服务器
  - 自定义服务器配置
  - 环境变量管理

#### Claude 扩展管理器 🆕

管理和查看 Claude Code 扩展生态：

- **Plugins 查看器**
  - 已安装插件列表
  - 组件统计和依赖关系
  - 插件配置编辑
  - 一键打开插件文件

- **Subagents 管理**
  - 浏览专用子代理
  - 查看代理配置
  - 编辑代理行为
  - 代理性能统计

- **Agent Skills 查看**
  - AI 技能列表和描述
  - 技能配置参数
  - 技能启用/禁用
  - 自定义技能开发

> 📚 **官方资源**: [Plugins 文档](https://docs.claude.com/en/docs/claude-code/plugins) | [Anthropic Skills 仓库](https://github.com/anthropics/skills) (13.7k ⭐)

#### Hooks 自动化系统

- **智能 Hook 模板**
  - 提交前代码审查
  - 安全漏洞扫描
  - 性能优化检查
  - 自定义审查规则

- **Hook 链执行**
  - 多 Hook 串联执行
  - 条件触发和过滤
  - 错误处理和重试
  - 执行日志和报告

- **预定义场景**
  - 严格质量门禁
  - 安全优先模式
  - 性能监控模式
  - 自动化测试集成

#### 代码上下文搜索 (Acemcp)

- **语义代码搜索**
  - 基于 MCP 的智能搜索
  - 项目预索引加速
  - 上下文增强提示
  - 相关代码自动关联

- **增强型提示词**
  - 自动补充相关上下文
  - 减少不必要的 Token 消耗
  - 提高 Claude 理解准确度
  - 优化响应质量

---

### 🌐 智能翻译中间件 ✨ 重构增强

<table>
<tr>
<td width="50%">

**透明翻译工作流**
1. 用户输入中文提示词
2. 自动检测并翻译为英文
3. 发送英文到 AI API
4. AI 返回英文响应
5. 自动翻译为中文显示
6. 用户看到中文响应

**核心特性**
- 基于 Hunyuan-MT-7B 模型
- 翻译缓存加速
- 智能语言检测
- 成本节省（减少中文 Token）
- 支持 Claude 和 Codex 双引擎

</td>
<td width="50%">

**渐进式翻译系统** 🆕
- **8 种内容提取策略**
  - 自适应内容识别
  - 多层级结构解析
  - 智能过滤和清理
  - 工具调用内容提取
- **优先级翻译队列**
  - 高优先级：最近 10 条消息
  - 普通优先级：历史消息
  - 后台异步翻译
  - 翻译状态实时追踪
- **批量翻译支持**
  - 会话历史批量处理
  - 翻译进度可视化
  - 可暂停/继续翻译

</td>
</tr>
</table>

<table>
<tr>
<td width="50%">

**配置选项**
- 启用/禁用翻译
- 置信度阈值调整（默认 0.7）
- 缓存策略配置
- 缓存 TTL 设置（默认 24 小时）
- 翻译质量监控
- 自动检测语言开关

</td>
<td width="50%">

**性能优化**
- 翻译缓存命中率统计
- 缓存大小管理
- 一键清除缓存
- 内存使用优化
- 避免重复翻译
- MD5 哈希去重

**统计和监控**
- 实时翻译状态显示
- 翻译完成率追踪
- 平均翻译时间
- 缓存效率分析

</td>
</tr>
</table>

---

### 🧠 自动上下文管理 🆕

<table>
<tr>
<td width="50%">

**智能监控系统**
- 实时追踪会话 Token 使用量
- 自动检测上下文超限风险
- 多会话并行监控
- 可配置的阈值告警
- 详细的统计和分析

**自动压缩触发**
- 基于 Token 数量自动触发
- 基于消息数量触发
- 定时自动压缩
- 手动压缩控制
- 压缩前确认对话框

</td>
<td width="50%">

**压缩策略配置**
- 保留最近 N 条消息
- 保留重要工具调用
- 智能摘要生成
- 关键信息提取
- 可自定义压缩规则

**压缩历史管理**
- 完整的压缩历史记录
- 压缩前后对比
- Token 节省统计
- 压缩效果评估
- 一键回滚压缩

**性能和统计**
- 压缩节省的 Token 数量
- 压缩时间追踪
- 压缩效率分析
- 历史趋势图表

</td>
</tr>
</table>

---

### 🎨 现代化 UI/UX

- **主题系统**
  - 深色/浅色主题切换
  - 顶栏快速切换按钮
  - 自动保存用户偏好
  - 平滑过渡动画

- **国际化支持**
  - 简体中文 / English
  - 一键切换语言
  - 完整的界面翻译
  - 持久化语言设置

- **响应式设计**
  - 适配不同屏幕尺寸
  - 紧凑高效的布局
  - 清晰的视觉层次
  - 无障碍访问支持

- **流畅动画**
  - Framer Motion 驱动
  - 页面转场效果
  - 微交互反馈
  - 性能优化的渲染

---

## 🚀 快速开始

### 系统要求

- **操作系统**: Windows 10/11、macOS 10.15+、Linux (Ubuntu 20.04+)
- **Claude Code**: 需要安装 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview)
- **磁盘空间**: 至少 200MB 可用空间

### 安装方式

#### 📦 预构建版本（推荐）

从 [Releases](https://github.com/anyme123/any-code/releases) 下载对应平台的安装包：

<details>
<summary><b>Windows 安装</b></summary>

**方式一：MSI 安装包**（推荐）
- 下载 `.msi` 文件
- 双击运行安装程序
- 按照向导完成安装

**方式二：NSIS 安装包**
- 下载 `.exe` 文件
- 以管理员身份运行
- 选择安装路径

**方式三：便携版**
- 下载 `.zip` 压缩包
- 解压到任意目录
- 运行 `Any Code.exe`

</details>

<details>
<summary><b>macOS 安装</b></summary>

**支持架构**: Apple Silicon (ARM64) + Intel (x86_64)

**方式一：DMG 安装包**（推荐）
1. 下载 `.dmg` 文件
2. 双击挂载磁盘映像
3. 拖拽应用到 Applications 文件夹

**方式二：APP 应用包**
1. 下载 `.app.tar.gz` 文件
2. 解压并移动到 Applications

**⚠️ 重要：解决 Gatekeeper 阻止**

如果安装后提示 **"Any Code" 已损坏，无法打开** 或 **"无法验证开发者"**，请在终端执行：

```bash
# 方法 1：移除隔离属性（推荐，最简单）
sudo xattr -r -d com.apple.quarantine "/Applications/Any Code.app"

# 方法 2：清除所有扩展属性
xattr -cr "/Applications/Any Code.app"

# 方法 3：重新签名应用（如果上述方法不生效）
sudo codesign --force --deep --sign - "/Applications/Any Code.app"
```

> **💡 提示**: 如果应用安装在其他位置，请将 `/Applications/Any Code.app` 替换为实际路径。

**原因**: macOS Gatekeeper 默认会阻止未经 Apple 公证的应用。这是正常的安全机制，执行上述命令后即可正常使用。

</details>

<details>
<summary><b>Linux 安装</b></summary>

**方式一：AppImage**（推荐）
```bash
# 下载 AppImage 文件
chmod +x Claude-Workbench-*.AppImage

# 运行应用
./Claude-Workbench-*.AppImage
```

**方式二：DEB 包** (Debian/Ubuntu)
```bash
sudo dpkg -i any-code-*.deb
sudo apt-get install -f  # 修复依赖
```

**方式三：RPM 包** (Fedora/RHEL)
```bash
sudo rpm -i any-code-*.rpm
```

</details>

---

#### 🛠️ 源码构建

```bash
# 1. 克隆仓库
git clone https://github.com/anyme123/any-code.git
cd any-code

# 2. 安装依赖
npm install

# 3. 开发模式（热重载）
npm run tauri dev

# 4. 构建生产版本（会通过 build.ps1 加载签名环境变量）
npm run tauri:build

# 5. 快速构建（开发版，速度更快）
npm run tauri:build-fast
```

**构建要求**:
- Node.js 18.0+ (推荐 LTS)
- Rust 1.70+
- 平台特定工具链（WebView2 Runtime for Windows）

---

## 📖 使用指南

### 首次使用

1. **配置 Claude Code CLI**
   - 安装 Claude Code CLI
   - 设置 API Key: `claude config set api_key YOUR_KEY`
   - 验证安装: `claude --version`

2. **配置 Gemini CLI（可选）** 🆕
   - 安装 Gemini CLI: `npm install -g @anthropic-ai/claude-code` 或从 [官方仓库](https://github.com/google-gemini/gemini-cli) 安装
   - 在应用中选择认证方式：
     - **Google OAuth**（推荐，免费层可用）
     - **API Key**（从 Google AI Studio 获取）
     - **Vertex AI**（企业级 Google Cloud）
   - 验证安装: `gemini --version`

3. **启动 Any Code**
   - 首次启动会自动检测 Claude CLI 和 Gemini CLI
   - 如果未找到，会提示设置自定义路径

4. **创建第一个会话**
   - 点击"新建会话"按钮
   - 选择项目目录
   - 选择使用的引擎（Claude/Codex/Gemini）
   - 开始与 AI 对话

### 核心功能使用

#### 会话管理

- **新建会话**: 顶部工具栏点击 `+` 按钮
- **切换会话**: 点击标签页或使用 `Ctrl+Tab` (macOS: `⌘+Tab`)
- **恢复会话**: 从会话历史列表双击会话
- **关闭会话**: 标签页关闭按钮或 `Ctrl+W` (macOS: `⌘+W`)

#### 提示词撤回

1. 找到要撤回的用户消息
2. 点击消息右侧的圆形撤回按钮
3. 确认撤回操作
4. 该消息及之后的所有对话将被删除
5. 代码自动回滚到发送前状态
6. 提示词恢复到输入框可修改

#### Plan Mode（只读分析模式）

- **切换**: 按 `Shift+Tab` 或输入框右侧切换按钮
- **用途**: 代码探索、方案设计、风险评估
- **特点**: 不修改文件、不执行命令、只返回分析结果

#### 成本追踪

- **基础显示**: 输入框底部实时显示会话总成本
- **详细统计**: 鼠标悬停查看完整成本分析
  - Token 分类统计
  - 会话时长
  - API 执行时间
  - Cache 效率

- **使用仪表板**: 侧边栏"使用统计"查看全局分析
  - 总成本和 Token 使用
  - 按模型/项目/日期分析
  - 趋势图表和导出

---

## 🔧 高级配置

### MCP 服务器配置

```json
// ~/.claude/mcp_servers.json
{
  "acemcp": {
    "transport": "stdio",
    "command": "acemcp",
    "args": [],
    "env": {
      "ACEMCP_PROJECT_ROOT": "/path/to/project"
    }
  },
  "filesystem": {
    "transport": "stdio",
    "command": "mcp-server-filesystem",
    "args": ["/allowed/path"]
  }
}
```

### Hooks 配置示例

```json
// ~/.claude/settings.json
{
  "hooks": {
    "user-prompt-submit": {
      "command": "echo 'Submitting prompt...'",
      "enabled": true
    },
    "tool-result": {
      "command": "custom-tool-handler.sh",
      "enabled": true,
      "filter": {
        "tool_name": ["bash", "edit"]
      }
    }
  }
}
```

### Gemini 配置 🆕

```json
// ~/.anycode/gemini/config.json
{
  "authMethod": "google_oauth",  // google_oauth | api_key | vertex_ai
  "defaultModel": "gemini-2.5-pro",
  "approvalMode": "auto_edit",   // auto_edit | yolo | default
  "apiKey": "YOUR_API_KEY",      // 仅 api_key 模式需要
  "googleCloudProject": "",      // 仅 vertex_ai 模式需要
  "env": {}
}
```

**支持的 Gemini 模型**：
| 模型 ID | 名称 | 上下文窗口 |
|---------|------|-----------|
| `gemini-3-pro-preview` | Gemini 3 Pro (Preview) | 1,000,000 |
| `gemini-2.5-pro` | Gemini 2.5 Pro | 1,000,000 |
| `gemini-2.5-flash` | Gemini 2.5 Flash | 1,000,000 |
| `gemini-2.0-flash-exp` | Gemini 2.0 Flash (Experimental) | 1,000,000 |

### 翻译中间件配置

```typescript
// 在设置中配置
{
  "translation": {
    "enabled": true,
    "confidence_threshold": 0.7,
    "cache_enabled": true,
    "cache_ttl_hours": 24
  }
}
```

---

## 🏗️ 技术架构

### 项目目录结构

```
any-code/
├── .factory/                    # Factory 配置（skills）
├── .github/workflows/           # GitHub Actions CI/CD 工作流
├── .vscode/                     # VSCode 编辑器配置
├── dist/                        # 前端构建输出目录
├── scripts/                     # 构建和部署脚本
├── src/                         # 前端源代码 (React + TypeScript)
│   ├── assets/                  # 静态资源
│   ├── components/              # React 组件
│   │   ├── common/              # 通用组件
│   │   ├── dialogs/             # 对话框组件
│   │   ├── FloatingPromptInput/ # 浮动输入框组件
│   │   ├── layout/              # 布局组件
│   │   ├── message/             # 消息展示组件
│   │   ├── ToolWidgets/         # 工具小部件
│   │   ├── ui/                  # 基础 UI 组件
│   │   └── widgets/             # 功能小部件
│   ├── contexts/                # React Context 状态管理
│   ├── hooks/                   # 自定义 React Hooks
│   ├── i18n/locales/            # 国际化语言文件 (en.json, zh.json)
│   ├── lib/                     # 工具库和服务
│   ├── types/                   # TypeScript 类型定义
│   ├── App.tsx                  # 主应用组件
│   ├── main.tsx                 # 应用入口
│   └── styles.css               # 全局样式
├── src-tauri/                   # Rust 后端源代码 (Tauri)
│   ├── src/
│   │   ├── commands/            # Tauri 命令模块
│   │   │   ├── claude/          # Claude CLI 集成
│   │   │   ├── codex/           # OpenAI Codex 集成
│   │   │   ├── gemini/          # Google Gemini CLI 集成 🆕
│   │   │   ├── acemcp.rs        # MCP 代码上下文搜索
│   │   │   ├── storage.rs       # SQLite 数据库操作
│   │   │   ├── translator.rs    # 翻译服务
│   │   │   ├── provider.rs      # API 代理商管理
│   │   │   ├── mcp.rs           # MCP 服务器管理
│   │   │   ├── usage.rs         # 使用统计和成本追踪
│   │   │   ├── prompt_tracker.rs    # 提示词历史和回滚
│   │   │   ├── context_manager.rs   # 自动上下文压缩
│   │   │   ├── enhanced_hooks.rs    # Hooks 自动化系统
│   │   │   └── extensions.rs        # 插件和扩展管理
│   │   └── main.rs              # Rust 入口
│   ├── icons/                   # 应用图标
│   ├── Cargo.toml               # Rust 依赖配置
│   └── tauri.conf.json          # Tauri 配置
├── package.json                 # npm 配置和依赖
├── tsconfig.json                # TypeScript 配置
├── vite.config.ts               # Vite 构建配置
├── index.html                   # HTML 入口
└── README.md                    # 项目文档
```

### 整体架构

```
┌───────────────────────────────────────────────────────────────┐
│                        Any Code                               │
├─────────────────────┬─────────────────┬───────────────────────┤
│                     │                 │                       │
│   React 前端层      │   Tauri 桥接层   │   Rust 后端层         │
│                     │                 │                       │
│ • React 18 + TS     │ • IPC 通信      │ • 三引擎管理          │
│ • Tailwind CSS 4    │ • 安全调用      │   - Claude CLI 封装   │
│ • Framer Motion     │ • 类型安全      │   - Codex API 集成    │
│ • i18next           │ • 事件系统      │   - Gemini CLI 集成   │
│ • Radix UI          │ • 资源管理      │ • 进程管理            │
│ • Custom Hooks      │ • 流式传输      │ • 会话控制            │
│                     │                 │ • 文件操作            │
│                     │                 │ • Git 集成            │
│                     │                 │ • SQLite 存储         │
│                     │                 │ • MCP 管理            │
│                     │                 │ • 翻译服务            │
│                     │                 │ • 上下文管理          │
└─────────────────────┴─────────────────┴───────────────────────┘
         ▲                     ▲                     ▲
         │                     │                     │
         └─────────────────────┴─────────────────────┘
                            IPC 事件流

    ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
    │  Claude Code CLI │   │  OpenAI Codex    │   │  Google Gemini   │
    │  • Agent SDK     │   │  • Codex API     │   │  • Gemini CLI    │
    │  • MCP Servers   │   │  • JSON Stream   │   │  • OAuth/API Key │
    │  • Tools & Exts  │   │  • Multi-mode    │   │  • Vertex AI     │
    └──────────────────┘   └──────────────────┘   └──────────────────┘
```

### 前端技术栈

| 技术                         | 版本     | 用途           |
| ---------------------------- | -------- | -------------- |
| **React**                    | 18.3.1   | UI 框架        |
| **TypeScript**               | 5.9.3    | 类型安全       |
| **Tailwind CSS**             | 4.1.8    | 样式框架       |
| **Framer Motion**            | 12.23.24 | 动画系统       |
| **i18next**                  | 25.6.0   | 国际化         |
| **Radix UI**                 | Latest   | 组件库         |
| **React Markdown**           | 9.0.3    | Markdown 渲染  |
| **React Syntax Highlighter** | 15.6.1   | 代码高亮       |
| **date-fns**                 | 3.6.0    | 日期处理       |
| **Zod**                      | 3.24.1   | 数据校验       |
| **@tauri-apps/api**          | 2.9.0    | Tauri 前端 API |

### 后端技术栈

| 技术        | 版本            | 用途            |
| ----------- | --------------- | --------------- |
| **Tauri**   | 2.9             | 桌面应用框架    |
| **Rust**    | 2021 Edition    | 系统编程语言    |
| **SQLite**  | 0.32 (rusqlite) | 嵌入式数据库    |
| **Tokio**   | 1.x             | 异步运行时      |
| **Serde**   | 1.x             | 序列化/反序列化 |
| **Reqwest** | 0.12            | HTTP 客户端     |
| **Chrono**  | 0.4             | 时间处理        |
| **anyhow**  | 1.x             | 错误处理        |
| **regex**   | 1.x             | 正则表达式      |
| **uuid**    | 1.6             | UUID 生成       |

### 核心前端组件

| 组件/模块                   | 位置          | 功能描述                   |
| --------------------------- | ------------- | -------------------------- |
| **AppLayout**               | `layout/`     | 应用主布局和导航           |
| **ClaudeCodeSession**       | `components/` | Claude 会话管理核心        |
| **ExecutionEngineSelector** | `components/` | 引擎切换器（Claude/Codex/Gemini） |
| **FloatingPromptInput**     | `components/` | 浮动输入框组件             |
| **AIMessage / UserMessage** | `message/`    | 消息展示组件               |
| **StreamMessageV2**         | `message/`    | 流式消息渲染               |
| **ToolCallsGroup**          | `message/`    | 工具调用展示               |
| **SubagentMessageGroup**    | `message/`    | 子代理消息组               |
| **MCPManager**              | `components/` | MCP 服务器管理             |
| **UsageDashboard**          | `components/` | 使用统计仪表板             |
| **TranslationSettings**     | `components/` | 翻译配置组件               |

### 核心 React Hooks

| Hook                          | 功能描述                 |
| ----------------------------- | ------------------------ |
| **usePromptExecution**        | 提示词执行逻辑（最核心） |
| **useMessageTranslation**     | 消息翻译处理             |
| **useSessionLifecycle**       | 会话生命周期管理         |
| **useSessionCostCalculation** | 成本计算                 |
| **useTabs**                   | 多标签页管理             |
| **useDisplayableMessages**    | 消息展示处理             |
| **useKeyboardShortcuts**      | 键盘快捷键               |

### 数据流架构

```
用户操作 → React 组件 → Tauri Command
                           ↓
                    Rust 后端处理
                           ↓
         ┌─────────────────┼─────────────────┬─────────────────┐
         ▼                 ▼                 ▼                 ▼
   文件系统操作      Claude CLI 调用    Codex API 调用    数据库操作
         │                 │                 │                 │
         └─────────────────┴─────────────────┴─────────────────┘
                           ↓
                   IPC 事件返回（流式）
                           ↓
              ┌────────────┴────────────┐
              ▼                         ▼
        翻译中间件处理            原始消息处理
              │                         │
              └────────────┬────────────┘
                           ▼
                    React 状态更新
                           ↓
              ┌────────────┴────────────┐
              ▼                         ▼
        UI 重新渲染              上下文监控
                                        ↓
                                  自动压缩检测
```

### 数据库架构

```sql
-- 使用统计表
CREATE TABLE usage_entries (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_creation_tokens INTEGER,
    cache_read_tokens INTEGER,
    total_tokens INTEGER,
    cost REAL,
    project_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 性能索引
CREATE INDEX idx_usage_session_id ON usage_entries(session_id);
CREATE INDEX idx_usage_timestamp ON usage_entries(timestamp DESC);
CREATE INDEX idx_usage_project_path ON usage_entries(project_path);
CREATE INDEX idx_usage_model_timestamp ON usage_entries(model, timestamp DESC);
```

### API 接口分类

前端通过 `src/lib/api.ts` 封装了所有 Tauri 命令调用：

| 分类            | 主要接口                                                     | 功能描述               |
| --------------- | ------------------------------------------------------------ | ---------------------- |
| **项目管理**    | `listProjects()`, `getProjectSessions()`, `deleteSession()`  | 项目和会话的 CRUD 操作 |
| **Claude 执行** | `executeClaudeCode()`, `continueClaudeCode()`, `resumeClaudeCode()`, `cancelClaudeExecution()` | Claude CLI 调用和控制  |
| **Codex 执行**  | `executeCodex()`, `resumeCodex()`, `listCodexSessions()`     | OpenAI Codex API 调用  |
| **Gemini 执行** 🆕 | `executeGemini()`, `resumeGemini()`, `cancelGeminiExecution()`, `getGeminiConfig()` | Google Gemini CLI 调用 |
| **存储管理**    | `storageListTables()`, `storageExecuteSql()`, `storageInsertRow()` | SQLite 数据库操作      |
| **MCP 管理**    | `mcpAdd()`, `mcpList()`, `mcpTestConnection()`               | MCP 服务器配置和测试   |
| **翻译服务**    | `translate()`, `getTranslationConfig()`, `clearTranslationCache()` | 翻译中间件接口         |
| **使用统计**    | `getUsageStats()`, `getUsageByModel()`, `getUsageByProject()` | 成本和 Token 统计      |
| **上下文管理**  | `compressContext()`, `getCompressionHistory()`               | 自动上下文压缩         |

### 架构特点总结

| 特点               | 描述                                               |
| ------------------ | -------------------------------------------------- |
| **三引擎架构**     | 同时支持 Claude Code、OpenAI Codex 和 Google Gemini，一键切换 |
| **现代化技术栈**   | Tauri 2.9 + React 18 + Rust 2021，跨平台高性能     |
| **流式渲染**       | IPC 事件流驱动，实时流式输出 AI 响应               |
| **嵌入式存储**     | SQLite WAL 模式，高性能本地数据持久化              |
| **翻译中间件**     | 透明的中英文翻译，8 种内容提取策略                 |
| **自动上下文管理** | 智能监控和压缩，优化 Token 使用                    |
| **扩展生态**       | MCP 协议支持、Hooks 自动化、插件系统               |

---

## 🆕 最新更新

### v5.6.6 (2025-12)

#### 🎉 重大更新
- ✨ **Google Gemini 引擎** - 全新的三引擎架构，新增 Gemini CLI 完整支持
  - 支持多种 Gemini 模型：Gemini 3 Pro、Gemini 2.5 Pro/Flash、Gemini 2.0 Flash
  - 三种认证方式：Google OAuth（推荐）、API Key、Vertex AI
  - 百万级上下文窗口（1,000,000 tokens）
  - 完整的流式输出和会话管理
  - 多种审批模式：auto_edit、yolo、default
- ✨ **增强的多引擎架构** - 从双引擎升级为三引擎
  - 统一的引擎切换器支持 Claude、Codex、Gemini
  - 跨引擎会话历史统一管理
  - 引擎特定的配置和优化

#### 🔧 功能增强
- ✅ 新增 Gemini 配置管理界面
- ✅ 支持 Gemini 供应商预设配置
- ✅ 增强的会话恢复功能
- ✅ 改进的实时流 tool_use 处理

#### 🐛 Bug 修复
- 🔧 修复 Gemini delta 消息合并导致 tool_use 分离的问题
- 🔧 过滤 Gemini CLI stderr 调试消息
- 🔧 修复实时流 tool_result 内容为空的问题

---

### v4.4.0 (2025-11-24)

#### 🎉 重大更新
- ✨ **OpenAI Codex 集成** - 双引擎架构，支持 Claude 和 Codex 引擎切换
  - 支持 Full Auto、Danger Full Access、Read-only 三种执行模式
  - JSON 格式流式输出，完整的会话管理
  - 独立的 Codex 会话历史和恢复功能
  - 可配置模型和输出 Schema
- ✨ **增强的翻译系统** - 全面重构的翻译中间件
  - 8 种智能内容提取策略
  - 渐进式历史消息后台翻译
  - 优先级翻译队列（高优先级处理最近消息）
  - 翻译状态实时追踪和显示
- ✨ **自动上下文管理** - 智能的上下文压缩和优化
  - 自动监控会话 Token 使用
  - 智能触发上下文压缩
  - 压缩历史记录和统计
  - 可配置的压缩策略

#### 🔧 功能增强
- ✅ 多引擎会话列表统一展示（Claude + Codex）
- ✅ 引擎特定的图标和标识
- ✅ 改进的会话生命周期管理
- ✅ 增强的消息翻译 Hook 系统
- ✅ 优化的 Token 计数和成本追踪
- ✅ 统一的错误处理和日志系统

#### 🎨 UI/UX 改进
- ✅ 执行引擎选择器（Claude / Codex）
- ✅ 会话类型可视化标识
- ✅ 改进的输入框和工具栏布局
- ✅ 更清晰的状态指示器
- ✅ 优化的响应式设计

#### ⚡ 性能优化
- ✅ 重构的会话加载逻辑，加载速度提升 60%
- ✅ 优化的翻译缓存机制
- ✅ 减少不必要的组件重渲染
- ✅ 改进的事件监听器管理
- ✅ 数据库查询优化

#### 🐛 Bug 修复
- 🔧 修复子代理消息渲染导致的页面崩溃问题
- 🔧 修复翻译功能的取消机制
- 🔧 修复会话切换时的内存泄漏
- 🔧 修复 Codex 集成中的控制台窗口闪现问题
- 🔧 清理死代码和冗余 API

---

### 历史版本

<details>
<summary><b>v4.3.x 更新历史</b></summary>

#### v4.3.8 (2025-11-20)
- 修复 AppLayout 中 ThemeToggle 组件的 props 类型错误
- 修复构建失败问题，确保 CI/CD 正常运行

#### v4.3.7 (2025-11-20)
- 版本号统一更新到 4.3.7
- 所有平台配置文件同步更新

#### v4.0.1 更新亮点
- Claude 扩展管理器（Plugins/Subagents/Skills）
- 多模型精确成本计算
- Git 代码变更统计 API
- Acemcp 代码上下文搜索集成
- 默认浅色主题，更护眼
- SQLite WAL 模式启用，数据库性能提升

</details>

---

## 🤝 贡献指南

我们欢迎各种形式的贡献！无论是 Bug 报告、功能建议还是代码提交。

### 开发环境设置

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/any-code.git
cd any-code

# 2. 安装依赖
npm install

# 3. 创建功能分支
git checkout -b feature/your-feature-name

# 4. 启动开发服务器
npm run tauri dev

# 5. 进行更改并测试

# 6. 提交更改
git add .
git commit -m "feat: add your feature description"

# 7. 推送到 Fork
git push origin feature/your-feature-name

# 8. 创建 Pull Request
```

### 代码规范

**TypeScript/React**
- 使用 TypeScript 严格模式
- 遵循 React Hooks 最佳实践
- 组件使用函数式组件 + Hooks
- Props 使用明确的类型定义
- 使用 ESLint 和 Prettier 格式化

**Rust**
- 遵循 Rust 2021 Edition 标准
- 使用 `cargo fmt` 格式化代码
- 使用 `cargo clippy` 检查代码质量
- 错误处理使用 `Result` 和 `anyhow`
- 异步代码使用 `tokio`

**提交信息规范**
```
<type>(<scope>): <subject>

<body>

<footer>
```

类型:
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行）
- `refactor`: 重构（既不是新功能，也不是 Bug 修复）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

### 问题报告

提交 Issue 时请包含：
- 详细的问题描述
- 复现步骤
- 预期行为 vs 实际行为
- 系统环境信息
- 相关截图或日志

---

## 🐛 故障排除

### 常见问题

<details>
<summary><b>Q: 应用无法启动或闪退</b></summary>

**A**: 检查以下几点：
1. 确认 Claude Code CLI 已正确安装
2. 检查系统是否安装了必要的运行时（Windows: WebView2 Runtime）
3. 查看应用日志文件（位置见下方）
4. 尝试以管理员/root 权限运行

日志位置：
- Windows: `%APPDATA%\any-code\logs`
- macOS: `~/Library/Application Support/any-code/logs`
- Linux: `~/.config/any-code/logs`

</details>

<details>
<summary><b>Q: Claude Code CLI 未找到</b></summary>

**A**:
1. 确认 Claude Code CLI 已安装: `claude --version`
2. 在设置中手动指定 Claude CLI 路径
3. 确保 PATH 环境变量包含 Claude CLI 安装目录

</details>

<details>
<summary><b>Q: 会话无法加载或历史记录丢失</b></summary>

**A**:
1. 检查 `~/.claude/projects/` 目录权限
2. 确认 JSONL 文件没有损坏
3. 尝试重启应用
4. 查看应用日志获取详细错误信息

</details>

<details>
<summary><b>Q: MCP 服务器连接失败</b></summary>

**A**:
1. 确认 MCP 服务器正确安装
2. 检查配置文件路径和命令是否正确
3. 测试手动运行 MCP 服务器命令
4. 查看服务器日志获取错误信息

</details>

<details>
<summary><b>Q: 翻译功能不工作</b></summary>

**A**:
1. 在设置中确认翻译中间件已启用
2. 检查网络连接
3. 尝试清除翻译缓存
4. 重新初始化翻译服务

</details>

---

## 📄 许可证

本项目基于 **AGPL-3.0** 开源协议发布。

这意味着：
- ✅ 可以自由使用、修改和分发
- ✅ 必须开源修改后的代码
- ✅ 网络服务也需要开源
- ✅ 必须保留版权和许可声明

详见 [LICENSE](LICENSE) 文件。

---

## 🔗 相关资源

### 官方文档
- [Claude Code 官方文档](https://docs.claude.com/en/docs/claude-code/overview)
- [Anthropic API 文档](https://docs.anthropic.com/)
- [Anthropic Skills 仓库](https://github.com/anthropics/skills) ⭐ 13.7k
- [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) 🆕
- [Google AI Studio](https://aistudio.google.com/) - Gemini API Key 获取

### 技术文档
- [Tauri 框架](https://tauri.app/) - 桌面应用框架
- [React 文档](https://react.dev/) - 前端框架
- [Rust 官网](https://rust-lang.org/) - 系统编程语言

### 社区资源
- [MCP 协议规范](https://modelcontextprotocol.io/) - Model Context Protocol
- [Claude Code GitHub Discussions](https://github.com/anthropics/claude-code/discussions)

---

## 💬 社区与支持

### 获取帮助

- **GitHub Issues**: [报告问题](https://github.com/anyme123/any-code/issues)
- **GitHub Discussions**: [讨论和提问](https://github.com/anyme123/any-code/discussions)

### 参与讨论

我们欢迎任何形式的反馈和建议！

- 💡 功能建议
- 🐛 Bug 报告
- 📝 文档改进
- 🌍 翻译贡献

---

## 🙏 致谢

感谢以下项目和社区：

- [Anthropic](https://anthropic.com/) - 提供强大的 Claude AI
- [Google](https://ai.google.dev/) - 提供 Gemini AI 和 Gemini CLI 🆕
- [OpenAI](https://openai.com/) - 提供 Codex API
- [Tauri](https://tauri.app/) - 优秀的桌面应用框架
- [React](https://react.dev/) - 灵活的前端框架
- [Rust 社区](https://rust-lang.org/) - 高性能系统编程
- 所有贡献者和用户的支持 ❤️

---

## ⭐ Star History

如果这个项目对您有帮助，请给我们一个 **Star** ⭐！

[![Star History Chart](https://star-history.dera.page/svg?repos=anyme123/any-code&type=Date)](https://star-history.dera.page/#anyme123/any-code&Date)

---

<div align="center">

**Any Code** - 三大 AI 引擎，一个桌面应用

Made with ❤️ by the Any Code Team

🔗 **项目地址**: https://github.com/anyme123/any-code

</div>
