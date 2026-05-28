use anyhow::{Context, Result};
use chrono::Utc;
use log;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use super::claude::get_claude_dir;
use super::permission_config::ClaudeExecutionConfig;
use super::simple_git;

/// Rewind mode for reverting prompts
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RewindMode {
    /// Revert conversation only (delete messages, keep code)
    ConversationOnly,
    /// Revert code only (rollback code, keep messages)
    CodeOnly,
    /// Revert both conversation and code (full revert)
    Both,
}

/// Capabilities for rewinding a specific prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindCapabilities {
    /// Can revert conversation (always true)
    pub conversation: bool,
    /// Can revert code (true if has git_commit_before)
    pub code: bool,
    /// Can revert both (true if has git_commit_before)
    pub both: bool,
    /// Warning message if code revert is not available
    pub warning: Option<String>,
    /// Prompt source indicator
    pub source: String, // "project" or "cli"
}

/// A record of a user prompt (legacy structure, kept for compatibility)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRecord {
    /// Index of this prompt (0, 1, 2...)
    pub index: usize,
    /// The prompt text user entered
    pub text: String,
    /// Git commit before sending this prompt
    pub git_commit_before: String,
    /// Git commit after AI completed (optional)
    pub git_commit_after: Option<String>,
    /// Timestamp when prompt was sent
    pub timestamp: i64,
    /// Prompt source: "project" (sent from project interface with queue-operation) or "cli" (sent from CLI)
    pub source: String,
    /// Line number in the JSONL file (0-based)
    pub line_number: usize,
}

/// Git record for a prompt (stored by content hash)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRecord {
    /// Git commit before sending this prompt
    pub commit_before: String,
    /// Git commit after AI completed (optional)
    pub commit_after: Option<String>,
    /// Timestamp when prompt was sent
    pub timestamp: i64,
}

/// Load execution config from file
pub fn load_execution_config() -> Result<ClaudeExecutionConfig> {
    let claude_dir = get_claude_dir().context("Failed to get claude dir")?;
    let config_file = claude_dir.join("execution_config.json");

    if config_file.exists() {
        let content =
            fs::read_to_string(&config_file).context("Failed to read execution config file")?;
        let config = serde_json::from_str::<ClaudeExecutionConfig>(&content)
            .context("Failed to parse execution config")?;
        Ok(config)
    } else {
        // Return default config if file doesn't exist
        Ok(ClaudeExecutionConfig::default())
    }
}

/// Get path to git records file
fn get_git_records_path(session_id: &str, project_id: &str) -> Result<PathBuf> {
    let claude_dir = get_claude_dir().context("Failed to get claude dir")?;
    let records_path = claude_dir
        .join("projects")
        .join(project_id)
        .join("sessions")
        .join(format!("{}.git-records.json", session_id));
    Ok(records_path)
}
/// Load git records from .git-records.json (using prompt_index as key)
fn load_git_records(session_id: &str, project_id: &str) -> Result<HashMap<usize, GitRecord>> {
    let records_path = get_git_records_path(session_id, project_id)?;

    if !records_path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&records_path).context("Failed to read git records file")?;

    // Support both old format (String keys) and new format (usize keys)
    // Try parsing as new format first
    if let Ok(records) = serde_json::from_str::<HashMap<usize, GitRecord>>(&content) {
        return Ok(records);
    }

    // Fallback: try parsing old format and migrate
    if let Ok(_old_records) = serde_json::from_str::<HashMap<String, GitRecord>>(&content) {
        log::warn!("Found old hash-based git records format, will migrate to index-based format on next save");
        // Return empty map - old records cannot be reliably migrated without prompt index info
        return Ok(HashMap::new());
    }

    Ok(HashMap::new())
}

/// Save git records to .git-records.json (using prompt_index as key)
fn save_git_records(
    session_id: &str,
    project_id: &str,
    records: &HashMap<usize, GitRecord>,
) -> Result<()> {
    let records_path = get_git_records_path(session_id, project_id)?;

    // Ensure directory exists
    if let Some(parent) = records_path.parent() {
        fs::create_dir_all(parent).context("Failed to create sessions directory")?;
    }

    let content =
        serde_json::to_string_pretty(&records).context("Failed to serialize git records")?;

    fs::write(&records_path, content).context("Failed to write git records file")?;

    Ok(())
}

/// Save a single git record (using prompt_index as key)
fn save_git_record(
    session_id: &str,
    project_id: &str,
    prompt_index: usize,
    record: GitRecord,
) -> Result<()> {
    let mut records = load_git_records(session_id, project_id)?;
    records.insert(prompt_index, record);
    save_git_records(session_id, project_id, &records)?;
    log::info!("[Git Record] Saved git record for prompt #{}", prompt_index);
    Ok(())
}

/// Get a git record by prompt_index
fn get_git_record(
    session_id: &str,
    project_id: &str,
    prompt_index: usize,
) -> Result<Option<GitRecord>> {
    let records = load_git_records(session_id, project_id)?;
    Ok(records.get(&prompt_index).cloned())
}

fn build_prompt_commit_message(
    prefix: &str,
    prompt_text: Option<&str>,
    prompt_index: usize,
) -> String {
    let prompt_text = prompt_text.unwrap_or("");
    let sanitized = prompt_text.replace('\n', " ").replace('\r', " ");
    let sanitized = sanitized.trim();
    let truncated: String = sanitized.chars().take(80).collect();

    if truncated.is_empty() {
        return format!("{prefix} After prompt #{prompt_index}");
    }

    format!("{prefix} {truncated} prompt #{prompt_index}")
}

/// Truncate git records (remove records for prompts after the specified index)
fn truncate_git_records(
    session_id: &str,
    project_id: &str,
    prompts: &[PromptRecord],
    prompt_index: usize,
) -> Result<()> {
    let mut records = load_git_records(session_id, project_id)?;

    // Remove git records for all prompts after prompt_index
    // Now using index-based keys, so simply remove all indices > prompt_index
    for i in (prompt_index + 1)..prompts.len() {
        records.remove(&i);
        log::debug!("[Truncate] Removed git record for prompt #{}", i);
    }

    save_git_records(session_id, project_id, &records)?;
    log::info!(
        "[Truncate] Truncated git records after prompt #{}",
        prompt_index
    );
    Ok(())
}

/// Truncate session JSONL file to before a specific prompt
/// 🆕 Now supports multiple files (main session + agent files)
fn truncate_session_to_prompt(
    session_id: &str,
    project_id: &str,
    prompt_index: usize,
) -> Result<()> {
    let claude_dir = get_claude_dir().context("Failed to get claude dir")?;
    let project_dir = claude_dir.join("projects").join(project_id);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));

    if !session_path.exists() {
        return Ok(()); // No session file, nothing to truncate
    }

    // ========================================================================
    // Step 1: Process main session file
    // ========================================================================

    // Read all lines
    let content = fs::read_to_string(&session_path).context("Failed to read session file")?;

    let lines: Vec<&str> = content.lines().collect();

    // Count user messages and find the line index to truncate at
    let mut user_message_count = 0;
    let mut truncate_at_line = 0;
    let mut found_target = false; // Flag to track if we found the target prompt

    for (line_index, line) in lines.iter().enumerate() {
        // Parse line as JSON to check message type
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(line) {
            // 🆕 跳过非用户消息类型（新版 Claude 引入的消息类型）
            let msg_type = msg.get("type").and_then(|t| t.as_str());

            log::debug!("Line {}: type={:?}", line_index, msg_type);

            // 忽略 summary 和 file-history-snapshot 类型
            if msg_type == Some("summary") || msg_type == Some("file-history-snapshot") {
                log::debug!(
                    "Skipping {} message at line {}",
                    msg_type.unwrap(),
                    line_index
                );
                continue;
            }

            // 只处理用户消息
            if msg_type == Some("user") {
                // 检查是否是侧链消息（agent 消息）
                let is_sidechain = msg
                    .get("isSidechain")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                if is_sidechain {
                    log::debug!("Skipping sidechain user message at line {}", line_index);
                    continue;
                }

                // 检查是否有 parent_tool_use_id（子代理的消息）
                let has_parent_tool_use_id = msg.get("parent_tool_use_id").is_some()
                    && !msg.get("parent_tool_use_id").unwrap().is_null();

                if has_parent_tool_use_id {
                    log::debug!(
                        "Skipping subagent message at line {} (has parent_tool_use_id)",
                        line_index
                    );
                    continue;
                }

                // 提取消息内容（支持字符串和数组两种格式）
                let content_value = msg.get("message").and_then(|m| m.get("content"));

                log::debug!(
                    "Line {}: content_value exists={}",
                    line_index,
                    content_value.is_some()
                );

                let mut extracted_text = String::new();
                let mut has_text_content = false;
                let mut has_tool_result = false;

                if let Some(content) = content_value {
                    if let Some(text) = content.as_str() {
                        // 字符串格式
                        extracted_text = text.to_string();
                        has_text_content = !text.trim().is_empty();
                        log::debug!(
                            "Line {}: extracted string content, length={}, has_text={}",
                            line_index,
                            extracted_text.len(),
                            has_text_content
                        );
                    } else if let Some(arr) = content.as_array() {
                        // 数组格式（可能包含 text 和 tool_result）
                        for item in arr {
                            if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                                if item_type == "text" {
                                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                        extracted_text.push_str(text);
                                        has_text_content = true;
                                    }
                                } else if item_type == "tool_result" {
                                    has_tool_result = true;
                                }
                            }
                        }
                    }
                }

                // 如果只有 tool_result 没有 text，跳过（这些是工具执行结果，不是用户输入）
                if has_tool_result && !has_text_content {
                    log::debug!("Skipping tool-result-only message at line {}", line_index);
                    continue;
                }

                // 必须有文本内容
                if !has_text_content {
                    log::debug!("Skipping empty user message at line {}", line_index);
                    continue;
                }

                // ⚡ 检查是否是自动发送的 Warmup 消息或 Skills 消息
                let is_warmup = extracted_text.contains("Warmup");
                let is_skill_message = extracted_text.contains("<command-name>")
                    || extracted_text.contains("Launching skill:")
                    || extracted_text.contains("skill is running");

                log::debug!(
                    "Line {}: is_warmup={}, is_skill={}, text_preview={}",
                    line_index,
                    is_warmup,
                    is_skill_message,
                    extracted_text.chars().take(20).collect::<String>()
                );

                if !is_warmup && !is_skill_message {
                    // 只计算真实用户输入的消息（排除自动 Warmup）
                    log::info!(
                        "[OK] Found real user message at line {}, count={}, looking for={}",
                        line_index,
                        user_message_count,
                        prompt_index
                    );

                    if user_message_count == prompt_index {
                        // Found the target prompt, truncate before it
                        truncate_at_line = line_index;
                        found_target = true; // Mark that we found it
                        log::info!(
                            "[TARGET] Target prompt #{} found at line {}",
                            prompt_index,
                            line_index
                        );
                        break;
                    }
                    user_message_count += 1;
                } else if is_warmup {
                    log::debug!(
                        "Skipping Warmup message at line {}: {}",
                        line_index,
                        extracted_text.chars().take(50).collect::<String>()
                    );
                } else if is_skill_message {
                    log::debug!(
                        "Skipping Skills message at line {}: {}",
                        line_index,
                        extracted_text.chars().take(50).collect::<String>()
                    );
                }
            }
        }
    }

    let total_lines = lines.len();

    // 安全检查：如果没找到目标 prompt，返回错误而不是清空所有内容
    if !found_target {
        if user_message_count == 0 {
            return Err(anyhow::anyhow!(
                "Prompt #{} not found in session (no user messages found)",
                prompt_index
            ));
        } else {
            return Err(anyhow::anyhow!(
                "Prompt #{} not found in session (only {} user messages found)",
                prompt_index,
                user_message_count
            ));
        }
    }

    log::info!(
        "Total lines: {}, will keep lines 0..{} (delete prompt #{} at line {} and after)",
        total_lines,
        truncate_at_line,
        prompt_index,
        truncate_at_line
    );

    // Truncate to the line before this prompt
    let truncated_lines: Vec<&str> = lines.into_iter().take(truncate_at_line).collect();

    // Join with newline and add final newline if we have content
    let new_content = if truncated_lines.is_empty() {
        String::new()
    } else {
        truncated_lines.join("\n") + "\n" // Add trailing newline
    };

    fs::write(&session_path, new_content).context("Failed to write truncated session")?;

    log::info!(
        "Truncated main session: kept {} lines, deleted {} lines",
        truncate_at_line,
        total_lines - truncate_at_line
    );

    // ========================================================================
    // Step 2: Handle agent files (新版 Claude 引入的 sidechain 文件)
    // ========================================================================

    // Agent 文件处理策略：
    // - Agent 文件通常只包含会话初始化的 Warmup 消息（通常只有2行）
    // - 如果撤回到 prompt #0（首个用户输入之前），则删除所有 agent 文件
    // - 如果撤回到 prompt #N (N>0)，保持 agent 文件不变（因为它们只在初始化时创建一次）

    if prompt_index == 0 {
        // 撤回到初始状态，只删除属于当前会话的 agent 文件
        log::info!(
            "Reverting to prompt #0, removing agent files for session: {}",
            session_id
        );

        if let Ok(entries) = fs::read_dir(&project_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    // Match pattern: agent-{id}.jsonl
                    if filename.starts_with("agent-") && filename.ends_with(".jsonl") {
                        // 🔧 FIX: 读取文件第一行，检查 sessionId 是否匹配当前会话
                        let belongs_to_session = if let Ok(file) = fs::File::open(&path) {
                            use std::io::{BufRead, BufReader};
                            let reader = BufReader::new(file);
                            if let Some(Ok(first_line)) = reader.lines().next() {
                                if let Ok(json) =
                                    serde_json::from_str::<serde_json::Value>(&first_line)
                                {
                                    json.get("sessionId")
                                        .and_then(|s| s.as_str())
                                        .map(|s| s == session_id)
                                        .unwrap_or(false)
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        if belongs_to_session {
                            log::info!("Removing agent file for current session: {}", filename);

                            if let Err(e) = fs::remove_file(&path) {
                                log::warn!("Failed to remove agent file {}: {}", filename, e);
                            } else {
                                log::info!("Successfully removed agent file: {}", filename);
                            }
                        } else {
                            log::debug!(
                                "Skipping agent file (belongs to different session): {}",
                                filename
                            );
                        }
                    }
                }
            }
        }
    } else {
        // 撤回到后续提示词，agent 文件保持不变
        log::info!("Reverting to prompt #{}, keeping agent files unchanged (they only contain initialization data)", prompt_index);
    }

    Ok(())
}

/// Record a prompt being sent
#[tauri::command]
pub async fn record_prompt_sent(
    session_id: String,
    project_id: String,
    project_path: String,
    _prompt_text: String,
) -> Result<usize, String> {
    log::info!(
        "[Record Prompt] Recording prompt sent for session: {}",
        session_id
    );

    // Check if Git operations are disabled in config
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    if execution_config.disable_rewind_git_operations {
        log::info!("[Record Prompt] Git operations disabled, skipping git record");
        // Still need to return a prompt_index for tracking purposes
        let prompts = extract_prompts_from_jsonl(&session_id, &project_id)
            .map_err(|e| format!("Failed to extract prompts from JSONL: {}", e))?;
        let prompt_index = prompts.len();
        log::info!(
            "[Record Prompt] Returning prompt index #{} (no git record)",
            prompt_index
        );
        return Ok(prompt_index);
    }

    // Ensure Git repository is initialized
    simple_git::ensure_git_repo(&project_path)
        .map_err(|e| format!("Failed to ensure Git repo: {}", e))?;

    // IMPORTANT: Always get the LATEST commit
    // This ensures we start from the correct state even if previous prompt made no changes
    let commit_before = simple_git::git_current_commit(&project_path)
        .map_err(|e| format!("Failed to get current commit: {}", e))?;

    log::info!("[Record Prompt] Current git commit: {}", commit_before);

    // 🔧 FIX: Get prompt_index FIRST (from current JSONL state)
    // The new prompt hasn't been written to JSONL yet, so prompts.len() will be the index of the new prompt
    let prompts = extract_prompts_from_jsonl(&session_id, &project_id)
        .map_err(|e| format!("Failed to extract prompts from JSONL: {}", e))?;

    let prompt_index = prompts.len(); // This will be the index of the new prompt

    log::info!(
        "[Record Prompt] New prompt will be assigned index #{}",
        prompt_index
    );

    // Create git record
    let git_record = GitRecord {
        commit_before: commit_before.clone(),
        commit_after: None,
        timestamp: Utc::now().timestamp(),
    };

    // 🔧 FIX: Save git record using prompt_index as key (not hash!)
    // This is reliable and not affected by translation/encoding/escaping
    save_git_record(&session_id, &project_id, prompt_index, git_record)
        .map_err(|e| format!("Failed to save git record: {}", e))?;

    log::info!(
        "[Record Prompt] ✅ Saved git record for prompt #{} with commit_before: {}",
        prompt_index,
        commit_before
    );

    Ok(prompt_index)
}

/// Mark a prompt as completed (after AI finishes)
#[tauri::command]
pub async fn mark_prompt_completed(
    session_id: String,
    project_id: String,
    project_path: String,
    prompt_index: usize,
    prompt_text: Option<String>,
) -> Result<(), String> {
    log::info!("Marking prompt #{} completed", prompt_index);

    // Check if Git operations are disabled in config
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    if execution_config.disable_rewind_git_operations {
        log::info!(
            "[Mark Complete] Git operations disabled, skipping git commit and record update"
        );
        return Ok(());
    }

    // Auto-commit any changes made by AI
    // This ensures each prompt has a distinct git state
    if execution_config.disable_auto_commit_after_response {
        log::info!(
            "[Mark Complete] Auto-commit disabled by user setting, skipping git commit (#181/#175)"
        );
    } else {
        let commit_message =
            build_prompt_commit_message("[Claude Code]", prompt_text.as_deref(), prompt_index);
        match simple_git::git_commit_changes(&project_path, &commit_message) {
            Ok(true) => {
                log::info!("Auto-committed changes after prompt #{}", prompt_index);
            }
            Ok(false) => {
                log::debug!("No changes to commit after prompt #{}", prompt_index);
            }
            Err(e) => {
                log::warn!(
                    "Failed to auto-commit after prompt #{}: {}",
                    prompt_index,
                    e
                );
                // Continue anyway, don't fail the whole operation
            }
        }
    }

    // Get current commit (state after AI completion and auto-commit)
    let commit_after = simple_git::git_current_commit(&project_path)
        .map_err(|e| format!("Failed to get current commit: {}", e))?;

    // 🔧 FIX: Load existing git record using prompt_index (not hash!)
    let mut git_record = get_git_record(&session_id, &project_id, prompt_index)
        .map_err(|e| format!("Failed to get git record: {}", e))?
        .ok_or_else(|| format!("Git record not found for prompt #{}", prompt_index))?;

    // Update commit_after
    git_record.commit_after = Some(commit_after.clone());

    // 🔧 FIX: Save updated git record using prompt_index (not hash!)
    save_git_record(&session_id, &project_id, prompt_index, git_record)
        .map_err(|e| format!("Failed to save git record: {}", e))?;

    log::info!(
        "[Mark Complete] ✅ Marked prompt #{} as completed with git_commit_after: {}",
        prompt_index,
        commit_after
    );
    Ok(())
}

/// Revert to a specific prompt with support for different rewind modes
#[tauri::command]
pub async fn revert_to_prompt(
    session_id: String,
    project_id: String,
    project_path: String,
    prompt_index: usize,
    mode: RewindMode,
) -> Result<String, String> {
    log::info!(
        "Reverting to prompt #{} in session: {} with mode: {:?}",
        prompt_index,
        session_id,
        mode
    );

    // Load execution config to check if Git operations are disabled
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    let git_operations_disabled = execution_config.disable_rewind_git_operations;

    if git_operations_disabled {
        log::warn!("Git operations are disabled in rewind config");
    }

    // Get prompts from JSONL (single source of truth)
    let prompts = extract_prompts_from_jsonl(&session_id, &project_id)
        .map_err(|e| format!("Failed to extract prompts: {}", e))?;

    let prompt = prompts
        .get(prompt_index)
        .ok_or_else(|| format!("Prompt #{} not found", prompt_index))?;

    // 🔧 FIX: Get git record using prompt_index (not hash!)
    let git_record = get_git_record(&session_id, &project_id, prompt_index)
        .map_err(|e| format!("Failed to get git record: {}", e))?;

    // Validate mode compatibility
    match mode {
        RewindMode::CodeOnly | RewindMode::Both => {
            if git_operations_disabled {
                return Err(format!(
                    "无法回滚代码：Git 操作已在配置中禁用。只能撤回对话历史，无法回滚代码变更。"
                ));
            }
            if git_record.is_none() {
                return Err(format!(
                    "无法回滚代码：提示词 #{} 没有关联的 Git 记录（可能来自 CLI 终端）",
                    prompt_index
                ));
            }
        }
        _ => {}
    }

    // Execute revert based on mode
    match mode {
        RewindMode::ConversationOnly => {
            log::info!("Reverting conversation only (deleting messages)");

            // Truncate session messages in JSONL
            truncate_session_to_prompt(&session_id, &project_id, prompt_index)
                .map_err(|e| format!("Failed to truncate session: {}", e))?;

            // Truncate git records (remove records for prompts after this index)
            // Skip if Git operations are disabled
            if !git_operations_disabled {
                truncate_git_records(&session_id, &project_id, &prompts, prompt_index)
                    .map_err(|e| format!("Failed to truncate git records: {}", e))?;
            } else {
                log::info!("Skipping git records truncation (Git operations disabled)");
            }

            log::info!(
                "Successfully reverted conversation to prompt #{}",
                prompt_index
            );
        }

        RewindMode::CodeOnly => {
            log::info!("Reverting code only (keeping messages) - revert to state before prompt #{}", prompt_index);

            // 1. Stash any uncommitted changes
            simple_git::git_stash_save(
                &project_path,
                &format!("Auto-stash before code revert to prompt #{}", prompt_index),
            )
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

            // 2. Record original HEAD for atomic rollback on failure
            let original_head = simple_git::git_current_commit(&project_path)
                .map_err(|e| format!("Failed to get current commit: {}", e))?;

            log::info!(
                "[Precise Revert] Original HEAD: {} (will rollback here on failure)",
                &original_head[..8.min(original_head.len())]
            );

            // 3. Load ALL git records for this session
            let all_git_records = load_git_records(&session_id, &project_id)
                .map_err(|e| format!("Failed to load git records: {}", e))?;

            // 4. Filter records for prompt_index and onwards, then sort by index descending
            let mut records_to_revert: Vec<(usize, GitRecord)> = all_git_records
                .into_iter()
                .filter(|(idx, _)| *idx >= prompt_index)
                .collect();

            // Sort by index descending (newest first) - revert from newest to oldest
            records_to_revert.sort_by(|a, b| b.0.cmp(&a.0));

            log::info!(
                "[Precise Revert] Found {} records to revert (prompts {} and onwards)",
                records_to_revert.len(),
                prompt_index
            );

            // 5. Revert each record's commit_before..commit_after in reverse order
            let mut total_reverted = 0;
            let mut revert_failed = false;
            let mut failure_message = String::new();

            for (idx, record) in &records_to_revert {
                // Skip if no commit_after (AI didn't make any changes)
                let commit_after = match &record.commit_after {
                    Some(c) if c != &record.commit_before => c.clone(),
                    _ => {
                        log::debug!("[Precise Revert] Skipping prompt #{} - no code changes", idx);
                        continue;
                    }
                };

                let has_changes = match simple_git::git_has_changes_between_commits(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                ) {
                    Ok(value) => value,
                    Err(e) => {
                        log::warn!(
                            "[Precise Revert] Failed to check changes for prompt #{}: {}",
                            idx,
                            e
                        );
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                };

                if !has_changes {
                    log::debug!("[Precise Revert] Skipping prompt #{} - empty commit", idx);
                    continue;
                }

                log::info!(
                    "[Precise Revert] Reverting prompt #{}: {}..{}",
                    idx,
                    &record.commit_before[..8.min(record.commit_before.len())],
                    &commit_after[..8.min(commit_after.len())]
                );

                let revert_result = simple_git::git_revert_range_with_retry(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                    &format!("[Revert] 撤回提示词 #{} 的代码更改", idx),
                    3, // Max 3 retries for Git lock conflicts
                );

                match revert_result {
                    Ok(result) if result.success => {
                        total_reverted += result.commits_reverted;
                        log::info!(
                            "[Precise Revert] Successfully reverted prompt #{} ({} commits)",
                            idx,
                            result.commits_reverted
                        );
                    }
                    Ok(result) => {
                        log::warn!(
                            "[Precise Revert] Revert conflict for prompt #{}: {}",
                            idx,
                            result.message
                        );
                        revert_failed = true;
                        failure_message = result.message;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Precise Revert] Revert failed for prompt #{}: {}", idx, e);
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                }
            }

            // 6. If revert failed, rollback to original HEAD (atomic operation)
            if revert_failed {
                log::warn!(
                    "[Precise Revert] Rolling back to original HEAD {} due to failure",
                    &original_head[..8.min(original_head.len())]
                );
                simple_git::git_reset_hard(&project_path, &original_head)
                    .map_err(|e| format!("Failed to rollback: {}", e))?;

                return Err(format!(
                    "撤回失败，已回滚到操作前状态。原因: {}",
                    failure_message
                ));
            }

            log::info!(
                "Successfully reverted code to state before prompt #{} (reverted {} commits from {} prompts)",
                prompt_index,
                total_reverted,
                records_to_revert.len()
            );
        }

        RewindMode::Both => {
            log::info!("Reverting both conversation and code - revert to state before prompt #{}", prompt_index);

            // 1. Stash any uncommitted changes
            simple_git::git_stash_save(
                &project_path,
                &format!("Auto-stash before full revert to prompt #{}", prompt_index),
            )
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

            // 2. Record original HEAD for atomic rollback on failure
            let original_head = simple_git::git_current_commit(&project_path)
                .map_err(|e| format!("Failed to get current commit: {}", e))?;

            log::info!(
                "[Precise Revert] Original HEAD: {} (will rollback here on failure)",
                &original_head[..8.min(original_head.len())]
            );

            // 3. Load ALL git records for this session
            let all_git_records = load_git_records(&session_id, &project_id)
                .map_err(|e| format!("Failed to load git records: {}", e))?;

            // 4. Filter records for prompt_index and onwards, then sort by index descending
            let mut records_to_revert: Vec<(usize, GitRecord)> = all_git_records
                .into_iter()
                .filter(|(idx, _)| *idx >= prompt_index)
                .collect();

            // Sort by index descending (newest first) - revert from newest to oldest
            records_to_revert.sort_by(|a, b| b.0.cmp(&a.0));

            log::info!(
                "[Precise Revert] Found {} records to revert (prompts {} and onwards)",
                records_to_revert.len(),
                prompt_index
            );

            // 5. Revert each record's commit_before..commit_after in reverse order
            let mut total_reverted = 0;
            let mut revert_failed = false;
            let mut failure_message = String::new();

            for (idx, record) in &records_to_revert {
                // Skip if no commit_after (AI didn't make any changes)
                let commit_after = match &record.commit_after {
                    Some(c) if c != &record.commit_before => c.clone(),
                    _ => {
                        log::debug!("[Precise Revert] Skipping prompt #{} - no code changes", idx);
                        continue;
                    }
                };

                let has_changes = match simple_git::git_has_changes_between_commits(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                ) {
                    Ok(value) => value,
                    Err(e) => {
                        log::warn!(
                            "[Precise Revert] Failed to check changes for prompt #{}: {}",
                            idx,
                            e
                        );
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                };

                if !has_changes {
                    log::debug!("[Precise Revert] Skipping prompt #{} - empty commit", idx);
                    continue;
                }

                log::info!(
                    "[Precise Revert] Reverting prompt #{}: {}..{}",
                    idx,
                    &record.commit_before[..8.min(record.commit_before.len())],
                    &commit_after[..8.min(commit_after.len())]
                );

                let revert_result = simple_git::git_revert_range_with_retry(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                    &format!("[Revert] 撤回提示词 #{} 的代码更改", idx),
                    3, // Max 3 retries for Git lock conflicts
                );

                match revert_result {
                    Ok(result) if result.success => {
                        total_reverted += result.commits_reverted;
                        log::info!(
                            "[Precise Revert] Successfully reverted prompt #{} ({} commits)",
                            idx,
                            result.commits_reverted
                        );
                    }
                    Ok(result) => {
                        log::warn!(
                            "[Precise Revert] Revert conflict for prompt #{}: {}",
                            idx,
                            result.message
                        );
                        revert_failed = true;
                        failure_message = result.message;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Precise Revert] Revert failed for prompt #{}: {}", idx, e);
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                }
            }

            // 6. If revert failed, rollback to original HEAD (atomic operation)
            if revert_failed {
                log::warn!(
                    "[Precise Revert] Rolling back to original HEAD {} due to failure",
                    &original_head[..8.min(original_head.len())]
                );
                simple_git::git_reset_hard(&project_path, &original_head)
                    .map_err(|e| format!("Failed to rollback: {}", e))?;

                return Err(format!(
                    "撤回失败，已回滚到操作前状态。原因: {}",
                    failure_message
                ));
            }

            log::info!(
                "Successfully reverted code to state before prompt #{} (reverted {} commits from {} prompts)",
                prompt_index,
                total_reverted,
                records_to_revert.len()
            );

            // 7. Truncate session messages (delete prompt #N and all after)
            // 🔧 ATOMIC PROTECTION: If session truncation fails, rollback Git changes
            if let Err(e) = truncate_session_to_prompt(&session_id, &project_id, prompt_index) {
                log::error!(
                    "[Atomic Rollback] Session truncation failed, rolling back Git to original state: {}",
                    e
                );

                // Attempt to rollback Git changes
                if let Err(rollback_err) = simple_git::git_reset_hard(&project_path, &original_head) {
                    log::error!("[CRITICAL] Git rollback failed: {}", rollback_err);
                    return Err(format!(
                        "会话文件截断失败，且 Git 回滚也失败，仓库可能处于不一致状态。\n\
                         会话截断错误: {}\n\
                         Git 回滚错误: {}\n\
                         请手动检查仓库状态并运行 'git status'。",
                        e, rollback_err
                    ));
                }

                return Err(format!(
                    "会话文件截断失败，已原子性回滚所有 Git 更改到操作前状态。\n\
                     原因: {}",
                    e
                ));
            }

            // 8. Truncate git records
            // 🔧 ATOMIC PROTECTION: If git records truncation fails, rollback Git changes
            // Note: Session file is already truncated at this point, cannot easily rollback
            if !git_operations_disabled {
                if let Err(e) = truncate_git_records(&session_id, &project_id, &prompts, prompt_index) {
                    log::error!(
                        "[Atomic Rollback] Git records truncation failed, rolling back Git: {}",
                        e
                    );

                    // Attempt to rollback Git changes
                    if let Err(rollback_err) = simple_git::git_reset_hard(&project_path, &original_head) {
                        log::error!("[CRITICAL] Git rollback failed: {}", rollback_err);
                        return Err(format!(
                            "Git 记录截断失败，且 Git 回滚也失败。\n\
                             记录截断错误: {}\n\
                             Git 回滚错误: {}\n\
                             注意：会话文件已截断但无法回滚。",
                            e, rollback_err
                        ));
                    }

                    return Err(format!(
                        "Git 记录截断失败，已回滚 Git 更改到操作前状态。\n\
                         注意：会话文件已截断但无法回滚，可能需要手动恢复。\n\
                         原因: {}",
                        e
                    ));
                }
            } else {
                log::info!("Skipping git records truncation (Git operations disabled)");
            }

            log::info!(
                "✅ [Atomic Revert] Successfully reverted both conversation and code to state before prompt #{}",
                prompt_index
            );
        }
    }

    // Return the prompt text for restoring to input
    Ok(prompt.text.clone())
}

/// Get all prompts for a session (for debugging)
#[tauri::command]
pub async fn get_prompt_list(
    session_id: String,
    project_id: String,
) -> Result<Vec<PromptRecord>, String> {
    extract_prompts_from_jsonl(&session_id, &project_id)
        .map_err(|e| format!("Failed to extract prompts from JSONL: {}", e))
}

/// Check rewind capabilities for a specific prompt
/// This determines whether a prompt can be reverted fully (conversation + code) or partially (conversation only)
#[tauri::command]
pub async fn check_rewind_capabilities(
    session_id: String,
    project_id: String,
    prompt_index: usize,
) -> Result<RewindCapabilities, String> {
    log::info!(
        "Checking rewind capabilities for prompt #{} in session: {}",
        prompt_index,
        session_id
    );

    // Load execution config to check if Git operations are disabled
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    let git_operations_disabled = execution_config.disable_rewind_git_operations;

    // Extract prompts from JSONL (single source of truth)
    let prompts = extract_prompts_from_jsonl(&session_id, &project_id)
        .map_err(|e| format!("Failed to extract prompts from JSONL: {}", e))?;

    // Get the prompt at the specified index
    let prompt = prompts
        .get(prompt_index)
        .ok_or_else(|| format!("Prompt #{} not found", prompt_index))?;

    // 🔧 FIX: Use prompt.source field (from queue-operation detection) instead of hash matching
    // This is more reliable as hash matching is fragile (affected by string escaping, encoding, etc.)
    log::info!(
        "[Rewind Check] Prompt #{} source: {}",
        prompt_index,
        prompt.source
    );

    // If Git operations are disabled, always return conversation-only capability with warning
    if git_operations_disabled {
        log::info!("[Rewind Check] Git operations disabled - conversation only");
        return Ok(RewindCapabilities {
            conversation: true,
            code: false,
            both: false,
            warning: Some(
                "Git 操作已在配置中禁用。只能撤回对话历史，无法回滚代码变更。".to_string(),
            ),
            source: prompt.source.clone(),
        });
    }

    if prompt.source == "project" {
        // This prompt was sent from project interface (has queue-operation marker)
        // 🔧 FIX: Check git records using prompt_index (not hash!)
        let git_record = get_git_record(&session_id, &project_id, prompt_index)
            .map_err(|e| format!("Failed to get git record: {}", e))?;

        if let Some(record) = git_record {
            let has_valid_commit =
                !record.commit_before.is_empty() && record.commit_before != "NONE";

            log::info!(
                "[Rewind Check] ✅ Project prompt #{} with git record: has_valid_commit={}",
                prompt_index,
                has_valid_commit
            );

            Ok(RewindCapabilities {
                conversation: true,
                code: has_valid_commit,
                both: has_valid_commit,
                warning: if !has_valid_commit {
                    Some("此提示词没有关联的 Git 记录，只能删除消息，无法回滚代码".to_string())
                } else {
                    None
                },
                source: "project".to_string(),
            })
        } else {
            // Project prompt but no git record (edge case: record_prompt_sent might have failed)
            log::warn!(
                "[Rewind Check] ⚠️ Project prompt #{} but no git record found",
                prompt_index
            );
            Ok(RewindCapabilities {
                conversation: true,
                code: false,
                both: false,
                warning: Some(
                    "此提示词来自项目界面，但没有找到 Git 记录，只能删除消息".to_string(),
                ),
                source: "project".to_string(),
            })
        }
    } else {
        // This prompt was sent from CLI (no queue-operation marker)
        log::info!(
            "[Rewind Check] CLI prompt #{} - conversation only",
            prompt_index
        );
        Ok(RewindCapabilities {
            conversation: true,
            code: false,
            both: false,
            warning: Some("此提示词来自 CLI 终端，只能删除消息，无法回滚代码".to_string()),
            source: "cli".to_string(),
        })
    }
}

/// Extract prompts from JSONL session file
/// This function reads the .jsonl file and extracts all user prompts
/// This is the single source of truth for all prompts (both CLI and project interface)
fn extract_prompts_from_jsonl(session_id: &str, project_id: &str) -> Result<Vec<PromptRecord>> {
    let claude_dir = get_claude_dir().context("Failed to get claude dir")?;
    let session_path = claude_dir
        .join("projects")
        .join(project_id)
        .join(format!("{}.jsonl", session_id));

    if !session_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&session_path).context("Failed to read session file")?;

    let mut prompts = Vec::new();
    let mut prompt_index = 0;
    let mut pending_dequeue = false;

    for (line_idx, line) in content.lines().enumerate() {
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(line) {
            let msg_type = msg.get("type").and_then(|t| t.as_str());

            // Check for dequeue operation
            if msg_type == Some("queue-operation") {
                let operation = msg.get("operation").and_then(|o| o.as_str());
                if operation == Some("dequeue") {
                    pending_dequeue = true;
                    continue;
                }
            }

            // Skip non-user message types
            if msg_type != Some("user") {
                continue;
            }

            // Skip sidechain messages (agent messages)
            let is_sidechain = msg
                .get("isSidechain")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if is_sidechain {
                continue;
            }

            // Skip subagent messages (has parent_tool_use_id)
            let has_parent_tool_use_id = msg.get("parent_tool_use_id").is_some()
                && !msg.get("parent_tool_use_id").unwrap().is_null();

            if has_parent_tool_use_id {
                continue;
            }

            // Extract text content
            let content_value = msg.get("message").and_then(|m| m.get("content"));
            let mut extracted_text = String::new();
            let mut has_text_content = false;
            let mut has_tool_result = false;

            if let Some(content) = content_value {
                if let Some(text) = content.as_str() {
                    extracted_text = text.to_string();
                    has_text_content = !text.trim().is_empty();
                } else if let Some(arr) = content.as_array() {
                    for item in arr {
                        if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                            if item_type == "text" {
                                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                    extracted_text.push_str(text);
                                    has_text_content = true;
                                }
                            } else if item_type == "tool_result" {
                                has_tool_result = true;
                            }
                        }
                    }
                }
            }

            // Skip tool-result-only messages
            if has_tool_result && !has_text_content {
                continue;
            }

            // Must have text content
            if !has_text_content {
                continue;
            }

            // Skip Warmup and Skills messages
            let is_warmup = extracted_text.contains("Warmup");
            let is_skill_message = extracted_text.contains("<command-name>")
                || extracted_text.contains("Launching skill:")
                || extracted_text.contains("skill is running");

            if is_warmup || is_skill_message {
                continue;
            }

            // Extract timestamp
            let timestamp = msg
                .get("timestamp")
                .and_then(|t| t.as_str())
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.timestamp())
                .unwrap_or_else(|| Utc::now().timestamp());

            // Determine source
            let source = if pending_dequeue {
                "project".to_string()
            } else {
                "cli".to_string()
            };

            // Reset pending_dequeue
            pending_dequeue = false;

            // Create prompt record
            prompts.push(PromptRecord {
                index: prompt_index,
                text: extracted_text,
                git_commit_before: "NONE".to_string(), // Will be filled later from git records
                git_commit_after: None,
                timestamp,
                source,
                line_number: line_idx,
            });

            prompt_index += 1;
        }
    }

    Ok(prompts)
}

/// Get unified prompt list with git records from .git-records.json
/// This merges prompts from JSONL with their corresponding git records (if any)
#[tauri::command]
pub async fn get_unified_prompt_list(
    session_id: String,
    project_id: String,
) -> Result<Vec<PromptRecord>, String> {
    log::info!("Getting unified prompt list for session: {}", session_id);

    // Get all prompts from .jsonl (single source of truth)
    let mut prompts = extract_prompts_from_jsonl(&session_id, &project_id)
        .map_err(|e| format!("Failed to extract prompts from JSONL: {}", e))?;

    // Load git records
    let git_records = load_git_records(&session_id, &project_id)
        .map_err(|e| format!("Failed to load git records: {}", e))?;

    // Enrich prompts with git records where available
    let mut project_count = 0;
    let mut cli_count = 0;

    for prompt in &mut prompts {
        // Count based on source field (already set correctly by extract_prompts_from_jsonl)
        if prompt.source == "project" {
            project_count += 1;
            // 🔧 FIX: Enrich with git commit info using prompt_index (not hash!)
            if let Some(record) = git_records.get(&prompt.index) {
                prompt.git_commit_before = record.commit_before.clone();
                prompt.git_commit_after = record.commit_after.clone();
                log::debug!(
                    "[Unified List] Enriched prompt #{} with git commits",
                    prompt.index
                );
            } else {
                log::debug!(
                    "[Unified List] No git record found for prompt #{}",
                    prompt.index
                );
            }
            // If no git record found, keep "NONE" placeholder
        } else {
            cli_count += 1;
            // CLI prompts don't have git records, keep "NONE" placeholder
        }
    }

    log::info!(
        "[Unified List] Found {} total prompts ({} from project interface, {} from CLI)",
        prompts.len(),
        project_count,
        cli_count
    );

    Ok(prompts)
}
