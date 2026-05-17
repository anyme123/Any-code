//! Gemini CLI Configuration Management
//!
//! Handles Gemini CLI configuration including authentication methods,
//! model selection, and user preferences.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tokio::sync::OnceCell;

use crate::commands::wsl_utils;

/// 全局 Gemini WSL 模式配置缓存
/// 避免重复创建 WSL 进程检测模式配置
static GEMINI_WSL_MODE_CONFIG_CACHE: OnceCell<GeminiWslModeInfo> = OnceCell::const_new();

// ============================================================================
// Configuration Types
// ============================================================================

/// Gemini authentication method
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GeminiAuthMethod {
    /// Google OAuth login (recommended, free tier)
    GoogleOauth,
    /// Gemini API Key
    ApiKey,
    /// Google Cloud Vertex AI
    VertexAi,
}

impl Default for GeminiAuthMethod {
    fn default() -> Self {
        Self::GoogleOauth
    }
}

/// Gemini CLI configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiConfig {
    /// Authentication method
    #[serde(default)]
    pub auth_method: GeminiAuthMethod,

    /// Default model to use
    #[serde(default = "default_model")]
    pub default_model: String,

    /// Default approval mode
    #[serde(default = "default_approval_mode")]
    pub approval_mode: String,

    /// API key (for ApiKey auth method)
    pub api_key: Option<String>,

    /// Google Cloud Project ID (for Vertex AI)
    pub google_cloud_project: Option<String>,

    /// Custom environment variables
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

fn default_model() -> String {
    "auto-gemini-3".to_string()
}

fn default_approval_mode() -> String {
    "auto_edit".to_string()
}

impl Default for GeminiConfig {
    fn default() -> Self {
        Self {
            auth_method: GeminiAuthMethod::default(),
            default_model: default_model(),
            approval_mode: default_approval_mode(),
            api_key: None,
            google_cloud_project: None,
            env: std::collections::HashMap::new(),
        }
    }
}

// ============================================================================
// Configuration File Operations
// ============================================================================

/// Check if WSL mode should be used for Gemini configuration
/// Returns true if WSL is enabled and has a valid config directory
fn should_use_wsl_config() -> bool {
    let wsl_runtime = wsl_utils::get_gemini_wsl_runtime();
    wsl_runtime.enabled && wsl_runtime.gemini_dir_unc.is_some()
}

/// Get the Gemini configuration directory (~/.gemini)
/// Supports both Native Windows and WSL modes
/// When WSL mode is enabled, returns the WSL UNC path (e.g., \\wsl$\Ubuntu\home\user\.gemini)
/// Otherwise returns the Windows native path (e.g., C:\Users\xxx\.gemini)
pub fn get_gemini_dir() -> Result<PathBuf, String> {
    // Check if WSL mode is enabled
    if should_use_wsl_config() {
        if let Some(wsl_dir) = wsl_utils::get_wsl_gemini_dir() {
            log::info!("[Gemini] Using WSL config directory: {:?}", wsl_dir);
            return Ok(wsl_dir);
        }
    }

    // Fall back to native Windows path
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let native_dir = home.join(".gemini");
    log::debug!("[Gemini] Using native config directory: {:?}", native_dir);
    Ok(native_dir)
}

/// Get the Any Code Gemini configuration path
fn get_anycode_gemini_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    Ok(home.join(".anycode").join("gemini.json"))
}

/// Load Gemini configuration from file
pub fn load_gemini_config() -> Result<GeminiConfig, String> {
    let config_path = get_anycode_gemini_config_path()?;
    // 使用通用配置加载工具
    crate::utils::config_utils::load_json_config(&config_path)
}

/// Save Gemini configuration to file
pub fn save_gemini_config(config: &GeminiConfig) -> Result<(), String> {
    let config_path = get_anycode_gemini_config_path()?;
    // 使用通用配置保存工具
    crate::utils::config_utils::save_json_config(config, &config_path)
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get Gemini configuration
#[tauri::command]
pub async fn get_gemini_config() -> Result<GeminiConfig, String> {
    load_gemini_config()
}

/// Update Gemini configuration
#[tauri::command]
pub async fn update_gemini_config(config: GeminiConfig) -> Result<(), String> {
    save_gemini_config(&config)
}

/// Get available Gemini models and CLI aliases.
/// Updated: May 2026
#[tauri::command]
pub async fn get_gemini_models() -> Result<Vec<GeminiModelInfo>, String> {
    Ok(vec![
        GeminiModelInfo {
            id: "auto-gemini-3".to_string(),
            name: "Auto (Gemini 3)".to_string(),
            description: "Recommended auto routing between Gemini 3 Pro/Flash Preview".to_string(),
            context_window: 1_000_000,
            is_default: true,
        },
        GeminiModelInfo {
            id: "pro".to_string(),
            name: "Pro".to_string(),
            description: "Gemini CLI Pro alias for complex reasoning".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "flash".to_string(),
            name: "Flash".to_string(),
            description: "Gemini CLI Flash alias for fast everyday coding".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "flash-lite".to_string(),
            name: "Flash-Lite".to_string(),
            description: "Gemini CLI Flash-Lite alias for lightweight tasks".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "gemini-3.1-pro-preview".to_string(),
            name: "Gemini 3.1 Pro (Preview)".to_string(),
            description: "Flagship preview model rolling out gradually".to_string(),
            context_window: 2_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "gemini-3-pro-preview".to_string(),
            name: "Gemini 3 Pro (Preview)".to_string(),
            description: "Gemini 3 Pro preview for complex reasoning".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "gemini-3-flash-preview".to_string(),
            name: "Gemini 3 Flash (Preview)".to_string(),
            description: "Gemini 3 fast preview model".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "auto-gemini-2.5".to_string(),
            name: "Auto (Gemini 2.5)".to_string(),
            description: "Stable auto routing between Gemini 2.5 Pro and Flash".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "gemini-2.5-pro".to_string(),
            name: "Gemini 2.5 Pro".to_string(),
            description: "Stable Pro model".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "gemini-2.5-flash".to_string(),
            name: "Gemini 2.5 Flash".to_string(),
            description: "Stable Flash model".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
        GeminiModelInfo {
            id: "gemini-2.5-flash-lite".to_string(),
            name: "Gemini 2.5 Flash-Lite".to_string(),
            description: "Stable lightweight model".to_string(),
            context_window: 1_000_000,
            is_default: false,
        },
    ])
}

/// Gemini model information
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub context_window: u64,
    pub is_default: bool,
}

// ============================================================================
// Environment Variable Helpers
// ============================================================================

/// Build environment variables for Gemini CLI execution
pub fn build_gemini_env(config: &GeminiConfig) -> std::collections::HashMap<String, String> {
    let mut env = config.env.clone();

    // Set authentication environment variables based on auth method
    match config.auth_method {
        GeminiAuthMethod::ApiKey => {
            if let Some(api_key) = &config.api_key {
                env.insert("GEMINI_API_KEY".to_string(), api_key.clone());
            }
        }
        GeminiAuthMethod::VertexAi => {
            if let Some(api_key) = &config.api_key {
                env.insert("GOOGLE_API_KEY".to_string(), api_key.clone());
            }
            if let Some(project) = &config.google_cloud_project {
                env.insert("GOOGLE_CLOUD_PROJECT".to_string(), project.clone());
            }
            env.insert("GOOGLE_GENAI_USE_VERTEXAI".to_string(), "true".to_string());
        }
        GeminiAuthMethod::GoogleOauth => {
            // No additional env vars needed for OAuth
        }
    }

    env
}

// ============================================================================
// Session History Functions
// ============================================================================

use crate::commands::gemini::types::{GeminiSessionDetail, GeminiSessionInfo, GeminiSessionLog};
use sha2::{Digest, Sha256};

/// Generate SHA256 hash for project path (matching Gemini CLI behavior)
pub fn hash_project_path(project_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_path.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Get Gemini session directory for a project
pub fn get_project_session_dir(project_path: &str) -> Result<PathBuf, String> {
    let gemini_dir = get_gemini_dir()?;
    let project_hash = hash_project_path(project_path);
    Ok(gemini_dir.join("tmp").join(project_hash))
}

/// Read logs.json for a project (session index)
pub fn read_session_logs(project_path: &str) -> Result<Vec<GeminiSessionLog>, String> {
    let session_dir = get_project_session_dir(project_path)?;
    let logs_path = session_dir.join("logs.json");

    if !logs_path.exists() {
        return Ok(Vec::new());
    }

    let content =
        fs::read_to_string(&logs_path).map_err(|e| format!("Failed to read logs.json: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse logs.json: {}", e))
}

/// List all session files in chats/ directory
pub fn list_session_files(project_path: &str) -> Result<Vec<GeminiSessionInfo>, String> {
    let session_dir = get_project_session_dir(project_path)?;
    let chats_dir = session_dir.join("chats");

    if !chats_dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        fs::read_dir(&chats_dir).map_err(|e| format!("Failed to read chats directory: {}", e))?;

    let mut sessions = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            // Try to read basic info from file
            if let Ok(detail) = read_session_detail_from_path(&path) {
                let first_message = detail
                    .messages
                    .first()
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());

                // Skip subagent/task sessions - they start with "Your task is to"
                if let Some(ref msg) = first_message {
                    if msg.trim_start().starts_with("Your task is to") {
                        continue;
                    }
                }

                sessions.push(GeminiSessionInfo {
                    session_id: detail.session_id,
                    file_name,
                    start_time: detail.start_time,
                    first_message,
                });
            }
        }
    }

    // Sort by start_time descending (most recent first)
    sessions.sort_by(|a, b| b.start_time.cmp(&a.start_time));

    Ok(sessions)
}

/// Read a complete session detail from chats/session-*.json
pub fn read_session_detail(
    project_path: &str,
    session_id: &str,
) -> Result<GeminiSessionDetail, String> {
    let session_dir = get_project_session_dir(project_path)?;
    let chats_dir = session_dir.join("chats");

    if !chats_dir.exists() {
        return Err("No chats directory found".to_string());
    }

    // Find session file by session_id
    let entries =
        fs::read_dir(&chats_dir).map_err(|e| format!("Failed to read chats directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(detail) = read_session_detail_from_path(&path) {
                if detail.session_id == session_id {
                    return Ok(detail);
                }
            }
        }
    }

    Err(format!("Session {} not found", session_id))
}

/// Helper function to read session detail from a specific file path
fn read_session_detail_from_path(path: &PathBuf) -> Result<GeminiSessionDetail, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse session file: {}", e))
}

// ============================================================================
// Tauri Commands for Session History
// ============================================================================

/// Get session logs for a project
#[tauri::command]
pub async fn get_gemini_session_logs(
    project_path: String,
) -> Result<Vec<GeminiSessionLog>, String> {
    read_session_logs(&project_path)
}

/// List all sessions for a project
#[tauri::command]
pub async fn list_gemini_sessions(project_path: String) -> Result<Vec<GeminiSessionInfo>, String> {
    list_session_files(&project_path)
}

/// Get detailed session information
#[tauri::command]
pub async fn get_gemini_session_detail(
    project_path: String,
    session_id: String,
) -> Result<GeminiSessionDetail, String> {
    read_session_detail(&project_path, &session_id)
}

/// Delete a Gemini session
#[tauri::command]
pub async fn delete_gemini_session(project_path: String, session_id: String) -> Result<(), String> {
    delete_session(&project_path, &session_id)
}

// ============================================================================
// System Prompt (GEMINI.md) Operations
// ============================================================================

/// Reads the GEMINI.md system prompt file from ~/.gemini directory
#[tauri::command]
pub async fn get_gemini_system_prompt() -> Result<String, String> {
    log::info!("Reading GEMINI.md system prompt");

    let gemini_dir = get_gemini_dir()?;
    let gemini_md_path = gemini_dir.join("GEMINI.md");

    if !gemini_md_path.exists() {
        log::warn!("GEMINI.md not found at {:?}", gemini_md_path);
        return Ok(String::new());
    }

    fs::read_to_string(&gemini_md_path).map_err(|e| {
        log::error!("Failed to read GEMINI.md: {}", e);
        format!("读取 GEMINI.md 失败: {}", e)
    })
}

/// Saves the GEMINI.md system prompt file to ~/.gemini directory
#[tauri::command]
pub async fn save_gemini_system_prompt(content: String) -> Result<String, String> {
    log::info!("Saving GEMINI.md system prompt");

    let gemini_dir = get_gemini_dir()?;

    // Ensure directory exists
    if !gemini_dir.exists() {
        fs::create_dir_all(&gemini_dir).map_err(|e| format!("创建 ~/.gemini 目录失败: {}", e))?;
    }

    let gemini_md_path = gemini_dir.join("GEMINI.md");

    fs::write(&gemini_md_path, content).map_err(|e| {
        log::error!("Failed to write GEMINI.md: {}", e);
        format!("保存 GEMINI.md 失败: {}", e)
    })?;

    Ok("Gemini 系统提示词保存成功".to_string())
}

/// Delete a session file by session_id
pub fn delete_session(project_path: &str, session_id: &str) -> Result<(), String> {
    let session_dir = get_project_session_dir(project_path)?;
    let chats_dir = session_dir.join("chats");

    if !chats_dir.exists() {
        return Err("No chats directory found".to_string());
    }

    // Find and delete session file by session_id
    let entries =
        fs::read_dir(&chats_dir).map_err(|e| format!("Failed to read chats directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if let Ok(detail) = read_session_detail_from_path(&path) {
                if detail.session_id == session_id {
                    fs::remove_file(&path)
                        .map_err(|e| format!("Failed to delete session file: {}", e))?;
                    log::info!("Deleted Gemini session: {} at {:?}", session_id, path);
                    return Ok(());
                }
            }
        }
    }

    Err(format!("Session {} not found", session_id))
}

// ============================================================================
// Gemini WSL Configuration Commands
// ============================================================================

/// Gemini WSL mode information for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiWslModeInfo {
    /// Current mode: "auto", "native", or "wsl"
    pub mode: String,
    /// Configured WSL distro (if any)
    pub wsl_distro: Option<String>,
    /// Is WSL available on this system
    pub wsl_available: bool,
    /// Available WSL distros
    pub available_distros: Vec<String>,
    /// Is WSL mode currently active
    pub wsl_enabled: bool,
    /// Gemini path in WSL (if detected)
    pub wsl_gemini_path: Option<String>,
    /// Gemini version in WSL (if detected)
    pub wsl_gemini_version: Option<String>,
    /// Is native Gemini available
    pub native_available: bool,
    /// Whether the current platform is Windows (WSL options are only relevant on Windows)
    pub is_windows: bool,
}

/// Get Gemini WSL mode configuration
/// 使用全局缓存避免重复检测，减少 WSL 进程创建
#[tauri::command]
pub async fn get_gemini_wsl_mode_config() -> Result<GeminiWslModeInfo, String> {
    // 使用缓存避免重复检测
    let result = GEMINI_WSL_MODE_CONFIG_CACHE
        .get_or_init(|| async {
            log::info!("[Gemini] Getting WSL mode configuration (first time)...");
            do_get_gemini_wsl_mode_config()
        })
        .await;

    log::debug!("[Gemini] Returning cached WSL mode config: {:?}", result);
    Ok(result.clone())
}

/// 实际执行 Gemini WSL 模式配置获取（内部函数）
fn do_get_gemini_wsl_mode_config() -> GeminiWslModeInfo {
    let config = wsl_utils::get_gemini_wsl_config();
    let runtime = wsl_utils::get_gemini_wsl_runtime();

    let mode_str = match config.mode {
        wsl_utils::GeminiMode::Auto => "auto",
        wsl_utils::GeminiMode::Native => "native",
        wsl_utils::GeminiMode::Wsl => "wsl",
    };

    let wsl_available = wsl_utils::is_wsl_available();
    let available_distros = wsl_utils::get_wsl_distros();
    let native_available = wsl_utils::is_native_gemini_available();

    let wsl_gemini_version = if runtime.enabled {
        wsl_utils::get_wsl_gemini_version(runtime.distro.as_deref())
    } else {
        None
    };

    #[cfg(target_os = "windows")]
    let is_windows = true;
    #[cfg(not(target_os = "windows"))]
    let is_windows = false;

    GeminiWslModeInfo {
        mode: mode_str.to_string(),
        wsl_distro: config.wsl_distro.clone(),
        wsl_available,
        available_distros,
        wsl_enabled: runtime.enabled,
        wsl_gemini_path: runtime.gemini_path_in_wsl.clone(),
        wsl_gemini_version,
        native_available,
        is_windows,
    }
}

/// Set Gemini WSL mode configuration
#[tauri::command]
pub async fn set_gemini_wsl_mode_config(
    mode: String,
    wsl_distro: Option<String>,
) -> Result<(), String> {
    let gemini_mode = match mode.as_str() {
        "auto" => wsl_utils::GeminiMode::Auto,
        "native" => wsl_utils::GeminiMode::Native,
        "wsl" => wsl_utils::GeminiMode::Wsl,
        _ => {
            return Err(format!(
                "Invalid mode: {}. Must be 'auto', 'native', or 'wsl'",
                mode
            ))
        }
    };

    let config = wsl_utils::GeminiWslConfig {
        mode: gemini_mode,
        wsl_distro,
    };

    wsl_utils::save_gemini_wsl_config(&config)?;

    log::info!(
        "[Gemini WSL] Configuration saved: mode={}, distro={:?}",
        mode,
        config.wsl_distro
    );

    Ok(())
}
