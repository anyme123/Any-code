use chrono::Utc;
/**
 * Codex Git Operations Module
 *
 * Handles Git-related operations for Codex sessions including:
 * - Git record tracking for rewind functionality
 * - Prompt extraction and management
 * - Rewind capabilities checking
 * - Session truncation and revert operations
 */
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// Import simple_git for rewind operations
use super::super::simple_git;
// Import rewind helpers/types shared with Claude
use super::super::prompt_tracker::{
    load_execution_config, PromptRecord as ClaudePromptRecord, RewindCapabilities, RewindMode,
};
// Import WSL utilities
use super::super::wsl_utils;
// Import session helpers
use super::session::find_session_file;

// Align Codex prompt record type with Claude prompt tracker representation
pub type PromptRecord = ClaudePromptRecord;

// ============================================================================
// Codex Rewind Types (Git Record Tracking)
// ============================================================================

/// Codex prompt record for rewind tracking
/// Note: Reserved for future use (e.g., prompt history display)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPromptRecord {
    pub index: usize,
    pub timestamp: String,
    pub text: String,
}

/// Codex Git state record for each prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPromptGitRecord {
    pub prompt_index: usize,
    pub commit_before: String,
    pub commit_after: Option<String>,
    pub timestamp: String,
}

/// Collection of Git records for a Codex session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexGitRecords {
    pub session_id: String,
    pub project_path: String,
    pub records: Vec<CodexPromptGitRecord>,
}

// ============================================================================
// Git Records Directory Management
// ============================================================================

/// Get the Codex git records directory
pub fn get_codex_git_records_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let records_dir = home_dir.join(".codex").join("git-records");

    // Create directory if it doesn't exist
    if !records_dir.exists() {
        fs::create_dir_all(&records_dir)
            .map_err(|e| format!("Failed to create git records directory: {}", e))?;
    }

    Ok(records_dir)
}

/// Get the Codex sessions directory
/// On Windows with WSL mode enabled, returns the WSL UNC path
pub fn get_codex_sessions_dir() -> Result<PathBuf, String> {
    // Check for WSL mode on Windows
    #[cfg(target_os = "windows")]
    {
        let wsl_config = wsl_utils::get_wsl_config();
        if wsl_config.enabled {
            if let Some(sessions_dir) = wsl_utils::get_wsl_codex_sessions_dir() {
                log::debug!("[Codex] Using WSL sessions directory: {:?}", sessions_dir);
                return Ok(sessions_dir);
            }
        }
    }

    // Native mode: use local home directory
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    Ok(home_dir.join(".codex").join("sessions"))
}

// ============================================================================
// Git Records CRUD Operations
// ============================================================================

/// Load Git records for a Codex session
pub fn load_codex_git_records(session_id: &str) -> Result<CodexGitRecords, String> {
    let records_dir = get_codex_git_records_dir()?;
    let records_file = records_dir.join(format!("{}.json", session_id));

    if !records_file.exists() {
        return Ok(CodexGitRecords {
            session_id: session_id.to_string(),
            project_path: String::new(),
            records: Vec::new(),
        });
    }

    let content = fs::read_to_string(&records_file)
        .map_err(|e| format!("Failed to read git records: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse git records: {}", e))
}

/// Save Git records for a Codex session
pub fn save_codex_git_records(session_id: &str, records: &CodexGitRecords) -> Result<(), String> {
    let records_dir = get_codex_git_records_dir()?;
    let records_file = records_dir.join(format!("{}.json", session_id));

    let content = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize git records: {}", e))?;

    fs::write(&records_file, content).map_err(|e| format!("Failed to write git records: {}", e))?;

    log::debug!("Saved Codex git records for session: {}", session_id);
    Ok(())
}

/// Truncate Git records after a specific prompt index
pub fn truncate_codex_git_records(session_id: &str, prompt_index: usize) -> Result<(), String> {
    let mut git_records = load_codex_git_records(session_id)?;

    // Keep only records up to and including prompt_index
    git_records
        .records
        .retain(|r| r.prompt_index <= prompt_index);

    save_codex_git_records(session_id, &git_records)?;
    log::info!(
        "[Codex Rewind] Truncated git records after prompt #{}",
        prompt_index
    );

    Ok(())
}

// ============================================================================
// Prompt Extraction
// ============================================================================

/// Extract all user prompts from a Codex session JSONL
/// This mirrors Claude prompt extraction so indices stay consistent
pub fn extract_codex_prompts(session_id: &str) -> Result<Vec<PromptRecord>, String> {
    let sessions_dir = get_codex_sessions_dir()?;
    let session_file = find_session_file(&sessions_dir, session_id)
        .ok_or_else(|| format!("Session file not found for: {}", session_id))?;

    let content = fs::read_to_string(&session_file)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let mut prompts: Vec<PromptRecord> = Vec::new();
    let mut prompt_index = 0;

    for (line_idx, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
            if event["type"].as_str() == Some("response_item")
                && event["payload"]["role"].as_str() == Some("user")
            {
                // Extract the actual user text (skip system/context injections)
                let mut prompt_text: Option<String> = None;
                if let Some(content) = event["payload"]["content"].as_array() {
                    for item in content {
                        if item["type"].as_str() == Some("input_text") {
                            if let Some(text) = item["text"].as_str() {
                                if !text.contains("<environment_context>")
                                    && !text.contains("# AGENTS.md instructions")
                                    && !text.trim().is_empty()
                                {
                                    prompt_text = Some(text.to_string());
                                    break;
                                }
                            }
                        }
                    }
                }

                if let Some(text) = prompt_text {
                    let timestamp = event["timestamp"]
                        .as_str()
                        .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
                        .map(|dt| dt.timestamp())
                        .unwrap_or_else(|| chrono::Utc::now().timestamp());

                    prompts.push(PromptRecord {
                        index: prompt_index,
                        text,
                        git_commit_before: String::new(),
                        git_commit_after: None,
                        timestamp,
                        source: "cli".to_string(), // default to CLI; update below if git record exists
                        line_number: line_idx,
                    });
                    prompt_index += 1;
                }
            }
        }
    }

    // Enrich with git records (if present)
    let git_records = load_codex_git_records(session_id)?;
    for prompt in prompts.iter_mut() {
        if let Some(record) = git_records
            .records
            .iter()
            .find(|r| r.prompt_index == prompt.index)
        {
            prompt.git_commit_before = record.commit_before.clone();
            prompt.git_commit_after = record.commit_after.clone();
            prompt.source = "project".to_string();

            if prompt.timestamp == 0 {
                if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&record.timestamp) {
                    prompt.timestamp = ts.timestamp();
                }
            }
        }
    }

    Ok(prompts)
}

/// Get prompt list for Codex sessions (for revert picker)
#[tauri::command]
pub async fn get_codex_prompt_list(session_id: String) -> Result<Vec<PromptRecord>, String> {
    extract_codex_prompts(&session_id)
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

// ============================================================================
// Rewind Capabilities
// ============================================================================

/// Check rewind capabilities for Codex prompt (conversation/code/both)
#[tauri::command]
pub async fn check_codex_rewind_capabilities(
    session_id: String,
    prompt_index: usize,
) -> Result<RewindCapabilities, String> {
    log::info!(
        "[Codex Rewind] Checking capabilities for session {} prompt #{}",
        session_id,
        prompt_index
    );

    // Respect global execution config for git operations
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;
    let git_operations_disabled = execution_config.disable_rewind_git_operations;

    // Extract prompts to validate index and source
    let prompts = extract_codex_prompts(&session_id)?;
    let prompt = prompts
        .get(prompt_index)
        .ok_or_else(|| format!("Prompt #{} not found", prompt_index))?;

    if git_operations_disabled {
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

    // Look up git record for this prompt index
    let git_records = load_codex_git_records(&session_id)?;
    let git_record = git_records
        .records
        .iter()
        .find(|r| r.prompt_index == prompt_index);

    if let Some(record) = git_record {
        let has_valid_commit = !record.commit_before.is_empty();
        Ok(RewindCapabilities {
            conversation: true,
            code: has_valid_commit,
            both: has_valid_commit,
            warning: if has_valid_commit {
                None
            } else {
                Some("此提示词没有关联的 Git 记录，只能删除对话历史。".to_string())
            },
            source: "project".to_string(),
        })
    } else {
        Ok(RewindCapabilities {
            conversation: true,
            code: false,
            both: false,
            warning: Some(
                "此提示词没有关联的 Git 记录（可能来自 CLI），只能删除对话历史。".to_string(),
            ),
            source: prompt.source.clone(),
        })
    }
}

// ============================================================================
// Session Truncation
// ============================================================================

/// Get prompt text from Codex session file
#[allow(dead_code)]
pub fn get_codex_prompt_text(session_id: &str, prompt_index: usize) -> Result<String, String> {
    let sessions_dir = get_codex_sessions_dir()?;
    let session_file = find_session_file(&sessions_dir, session_id)
        .ok_or_else(|| format!("Session file not found for: {}", session_id))?;

    use std::io::{BufRead, BufReader};
    let file =
        fs::File::open(&session_file).map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);
    let mut user_message_count = 0;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
            if event["type"].as_str() == Some("response_item") {
                if event["payload"]["role"].as_str() == Some("user") {
                    if user_message_count == prompt_index {
                        // Extract text from content array
                        if let Some(content) = event["payload"]["content"].as_array() {
                            for item in content {
                                if item["type"].as_str() == Some("input_text") {
                                    if let Some(text) = item["text"].as_str() {
                                        // Skip system messages
                                        if !text.contains("<environment_context>")
                                            && !text.contains("# AGENTS.md instructions")
                                            && !text.is_empty()
                                        {
                                            return Ok(text.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                    user_message_count += 1;
                }
            }
        }
    }

    Err(format!("Prompt #{} not found in session", prompt_index))
}

/// Truncate Codex session file to before a specific prompt
pub fn truncate_codex_session_to_prompt(
    session_id: &str,
    prompt_index: usize,
) -> Result<(), String> {
    let sessions_dir = get_codex_sessions_dir()?;
    let session_file = find_session_file(&sessions_dir, session_id)
        .ok_or_else(|| format!("Session file not found for: {}", session_id))?;

    let content = fs::read_to_string(&session_file)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();

    // Find the line index to truncate at
    let mut user_message_count = 0;
    let mut truncate_at_line = 0;
    let mut found_target = false;

    for (idx, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
            if event["type"].as_str() == Some("response_item") {
                if event["payload"]["role"].as_str() == Some("user") {
                    // Extract user text and skip system injections
                    let mut prompt_text: Option<String> = None;
                    if let Some(content) = event["payload"]["content"].as_array() {
                        for item in content {
                            if item["type"].as_str() == Some("input_text") {
                                if let Some(text) = item["text"].as_str() {
                                    if !text.contains("<environment_context>")
                                        && !text.contains("# AGENTS.md instructions")
                                        && !text.trim().is_empty()
                                    {
                                        prompt_text = Some(text.to_string());
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Skip non-user prompts (e.g., AGENTS/system context)
                    if prompt_text.is_none() {
                        continue;
                    }

                    if user_message_count == prompt_index {
                        truncate_at_line = idx;
                        found_target = true;
                        break;
                    }
                    user_message_count += 1;
                }
            }
        }
    }

    if !found_target {
        return Err(format!("Prompt #{} not found in session", prompt_index));
    }

    log::info!(
        "[Codex Rewind] Total lines: {}, truncating at line {} (prompt #{})",
        total_lines,
        truncate_at_line,
        prompt_index
    );

    // Truncate to the line before this prompt
    let truncated_lines: Vec<&str> = lines.into_iter().take(truncate_at_line).collect();

    let new_content = if truncated_lines.is_empty() {
        String::new()
    } else {
        truncated_lines.join("\n") + "\n"
    };

    fs::write(&session_file, new_content)
        .map_err(|e| format!("Failed to write truncated session: {}", e))?;

    log::info!(
        "[Codex Rewind] Truncated session: kept {} lines, deleted {} lines",
        truncate_at_line,
        total_lines - truncate_at_line
    );

    Ok(())
}

// ============================================================================
// Prompt Recording (for rewind tracking)
// ============================================================================

/// Record a Codex prompt being sent (called before execution)
#[tauri::command]
pub async fn record_codex_prompt_sent(
    session_id: String,
    project_path: String,
    _prompt_text: String,
) -> Result<usize, String> {
    log::info!(
        "[Codex Record] Recording prompt sent for session: {}",
        session_id
    );

    // Check if Git operations are disabled in config
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    if execution_config.disable_rewind_git_operations {
        log::info!("[Codex Record] Git operations disabled, skipping git record");
        // Still need to return a prompt_index for tracking purposes
        let git_records = load_codex_git_records(&session_id)?;
        let prompt_index = git_records.records.len();
        log::info!(
            "[Codex Record] Returning prompt index #{} (no git record)",
            prompt_index
        );
        return Ok(prompt_index);
    }

    // Ensure Git repository is initialized
    simple_git::ensure_git_repo(&project_path)
        .map_err(|e| format!("Failed to ensure Git repo: {}", e))?;

    // Get current commit (state before prompt execution)
    let commit_before = simple_git::git_current_commit(&project_path)
        .map_err(|e| format!("Failed to get current commit: {}", e))?;

    // Load existing records
    let mut git_records = load_codex_git_records(&session_id)?;

    // Update project path if needed
    if git_records.project_path.is_empty() {
        git_records.project_path = project_path.clone();
    }

    // Calculate prompt index
    let prompt_index = git_records.records.len();

    // Create new record
    let record = CodexPromptGitRecord {
        prompt_index,
        commit_before: commit_before.clone(),
        commit_after: None,
        timestamp: Utc::now().to_rfc3339(),
    };

    git_records.records.push(record);
    save_codex_git_records(&session_id, &git_records)?;

    log::info!(
        "[Codex Record] Recorded prompt #{} with commit_before: {}",
        prompt_index,
        &commit_before[..8.min(commit_before.len())]
    );

    Ok(prompt_index)
}

/// Record a Codex prompt completion (called after AI response)
#[tauri::command]
pub async fn record_codex_prompt_completed(
    session_id: String,
    project_path: String,
    prompt_index: usize,
    prompt_text: Option<String>,
) -> Result<(), String> {
    log::info!(
        "[Codex Record] Recording prompt #{} completed for session: {}",
        prompt_index,
        session_id
    );

    // Check if Git operations are disabled in config
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    if execution_config.disable_rewind_git_operations {
        log::info!("[Codex Record] Git operations disabled, skipping git commit and record update");
        return Ok(());
    }

    if execution_config.disable_auto_commit_after_response {
        log::info!("[Codex Record] Auto-commit disabled by user setting, skipping git commit");
    } else {
        let commit_message = build_prompt_commit_message("[Codex]", prompt_text.as_deref(), prompt_index);
        match simple_git::git_commit_changes(&project_path, &commit_message) {
            Ok(true) => {
                log::info!(
                    "[Codex Record] Auto-committed changes after prompt #{}",
                    prompt_index
                );
            }
            Ok(false) => {
                log::debug!(
                    "[Codex Record] No changes to commit after prompt #{}",
                    prompt_index
                );
            }
            Err(e) => {
                log::warn!("[Codex Record] Failed to auto-commit: {}", e);
            }
        }
    }

    // Get current commit (state after AI completion)
    let commit_after = simple_git::git_current_commit(&project_path)
        .map_err(|e| format!("Failed to get current commit: {}", e))?;

    // Update the record
    let mut git_records = load_codex_git_records(&session_id)?;

    if let Some(record) = git_records
        .records
        .iter_mut()
        .find(|r| r.prompt_index == prompt_index)
    {
        record.commit_after = Some(commit_after.clone());
        save_codex_git_records(&session_id, &git_records)?;

        log::info!(
            "[Codex Record] Updated prompt #{} with commit_after: {}",
            prompt_index,
            &commit_after[..8.min(commit_after.len())]
        );
    } else {
        log::warn!(
            "[Codex Record] Record not found for prompt #{}",
            prompt_index
        );
    }

    Ok(())
}

// ============================================================================
// Revert Operations
// ============================================================================

/// Revert Codex session to a specific prompt
#[tauri::command]
pub async fn revert_codex_to_prompt(
    session_id: String,
    project_path: String,
    prompt_index: usize,
    mode: RewindMode,
) -> Result<String, String> {
    log::info!(
        "[Codex Rewind] Reverting session {} to prompt #{} with mode: {:?}",
        session_id,
        prompt_index,
        mode
    );

    // Load execution config to check if Git operations are disabled
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    let git_operations_disabled = execution_config.disable_rewind_git_operations;

    if git_operations_disabled {
        log::warn!("[Codex Rewind] Git operations are disabled in config");
    }

    // Extract prompts to validate index and retrieve text
    let prompts = extract_codex_prompts(&session_id)?;
    let prompt = prompts
        .get(prompt_index)
        .ok_or_else(|| format!("Prompt #{} not found in session", prompt_index))?;

    // Load Git records
    let git_records = load_codex_git_records(&session_id)?;
    let git_record = git_records
        .records
        .iter()
        .find(|r| r.prompt_index == prompt_index);

    // Validate mode compatibility
    match mode {
        RewindMode::CodeOnly | RewindMode::Both => {
            if git_operations_disabled {
                return Err(
                    "无法回滚代码：Git 操作已在配置中禁用。只能撤回对话历史，无法回滚代码变更。"
                        .into(),
                );
            }
            if git_record.is_none() {
                return Err(format!(
                    "无法回滚代码：提示词 #{} 没有关联的 Git 记录",
                    prompt_index
                ));
            }
        }
        RewindMode::ConversationOnly => {}
    }

    // Execute revert based on mode
    match mode {
        RewindMode::ConversationOnly => {
            log::info!("[Codex Rewind] Reverting conversation only");

            // Truncate session messages
            truncate_codex_session_to_prompt(&session_id, prompt_index)?;

            // Truncate git records
            if !git_operations_disabled {
                truncate_codex_git_records(&session_id, prompt_index)?;
            }

            log::info!(
                "[Codex Rewind] Successfully reverted conversation to prompt #{}",
                prompt_index
            );
        }

        RewindMode::CodeOnly => {
            log::info!("[Codex Rewind] Reverting code to state before prompt #{}", prompt_index);

            // Stash uncommitted changes
            simple_git::git_stash_save(
                &project_path,
                &format!(
                    "Auto-stash before Codex code revert to prompt #{}",
                    prompt_index
                ),
            )
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

            // Record original HEAD for atomic rollback on failure
            let original_head = simple_git::git_current_commit(&project_path)
                .map_err(|e| format!("Failed to get current commit: {}", e))?;

            log::info!(
                "[Codex Precise Revert] Original HEAD: {} (will rollback here on failure)",
                &original_head[..8.min(original_head.len())]
            );

            // Load ALL git records for this session
            let all_git_records = load_codex_git_records(&session_id)?;

            // Filter records for prompt_index and onwards, then sort by index descending
            let mut records_to_revert: Vec<&CodexPromptGitRecord> = all_git_records
                .records
                .iter()
                .filter(|r| r.prompt_index >= prompt_index)
                .collect();

            // Sort by index descending (newest first) - revert from newest to oldest
            records_to_revert.sort_by(|a, b| b.prompt_index.cmp(&a.prompt_index));

            log::info!(
                "[Codex Precise Revert] Found {} records to revert (prompts {} and onwards)",
                records_to_revert.len(),
                prompt_index
            );

            // Revert each record's commit_before..commit_after in reverse order
            let mut total_reverted = 0;
            let mut revert_failed = false;
            let mut failure_message = String::new();

            for record in &records_to_revert {
                // Skip if no commit_after (AI didn't make any changes)
                let commit_after = match &record.commit_after {
                    Some(c) if c != &record.commit_before => c.clone(),
                    _ => {
                        log::debug!("[Codex Precise Revert] Skipping prompt #{} - no code changes", record.prompt_index);
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
                            "[Codex Precise Revert] Failed to check changes for prompt #{}: {}",
                            record.prompt_index,
                            e
                        );
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                };

                if !has_changes {
                    log::debug!(
                        "[Codex Precise Revert] Skipping prompt #{} - empty commit",
                        record.prompt_index
                    );
                    continue;
                }

                log::info!(
                    "[Codex Precise Revert] Reverting prompt #{}: {}..{}",
                    record.prompt_index,
                    &record.commit_before[..8.min(record.commit_before.len())],
                    &commit_after[..8.min(commit_after.len())]
                );

                let revert_result = simple_git::git_revert_range_with_retry(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                    &format!("[Codex Revert] 撤回提示词 #{} 的代码更改", record.prompt_index),
                    3, // Max 3 retries for Git lock conflicts
                );

                match revert_result {
                    Ok(result) if result.success => {
                        total_reverted += result.commits_reverted;
                        log::info!(
                            "[Codex Precise Revert] Successfully reverted prompt #{} ({} commits)",
                            record.prompt_index,
                            result.commits_reverted
                        );
                    }
                    Ok(result) => {
                        log::warn!(
                            "[Codex Precise Revert] Revert conflict for prompt #{}: {}",
                            record.prompt_index,
                            result.message
                        );
                        revert_failed = true;
                        failure_message = result.message;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Codex Precise Revert] Revert failed for prompt #{}: {}", record.prompt_index, e);
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                }
            }

            // If revert failed, rollback to original HEAD (atomic operation)
            if revert_failed {
                log::warn!(
                    "[Codex Precise Revert] Rolling back to original HEAD {} due to failure",
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
                "[Codex Rewind] Successfully reverted code to state before prompt #{} (reverted {} commits from {} prompts)",
                prompt_index,
                total_reverted,
                records_to_revert.len()
            );
        }

        RewindMode::Both => {
            log::info!("[Codex Rewind] Reverting both to state before prompt #{}", prompt_index);

            // Stash uncommitted changes
            simple_git::git_stash_save(
                &project_path,
                &format!(
                    "Auto-stash before Codex full revert to prompt #{}",
                    prompt_index
                ),
            )
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

            // Record original HEAD for atomic rollback on failure
            let original_head = simple_git::git_current_commit(&project_path)
                .map_err(|e| format!("Failed to get current commit: {}", e))?;

            log::info!(
                "[Codex Precise Revert] Original HEAD: {} (will rollback here on failure)",
                &original_head[..8.min(original_head.len())]
            );

            // Load ALL git records for this session
            let all_git_records = load_codex_git_records(&session_id)?;

            // Filter records for prompt_index and onwards, then sort by index descending
            let mut records_to_revert: Vec<&CodexPromptGitRecord> = all_git_records
                .records
                .iter()
                .filter(|r| r.prompt_index >= prompt_index)
                .collect();

            // Sort by index descending (newest first) - revert from newest to oldest
            records_to_revert.sort_by(|a, b| b.prompt_index.cmp(&a.prompt_index));

            log::info!(
                "[Codex Precise Revert] Found {} records to revert (prompts {} and onwards)",
                records_to_revert.len(),
                prompt_index
            );

            // Revert each record's commit_before..commit_after in reverse order
            let mut total_reverted = 0;
            let mut revert_failed = false;
            let mut failure_message = String::new();

            for record in &records_to_revert {
                // Skip if no commit_after (AI didn't make any changes)
                let commit_after = match &record.commit_after {
                    Some(c) if c != &record.commit_before => c.clone(),
                    _ => {
                        log::debug!("[Codex Precise Revert] Skipping prompt #{} - no code changes", record.prompt_index);
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
                            "[Codex Precise Revert] Failed to check changes for prompt #{}: {}",
                            record.prompt_index,
                            e
                        );
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                };

                if !has_changes {
                    log::debug!(
                        "[Codex Precise Revert] Skipping prompt #{} - empty commit",
                        record.prompt_index
                    );
                    continue;
                }

                log::info!(
                    "[Codex Precise Revert] Reverting prompt #{}: {}..{}",
                    record.prompt_index,
                    &record.commit_before[..8.min(record.commit_before.len())],
                    &commit_after[..8.min(commit_after.len())]
                );

                let revert_result = simple_git::git_revert_range_with_retry(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                    &format!("[Codex Revert] 撤回提示词 #{} 的代码更改", record.prompt_index),
                    3, // Max 3 retries for Git lock conflicts
                );

                match revert_result {
                    Ok(result) if result.success => {
                        total_reverted += result.commits_reverted;
                        log::info!(
                            "[Codex Precise Revert] Successfully reverted prompt #{} ({} commits)",
                            record.prompt_index,
                            result.commits_reverted
                        );
                    }
                    Ok(result) => {
                        log::warn!(
                            "[Codex Precise Revert] Revert conflict for prompt #{}: {}",
                            record.prompt_index,
                            result.message
                        );
                        revert_failed = true;
                        failure_message = result.message;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Codex Precise Revert] Revert failed for prompt #{}: {}", record.prompt_index, e);
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                }
            }

            // If revert failed, rollback to original HEAD (atomic operation)
            if revert_failed {
                log::warn!(
                    "[Codex Precise Revert] Rolling back to original HEAD {} due to failure",
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
                "[Codex Rewind] Successfully reverted code to state before prompt #{} (reverted {} commits from {} prompts)",
                prompt_index,
                total_reverted,
                records_to_revert.len()
            );

            // Truncate session
            // 🔧 ATOMIC PROTECTION: If session truncation fails, rollback Git changes
            if let Err(e) = truncate_codex_session_to_prompt(&session_id, prompt_index) {
                log::error!(
                    "[Codex Atomic Rollback] Session truncation failed, rolling back Git: {}",
                    e
                );

                if let Err(rollback_err) = simple_git::git_reset_hard(&project_path, &original_head) {
                    log::error!("[CRITICAL] Git rollback failed: {}", rollback_err);
                    return Err(format!(
                        "会话截断失败且 Git 回滚失败。\n\
                         会话错误: {}\n\
                         Git 回滚错误: {}",
                        e, rollback_err
                    ));
                }

                return Err(format!(
                    "会话截断失败，已原子性回滚 Git 更改。原因: {}",
                    e
                ));
            }

            // Truncate git records
            // 🔧 ATOMIC PROTECTION: If git records truncation fails, rollback Git changes
            if !git_operations_disabled {
                if let Err(e) = truncate_codex_git_records(&session_id, prompt_index) {
                    log::error!(
                        "[Codex Atomic Rollback] Git records truncation failed, rolling back Git: {}",
                        e
                    );

                    if let Err(rollback_err) = simple_git::git_reset_hard(&project_path, &original_head) {
                        log::error!("[CRITICAL] Git rollback failed: {}", rollback_err);
                        return Err(format!(
                            "Git 记录截断失败且回滚失败。\n\
                             记录错误: {}\n\
                             回滚错误: {}\n\
                             注意：会话已截断。",
                            e, rollback_err
                        ));
                    }

                    return Err(format!(
                        "Git 记录截断失败，已回滚 Git 更改。\n\
                         注意：会话已截断但无法回滚。原因: {}",
                        e
                    ));
                }
            }

            log::info!(
                "✅ [Codex Atomic Revert] Successfully reverted both to state before prompt #{}",
                prompt_index
            );
        }
    }

    // Return the prompt text for restoring to input
    Ok(prompt.text.clone())
}
