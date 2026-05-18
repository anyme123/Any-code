use chrono::Utc;
/**
 * Gemini Git Operations Module
 *
 * Handles Git-related operations for Gemini sessions including:
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
// Import Gemini config helpers
use super::config::get_gemini_dir;

// Align Gemini prompt record type with Claude prompt tracker representation
pub type PromptRecord = ClaudePromptRecord;

// ============================================================================
// Gemini Rewind Types (Git Record Tracking)
// ============================================================================

/// Gemini Git state record for each prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiPromptGitRecord {
    pub prompt_index: usize,
    pub commit_before: String,
    pub commit_after: Option<String>,
    pub timestamp: String,
}

/// Collection of Git records for a Gemini session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGitRecords {
    pub session_id: String,
    pub project_path: String,
    pub records: Vec<GeminiPromptGitRecord>,
}

// ============================================================================
// Git Records Directory Management
// ============================================================================

/// Get the Gemini git records directory
pub fn get_gemini_git_records_dir() -> Result<PathBuf, String> {
    let gemini_dir = get_gemini_dir()?;
    let records_dir = gemini_dir.join("git-records");

    // Create directory if it doesn't exist
    if !records_dir.exists() {
        fs::create_dir_all(&records_dir)
            .map_err(|e| format!("Failed to create git records directory: {}", e))?;
    }

    Ok(records_dir)
}

/// Get the Gemini sessions directory (for chats/*.json files)
pub fn get_gemini_sessions_dir(project_path: &str) -> Result<PathBuf, String> {
    let gemini_dir = get_gemini_dir()?;

    // Hash project path to get session directory
    use super::config::hash_project_path;
    let project_hash = hash_project_path(project_path);

    Ok(gemini_dir.join("tmp").join(project_hash).join("chats"))
}

/// Find Gemini session file by session ID
/// Gemini CLI stores session files with format: session-<date>-<session_id_prefix>.json
/// where session_id_prefix is the first 8 characters of the full UUID
/// This function searches by prefix and verifies by reading the internal sessionId field
fn find_gemini_session_file(sessions_dir: &PathBuf, session_id: &str) -> Result<PathBuf, String> {
    // Extract the first 8 characters of session_id for filename matching
    // Gemini CLI uses this prefix in the filename
    let session_prefix = if session_id.len() >= 8 {
        &session_id[..8]
    } else {
        session_id
    };

    log::debug!(
        "[Gemini] Searching for session file with prefix: {} in {:?}",
        session_prefix,
        sessions_dir
    );

    let entries = fs::read_dir(sessions_dir)
        .map_err(|e| format!("Failed to read sessions directory: {}", e))?;

    // First pass: find files that match the prefix in filename
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                // Check if filename contains the session_id prefix
                if filename.contains(session_prefix) {
                    candidates.push(path);
                }
            }
        }
    }

    log::debug!(
        "[Gemini] Found {} candidate files for prefix {}",
        candidates.len(),
        session_prefix
    );

    // Second pass: verify by reading the sessionId field in the file
    for candidate in candidates {
        if let Ok(content) = fs::read_to_string(&candidate) {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(file_session_id) = data.get("sessionId").and_then(|v| v.as_str()) {
                    if file_session_id == session_id {
                        log::info!("[Gemini] Found matching session file: {:?}", candidate);
                        return Ok(candidate);
                    }
                }
            }
        }
    }

    Err(format!(
        "Session file not found for: {} (searched for prefix: {})",
        session_id, session_prefix
    ))
}

// ============================================================================
// Git Records Storage
// ============================================================================

/// Load Git records for a Gemini session
pub fn load_gemini_git_records(session_id: &str) -> Result<GeminiGitRecords, String> {
    let records_dir = get_gemini_git_records_dir()?;
    let records_file = records_dir.join(format!("{}.json", session_id));

    if !records_file.exists() {
        return Ok(GeminiGitRecords {
            session_id: session_id.to_string(),
            project_path: String::new(),
            records: Vec::new(),
        });
    }

    let content = fs::read_to_string(&records_file)
        .map_err(|e| format!("Failed to read git records: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse git records: {}", e))
}

/// Save Git records for a Gemini session
pub fn save_gemini_git_records(session_id: &str, records: &GeminiGitRecords) -> Result<(), String> {
    let records_dir = get_gemini_git_records_dir()?;
    let records_file = records_dir.join(format!("{}.json", session_id));

    let content = serde_json::to_string_pretty(records)
        .map_err(|e| format!("Failed to serialize git records: {}", e))?;

    fs::write(&records_file, content).map_err(|e| format!("Failed to write git records: {}", e))?;

    log::debug!("Saved Gemini git records for session: {}", session_id);
    Ok(())
}

/// Truncate Git records (remove records at and after prompt_index)
/// When reverting to prompt #N, we delete prompt #N and keep only prompts before it
pub fn truncate_gemini_git_records(session_id: &str, prompt_index: usize) -> Result<(), String> {
    let mut git_records = load_gemini_git_records(session_id)?;

    let before_count = git_records.records.len();

    // Remove records at and after prompt_index (keep only records BEFORE)
    git_records
        .records
        .retain(|r| r.prompt_index < prompt_index);

    let after_count = git_records.records.len();

    save_gemini_git_records(session_id, &git_records)?;

    log::info!(
        "[Gemini Rewind] Truncated git records: kept {} records before prompt #{} (removed {})",
        after_count,
        prompt_index,
        before_count - after_count
    );
    Ok(())
}

// ============================================================================
// Prompt Extraction from Gemini Session Files
// ============================================================================

/// Extract prompts from Gemini session chat file
/// Gemini stores sessions in chats/session-*.json files with structured format
fn extract_gemini_prompts(
    session_id: &str,
    project_path: &str,
) -> Result<Vec<PromptRecord>, String> {
    let sessions_dir = get_gemini_sessions_dir(project_path)?;

    // Find session file using helper function (handles Gemini's 8-char prefix naming)
    let session_file = find_gemini_session_file(&sessions_dir, session_id)?;

    let content = fs::read_to_string(&session_file)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let session_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse session JSON: {}", e))?;

    // Extract messages array
    let messages = session_data
        .get("messages")
        .and_then(|m| m.as_array())
        .ok_or_else(|| "No messages array found in session".to_string())?;

    let mut prompts = Vec::new();
    let mut prompt_index = 0;

    for message in messages {
        // Only process user messages
        // Gemini CLI stores messages with "type" field, not "role"
        let msg_type = message.get("type").and_then(|t| t.as_str());
        if msg_type != Some("user") {
            continue;
        }

        // Extract text content from "content" field (direct string)
        // Gemini CLI stores content as a simple string, not as parts array
        let extracted_text = message
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();

        if extracted_text.trim().is_empty() {
            continue;
        }

        // Extract timestamp
        let timestamp = message
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.timestamp())
            .unwrap_or_else(|| Utc::now().timestamp());

        // All Gemini prompts sent from project interface are marked as "project"
        prompts.push(PromptRecord {
            index: prompt_index,
            text: extracted_text,
            git_commit_before: "NONE".to_string(),
            git_commit_after: None,
            timestamp,
            source: "project".to_string(), // Gemini always from project interface
            line_number: 0,                // Gemini uses JSON format, no specific line number
        });

        prompt_index += 1;
    }

    // Enrich with git records (if present)
    let git_records = load_gemini_git_records(session_id)?;
    for prompt in prompts.iter_mut() {
        if let Some(record) = git_records
            .records
            .iter()
            .find(|r| r.prompt_index == prompt.index)
        {
            prompt.git_commit_before = record.commit_before.clone();
            prompt.git_commit_after = record.commit_after.clone();

            if prompt.timestamp == 0 {
                if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&record.timestamp) {
                    prompt.timestamp = ts.timestamp();
                }
            }
        }
    }

    Ok(prompts)
}

/// Get prompt list for Gemini sessions (for revert picker)
#[tauri::command]
pub async fn get_gemini_prompt_list(
    session_id: String,
    project_path: String,
) -> Result<Vec<PromptRecord>, String> {
    extract_gemini_prompts(&session_id, &project_path)
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

/// Check rewind capabilities for Gemini prompt (conversation/code/both)
#[tauri::command]
pub async fn check_gemini_rewind_capabilities(
    session_id: String,
    project_path: String,
    prompt_index: usize,
) -> Result<RewindCapabilities, String> {
    log::info!(
        "[Gemini Rewind] Checking capabilities for session {} prompt #{}",
        session_id,
        prompt_index
    );

    // Respect global execution config for git operations
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;
    let git_operations_disabled = execution_config.disable_rewind_git_operations;

    // Extract prompts to validate index
    let prompts = extract_gemini_prompts(&session_id, &project_path)?;
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
    let git_records = load_gemini_git_records(&session_id)?;
    let git_record = git_records
        .records
        .iter()
        .find(|r| r.prompt_index == prompt_index);

    if let Some(record) = git_record {
        let has_valid_commit = !record.commit_before.is_empty() && record.commit_before != "NONE";

        log::info!(
            "[Gemini Rewind] ✅ Prompt #{} with git record: has_valid_commit={}",
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
        log::warn!(
            "[Gemini Rewind] ⚠️ No git record found for prompt #{}",
            prompt_index
        );
        Ok(RewindCapabilities {
            conversation: true,
            code: false,
            both: false,
            warning: Some("此提示词没有关联的 Git 记录，只能删除消息".to_string()),
            source: "project".to_string(),
        })
    }
}

// ============================================================================
// Prompt Recording
// ============================================================================

/// Record a Gemini prompt being sent (called before execution)
#[tauri::command]
pub async fn record_gemini_prompt_sent(
    session_id: String,
    project_path: String,
    _prompt_text: String,
) -> Result<usize, String> {
    log::info!(
        "[Gemini Record] Recording prompt sent for session: {}",
        session_id
    );

    // Check if Git operations are disabled in config
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    if execution_config.disable_rewind_git_operations {
        log::info!("[Gemini Record] Git operations disabled, skipping git record");
        // Still need to return a prompt_index for tracking purposes
        let git_records = load_gemini_git_records(&session_id)?;
        let prompt_index = git_records.records.len();
        log::info!(
            "[Gemini Record] Returning prompt index #{} (no git record)",
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
    let mut git_records = load_gemini_git_records(&session_id)?;

    // Update project path if needed
    if git_records.project_path.is_empty() {
        git_records.project_path = project_path.clone();
    }

    // Calculate prompt index
    let prompt_index = git_records.records.len();

    // Create new record
    let record = GeminiPromptGitRecord {
        prompt_index,
        commit_before: commit_before.clone(),
        commit_after: None,
        timestamp: Utc::now().to_rfc3339(),
    };

    git_records.records.push(record);
    save_gemini_git_records(&session_id, &git_records)?;

    log::info!(
        "[Gemini Record] Recorded prompt #{} with commit_before: {}",
        prompt_index,
        &commit_before[..8.min(commit_before.len())]
    );

    Ok(prompt_index)
}

/// Record a Gemini prompt completion (called after AI response)
#[tauri::command]
pub async fn record_gemini_prompt_completed(
    session_id: String,
    project_path: String,
    prompt_index: usize,
    prompt_text: Option<String>,
) -> Result<(), String> {
    log::info!(
        "[Gemini Record] Recording prompt #{} completed for session: {}",
        prompt_index,
        session_id
    );

    // Check if Git operations are disabled in config
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    if execution_config.disable_rewind_git_operations {
        log::info!(
            "[Gemini Record] Git operations disabled, skipping git commit and record update"
        );
        return Ok(());
    }

    if execution_config.disable_auto_commit_after_response {
        log::info!("[Gemini Record] Auto-commit disabled by user setting, skipping git commit");
    } else {
        let commit_message =
            build_prompt_commit_message("[Gemini]", prompt_text.as_deref(), prompt_index);
        match simple_git::git_commit_changes(&project_path, &commit_message) {
            Ok(true) => {
                log::info!(
                    "[Gemini Record] Auto-committed changes after prompt #{}",
                    prompt_index
                );
            }
            Ok(false) => {
                log::debug!(
                    "[Gemini Record] No changes to commit after prompt #{}",
                    prompt_index
                );
            }
            Err(e) => {
                log::warn!("[Gemini Record] Failed to auto-commit: {}", e);
            }
        }
    }

    // Get current commit (state after AI completion)
    let commit_after = simple_git::git_current_commit(&project_path)
        .map_err(|e| format!("Failed to get current commit: {}", e))?;

    // Update the record
    let mut git_records = load_gemini_git_records(&session_id)?;

    if let Some(record) = git_records
        .records
        .iter_mut()
        .find(|r| r.prompt_index == prompt_index)
    {
        record.commit_after = Some(commit_after.clone());
        save_gemini_git_records(&session_id, &git_records)?;

        log::info!(
            "[Gemini Record] Updated prompt #{} with commit_after: {}",
            prompt_index,
            &commit_after[..8.min(commit_after.len())]
        );
    } else {
        log::warn!(
            "[Gemini Record] Record not found for prompt #{}",
            prompt_index
        );
    }

    Ok(())
}

// ============================================================================
// Session Truncation
// ============================================================================

/// Truncate Gemini session file to before a specific prompt
/// Note: Gemini stores sessions as structured JSON files, not JSONL
///
/// When reverting to prompt #N:
/// - We want to DELETE prompt #N and everything after it
/// - We want to KEEP all messages BEFORE prompt #N
///
/// Example: If we have prompts [#0, #1, #2] and revert to #1:
/// - Prompt #1 and #2 should be deleted
/// - Prompt #0 should be kept
pub fn truncate_gemini_session_to_prompt(
    session_id: &str,
    project_path: &str,
    prompt_index: usize,
) -> Result<(), String> {
    let sessions_dir = get_gemini_sessions_dir(project_path)?;

    // Find session file using helper function (handles Gemini's 8-char prefix naming)
    let session_file = find_gemini_session_file(&sessions_dir, session_id)?;

    // Read session JSON
    let content = fs::read_to_string(&session_file)
        .map_err(|e| format!("Failed to read session file: {}", e))?;

    let mut session_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse session JSON: {}", e))?;

    // Get messages array
    let messages = session_data
        .get_mut("messages")
        .and_then(|m| m.as_array_mut())
        .ok_or_else(|| "No messages array found in session".to_string())?;

    // Count user prompts to find truncation point
    // Gemini uses "type" field (not "role"), with values "user" or "gemini"
    let mut user_prompt_count = 0;
    let mut truncate_at_index = messages.len(); // Default: keep all if not found

    for (idx, message) in messages.iter().enumerate() {
        // Fix: Gemini uses "type" field, not "role"
        let msg_type = message.get("type").and_then(|t| t.as_str());
        if msg_type == Some("user") {
            if user_prompt_count == prompt_index {
                // Found the target prompt - truncate AT this index (not after)
                truncate_at_index = idx;
                log::debug!(
                    "[Gemini Rewind] Found prompt #{} at message index {}",
                    prompt_index,
                    idx
                );
                break;
            }
            user_prompt_count += 1;
        }
    }

    log::info!(
        "[Gemini Rewind] Truncating: keeping {} messages (removing from index {})",
        truncate_at_index,
        truncate_at_index
    );

    // Truncate messages array - keep only messages BEFORE the target prompt
    session_data["messages"] =
        serde_json::Value::Array(messages.iter().take(truncate_at_index).cloned().collect());

    // Write back to file
    let new_content = serde_json::to_string_pretty(&session_data)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;

    fs::write(&session_file, new_content)
        .map_err(|e| format!("Failed to write session file: {}", e))?;

    log::info!(
        "[Gemini Rewind] Truncated session to before prompt #{}",
        prompt_index
    );
    Ok(())
}

// ============================================================================
// Revert Operations
// ============================================================================

/// Revert Gemini session to a specific prompt
#[tauri::command]
pub async fn revert_gemini_to_prompt(
    session_id: String,
    project_path: String,
    prompt_index: usize,
    mode: RewindMode,
) -> Result<String, String> {
    log::info!(
        "[Gemini Rewind] Reverting session {} to prompt #{} with mode: {:?}",
        session_id,
        prompt_index,
        mode
    );

    // Load execution config to check if Git operations are disabled
    let execution_config =
        load_execution_config().map_err(|e| format!("Failed to load execution config: {}", e))?;

    let git_operations_disabled = execution_config.disable_rewind_git_operations;

    if git_operations_disabled {
        log::warn!("[Gemini Rewind] Git operations are disabled in config");
    }

    // Extract prompts to validate index and get the prompt text for return
    let prompts = extract_gemini_prompts(&session_id, &project_path)?;
    let prompt = prompts
        .get(prompt_index)
        .ok_or_else(|| format!("Prompt #{} not found in session", prompt_index))?;

    // Load Git records
    let git_records = load_gemini_git_records(&session_id)?;
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
            log::info!("[Gemini Rewind] Reverting conversation only");

            // Truncate session messages
            truncate_gemini_session_to_prompt(&session_id, &project_path, prompt_index)?;

            // Truncate git records
            if !git_operations_disabled {
                truncate_gemini_git_records(&session_id, prompt_index)?;
            }

            log::info!(
                "[Gemini Rewind] Successfully reverted conversation to prompt #{}",
                prompt_index
            );
        }

        RewindMode::CodeOnly => {
            log::info!("[Gemini Rewind] Reverting code to state before prompt #{}", prompt_index);

            // Stash uncommitted changes
            simple_git::git_stash_save(
                &project_path,
                &format!(
                    "Auto-stash before Gemini code revert to prompt #{}",
                    prompt_index
                ),
            )
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

            // Record original HEAD for atomic rollback on failure
            let original_head = simple_git::git_current_commit(&project_path)
                .map_err(|e| format!("Failed to get current commit: {}", e))?;

            log::info!(
                "[Gemini Precise Revert] Original HEAD: {} (will rollback here on failure)",
                &original_head[..8.min(original_head.len())]
            );

            // Load ALL git records for this session
            let all_git_records = load_gemini_git_records(&session_id)?;

            // Filter records for prompt_index and onwards, then sort by index descending
            let mut records_to_revert: Vec<&GeminiPromptGitRecord> = all_git_records
                .records
                .iter()
                .filter(|r| r.prompt_index >= prompt_index)
                .collect();

            // Sort by index descending (newest first) - revert from newest to oldest
            records_to_revert.sort_by(|a, b| b.prompt_index.cmp(&a.prompt_index));

            log::info!(
                "[Gemini Precise Revert] Found {} records to revert (prompts {} and onwards)",
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
                        log::debug!("[Gemini Precise Revert] Skipping prompt #{} - no code changes", record.prompt_index);
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
                            "[Gemini Precise Revert] Failed to check changes for prompt #{}: {}",
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
                        "[Gemini Precise Revert] Skipping prompt #{} - empty commit",
                        record.prompt_index
                    );
                    continue;
                }

                log::info!(
                    "[Gemini Precise Revert] Reverting prompt #{}: {}..{}",
                    record.prompt_index,
                    &record.commit_before[..8.min(record.commit_before.len())],
                    &commit_after[..8.min(commit_after.len())]
                );

                let revert_result = simple_git::git_revert_range_with_retry(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                    &format!("[Gemini Revert] 撤回提示词 #{} 的代码更改", record.prompt_index),
                    3, // Max 3 retries for Git lock conflicts
                );

                match revert_result {
                    Ok(result) if result.success => {
                        total_reverted += result.commits_reverted;
                        log::info!(
                            "[Gemini Precise Revert] Successfully reverted prompt #{} ({} commits)",
                            record.prompt_index,
                            result.commits_reverted
                        );
                    }
                    Ok(result) => {
                        log::warn!(
                            "[Gemini Precise Revert] Revert conflict for prompt #{}: {}",
                            record.prompt_index,
                            result.message
                        );
                        revert_failed = true;
                        failure_message = result.message;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Gemini Precise Revert] Revert failed for prompt #{}: {}", record.prompt_index, e);
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                }
            }

            // If revert failed, rollback to original HEAD (atomic operation)
            if revert_failed {
                log::warn!(
                    "[Gemini Precise Revert] Rolling back to original HEAD {} due to failure",
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
                "[Gemini Rewind] Successfully reverted code to state before prompt #{} (reverted {} commits from {} prompts)",
                prompt_index,
                total_reverted,
                records_to_revert.len()
            );
        }

        RewindMode::Both => {
            log::info!("[Gemini Rewind] Reverting both to state before prompt #{}", prompt_index);

            // Stash uncommitted changes
            simple_git::git_stash_save(
                &project_path,
                &format!(
                    "Auto-stash before Gemini full revert to prompt #{}",
                    prompt_index
                ),
            )
            .map_err(|e| format!("Failed to stash changes: {}", e))?;

            // Record original HEAD for atomic rollback on failure
            let original_head = simple_git::git_current_commit(&project_path)
                .map_err(|e| format!("Failed to get current commit: {}", e))?;

            log::info!(
                "[Gemini Precise Revert] Original HEAD: {} (will rollback here on failure)",
                &original_head[..8.min(original_head.len())]
            );

            // Load ALL git records for this session
            let all_git_records = load_gemini_git_records(&session_id)?;

            // Filter records for prompt_index and onwards, then sort by index descending
            let mut records_to_revert: Vec<&GeminiPromptGitRecord> = all_git_records
                .records
                .iter()
                .filter(|r| r.prompt_index >= prompt_index)
                .collect();

            // Sort by index descending (newest first) - revert from newest to oldest
            records_to_revert.sort_by(|a, b| b.prompt_index.cmp(&a.prompt_index));

            log::info!(
                "[Gemini Precise Revert] Found {} records to revert (prompts {} and onwards)",
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
                        log::debug!("[Gemini Precise Revert] Skipping prompt #{} - no code changes", record.prompt_index);
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
                            "[Gemini Precise Revert] Failed to check changes for prompt #{}: {}",
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
                        "[Gemini Precise Revert] Skipping prompt #{} - empty commit",
                        record.prompt_index
                    );
                    continue;
                }

                log::info!(
                    "[Gemini Precise Revert] Reverting prompt #{}: {}..{}",
                    record.prompt_index,
                    &record.commit_before[..8.min(record.commit_before.len())],
                    &commit_after[..8.min(commit_after.len())]
                );

                let revert_result = simple_git::git_revert_range_with_retry(
                    &project_path,
                    &record.commit_before,
                    &commit_after,
                    &format!("[Gemini Revert] 撤回提示词 #{} 的代码更改", record.prompt_index),
                    3, // Max 3 retries for Git lock conflicts
                );

                match revert_result {
                    Ok(result) if result.success => {
                        total_reverted += result.commits_reverted;
                        log::info!(
                            "[Gemini Precise Revert] Successfully reverted prompt #{} ({} commits)",
                            record.prompt_index,
                            result.commits_reverted
                        );
                    }
                    Ok(result) => {
                        log::warn!(
                            "[Gemini Precise Revert] Revert conflict for prompt #{}: {}",
                            record.prompt_index,
                            result.message
                        );
                        revert_failed = true;
                        failure_message = result.message;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Gemini Precise Revert] Revert failed for prompt #{}: {}", record.prompt_index, e);
                        revert_failed = true;
                        failure_message = e;
                        break;
                    }
                }
            }

            // If revert failed, rollback to original HEAD (atomic operation)
            if revert_failed {
                log::warn!(
                    "[Gemini Precise Revert] Rolling back to original HEAD {} due to failure",
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
                "[Gemini Rewind] Successfully reverted code to state before prompt #{} (reverted {} commits from {} prompts)",
                prompt_index,
                total_reverted,
                records_to_revert.len()
            );

            // Truncate session
            // 🔧 ATOMIC PROTECTION: If session truncation fails, rollback Git changes
            if let Err(e) = truncate_gemini_session_to_prompt(&session_id, &project_path, prompt_index) {
                log::error!(
                    "[Gemini Atomic Rollback] Session truncation failed, rolling back Git: {}",
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
                if let Err(e) = truncate_gemini_git_records(&session_id, prompt_index) {
                    log::error!(
                        "[Gemini Atomic Rollback] Git records truncation failed, rolling back Git: {}",
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
                "✅ [Gemini Atomic Revert] Successfully reverted both to state before prompt #{}",
                prompt_index
            );
        }
    }

    // Return the prompt text for restoring to input (same as Claude's behavior)
    Ok(prompt.text.clone())
}
