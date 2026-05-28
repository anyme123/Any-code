/**
 * Codex Session Management Module
 *
 * Handles session lifecycle operations including:
 * - Session execution (execute, resume, cancel)
 * - Session listing and history
 * - Session deletion
 */
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// Import platform-specific utilities for window hiding
use crate::claude_binary::detect_binary_for_tool;
use crate::commands::claude::apply_no_window_async;
use crate::process::JobObject;
// Import WSL utilities for Windows + WSL Codex support
use super::super::wsl_utils;
// Import config module for sessions directory
use super::config::get_codex_sessions_dir;

// ============================================================================
// Type Definitions
// ============================================================================

/// Codex execution mode
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CodexExecutionMode {
    /// Read-only mode (safe, no writes)
    ReadOnly,
    /// Default sandbox: prompt user before sensitive operations
    Default,
    /// Allow file edits without prompts (workspace-write)
    FullAuto,
    /// Full access including network (danger)
    DangerFullAccess,
}

impl Default for CodexExecutionMode {
    fn default() -> Self {
        Self::ReadOnly
    }
}

/// Codex execution options
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecutionOptions {
    /// Project path
    pub project_path: String,

    /// User prompt
    pub prompt: String,

    /// Execution mode
    #[serde(default)]
    pub mode: CodexExecutionMode,

    /// Model to use (e.g., "gpt-5.5")
    pub model: Option<String>,

    /// Enable Codex fast service tier for supported models
    pub fast_mode: Option<bool>,

    /// Reasoning effort for this run (minimal, low, medium, high, xhigh)
    pub reasoning_effort: Option<String>,

    /// Enable JSON output mode
    #[serde(default = "default_json_mode")]
    pub json: bool,

    /// Output schema for structured output (JSON Schema)
    pub output_schema: Option<String>,

    /// Output file path
    pub output_file: Option<String>,

    /// Skip Git repository check
    #[serde(default)]
    pub skip_git_repo_check: bool,

    /// API key (overrides default)
    pub api_key: Option<String>,

    /// Session ID for resuming
    pub session_id: Option<String>,

    /// Resume last session
    #[serde(default)]
    pub resume_last: bool,
}

fn default_json_mode() -> bool {
    true
}

/// 把 mode 转成 Codex CLI 的 -c sandbox_mode=… 值；Default 不需要覆盖
fn codex_sandbox_mode_override(mode: &CodexExecutionMode) -> Option<&'static str> {
    match mode {
        CodexExecutionMode::ReadOnly => Some("read-only"),
        CodexExecutionMode::FullAuto => Some("workspace-write"),
        CodexExecutionMode::DangerFullAccess => Some("danger-full-access"),
        CodexExecutionMode::Default => None,
    }
}

/// Codex session metadata
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSession {
    /// Session/thread ID
    pub id: String,

    /// Project path
    pub project_path: String,

    /// Creation timestamp
    pub created_at: u64,

    /// Last updated timestamp
    pub updated_at: u64,

    /// Execution mode used
    pub mode: CodexExecutionMode,

    /// Model used
    pub model: Option<String>,

    /// Session status
    pub status: String,

    /// First user message
    pub first_message: Option<String>,

    /// Last message timestamp (ISO string)
    pub last_message_timestamp: Option<String>,
}

/// Codex process handle with PID for proper cleanup
pub struct CodexProcessHandle {
    pub child: Child,
    pub pid: u32,
    /// Windows Job Object (kills all child processes when dropped); no-op on non-Windows.
    pub job_object: Option<JobObject>,
}

/// Global state to track Codex processes
pub struct CodexProcessState {
    pub processes: Arc<Mutex<HashMap<String, CodexProcessHandle>>>,
    pub last_session_id: Arc<Mutex<Option<String>>>,
}

impl Default for CodexProcessState {
    fn default() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            last_session_id: Arc::new(Mutex::new(None)),
        }
    }
}

// ============================================================================
// Core Execution Methods
// ============================================================================

/// Executes a Codex task in non-interactive mode with streaming output
#[tauri::command]
pub async fn execute_codex(
    options: CodexExecutionOptions,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Avoid logging sensitive fields (prompt/api_key). Log only non-sensitive metadata.
    log::info!(
        "execute_codex called: project_path={}, mode={:?}, model={:?}, json={}, output_schema_present={}, output_file_present={}, skip_git_repo_check={}, session_id_present={}, resume_last={}, api_key_present={}, prompt_len={}",
        options.project_path,
        options.mode,
        options.model,
        options.json,
        options.output_schema.is_some(),
        options.output_file.is_some(),
        options.skip_git_repo_check,
        options.session_id.is_some(),
        options.resume_last,
        options.api_key.is_some(),
        options.prompt.len()
    );

    // Build codex exec command
    let (cmd, prompt) = build_codex_command(&options, false, None)?;

    // Execute and stream output
    let session_id = format!("codex-{}", uuid::Uuid::new_v4());
    execute_codex_process(
        session_id,
        cmd,
        prompt,
        options.project_path.clone(),
        app_handle,
    )
    .await
}

/// Resumes a previous Codex session
#[tauri::command]
pub async fn resume_codex(
    session_id: String,
    options: CodexExecutionOptions,
    app_handle: AppHandle,
) -> Result<(), String> {
    log::info!("resume_codex called for session: {}", session_id);

    // Build codex exec resume command (session_id added inside build function)
    let (cmd, prompt) = build_codex_command(&options, true, Some(&session_id))?;

    // Execute and stream output
    let channel_session_id = format!("codex-{}", uuid::Uuid::new_v4());
    execute_codex_process(
        channel_session_id,
        cmd,
        prompt,
        options.project_path.clone(),
        app_handle,
    )
    .await
}

/// Resumes the last Codex session
#[tauri::command]
pub async fn resume_last_codex(
    options: CodexExecutionOptions,
    app_handle: AppHandle,
) -> Result<(), String> {
    log::info!("resume_last_codex called");

    // Build codex exec resume --last command
    let (cmd, prompt) = build_codex_command(&options, true, Some("--last"))?;

    // Execute and stream output
    let session_id = format!("codex-{}", uuid::Uuid::new_v4());
    execute_codex_process(
        session_id,
        cmd,
        prompt,
        options.project_path.clone(),
        app_handle,
    )
    .await
}

/// Cancels a running Codex execution
#[tauri::command]
pub async fn cancel_codex(session_id: Option<String>, app_handle: AppHandle) -> Result<(), String> {
    use crate::commands::claude::kill_process_tree;

    log::info!("cancel_codex called for session: {:?}", session_id);

    let state: tauri::State<'_, CodexProcessState> = app_handle.state();
    let mut processes = state.processes.lock().await;

    if let Some(sid) = session_id {
        // Cancel specific session
        if let Some(handle) = processes.remove(&sid) {
            let pid = handle.pid;
            log::info!(
                "Killing Codex process tree for session: {} (PID: {})",
                sid,
                pid
            );

            // Kill the entire process tree (parent + all children)
            if let Err(e) = kill_process_tree(pid) {
                log::error!("Failed to kill process tree for session {}: {}", sid, e);
                // Fallback: try to kill main process directly
                let mut child = handle.child;
                if let Err(e2) = child.kill().await {
                    log::error!("Fallback kill also failed: {}", e2);
                }
            } else {
                log::info!(
                    "Successfully killed Codex process tree for session: {}",
                    sid
                );
            }
        } else {
            log::warn!("No running process found for session: {}", sid);
        }
    } else {
        // Cancel all processes
        for (sid, handle) in processes.drain() {
            let pid = handle.pid;
            log::info!(
                "Killing Codex process tree for session: {} (PID: {})",
                sid,
                pid
            );

            if let Err(e) = kill_process_tree(pid) {
                log::error!("Failed to kill process tree for session {}: {}", sid, e);
                let mut child = handle.child;
                if let Err(e2) = child.kill().await {
                    log::error!("Fallback kill also failed: {}", e2);
                }
            } else {
                log::info!(
                    "Successfully killed Codex process tree for session: {}",
                    sid
                );
            }
        }
    }

    Ok(())
}

// ============================================================================
// Session Management
// ============================================================================

/// Lists all Codex sessions by reading ~/.codex/sessions directory
/// On Windows with WSL mode, reads from WSL filesystem via UNC path
#[tauri::command]
pub async fn list_codex_sessions() -> Result<Vec<CodexSession>, String> {
    log::info!("list_codex_sessions called");

    // Use unified sessions directory function (supports WSL)
    let sessions_dir = get_codex_sessions_dir()?;
    log::info!("Looking for Codex sessions in: {:?}", sessions_dir);

    if !sessions_dir.exists() {
        log::warn!(
            "Codex sessions directory does not exist: {:?}",
            sessions_dir
        );
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    // Walk through date-organized directories (2025/11/23/rollout-xxx.jsonl)
    if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
        for year_entry in entries.flatten() {
            if let Ok(month_entries) = std::fs::read_dir(year_entry.path()) {
                for month_entry in month_entries.flatten() {
                    if let Ok(day_entries) = std::fs::read_dir(month_entry.path()) {
                        for day_entry in day_entries.flatten() {
                            // day_entry is a day directory (e.g., "23"), go into it
                            if day_entry.path().is_dir() {
                                if let Ok(file_entries) = std::fs::read_dir(day_entry.path()) {
                                    for file_entry in file_entries.flatten() {
                                        let path = file_entry.path();
                                        if path.extension().and_then(|s| s.to_str())
                                            == Some("jsonl")
                                        {
                                            match parse_codex_session_file(&path) {
                                                Some(session) => {
                                                    log::debug!(
                                                        "Found session: {} ({})",
                                                        session.id,
                                                        session.project_path
                                                    );
                                                    sessions.push(session);
                                                }
                                                None => {
                                                    log::debug!("Failed to parse: {:?}", path);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by creation time (newest first)
    sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    log::info!("Found {} Codex sessions", sessions.len());
    Ok(sessions)
}

/// Parses a Codex session JSONL file to extract metadata
pub fn parse_codex_session_file(path: &std::path::Path) -> Option<CodexSession> {
    use std::io::{BufRead, BufReader};

    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    // Read first line (session_meta)
    let first_line = lines.next()?.ok()?;
    let meta: serde_json::Value = serde_json::from_str(&first_line).ok()?;

    if meta["type"].as_str()? != "session_meta" {
        return None;
    }

    let payload = &meta["payload"];
    let session_id = payload["id"].as_str()?.to_string();
    let timestamp_str = payload["timestamp"].as_str()?;
    let created_at = chrono::DateTime::parse_from_rfc3339(timestamp_str)
        .ok()?
        .timestamp() as u64;

    // Get cwd and convert from WSL path format if needed
    let cwd_raw = payload["cwd"].as_str().unwrap_or("");
    #[cfg(target_os = "windows")]
    let cwd = {
        // Convert WSL path (/mnt/c/...) to Windows path (C:\...)
        // This ensures the UI displays Windows-friendly paths
        if cwd_raw.starts_with("/mnt/") {
            wsl_utils::wsl_to_windows_path(cwd_raw)
        } else {
            cwd_raw.to_string()
        }
    };
    #[cfg(not(target_os = "windows"))]
    let cwd = cwd_raw.to_string();

    // Extract first user message and other metadata from subsequent lines
    let mut first_message: Option<String> = None;
    let mut last_timestamp: Option<String> = None;
    let mut model: Option<String> = None;

    // Parse remaining lines to find first user message
    for line_result in lines {
        if let Ok(line) = line_result {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                // Update last timestamp
                if let Some(ts) = event["timestamp"].as_str() {
                    last_timestamp = Some(ts.to_string());
                }

                // Extract model from session_meta or other events
                if event["type"].as_str() == Some("session_meta") {
                    if let Some(m) = event["payload"]["model"].as_str() {
                        model = Some(m.to_string());
                    }
                }

                // Find first user message
                if first_message.is_none() && event["type"].as_str() == Some("response_item") {
                    if let Some(payload_obj) = event["payload"].as_object() {
                        if payload_obj.get("role").and_then(|r| r.as_str()) == Some("user") {
                            if let Some(content) =
                                payload_obj.get("content").and_then(|c| c.as_array())
                            {
                                // Extract text from content array
                                for item in content {
                                    // Check if this is a text content block (input_text type)
                                    if item["type"].as_str() == Some("input_text") {
                                        if let Some(text) = item["text"].as_str() {
                                            // Skip system messages (environment_context and AGENTS.md)
                                            if !text.contains("<environment_context>")
                                                && !text.contains("# AGENTS.md instructions")
                                                && !text.is_empty()
                                                && text.trim().len() > 0
                                            {
                                                first_message = Some(text.to_string());
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Early exit if we have all info
                if first_message.is_some() && model.is_some() {
                    break;
                }
            }
        }
    }

    let updated_at = last_timestamp
        .as_ref()
        .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
        .map(|dt| dt.timestamp() as u64)
        .unwrap_or(created_at);

    Some(CodexSession {
        id: session_id,
        project_path: cwd,
        created_at,
        updated_at,
        mode: CodexExecutionMode::ReadOnly,
        model,
        status: "completed".to_string(),
        first_message,
        last_message_timestamp: last_timestamp,
    })
}

/// Loads Codex session history from JSONL file
/// On Windows with WSL mode, reads from WSL filesystem via UNC path
#[tauri::command]
pub async fn load_codex_session_history(
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    log::info!("load_codex_session_history called for: {}", session_id);

    // Use unified sessions directory function (supports WSL)
    let sessions_dir = get_codex_sessions_dir()?;

    // Search for file containing this session_id
    let session_file = find_session_file(&sessions_dir, &session_id)
        .ok_or_else(|| format!("Session file not found for ID: {}", session_id))?;

    // Read and parse JSONL file
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(&session_file)
        .map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);
    let mut events = Vec::new();
    let mut line_count = 0;
    let mut parse_errors = 0;

    for line_result in reader.lines() {
        line_count += 1;
        match line_result {
            Ok(line) => {
                if line.trim().is_empty() {
                    continue; // Skip empty lines
                }
                match serde_json::from_str::<serde_json::Value>(&line) {
                    Ok(event) => {
                        events.push(event);
                    }
                    Err(e) => {
                        parse_errors += 1;
                        log::warn!(
                            "Failed to parse line {} in session {}: {}",
                            line_count,
                            session_id,
                            e
                        );
                        log::debug!("Problematic line content: {}", line);
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "Failed to read line {} in session {}: {}",
                    line_count,
                    session_id,
                    e
                );
            }
        }
    }

    log::info!(
        "Loaded {} events from Codex session {} (total lines: {}, parse errors: {})",
        events.len(),
        session_id,
        line_count,
        parse_errors
    );
    Ok(events)
}

/// Finds the JSONL file for a given session ID
pub fn find_session_file(
    sessions_dir: &std::path::Path,
    session_id: &str,
) -> Option<std::path::PathBuf> {
    use std::io::{BufRead, BufReader};
    use walkdir::WalkDir;

    for entry in WalkDir::new(sessions_dir).into_iter().flatten() {
        if entry.path().extension().and_then(|s| s.to_str()) == Some("jsonl") {
            // Read the first line to check session_id
            if let Ok(file) = std::fs::File::open(entry.path()) {
                let reader = BufReader::new(file);
                if let Some(Ok(first_line)) = reader.lines().next() {
                    if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&first_line) {
                        // Check if this is a session_meta event with matching ID
                        if meta["type"].as_str() == Some("session_meta") {
                            if let Some(id) = meta["payload"]["id"].as_str() {
                                if id == session_id {
                                    log::info!(
                                        "Found session file: {:?} for session_id: {}",
                                        entry.path(),
                                        session_id
                                    );
                                    return Some(entry.path().to_path_buf());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    log::warn!("Session file not found for session_id: {}", session_id);
    None
}

/// Deletes a Codex session
/// On Windows with WSL mode, deletes from WSL filesystem via UNC path
#[tauri::command]
pub async fn delete_codex_session(session_id: String) -> Result<String, String> {
    log::info!("delete_codex_session called for: {}", session_id);

    // Use unified sessions directory function (supports WSL)
    let sessions_dir = get_codex_sessions_dir()?;

    // Find the session file
    let session_file = find_session_file(&sessions_dir, &session_id)
        .ok_or_else(|| format!("Session file not found for ID: {}", session_id))?;

    // Delete the file
    std::fs::remove_file(&session_file)
        .map_err(|e| format!("Failed to delete session file: {}", e))?;

    log::info!(
        "Successfully deleted Codex session file: {:?}",
        session_file
    );
    Ok(format!("Session {} deleted", session_id))
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Builds a Codex command with the given options
/// Returns (Command, Option<String>) where the String is the prompt to be passed via stdin
/// Supports both native execution and WSL mode on Windows
fn build_codex_command(
    options: &CodexExecutionOptions,
    is_resume: bool,
    session_id: Option<&str>,
) -> Result<(Command, Option<String>), String> {
    // Check if we should use WSL mode on Windows
    #[cfg(target_os = "windows")]
    {
        let wsl_config = wsl_utils::get_wsl_config();
        if wsl_config.enabled {
            log::info!("[Codex] Using WSL mode (distro: {:?})", wsl_config.distro);
            return build_wsl_codex_command(options, is_resume, session_id, &wsl_config);
        }
    }

    // Native mode: Use system-installed Codex
    let (_env_info, detected) = detect_binary_for_tool("codex", "CODEX_PATH", "codex");
    let codex_cmd = if let Some(inst) = detected {
        log::info!(
            "[Codex] Using detected binary: {} (source: {}, version: {:?})",
            inst.path,
            inst.source,
            inst.version
        );
        inst.path
    } else {
        log::warn!("[Codex] No detected binary, fallback to 'codex' in PATH");
        "codex".to_string()
    };

    let mut cmd = Command::new(&codex_cmd);
    cmd.arg("exec");

    // CRITICAL: --json MUST come before 'resume' (if used)
    // Correct order: codex exec --json resume <SESSION_ID> <PROMPT>
    // This enables JSON output for both new and resume sessions

    // Add --json flag first (works for both new and resume)
    if options.json {
        cmd.arg("--json");
    }

    if is_resume {
        // 通过 -c 配置覆盖在 'resume' 子命令前注入 sandbox_mode/model
        // 修复 #174: resume 之前不会传 mode/model，导致用户选择被忽略、强制只读
        if let Some(sandbox_mode) = codex_sandbox_mode_override(&options.mode) {
            cmd.arg("-c");
            cmd.arg(format!("sandbox_mode={}", sandbox_mode));
        }

        if let Some(ref model) = options.model {
            cmd.arg("-c");
            cmd.arg(format!(
                "model={}",
                model.strip_suffix("-fast").unwrap_or(model)
            ));
        }

        cmd.arg("resume");

        if let Some(sid) = session_id {
            cmd.arg(sid);
        }
    } else {
        // For new sessions: add other options
        // (--json already added above)

        match options.mode {
            CodexExecutionMode::Default => {
                // Codex 默认沙箱：交由 CLI 自身决定，不显式传 --sandbox
            }
            CodexExecutionMode::FullAuto => {
                cmd.arg("--full-auto");
            }
            CodexExecutionMode::DangerFullAccess => {
                cmd.arg("--sandbox");
                cmd.arg("danger-full-access");
            }
            CodexExecutionMode::ReadOnly => {
                cmd.arg("--sandbox");
                cmd.arg("read-only");
            }
        }

        if let Some(ref model) = options.model {
            cmd.arg("--model");
            cmd.arg(model.strip_suffix("-fast").unwrap_or(model));
        }

        if let Some(ref effort) = options.reasoning_effort {
            cmd.arg("--config");
            cmd.arg(format!("model_reasoning_effort=\"{}\"", effort));
        }

        if options.fast_mode.unwrap_or(false) {
            cmd.arg("--config");
            cmd.arg("service_tier=\"fast\"");
            cmd.arg("--config");
            cmd.arg("features.fast_mode=true");
        }

        if let Some(ref schema) = options.output_schema {
            cmd.arg("--output-schema");
            cmd.arg(schema);
        }

        if let Some(ref file) = options.output_file {
            cmd.arg("-o");
            cmd.arg(file);
        }

        if options.skip_git_repo_check {
            cmd.arg("--skip-git-repo-check");
        }
    }

    // Set working directory
    cmd.current_dir(&options.project_path);

    // Set API key environment variable if provided
    if let Some(ref api_key) = options.api_key {
        cmd.env("CODEX_API_KEY", api_key);
    }

    // FIX: Pass prompt via stdin instead of command line argument
    // This fixes issues with:
    // 1. Command line length limits (Windows: ~8191 chars)
    // 2. Special characters (newlines, quotes, etc.)
    // 3. Formatted text (markdown, code blocks)

    // Add "-" to indicate reading from stdin (common CLI convention)
    cmd.arg("-");

    let prompt_for_stdin = if is_resume {
        // For resume mode, prompt is still needed but passed via stdin
        Some(options.prompt.clone())
    } else {
        // For new sessions, pass prompt via stdin
        Some(options.prompt.clone())
    };

    Ok((cmd, prompt_for_stdin))
}

/// Builds a Codex command for WSL mode
/// This is used when Codex is installed in WSL and we're running on Windows
#[cfg(target_os = "windows")]
fn build_wsl_codex_command(
    options: &CodexExecutionOptions,
    is_resume: bool,
    session_id: Option<&str>,
    wsl_config: &wsl_utils::WslConfig,
) -> Result<(Command, Option<String>), String> {
    // Build arguments for codex command
    let mut args: Vec<String> = vec!["exec".to_string()];

    // Add --json flag first (must come before 'resume')
    if options.json {
        args.push("--json".to_string());
    }

    if is_resume {
        if let Some(sandbox_mode) = codex_sandbox_mode_override(&options.mode) {
            args.push("-c".to_string());
            args.push(format!("sandbox_mode={}", sandbox_mode));
        }
        if let Some(ref model) = options.model {
            args.push("-c".to_string());
            args.push(format!(
                "model={}",
                model.strip_suffix("-fast").unwrap_or(model)
            ));
        }
        args.push("resume".to_string());
        if let Some(sid) = session_id {
            args.push(sid.to_string());
        }
    } else {
        match options.mode {
            CodexExecutionMode::Default => {
                // Codex 默认沙箱
            }
            CodexExecutionMode::FullAuto => {
                args.push("--full-auto".to_string());
            }
            CodexExecutionMode::DangerFullAccess => {
                args.push("--sandbox".to_string());
                args.push("danger-full-access".to_string());
            }
            CodexExecutionMode::ReadOnly => {
                args.push("--sandbox".to_string());
                args.push("read-only".to_string());
            }
        }

        if let Some(ref model) = options.model {
            args.push("--model".to_string());
            args.push(model.strip_suffix("-fast").unwrap_or(model).to_string());
        }

        if let Some(ref effort) = options.reasoning_effort {
            args.push("--config".to_string());
            args.push(format!("model_reasoning_effort=\"{}\"", effort));
        }

        if options.fast_mode.unwrap_or(false) {
            args.push("--config".to_string());
            args.push("service_tier=\"fast\"".to_string());
            args.push("--config".to_string());
            args.push("features.fast_mode=true".to_string());
        }

        if let Some(ref schema) = options.output_schema {
            args.push("--output-schema".to_string());
            args.push(schema.clone());
        }

        if let Some(ref file) = options.output_file {
            args.push("-o".to_string());
            // Convert output file path to WSL format (supports UNC + wslpath)
            args.push(wsl_utils::windows_to_wsl_path_with_distro(
                file,
                wsl_config.distro.as_deref(),
            ));
        }

        if options.skip_git_repo_check {
            args.push("--skip-git-repo-check".to_string());
        }
    }

    // Add stdin indicator
    args.push("-".to_string());

    // Build WSL command with path conversion
    // project_path is Windows format (C:\...), will be converted to WSL format (/mnt/c/...)
    let codex_program = wsl_config.codex_path_in_wsl.as_deref().unwrap_or("codex");

    // 若 Codex 位于版本管理器目录（例如 /root/.nvm/.../bin/codex），则非交互 wsl -- 不会加载 NVM 环境，
    // 需要显式注入 PATH，确保脚本内部能找到 node。
    let (program_for_wsl, args_for_wsl) = if codex_program.starts_with('/') {
        if let Some(path_env) = wsl_utils::build_wsl_path_for_program(codex_program) {
            let mut wrapped: Vec<String> = Vec::with_capacity(args.len() + 2);
            wrapped.push(format!("PATH={}", path_env));
            wrapped.push(codex_program.to_string());
            wrapped.extend(args.clone());
            ("env", wrapped)
        } else {
            (codex_program, args)
        }
    } else {
        (codex_program, args)
    };

    let mut cmd = wsl_utils::build_wsl_command_async(
        program_for_wsl,
        &args_for_wsl,
        Some(&options.project_path),
        wsl_config.distro.as_deref(),
    );

    // Set API key environment variable if provided
    // Note: This will be passed to WSL environment
    if let Some(ref api_key) = options.api_key {
        cmd.env("CODEX_API_KEY", api_key);
    }

    log::info!(
        "[Codex WSL] Command built: wsl -d {:?} --cd {} -- {} {:?}",
        wsl_config.distro,
        wsl_utils::windows_to_wsl_path_with_distro(
            &options.project_path,
            wsl_config.distro.as_deref(),
        ),
        program_for_wsl,
        args_for_wsl
    );

    Ok((cmd, Some(options.prompt.clone())))
}

/// Executes a Codex process and streams output to frontend
async fn execute_codex_process(
    session_id: String,
    mut cmd: Command,
    prompt: Option<String>,
    _project_path: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    // 启动流程一开始就发送 session_init，确保即使启动失败也能让前端拿到 session_id 做隔离与错误反馈
    let init_payload = serde_json::json!({
        "type": "session_init",
        "session_id": session_id
    });
    if let Err(e) = app_handle.emit("codex-session-init", init_payload) {
        log::error!("Failed to emit codex-session-init: {}", e);
    }
    log::info!("Codex session initialized with ID: {}", session_id);

    // Setup stdio
    cmd.stdin(Stdio::piped()); // Enable stdin to pass prompt
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Fix: Apply platform-specific no-window configuration to hide console
    // This prevents the terminal window from flashing when starting Codex sessions
    apply_no_window_async(&mut cmd);

    // Spawn process
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            emit_codex_error(
                &app_handle,
                &session_id,
                "启动 Codex 失败",
                Some(&e.to_string()),
            );
            // 这里不返回错误给前端（避免覆盖错误事件的可诊断信息），统一走事件通道
            return Ok(());
        }
    };

    // Get process PID for proper cleanup (needed to kill child processes)
    let pid = match child.id() {
        Some(pid) => pid,
        None => {
            emit_codex_error(
                &app_handle,
                &session_id,
                "启动 Codex 失败：无法获取进程 PID",
                None,
            );
            let _ = child.kill().await;
            return Ok(());
        }
    };
    log::info!("[Codex] Spawned process with PID: {}", pid);

    // Windows robustness: assign the process to a Job Object so *all* descendants are cleaned up
    // even if Codex/MCP spawns detached node.exe processes.
    #[cfg(windows)]
    let job_object = match JobObject::create() {
        Ok(job) => match job.assign_process_by_pid(pid) {
            Ok(_) => {
                log::info!("[Codex] Assigned PID {} to Job Object for cleanup", pid);
                Some(job)
            }
            Err(e) => {
                log::warn!("[Codex] Failed to assign PID {} to Job Object: {}", pid, e);
                None
            }
        },
        Err(e) => {
            log::warn!("[Codex] Failed to create Job Object: {}", e);
            None
        }
    };

    #[cfg(not(windows))]
    let job_object: Option<JobObject> = None;

    // FIX: Write prompt to stdin if provided
    // This avoids command line length limits and special character issues
    if let Some(prompt_text) = prompt {
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;

            log::debug!("Writing prompt to stdin ({} bytes)", prompt_text.len());

            if let Err(e) = stdin.write_all(prompt_text.as_bytes()).await {
                log::error!("Failed to write prompt to stdin: {}", e);
                let _ = child.kill().await;
                emit_codex_error(
                    &app_handle,
                    &session_id,
                    "Codex 写入 stdin 失败",
                    Some(&e.to_string()),
                );
                return Ok(());
            }

            // Close stdin to signal end of input
            drop(stdin);
            log::debug!("Stdin closed successfully");
        } else {
            log::error!("Failed to get stdin handle");
            let _ = child.kill().await;
            emit_codex_error(
                &app_handle,
                &session_id,
                "Codex 启动失败：无法获取 stdin 句柄",
                None,
            );
            return Ok(());
        }
    }

    // Extract stdout and stderr
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            emit_codex_error(
                &app_handle,
                &session_id,
                "启动 Codex 失败：无法捕获 stdout",
                None,
            );
            let _ = child.kill().await;
            return Ok(());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            emit_codex_error(
                &app_handle,
                &session_id,
                "启动 Codex 失败：无法捕获 stderr",
                None,
            );
            let _ = child.kill().await;
            return Ok(());
        }
    };

    // Store process in state with PID for proper cleanup
    let state: tauri::State<'_, CodexProcessState> = app_handle.state();
    {
        let mut processes = state.processes.lock().await;
        let handle = CodexProcessHandle {
            child,
            pid,
            job_object,
        };
        processes.insert(session_id.clone(), handle);

        let mut last_session = state.last_session_id.lock().await;
        *last_session = Some(session_id.clone());
    }

    // Clone handles for async tasks
    let app_handle_stdout = app_handle.clone();
    let app_handle_complete = app_handle.clone();
    let session_id_stdout = session_id.clone(); // Clone for stdout task
    let session_id_stderr = session_id.clone(); // Clone for stderr task
    let session_id_complete = session_id.clone();

    // 用于判断是否收到了任何 stdout 事件；仅当 stdout 完全无输出且存在 stderr 时，才触发 codex-error
    let saw_stdout = Arc::new(AtomicBool::new(false));
    let saw_stdout_for_complete = saw_stdout.clone();
    let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buffer_for_stderr = stderr_buffer.clone();
    let stderr_buffer_for_complete = stderr_buffer.clone();

    // 🔧 FIX: Use channels to track stdout/stderr closure for timeout detection
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let (stderr_done_tx, _stderr_done_rx) = tokio::sync::oneshot::channel();

    // Spawn task to read stdout (JSONL events)
    // FIX: Emit to both session-specific and global channels for proper multi-tab isolation
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut done_tx = Some(done_tx);
        while let Ok(Some(line)) = reader.next_line().await {
            if !line.trim().is_empty() {
                saw_stdout.store(true, Ordering::Relaxed);
                // Use trace level to avoid flooding logs in debug mode
                log::trace!("Codex output: {}", line);
                // Emit to session-specific channel first (for multi-tab isolation)
                if let Err(e) =
                    app_handle_stdout.emit(&format!("codex-output:{}", session_id_stdout), &line)
                {
                    log::error!("Failed to emit codex-output (session-specific): {}", e);
                }
                // Also emit to global channel for backward compatibility
                if let Err(e) = app_handle_stdout.emit("codex-output", &line) {
                    log::error!("Failed to emit codex-output (global): {}", e);
                }

                // Detect turn completion to trigger backend cleanup even if stdout never closes.
                if done_tx.is_some() {
                    let is_done_event = serde_json::from_str::<serde_json::Value>(&line)
                        .ok()
                        .and_then(|v| {
                            v.get("type")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string())
                        })
                        .map(|t| matches!(t.as_str(), "turn.completed" | "turn.failed" | "error"))
                        .unwrap_or(false);

                    if is_done_event {
                        log::info!(
                            "[Codex] Detected completion event on stdout for session: {}",
                            session_id_stdout
                        );
                        if let Some(tx) = done_tx.take() {
                            let _ = tx.send(());
                        }
                    }
                }
            }
        }
        log::info!("[Codex] Stdout closed for session: {}", session_id_stdout);
        // Fallback: stdout closed, treat as completion if not already signaled.
        if let Some(tx) = done_tx.take() {
            let _ = tx.send(());
        }
    });

    // Spawn task to read stderr (log errors, suppress debug output)
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            // Log error messages for debugging
            if !line.trim().is_empty() {
                log::warn!("Codex stderr: {}", line);
                // 仅缓存少量 stderr 以便在“无 stdout 输出”的启动失败场景下进行汇总反馈
                let mut buf = stderr_buffer_for_stderr.lock().await;
                if buf.len() < 20 {
                    buf.push(line);
                }
            }
        }
        log::info!("[Codex] Stderr closed for session: {}", session_id_stderr);
        // Signal that stderr is done (ignore send error if receiver dropped)
        let _ = stderr_done_tx.send(());
    });

    // Spawn task to wait for process completion
    // 🔧 FIX: Only wait for stdout to close, then send completion event immediately
    // stderr may continue outputting logs (MCP servers, etc.) for a long time
    let pid_for_cleanup = pid; // Copy PID for cleanup task
    tokio::spawn(async move {
        use crate::commands::claude::kill_process_tree;

        let state: tauri::State<'_, CodexProcessState> = app_handle_complete.state();

        // Only wait for stdout to close (stderr can continue logging)
        let _ = done_rx.await;
        log::info!(
            "[Codex] Completion signaled for session: {}",
            session_id_complete
        );

        // 若 stdout 完全无输出但 stderr 有内容，补发一次可诊断错误事件，避免前端表现为“无反应”
        if !saw_stdout_for_complete.load(Ordering::Relaxed) {
            let buf = stderr_buffer_for_complete.lock().await;
            if !buf.is_empty() {
                let detail = buf.join("\n");
                emit_codex_error(
                    &app_handle_complete,
                    &session_id_complete,
                    "Codex 启动失败或未产生任何输出",
                    Some(&detail),
                );
            }
        }

        // 🔧 CRITICAL FIX: Emit completion event immediately after stdout closes
        // Don't wait for process exit or stderr - those can take a long time
        // stdout closing means all JSONL events have been sent, session is effectively complete
        log::info!(
            "[Codex] Sending completion event for session: {}",
            session_id_complete
        );
        if let Err(e) =
            app_handle_complete.emit(&format!("codex-complete:{}", session_id_complete), true)
        {
            log::error!("Failed to emit codex-complete (session-specific): {}", e);
        }
        if let Err(e) = app_handle_complete.emit("codex-complete", true) {
            log::error!("Failed to emit codex-complete (global): {}", e);
        }

        // Continue waiting for process exit in background (with timeout protection)
        // This ensures proper cleanup but doesn't block the completion event
        // After turn completion, Codex should exit promptly; keep a short grace window to
        // let it flush session files, then force-kill to prevent orphan node.exe accumulation.
        let timeout_duration = tokio::time::Duration::from_secs(3);
        let start_time = tokio::time::Instant::now();

        loop {
            let mut processes = state.processes.lock().await;

            if let Some(handle) = processes.get_mut(&session_id_complete) {
                match handle.child.try_wait() {
                    Ok(Some(status)) => {
                        log::info!("[Codex] Process exited with status: {}", status);
                        processes.remove(&session_id_complete);
                        break;
                    }
                    Ok(None) => {
                        // Check timeout
                        if start_time.elapsed() > timeout_duration {
                            log::warn!(
                                "[Codex] Process {} (PID: {}) did not exit within {}s after completion, force killing process tree",
                                session_id_complete,
                                pid_for_cleanup,
                                timeout_duration.as_secs()
                            );

                            // 🔧 FIX: Kill entire process tree to prevent orphan child processes
                            // Prefer Job Object termination (Windows) to ensure detached descendants are killed.
                            let mut terminated_via_job = false;
                            if let Some(job) = handle.job_object.as_ref() {
                                match job.terminate_all(1) {
                                    Ok(_) => {
                                        terminated_via_job = true;
                                        log::info!(
                                            "[Codex] Terminated Job Object for PID: {}",
                                            pid_for_cleanup
                                        );
                                    }
                                    Err(e) => {
                                        log::warn!(
                                            "[Codex] Failed to terminate Job Object for PID {}: {}",
                                            pid_for_cleanup,
                                            e
                                        );
                                    }
                                }
                            }

                            if !terminated_via_job {
                                if let Err(e) = kill_process_tree(pid_for_cleanup) {
                                    log::error!("[Codex] Failed to kill process tree: {}", e);
                                    // Fallback: try to kill main process directly
                                    if let Err(e2) = handle.child.kill().await {
                                        log::error!("[Codex] Fallback kill also failed: {}", e2);
                                    }
                                } else {
                                    log::info!(
                                        "[Codex] Successfully killed process tree for PID: {}",
                                        pid_for_cleanup
                                    );
                                }
                            }
                            processes.remove(&session_id_complete);
                            break;
                        }

                        drop(processes);
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    }
                    Err(e) => {
                        log::error!("[Codex] Error checking process status: {}", e);
                        processes.remove(&session_id_complete);
                        break;
                    }
                }
            } else {
                log::info!(
                    "[Codex] Process {} was removed (cancelled)",
                    session_id_complete
                );
                break;
            }
        }
    });

    Ok(())
}

fn emit_codex_error(app_handle: &AppHandle, session_id: &str, message: &str, detail: Option<&str>) {
    let payload = serde_json::json!({
        "session_id": session_id,
        "error": {
            "message": message,
            "detail": detail,
        }
    });

    let payload_str = serde_json::to_string(&payload).unwrap_or_else(|_| message.to_string());

    let _ = app_handle.emit(&format!("codex-error:{}", session_id), &payload_str);
    let _ = app_handle.emit("codex-error", &payload_str);
}
