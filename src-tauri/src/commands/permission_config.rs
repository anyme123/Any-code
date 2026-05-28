use serde::{Deserialize, Serialize};

/// Claude权限管理配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudePermissionConfig {
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub permission_mode: PermissionMode,
    pub auto_approve_edits: bool,
    pub enable_dangerous_skip: bool, // 向后兼容选项
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PermissionMode {
    Interactive,
    AcceptEdits,
    ReadOnly,
    Plan, // Claude CLI 原生支持的 Plan Mode
}

impl Default for ClaudePermissionConfig {
    fn default() -> Self {
        Self {
            allowed_tools: vec![
                "Read".to_string(),
                "Write".to_string(),
                "Edit".to_string(),
                "Bash".to_string(),
            ],
            disallowed_tools: vec![],
            permission_mode: PermissionMode::Interactive,
            auto_approve_edits: false,
            enable_dangerous_skip: true, // 默认保持现有行为
        }
    }
}

impl std::fmt::Display for PermissionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionMode::Interactive => write!(f, "default"),
            PermissionMode::AcceptEdits => write!(f, "acceptEdits"),
            PermissionMode::ReadOnly => write!(f, "bypassPermissions"), // 使用 CLI 正确的参数
            PermissionMode::Plan => write!(f, "plan"),                  // Plan Mode
        }
    }
}

/// 预定义工具权限组常量
pub const DEVELOPMENT_TOOLS: &[&str] = &["Bash", "Read", "Write", "Edit"];
pub const SAFE_TOOLS: &[&str] = &["Read", "Search"];
pub const ALL_TOOLS: &[&str] = &[
    "Bash",
    "Read",
    "Write",
    "Edit",
    "WebFetch",
    "Task",
    "TodoWrite",
];

/// Claude执行配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeExecutionConfig {
    pub output_format: OutputFormat,
    pub timeout_seconds: Option<u32>,
    pub max_tokens: Option<u32>,
    pub max_thinking_tokens: Option<u32>,
    pub verbose: bool,
    pub permissions: ClaudePermissionConfig,
    #[serde(default)]
    pub disable_rewind_git_operations: bool,
    /// 控制每次 AI 回复后是否自动 git commit。
    /// Issue #181/#175: 与 disable_rewind_git_operations 解耦，
    /// 让用户既保留 rewind 历史，又能关掉自动提交。
    #[serde(default)]
    pub disable_auto_commit_after_response: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OutputFormat {
    StreamJson,
    Json,
    Text,
}

impl Default for ClaudeExecutionConfig {
    fn default() -> Self {
        Self {
            output_format: OutputFormat::StreamJson,
            timeout_seconds: None,
            max_tokens: None,
            max_thinking_tokens: None,
            verbose: true,
            permissions: ClaudePermissionConfig::default(),
            disable_rewind_git_operations: false,
            disable_auto_commit_after_response: false,
        }
    }
}

impl std::fmt::Display for OutputFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OutputFormat::StreamJson => write!(f, "stream-json"),
            OutputFormat::Json => write!(f, "json"),
            OutputFormat::Text => write!(f, "text"),
        }
    }
}

/// 权限构建辅助函数
pub fn build_permission_args(config: &ClaudePermissionConfig) -> Vec<String> {
    let mut args = Vec::new();

    // 如果启用了危险跳过模式（向后兼容）
    if config.enable_dangerous_skip {
        args.push("--dangerously-skip-permissions".to_string());
        return args;
    }

    // 添加允许的工具
    if !config.allowed_tools.is_empty() {
        args.push("--allowedTools".to_string());
        args.push(config.allowed_tools.join(","));
    }

    // 添加禁止的工具
    if !config.disallowed_tools.is_empty() {
        args.push("--disallowedTools".to_string());
        args.push(config.disallowed_tools.join(","));
    }

    // 添加权限模式
    args.push("--permission-mode".to_string());
    args.push(config.permission_mode.to_string());

    args
}

/// 执行参数构建函数
/// 注意：prompt 不再通过命令行参数传递，而是通过 stdin 管道传递
/// 这样可以避免操作系统命令行长度限制（Windows ~8KB, Linux/macOS ~128KB-2MB）
pub fn build_execution_args(config: &ClaudeExecutionConfig, model: &str) -> Vec<String> {
    let mut args = Vec::new();

    // prompt 通过 stdin 传递，不再作为命令行参数

    // 🔥 修复：仅为内置模型/Claude Code aliases 添加 --model 参数
    // 对于自定义模型，通过 ANTHROPIC_MODEL 环境变量设置
    // 避免命令行参数与环境变量冲突导致发送失败
    let is_builtin_model = matches!(
        model,
        "default" | "best" | "sonnet" | "opus" | "haiku" | "sonnet[1m]" | "opus[1m]" | "opusplan"
    );
    if is_builtin_model {
        args.push("--model".to_string());
        args.push(model.to_string());
    }

    // 添加输出格式
    args.push("--output-format".to_string());
    args.push(config.output_format.to_string());

    // 添加详细输出
    if config.verbose {
        args.push("--verbose".to_string());
    }

    // 添加超时参数
    if let Some(timeout) = config.timeout_seconds {
        args.push("--timeout".to_string());
        args.push(timeout.to_string());
    }

    // 添加token限制
    if let Some(max_tokens) = config.max_tokens {
        args.push("--max-tokens".to_string());
        args.push(max_tokens.to_string());
    }

    // 添加thinking token限制（Extended Thinking 功能）
    // 🔥 修复：使用官方标准的参数名称: --max-thinking-tokens (短横线分隔,不是驼峰)
    // 参考: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
    if let Some(max_thinking_tokens) = config.max_thinking_tokens {
        args.push("--max-thinking-tokens".to_string());
        args.push(max_thinking_tokens.to_string());
    }

    // 添加权限参数
    args.extend(build_permission_args(&config.permissions));

    args
}

/// 预设权限配置
impl ClaudePermissionConfig {
    /// 开发模式 - 允许所有常用开发工具
    pub fn development_mode() -> Self {
        Self {
            allowed_tools: DEVELOPMENT_TOOLS.iter().map(|s| s.to_string()).collect(),
            disallowed_tools: vec![],
            permission_mode: PermissionMode::AcceptEdits,
            auto_approve_edits: true,
            enable_dangerous_skip: false,
        }
    }

    /// 安全模式 - 只允许读取操作
    pub fn safe_mode() -> Self {
        Self {
            allowed_tools: SAFE_TOOLS.iter().map(|s| s.to_string()).collect(),
            disallowed_tools: vec!["Bash".to_string(), "WebFetch".to_string()],
            permission_mode: PermissionMode::ReadOnly,
            auto_approve_edits: false,
            enable_dangerous_skip: false,
        }
    }

    /// 交互模式 - 平衡的权限设置
    pub fn interactive_mode() -> Self {
        Self {
            allowed_tools: vec!["Read".to_string(), "Write".to_string(), "Edit".to_string()],
            disallowed_tools: vec![],
            permission_mode: PermissionMode::Interactive,
            auto_approve_edits: false,
            enable_dangerous_skip: false,
        }
    }

    /// 向后兼容模式 - 保持原有的危险跳过行为
    pub fn legacy_mode() -> Self {
        Self {
            allowed_tools: vec![],
            disallowed_tools: vec![],
            permission_mode: PermissionMode::Interactive,
            auto_approve_edits: false,
            enable_dangerous_skip: true,
        }
    }

    /// Plan Mode - 使用 Claude CLI 原生的 plan 权限模式
    /// Plan Mode 允许分析但禁止修改文件或执行命令
    ///
    /// 官方定义：Claude can analyze but not modify files or execute commands
    /// - 允许：Read, Grep, Glob, LS, NotebookRead (只读工具)
    /// - 允许：WebFetch, WebSearch (信息获取)
    /// - 允许：TodoWrite (规划任务)
    /// - 允许：MCP 只读工具（根据具体工具特性）
    /// - 禁止：Edit, Write, MultiEdit, Bash (修改和执行)
    pub fn plan_mode() -> Self {
        Self {
            allowed_tools: vec![],    // CLI 的 --permission-mode plan 会自动处理
            disallowed_tools: vec![], // 不需要额外禁止，CLI 已经处理
            permission_mode: PermissionMode::Plan,
            auto_approve_edits: false,
            enable_dangerous_skip: false,
        }
    }
}
