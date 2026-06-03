use std::fs;
use std::process::Stdio;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::commands::permission_config::{
    build_execution_args, ClaudeExecutionConfig, ClaudePermissionConfig,
};
#[cfg(windows)]
use crate::process::JobObject;

use super::config::get_claude_execution_config;
use super::paths::{encode_project_path, get_claude_dir};
use super::platform;

/// Global state to track current Claude process
pub struct ClaudeProcessState {
    pub current_process: Arc<Mutex<Option<Child>>>,
    pub last_spawned_pid: Arc<Mutex<Option<u32>>>,
}

impl Default for ClaudeProcessState {
    fn default() -> Self {
        Self {
            current_process: Arc::new(Mutex::new(None)),
            last_spawned_pid: Arc::new(Mutex::new(None)),
        }
    }
}

impl Drop for ClaudeProcessState {
    fn drop(&mut self) {
        // When the application exits, clean up the current process
        log::info!("ClaudeProcessState dropping, cleaning up current process...");

        // Use a runtime to execute the async cleanup
        let process = self.current_process.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            // We're in a tokio runtime context
            handle.block_on(async move {
                let mut current_process = process.lock().await;
                if let Some(mut child) = current_process.take() {
                    log::info!("Cleanup on drop: Killing Claude process");
                    match child.kill().await {
                        Ok(_) => {
                            log::info!("Cleanup on drop: Successfully killed Claude process");
                        }
                        Err(e) => {
                            log::error!("Cleanup on drop: Failed to kill Claude process: {}", e);
                        }
                    }
                }
            });
        } else {
            // Create a temporary runtime for cleanup
            if let Ok(rt) = tokio::runtime::Runtime::new() {
                rt.block_on(async move {
                    let mut current_process = process.lock().await;
                    if let Some(mut child) = current_process.take() {
                        log::info!("Cleanup on drop: Killing Claude process");
                        match child.kill().await {
                            Ok(_) => {
                                log::info!("Cleanup on drop: Successfully killed Claude process");
                            }
                            Err(e) => {
                                log::error!(
                                    "Cleanup on drop: Failed to kill Claude process: {}",
                                    e
                                );
                            }
                        }
                    }
                });
            }
        }
    }
}

/// Maps frontend model IDs to Claude CLI model aliases
/// Converts frontend-friendly model names to official Claude Code model identifiers
/// Uses Claude Code aliases so model routing can stay current.
pub(super) fn map_model_to_claude_alias(model: &str) -> String {
    match model {
        "default" => "default".to_string(),
        "best" => "best".to_string(),
        "sonnet" => "sonnet".to_string(),
        "opus" => "opus".to_string(),
        "haiku" => "haiku".to_string(),
        "opusplan" => "opusplan".to_string(),
        // Pass through any other model names unchanged (for future compatibility)
        _ => model.to_string(),
    }
}

// 🔥 已移除 escape_prompt_for_cli 函数
// prompt 现在通过 stdin 管道传递，不再需要命令行转义
// 这样可以避免操作系统命令行长度限制（Windows ~8KB, Linux/macOS ~128KB-2MB）

/// Helper function to create a tokio Command with proper environment variables
/// This ensures commands like Claude can find Node.js and other dependencies
fn create_command_with_env(program: &str) -> Command {
    // On Windows, if the program is a .cmd file, try to resolve it to direct Node.js invocation
    // This prevents the cmd.exe window from appearing
    #[cfg(target_os = "windows")]
    let (final_program, extra_args) = {
        if program.ends_with(".cmd") {
            // Use the resolver from claude_binary module
            if let Some((node_path, script_path)) = platform::resolve_cmd_wrapper(program) {
                log::info!(
                    "Resolved .cmd wrapper {} to Node.js script: {}",
                    program,
                    script_path
                );
                (node_path, vec![script_path])
            } else {
                (program.to_string(), vec![])
            }
        } else {
            (program.to_string(), vec![])
        }
    };

    #[cfg(not(target_os = "windows"))]
    let (final_program, extra_args) = (program.to_string(), Vec::<String>::new());

    // Create a new tokio Command from the resolved program path
    let mut tokio_cmd = Command::new(&final_program);

    // Add any extra arguments (e.g., script path when using node directly)
    for arg in extra_args {
        tokio_cmd.arg(arg);
    }

    // Copy over all environment variables
    for (key, value) in std::env::vars() {
        if key == "PATH"
            || key == "HOME"
            || key == "USER"
            || key == "SHELL"
            || key == "LANG"
            || key == "LC_ALL"
            || key.starts_with("LC_")
            || key == "NODE_PATH"
            || key == "NVM_DIR"
            || key == "NVM_BIN"
            || key == "HOMEBREW_PREFIX"
            || key == "HOMEBREW_CELLAR"
            // Windows-specific
            || key == "USERPROFILE"
            || key == "USERNAME"
            || key == "COMPUTERNAME"
            || key == "APPDATA"
            || key == "LOCALAPPDATA"
            || key == "TEMP"
            || key == "TMP"
            // 🔥 修复：添加 ANTHROPIC 和 Claude Code 相关环境变量
            || key.starts_with("ANTHROPIC_")
            || key.starts_with("CLAUDE_CODE_")
            || key == "API_TIMEOUT_MS"
        {
            log::debug!("Inheriting env var: {}={}", key, value);
            tokio_cmd.env(&key, &value);
        }
    }

    // Add NVM support if the program is in an NVM directory (cross-platform)
    if program.contains("/.nvm/versions/node/") || program.contains("\\.nvm\\versions\\node\\") {
        if let Some(node_bin_dir) = std::path::Path::new(program).parent() {
            let current_path = std::env::var("PATH").unwrap_or_default();
            let node_bin_str = node_bin_dir.to_string_lossy();
            if !current_path.contains(&node_bin_str.as_ref()) {
                // Use platform-specific path separator
                #[cfg(target_os = "windows")]
                let separator = ";";
                #[cfg(not(target_os = "windows"))]
                let separator = ":";

                let new_path = format!("{}{}{}", node_bin_str, separator, current_path);
                tokio_cmd.env("PATH", new_path);
            }
        }
    }

    // 🔥 新增：读取 ~/.claude/settings.json 中的自定义环境变量
    // 这些变量会覆盖系统环境变量，确保用户的自定义配置生效
    if let Ok(claude_dir) = get_claude_dir() {
        let settings_path = claude_dir.join("settings.json");
        if settings_path.exists() {
            if let Ok(content) = fs::read_to_string(&settings_path) {
                if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(env_obj) = settings.get("env").and_then(|v| v.as_object()) {
                        log::info!(
                            "Loading {} custom environment variables from settings.json",
                            env_obj.len()
                        );
                        for (key, value) in env_obj {
                            if let Some(value_str) = value.as_str() {
                                log::info!("Setting custom env var: {}={}", key, value_str);
                                tokio_cmd.env(key, value_str);
                            }
                        }
                    }
                }
            }
        }
    }

    tokio_cmd
}

/// Helper function to spawn Claude process and handle streaming
/// Enhanced for Windows compatibility with router support
fn create_system_command(
    claude_path: &str,
    args: Vec<String>,
    project_path: &str,
    model: Option<&str>,
    fast_mode: bool,
    _max_thinking_tokens: Option<u32>, // Keep parameter for compatibility but don't use it
) -> Result<Command, String> {
    create_windows_command(claude_path, args, project_path, model, fast_mode)
}

/// Create a Windows command
/// 注意：stdout/stderr 会被 piped，stdin 也会被 piped 以支持通过管道传递 prompt
fn create_windows_command(
    claude_path: &str,
    args: Vec<String>,
    project_path: &str,
    model: Option<&str>,
    fast_mode: bool,
) -> Result<Command, String> {
    let mut cmd = create_command_with_env(claude_path);

    // 🔥 修复：设置ANTHROPIC_MODEL环境变量以确保模型选择生效
    if let Some(model_name) = model {
        log::info!(
            "Setting ANTHROPIC_MODEL environment variable to: {}",
            model_name
        );
        cmd.env("ANTHROPIC_MODEL", model_name);
    }

    if fast_mode {
        cmd.env("CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE", "1");
        cmd.env("CLAUDE_CODE_FAST_MODE", "1");
    }

    // Note: MAX_THINKING_TOKENS is now controlled via settings.json env field
    // See update_thinking_mode command for managing this setting

    // Add all arguments
    cmd.args(&args);

    // Set working directory
    cmd.current_dir(project_path);

    // Configure stdio for capturing output
    // 🔥 添加 stdin pipe 以支持通过管道传递长文本 prompt
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Apply platform-specific no-window configuration
    platform::apply_no_window_async(&mut cmd);

    // On Unix-like systems, create a new process group
    // This allows us to kill the entire process tree with a single signal
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // Create new process group, process becomes group leader
    }

    Ok(cmd)
}

/// Execute Claude Code session with project context resume and streaming output
/// Always tries to resume project context first for better continuity
/// Enhanced for Windows with better error handling
#[tauri::command]
pub async fn execute_claude_code(
    app: AppHandle,
    project_path: String,
    prompt: String,
    model: String,
    plan_mode: Option<bool>,
    max_thinking_tokens: Option<u32>,
    tab_id: Option<String>,
    fast_mode: Option<bool>,
) -> Result<(), String> {
    let plan_mode = plan_mode.unwrap_or(false);
    let fast_mode = fast_mode.unwrap_or(false);
    log::info!(
        "Starting Claude Code session with project context resume in: {} with model: {}, plan_mode: {}",
        project_path,
        model,
        plan_mode
    );

    let claude_path = crate::claude_binary::find_claude_binary(&app)?;

    // 获取当前执行配置
    let mut execution_config = get_claude_execution_config(app.clone())
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to load execution config, using default: {}", e);
            ClaudeExecutionConfig::default()
        });

    // 设置 maxThinkingTokens（如果提供）
    if let Some(tokens) = max_thinking_tokens {
        execution_config.max_thinking_tokens = Some(tokens);
        log::info!("Setting maxThinkingTokens to {}", tokens);
    }

    // 如果启用 Plan Mode，使用 Claude CLI 原生的 plan 权限模式
    if plan_mode {
        execution_config.permissions = ClaudePermissionConfig::plan_mode();
    }

    log::info!("Using execution config: permissions_mode={:?}, dangerous_skip={}, plan_mode={}, max_thinking_tokens={:?}",
        execution_config.permissions.permission_mode,
        execution_config.permissions.enable_dangerous_skip,
        plan_mode,
        execution_config.max_thinking_tokens
    );

    // 使用新的参数构建函数（先映射模型名称）
    // 🔥 修复：prompt 不再通过命令行参数传递，改为 stdin 管道传递
    let mapped_model = if fast_mode {
        "opus".to_string()
    } else {
        map_model_to_claude_alias(&model)
    };
    let args = build_execution_args(&execution_config, &mapped_model);

    // Create command
    let cmd = create_system_command(
        &claude_path,
        args,
        &project_path,
        Some(&mapped_model),
        fast_mode,
        max_thinking_tokens,
    )?;
    spawn_claude_process(app, cmd, prompt, model, project_path, tab_id).await
}

/// Continue an existing Claude Code conversation with streaming output
/// Enhanced for Windows with better error handling
#[tauri::command]
pub async fn continue_claude_code(
    app: AppHandle,
    project_path: String,
    prompt: String,
    model: String,
    plan_mode: Option<bool>,
    max_thinking_tokens: Option<u32>,
    tab_id: Option<String>,
    fast_mode: Option<bool>,
) -> Result<(), String> {
    let plan_mode = plan_mode.unwrap_or(false);
    let fast_mode = fast_mode.unwrap_or(false);
    log::info!(
        "Continuing Claude Code conversation in: {} with model: {}, plan_mode: {}",
        project_path,
        model,
        plan_mode
    );

    let claude_path = crate::claude_binary::find_claude_binary(&app)?;

    // 获取当前执行配置
    let mut execution_config = get_claude_execution_config(app.clone())
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to load execution config, using default: {}", e);
            ClaudeExecutionConfig::default()
        });

    // 设置 maxThinkingTokens（如果提供）
    if let Some(tokens) = max_thinking_tokens {
        execution_config.max_thinking_tokens = Some(tokens);
        log::info!("Setting maxThinkingTokens to {}", tokens);
    }

    // 如果启用 Plan Mode，使用 Claude CLI 原生的 plan 权限模式
    if plan_mode {
        execution_config.permissions = ClaudePermissionConfig::plan_mode();
    }

    log::info!("Continuing with execution config: permissions_mode={:?}, dangerous_skip={}, plan_mode={}, max_thinking_tokens={:?}",
        execution_config.permissions.permission_mode,
        execution_config.permissions.enable_dangerous_skip,
        plan_mode,
        execution_config.max_thinking_tokens
    );

    // 使用新的参数构建函数，添加 -c 标志用于继续对话（先映射模型名称）
    // 🔥 修复：prompt 不再通过命令行参数传递，改为 stdin 管道传递
    let mapped_model = if fast_mode {
        "opus".to_string()
    } else {
        map_model_to_claude_alias(&model)
    };
    let mut args = build_execution_args(&execution_config, &mapped_model);

    // 在开头插入 -c 标志
    args.insert(0, "-c".to_string());

    // Create command
    let cmd = create_system_command(
        &claude_path,
        args,
        &project_path,
        Some(&mapped_model),
        fast_mode,
        max_thinking_tokens,
    )?;
    spawn_claude_process(app, cmd, prompt, model, project_path, tab_id).await
}

/// Resume an existing Claude Code session by ID with streaming output
/// Enhanced for Windows with better error handling
#[tauri::command]
pub async fn resume_claude_code(
    app: AppHandle,
    project_path: String,
    session_id: String,
    prompt: String,
    model: String,
    plan_mode: Option<bool>,
    max_thinking_tokens: Option<u32>,
    tab_id: Option<String>,
    fast_mode: Option<bool>,
) -> Result<(), String> {
    let plan_mode = plan_mode.unwrap_or(false);
    let fast_mode = fast_mode.unwrap_or(false);
    log::info!(
        "Resuming Claude Code session: {} in: {} with model: {}, plan_mode: {}",
        session_id,
        project_path,
        model,
        plan_mode
    );

    // Log the session file path for debugging
    let session_dir = format!(
        "{}/.claude/projects/{}",
        std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| "~".to_string()),
        encode_project_path(&project_path)
    );
    log::info!("Expected session file directory: {}", session_dir);
    log::info!("Session ID to resume: {}", session_id);

    let claude_path = crate::claude_binary::find_claude_binary(&app)?;

    // 获取当前执行配置
    let mut execution_config = get_claude_execution_config(app.clone())
        .await
        .unwrap_or_else(|e| {
            log::warn!("Failed to load execution config, using default: {}", e);
            ClaudeExecutionConfig::default()
        });

    // 设置 maxThinkingTokens（如果提供）
    if let Some(tokens) = max_thinking_tokens {
        execution_config.max_thinking_tokens = Some(tokens);
        log::info!("Setting maxThinkingTokens to {}", tokens);
    }

    // 如果启用 Plan Mode，使用 Claude CLI 原生的 plan 权限模式
    if plan_mode {
        execution_config.permissions = ClaudePermissionConfig::plan_mode();
    }

    log::info!("Resuming with execution config: permissions_mode={:?}, dangerous_skip={}, plan_mode={}, max_thinking_tokens={:?}",
        execution_config.permissions.permission_mode,
        execution_config.permissions.enable_dangerous_skip,
        plan_mode,
        execution_config.max_thinking_tokens
    );

    // 使用新的参数构建函数，添加 --resume 和 session_id（先映射模型名称）
    // 🔥 修复：prompt 不再通过命令行参数传递，改为 stdin 管道传递
    let mapped_model = if fast_mode {
        "opus".to_string()
    } else {
        map_model_to_claude_alias(&model)
    };
    let mut args = build_execution_args(&execution_config, &mapped_model);

    // 为resume模式重新组织参数：--resume session_id 应该在最前面
    args.insert(0, "--resume".to_string());
    args.insert(1, session_id.clone());

    log::info!("Resume command: claude {}", args.join(" "));

    // Create command
    let cmd = create_system_command(
        &claude_path,
        args,
        &project_path,
        Some(&mapped_model),
        fast_mode,
        max_thinking_tokens,
    )?;

    // Try to spawn the process - if it fails, fall back to continue mode
    match spawn_claude_process(
        app.clone(),
        cmd,
        prompt.clone(),
        model.clone(),
        project_path.clone(),
        tab_id.clone(),
    )
    .await
    {
        Ok(_) => Ok(()),
        Err(resume_error) => {
            log::warn!(
                "Resume failed: {}, trying continue mode as fallback",
                resume_error
            );
            // Fallback to continue mode
            continue_claude_code(
                app,
                project_path,
                prompt,
                model,
                Some(plan_mode),
                max_thinking_tokens,
                tab_id,
                Some(fast_mode),
            )
            .await
        }
    }
}

/// Cancel the currently running Claude Code execution
#[tauri::command]
pub async fn cancel_claude_execution(
    app: AppHandle,
    session_id: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Cancelling Claude Code execution for session: {:?}",
        session_id
    );

    let mut killed = false;
    let mut attempted_methods = Vec::new();

    // Method 1: Try to find and kill via ProcessRegistry using session ID
    if let Some(sid) = &session_id {
        let registry = app.state::<crate::process::ProcessRegistryState>();
        match registry.0.get_claude_session_by_id(sid) {
            Ok(Some(process_info)) => {
                log::info!(
                    "Found process in registry for session {}: run_id={}, PID={}",
                    sid,
                    process_info.run_id,
                    process_info.pid
                );
                match registry.0.kill_process(process_info.run_id).await {
                    Ok(success) => {
                        if success {
                            log::info!("Successfully killed process via registry");
                            killed = true;
                        } else {
                            log::warn!("Registry kill returned false");
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to kill via registry: {}", e);
                    }
                }
                attempted_methods.push("registry");
            }
            Ok(None) => {
                log::warn!("Session {} not found in ProcessRegistry", sid);
            }
            Err(e) => {
                log::error!("Error querying ProcessRegistry: {}", e);
            }
        }
    }

    // Method 2: Try the legacy approach via ClaudeProcessState
    if !killed {
        let claude_state = app.state::<ClaudeProcessState>();
        let mut current_process = claude_state.current_process.lock().await;

        if let Some(mut child) = current_process.take() {
            // Try to get the PID before killing
            let pid = child.id();
            log::info!(
                "Attempting to kill Claude process via ClaudeProcessState with PID: {:?}",
                pid
            );

            // Kill the process
            match child.kill().await {
                Ok(_) => {
                    log::info!("Successfully killed Claude process via ClaudeProcessState");
                    killed = true;
                }
                Err(e) => {
                    log::error!(
                        "Failed to kill Claude process via ClaudeProcessState: {}",
                        e
                    );

                    // Fallback: If we have a PID, try system kill as last resort
                    if let Some(pid) = pid {
                        log::info!("Attempting system kill as last resort for PID: {}", pid);
                        match platform::kill_process_tree(pid) {
                            Ok(_) => {
                                log::info!("Successfully killed process tree via platform module");
                                killed = true;
                            }
                            Err(e) => {
                                log::error!("Failed to kill process tree: {}", e);
                            }
                        }
                    }
                }
            }
            attempted_methods.push("claude_state");
        } else {
            log::warn!("No active Claude process in ClaudeProcessState");
        }
    }

    // Method 3: Try killing the last spawned PID when session_id is not available
    if !killed {
        let claude_state = app.state::<ClaudeProcessState>();
        let last_pid = { *claude_state.last_spawned_pid.lock().await };
        if let Some(pid) = last_pid {
            log::info!(
                "Attempting to kill Claude process via last spawned PID: {}",
                pid
            );
            match platform::kill_process_tree(pid) {
                Ok(_) => {
                    log::info!("Successfully killed process tree via last spawned PID");
                    let mut last_pid_guard = claude_state.last_spawned_pid.lock().await;
                    if last_pid_guard.as_ref() == Some(&pid) {
                        *last_pid_guard = None;
                    }
                    killed = true;
                }
                Err(e) => {
                    log::error!("Failed to kill process tree via last spawned PID: {}", e);
                }
            }
            attempted_methods.push("last_spawned_pid");
        }
    }

    if !killed && attempted_methods.is_empty() {
        log::warn!("No active Claude process found to cancel");
    }

    // Always emit cancellation events for UI consistency
    if let Some(sid) = session_id {
        let _ = app.emit(&format!("claude-cancelled:{}", sid), true);
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        let _ = app.emit(&format!("claude-complete:{}", sid), false);
    }

    // Also emit generic events for backward compatibility
    let _ = app.emit("claude-cancelled", true);
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let _ = app.emit("claude-complete", false);

    if killed {
        log::info!("Claude process cancellation completed successfully");
    } else if !attempted_methods.is_empty() {
        log::warn!("Claude process cancellation attempted but process may have already exited. Attempted methods: {:?}", attempted_methods);
    }

    Ok(())
}

/// Get all running Claude sessions
#[tauri::command]
pub async fn list_running_claude_sessions(
    registry: tauri::State<'_, crate::process::ProcessRegistryState>,
) -> Result<Vec<crate::process::ProcessInfo>, String> {
    registry.0.get_running_claude_sessions()
}

/// Get live output from a Claude session
#[tauri::command]
pub async fn get_claude_session_output(
    registry: tauri::State<'_, crate::process::ProcessRegistryState>,
    session_id: String,
) -> Result<String, String> {
    // Find the process by session ID
    if let Some(process_info) = registry.0.get_claude_session_by_id(&session_id)? {
        registry.0.get_live_output(process_info.run_id)
    } else {
        Ok(String::new())
    }
}

/// Helper function to check if prompt is a slash command
/// Slash commands start with '/' and are typically short (like /help, /compact, /clear)
fn is_slash_command(prompt: &str) -> bool {
    let trimmed = prompt.trim();
    trimmed.starts_with('/') && !trimmed.contains('\n') && trimmed.len() < 256
}

/// 检测 prompt 是否包含 @文件/路径引用（图片或文件）。
/// Claude CLI 的 @引用展开（把文件读入上下文、把图片作为视觉块注入）只在 print 模式（-p）下生效；
/// 经 stdin 管道但不带 -p 时，@提及不会被展开，模型只看到一段字面路径文本（实测 NO_IMAGE）。
/// 因此含 @引用的 prompt 必须加 -p 标志才能让图片/文件被真正解析。
///
/// 为避免把邮箱（user@host）、npm scope（@types/node 作为普通文字）等误判为路径引用，
/// 仅当 token 以 @ 开头、且其后内容看起来像文件路径（含 / 或 \，或带常见文件扩展名）时才命中。
fn contains_at_reference(prompt: &str) -> bool {
    prompt.split_whitespace().any(|tok| {
        // 去掉前导括号/引号，识别 @ 开头的 token
        let t = tok.trim_start_matches(|c| c == '(' || c == '[' || c == '"' || c == '\'');
        let Some(rest) = t.strip_prefix('@') else {
            return false;
        };
        if rest.is_empty() {
            return false;
        }
        // 去掉尾部引号/标点后判断是否像路径
        let rest = rest.trim_end_matches(|c| c == '"' || c == '\'' || c == ')' || c == ']');
        rest.contains('/')
            || rest.contains('\\')
            || matches!(
                rest.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref(),
                Some(
                    "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svg"
                        | "pdf" | "txt" | "md" | "json" | "csv" | "log"
                )
            )
    })
}

/// 判断路径是否为受支持的图片扩展名。
fn is_image_extension(path: &str) -> bool {
    matches!(
        path.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svg")
    )
}

/// 根据图片扩展名推断 Anthropic API 接受的 media_type。
fn image_media_type(path: &str) -> &'static str {
    match path.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        // png 及其它（bmp/ico/svg 等少见格式）统一回退到 png
        _ => "image/png",
    }
}

/// 从 prompt 文本中提取 @图片引用的文件路径（去重、保序）。
/// 复用前端 MessageImagePreview 的约定：@"含空格路径" 与 @无空格路径 两种形态，
/// 仅保留图片扩展名，跳过 data: 内联 URL（base64 注入只处理真实文件）。
fn extract_image_paths(prompt: &str) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut push = |p: &str| {
        if p.starts_with("data:") {
            return;
        }
        if is_image_extension(p) && seen.insert(p.to_string()) {
            paths.push(p.to_string());
        }
    };

    // 模式1：@"路径"（含空格，引号包裹）。
    let bytes = prompt.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'@' && bytes[i + 1] == b'"' {
            if let Some(end_rel) = prompt[i + 2..].find('"') {
                let start = i + 2;
                let end = start + end_rel;
                push(&prompt[start..end]);
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }

    // 模式2：@路径（无空格，到空白或引号止）。
    // 与模式1重复的路径会被 seen 去重，引号形态在此跳过。
    for tok in prompt.split_whitespace() {
        let t = tok.trim_start_matches(|c| c == '(' || c == '[' || c == '\'');
        if let Some(rest) = t.strip_prefix('@') {
            if rest.starts_with('"') {
                continue; // 引号形态已由模式1处理
            }
            let rest = rest.trim_end_matches(|c| c == ')' || c == ']' || c == ',');
            push(rest);
        }
    }

    paths
}

/// 构造一行 stream-json（NDJSON）user 消息，把图片作为 base64 视觉块直接注入。
/// 这样 Claude 无需调用 Read 工具即可"看到"图片（绕开 Read 读较大图失效的问题，issue #18588）。
/// 读盘失败的图片会被跳过并记录 warn，不阻断整条消息。
fn build_stream_json_message(prompt: &str, image_paths: &[String]) -> String {
    use base64::{engine::general_purpose, Engine};

    let mut content: Vec<serde_json::Value> = Vec::new();
    // 文本块保留原始 prompt（含 @路径文字无妨，模型已能看到真图）
    content.push(serde_json::json!({ "type": "text", "text": prompt }));

    for path in image_paths {
        match std::fs::read(path) {
            Ok(bytes) => {
                let b64 = general_purpose::STANDARD.encode(&bytes);
                content.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image_media_type(path),
                        "data": b64,
                    }
                }));
                log::info!("Injected image as base64 block: {} ({} bytes)", path, bytes.len());
            }
            Err(e) => {
                log::warn!("Failed to read image '{}', skipping: {}", path, e);
            }
        }
    }

    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content }
    });

    // NDJSON：单行 JSON + 换行
    format!("{}\n", msg)
}

/// Helper function to spawn Claude process and handle streaming
/// 🔥 修复：斜杠命令通过 -p 参数传递（触发命令解析），普通 prompt 通过 stdin 管道传递
/// 这样既支持斜杠命令，又避免操作系统命令行长度限制（Windows ~8KB, Linux/macOS ~128KB-2MB）
/// 🔒 CRITICAL FIX: 添加 tab_id 参数，用于全局事件中标识消息来源，解决新建会话并发时的消息串扰
async fn spawn_claude_process(
    app: AppHandle,
    mut cmd: Command,
    prompt: String,
    model: String,
    project_path: String,
    tab_id: Option<String>,
) -> Result<(), String> {
    use std::sync::Mutex;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    // 🔥 关键修复：检测斜杠命令，通过 -p 参数传递以触发命令解析
    // Claude CLI 只在 -p 参数中解析斜杠命令，stdin 管道不会触发
    let is_slash = is_slash_command(&prompt);

    // 提取 prompt 中的 @图片路径。含图片时改走 stream-json 输入，把图片作为 base64 视觉块
    // 直接注入（绕开 Read 工具——实测 Read 读较大图片后模型收不到有效图像，issue #18588）。
    let image_paths: Vec<String> = if is_slash {
        Vec::new()
    } else {
        extract_image_paths(&prompt)
    };
    let has_images = !image_paths.is_empty();

    // 含非图片 @文件引用（如文本文件）仍走 -p + Read（文本文件无 #18588 问题）
    let has_at_ref = !is_slash && !has_images && contains_at_reference(&prompt);

    // 写入 stdin 的载荷：
    // - 含图片：一行 stream-json NDJSON user 消息（text + image base64 块）
    // - 其它非斜杠：原始 prompt 文本
    let stdin_payload: Option<String> = if is_slash {
        None
    } else if has_images {
        Some(build_stream_json_message(&prompt, &image_paths))
    } else {
        Some(prompt.clone())
    };

    if is_slash {
        // 斜杠命令：prompt 作为 -p 的参数传入以触发命令解析
        log::info!("Detected slash command, using -p flag: {}", prompt.trim());
        cmd.arg("-p");
        cmd.arg(&prompt);
    } else if has_images {
        // 含图片：print 模式 + stream-json 输入，stdin 注入 base64 图像块
        log::info!(
            "Detected {} image(s) in prompt, using stream-json input to inject image blocks",
            image_paths.len()
        );
        cmd.arg("-p");
        cmd.arg("--input-format");
        cmd.arg("stream-json");
    } else if has_at_ref {
        // 含非图片 @引用：仅加 -p 标志触发 @展开，prompt 仍走 stdin
        log::info!("Detected @file reference, enabling print mode (-p) for @expansion");
        cmd.arg("-p");
    }

    // Spawn the process
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude: {}", e))?;

    // 🔥 通过 stdin 管道写入载荷，避免命令行长度限制
    // 斜杠命令已通过 -p 参数传递 prompt（stdin_payload 为 None），只需关闭 stdin
    if let Some(payload) = stdin_payload {
        if let Some(mut stdin) = child.stdin.take() {
            let prompt_len = payload.len();
            log::info!("Writing payload to stdin ({} bytes)", prompt_len);

            // 使用 spawn 异步写入 stdin，避免阻塞主流程
            tokio::spawn(async move {
                match stdin.write_all(payload.as_bytes()).await {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => {
                        log::warn!(
                            "stdin BrokenPipe: child process exited before payload was fully written"
                        );
                        return;
                    }
                    Err(e) => {
                        log::error!("Failed to write payload to stdin: {}", e);
                        return;
                    }
                }
                // 关闭 stdin 表示输入完成
                if let Err(e) = stdin.shutdown().await {
                    log::warn!("Failed to shutdown stdin: {}", e);
                }
                log::info!("Successfully wrote payload to stdin and closed");
            });
        } else {
            log::warn!("Failed to get stdin handle, payload may not be sent");
        }
    } else {
        // 斜杠命令模式：关闭 stdin 以信号结束
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                if let Err(e) = stdin.shutdown().await {
                    log::warn!("Failed to shutdown stdin for slash command: {}", e);
                }
            });
        }
    }

    // Get stdout and stderr
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    // Get the child PID for logging
    let pid = child.id().unwrap_or(0);
    log::info!("Spawned Claude process with PID: {:?}", pid);

    // 🔧 FIX: Create Job Object IMMEDIATELY after spawn, before Claude starts MCP servers
    // This ensures all child processes (including MCP node processes) are automatically
    // added to the Job Object and will be terminated when the job is closed.
    // Previously, Job Object was created when receiving init message, which was too late.
    #[cfg(windows)]
    let job_object: Option<Arc<JobObject>> = if pid != 0 {
        match JobObject::create() {
            Ok(job) => match job.assign_process_by_pid(pid) {
                Ok(_) => {
                    log::info!(
                        "🔧 FIX: Assigned process {} to Job Object immediately after spawn",
                        pid
                    );
                    Some(Arc::new(job))
                }
                Err(e) => {
                    log::warn!("Failed to assign process {} to Job Object: {}", pid, e);
                    None
                }
            },
            Err(e) => {
                log::warn!("Failed to create Job Object: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Create readers first (before moving child)
    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    // We'll extract the session ID from Claude's init message
    let session_id_holder: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let run_id_holder: Arc<Mutex<Option<i64>>> = Arc::new(Mutex::new(None));
    #[cfg(windows)]
    let job_object_holder: Arc<std::sync::Mutex<Option<Arc<JobObject>>>> =
        Arc::new(std::sync::Mutex::new(job_object));

    // 🔒 CRITICAL FIX: 不再使用全局 ClaudeProcessState 管理进程生命周期
    // 原因：全局单例只能存储一个 child，多会话并发时会互相覆盖
    // 解决：每个进程独立管理自己的 child，取消功能通过 ProcessRegistry 实现
    //
    // ClaudeProcessState 仅作为向后兼容的备选取消机制（存储最新进程的 PID）
    let claude_state = app.state::<ClaudeProcessState>();
    {
        let mut current_process = claude_state.current_process.lock().await;
        // 仅用于记录，不影响进程管理
        if current_process.is_some() {
            log::info!("Another Claude process is running, allowing concurrent sessions");
        }
        // 不再存储 child，改为独立管理
        *current_process = None;
    }
    if pid != 0 {
        let mut last_pid = claude_state.last_spawned_pid.lock().await;
        *last_pid = Some(pid);
    }

    // Check if auto-compact state is available
    let auto_compact_available = app
        .try_state::<crate::commands::context_manager::AutoCompactState>()
        .is_some();

    // Spawn tasks to read stdout and stderr
    let app_handle = app.clone();
    let session_id_holder_clone = session_id_holder.clone();
    let run_id_holder_clone = run_id_holder.clone();
    let registry = app.state::<crate::process::ProcessRegistryState>();
    let registry_clone = registry.0.clone();
    let project_path_clone = project_path.clone();
    let prompt_clone = prompt.clone();
    let model_clone = model.clone();
    // 🔒 CRITICAL FIX: 克隆 tab_id 用于事件发送
    let tab_id_for_stdout = tab_id.clone();
    // 🔧 FIX: Clone job_object_holder for passing to register_claude_session
    #[cfg(windows)]
    let job_object_holder_clone = job_object_holder.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            // Use trace level to avoid flooding logs in debug mode
            log::trace!("Claude stdout: {}", line);

            // Parse the line to check for init message with session ID
            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                if msg["type"] == "system" && msg["subtype"] == "init" {
                    if let Some(claude_session_id) = msg["session_id"].as_str() {
                        let mut session_id_guard = session_id_holder_clone.lock().unwrap();
                        if session_id_guard.is_none() {
                            *session_id_guard = Some(claude_session_id.to_string());
                            log::info!("Extracted Claude session ID: {}", claude_session_id);

                            // Register with auto-compact manager
                            if auto_compact_available {
                                if let Some(auto_compact_state) = app_handle.try_state::<crate::commands::context_manager::AutoCompactState>() {
                                    if let Err(e) = auto_compact_state.0.register_session(
                                    claude_session_id.to_string(),
                                    project_path_clone.clone(),
                                    model_clone.clone(),
                                ) {
                                    log::warn!("Failed to register session with auto-compact manager: {}", e);
                                }
                                }
                            }

                            // Now register with ProcessRegistry using Claude's session ID
                            // 🔧 FIX: Pass the pre-created Job Object to avoid orphan processes
                            #[cfg(windows)]
                            let job_object_for_register =
                                job_object_holder_clone.lock().unwrap().take();
                            #[cfg(not(windows))]
                            let job_object_for_register: Option<()> = None;

                            match registry_clone.register_claude_session_with_job(
                                claude_session_id.to_string(),
                                pid,
                                project_path_clone.clone(),
                                prompt_clone.clone(),
                                model_clone.clone(),
                                job_object_for_register,
                            ) {
                                Ok(run_id) => {
                                    log::info!("Registered Claude session with run_id: {}", run_id);
                                    let mut run_id_guard = run_id_holder_clone.lock().unwrap();
                                    *run_id_guard = Some(run_id);

                                    // ✨ Phase 2: Emit event for real-time session tracking
                                    let event_payload = serde_json::json!({
                                        "session_id": claude_session_id,
                                        "project_path": project_path_clone,
                                        "model": model_clone,
                                        "status": "started",
                                        "pid": pid,
                                        "run_id": run_id,
                                    });
                                    if let Err(e) =
                                        app_handle.emit("claude-session-state", &event_payload)
                                    {
                                        log::warn!(
                                            "Failed to emit claude-session-state event: {}",
                                            e
                                        );
                                    } else {
                                        log::info!(
                                            "Emitted claude-session-started event for session: {}",
                                            claude_session_id
                                        );
                                    }

                                    log::info!(
                                        "Claude CLI will handle project creation for session: {}",
                                        claude_session_id
                                    );
                                }
                                Err(e) => {
                                    log::error!("Failed to register Claude session: {}", e);
                                }
                            }
                        }
                    }
                }

                // Check for usage information and update context tracking
                if let Some(usage) = msg.get("usage") {
                    if let (Some(input_tokens), Some(output_tokens)) = (
                        usage.get("input_tokens").and_then(|t| t.as_u64()),
                        usage.get("output_tokens").and_then(|t| t.as_u64()),
                    ) {
                        let total_tokens = (input_tokens + output_tokens) as usize;

                        // Extract cache tokens if available
                        let _cache_creation_tokens = usage
                            .get("cache_creation_input_tokens")
                            .and_then(|t| t.as_u64());
                        let _cache_read_tokens = usage
                            .get("cache_read_input_tokens")
                            .and_then(|t| t.as_u64());

                        // Store usage data in database for real-time token statistics
                        let session_id_for_update =
                            { session_id_holder_clone.lock().unwrap().as_ref().cloned() };

                        if let Some(session_id_str) = &session_id_for_update {
                            // Agent database functionality removed - usage tracking disabled

                            // Update auto-compact manager with token count
                            if auto_compact_available {
                                if let Some(auto_compact_state) = app_handle.try_state::<crate::commands::context_manager::AutoCompactState>() {
                                    let auto_compact_state_clone = auto_compact_state.inner().clone();
                                    let session_id_for_compact = session_id_str.clone();

                                    // Spawn async task to avoid blocking main output loop
                                    tokio::spawn(async move {
                                        match auto_compact_state_clone.0.update_session_tokens(&session_id_for_compact, total_tokens).await {
                                            Ok(compaction_triggered) => {
                                                if compaction_triggered {
                                                    log::info!("Auto-compaction triggered for session {}", session_id_for_compact);
                                                    // The actual compaction will be handled by the background monitoring thread
                                                }
                                            }
                                            Err(e) => {
                                                log::warn!("Failed to update session tokens for auto-compact: {}", e);
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }

            // Store live output in registry if we have a run_id
            if let Some(run_id) = *run_id_holder_clone.lock().unwrap() {
                let _ = registry_clone.append_live_output(run_id, &line);
            }

            // Emit the line to the frontend with session isolation if we have session ID
            if let Some(ref session_id) = *session_id_holder_clone.lock().unwrap() {
                let _ = app_handle.emit(&format!("claude-output:{}", session_id), &line);
            }
            // 🔒 CRITICAL FIX: 全局事件包含 tab_id，用于前端过滤新建会话的消息
            let global_payload = serde_json::json!({
                "tab_id": tab_id_for_stdout,
                "payload": &line
            });
            let _ = app_handle.emit("claude-output", &global_payload);
        }
    });

    let app_handle_stderr = app.clone();
    let session_id_holder_clone2 = session_id_holder.clone();
    // 🔒 CRITICAL FIX: 克隆 tab_id 用于 stderr 事件
    let tab_id_for_stderr = tab_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::error!("Claude stderr: {}", line);
            // Emit error lines to the frontend with session isolation if we have session ID
            if let Some(ref session_id) = *session_id_holder_clone2.lock().unwrap() {
                let _ = app_handle_stderr.emit(&format!("claude-error:{}", session_id), &line);
            }
            // 🔒 CRITICAL FIX: 全局事件包含 tab_id
            let global_payload = serde_json::json!({
                "tab_id": tab_id_for_stderr,
                "payload": &line
            });
            let _ = app_handle_stderr.emit("claude-error", &global_payload);
        }
    });

    // Wait for the process to complete
    // 🔒 CRITICAL FIX: 直接将 child 移动到 wait task 中，而不是从全局 state 取出
    // 这样每个进程独立管理自己的生命周期，支持真正的多会话并发
    let app_handle_wait = app.clone();
    let session_id_holder_clone3 = session_id_holder.clone();
    let run_id_holder_clone2 = run_id_holder.clone();
    let registry_clone2 = registry.0.clone();
    let last_spawned_pid = claude_state.last_spawned_pid.clone();
    // 🔒 CRITICAL FIX: 克隆 tab_id 用于 complete 事件
    let tab_id_for_complete = tab_id;
    tokio::spawn(async move {
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        // 🔒 CRITICAL FIX: 直接等待 child，不再从全局 state 取出
        // child 已经被移动到这个 async block 中
        match child.wait().await {
            Ok(status) => {
                log::info!("Claude process exited with status: {}", status);
                // Add a small delay to ensure all messages are processed
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                if let Some(ref session_id) = *session_id_holder_clone3.lock().unwrap() {
                    // ✨ Phase 2: Emit state change event
                    let event_payload = serde_json::json!({
                        "session_id": session_id,
                        "status": "stopped",
                        "success": status.success(),
                    });
                    let _ = app_handle_wait.emit("claude-session-state", &event_payload);

                    let _ = app_handle_wait
                        .emit(&format!("claude-complete:{}", session_id), status.success());
                }
                // 🔒 CRITICAL FIX: 全局事件包含 tab_id
                let global_payload = serde_json::json!({
                    "tab_id": tab_id_for_complete,
                    "payload": status.success()
                });
                let _ = app_handle_wait.emit("claude-complete", &global_payload);
            }
            Err(e) => {
                log::error!("Failed to wait for Claude process: {}", e);
                // Add a small delay to ensure all messages are processed
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                if let Some(ref session_id) = *session_id_holder_clone3.lock().unwrap() {
                    // ✨ Phase 2: Emit state change event for error case
                    let event_payload = serde_json::json!({
                        "session_id": session_id,
                        "status": "stopped",
                        "success": false,
                        "error": e.to_string(),
                    });
                    let _ = app_handle_wait.emit("claude-session-state", &event_payload);

                    let _ = app_handle_wait.emit(&format!("claude-complete:{}", session_id), false);
                }
                // 🔒 CRITICAL FIX: 全局事件包含 tab_id
                let global_payload = serde_json::json!({
                    "tab_id": tab_id_for_complete,
                    "payload": false
                });
                let _ = app_handle_wait.emit("claude-complete", &global_payload);
            }
        }

        // Unregister from ProcessRegistry if we have a run_id
        if let Some(run_id) = *run_id_holder_clone2.lock().unwrap() {
            let _ = registry_clone2.unregister_process(run_id);
        }

        if pid != 0 {
            let mut last_pid = last_spawned_pid.lock().await;
            if last_pid.as_ref() == Some(&pid) {
                *last_pid = None;
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{contains_at_reference, extract_image_paths, is_slash_command};

    #[test]
    fn slash_command_detected() {
        assert!(is_slash_command("/help"));
        assert!(is_slash_command("  /compact  "));
        assert!(!is_slash_command("hello"));
        assert!(!is_slash_command("/multi\nline"));
    }

    #[test]
    fn at_reference_detects_image_paths() {
        // 正斜杠绝对路径（修复后剪贴板图片的形态）
        assert!(contains_at_reference(
            "描述这张图 @C:/Users/x/Temp/clipboard_image_1.png"
        ));
        // 反斜杠路径
        assert!(contains_at_reference("看 @C:\\Users\\x\\img.jpg"));
        // 引号包裹的含空格路径
        assert!(contains_at_reference("@\"C:/My Pictures/a b.png\""));
        // 相对路径
        assert!(contains_at_reference("@assets/logo.svg 是什么"));
        // 无扩展名但含分隔符的路径
        assert!(contains_at_reference("@src/main 看这里"));
    }

    #[test]
    fn at_reference_ignores_non_paths() {
        // 纯文字不应触发 -p
        assert!(!contains_at_reference("你好吗，帮我写个函数"));
        // 邮箱不应误判为路径引用
        assert!(!contains_at_reference("联系 user@example.com 获取帮助"));
        // 单独的 @ 符号
        assert!(!contains_at_reference("价格 @ 100 元"));
        // npm scope 作为普通文字（无路径分隔符、无文件扩展名）
        assert!(!contains_at_reference("安装 @types 这个包"));
    }

    #[test]
    fn extract_image_paths_unquoted() {
        let p = "描述这张图 @C:/Users/x/Temp/clipboard_image_1.png";
        assert_eq!(
            extract_image_paths(p),
            vec!["C:/Users/x/Temp/clipboard_image_1.png".to_string()]
        );
    }

    #[test]
    fn extract_image_paths_quoted_with_spaces() {
        let p = "看 @\"C:/My Pictures/a b.png\" 这张";
        assert_eq!(
            extract_image_paths(p),
            vec!["C:/My Pictures/a b.png".to_string()]
        );
    }

    #[test]
    fn extract_image_paths_backslash() {
        let p = "@C:\\Users\\x\\shot.jpeg";
        assert_eq!(
            extract_image_paths(p),
            vec!["C:\\Users\\x\\shot.jpeg".to_string()]
        );
    }

    #[test]
    fn extract_image_paths_multiple_and_dedup() {
        let p = "@a/1.png 和 @a/2.gif 再看 @a/1.png";
        assert_eq!(
            extract_image_paths(p),
            vec!["a/1.png".to_string(), "a/2.gif".to_string()]
        );
    }

    #[test]
    fn extract_image_paths_skips_non_images_and_data_url() {
        // 非图片文件不纳入
        assert!(extract_image_paths("@notes/readme.md 看看").is_empty());
        // data: 内联 URL 跳过
        assert!(extract_image_paths("@\"data:image/png;base64,AAAA\"").is_empty());
        // 纯文字无图片
        assert!(extract_image_paths("你好，帮我写函数").is_empty());
    }
}
