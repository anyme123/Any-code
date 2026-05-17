use dirs;
use rusqlite;
/**
 * Codex Configuration Module
 *
 * Handles configuration operations including:
 * - Codex availability checking
 * - Custom binary path management
 * - Mode configuration (Native/WSL)
 * - Provider management (presets, switching, CRUD)
 */
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::sync::OnceCell;

// Import platform-specific utilities for window hiding
use crate::claude_binary::detect_binary_for_tool;
use crate::commands::claude::apply_no_window_async;
// Import WSL utilities
use super::super::wsl_utils;

// ============================================================================
// Type Definitions
// ============================================================================

/// Codex availability status
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CodexAvailability {
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// 全局 Codex 可用性结果缓存
/// 避免重复创建 WSL 进程检测可用性
static CODEX_AVAILABILITY_CACHE: OnceCell<CodexAvailability> = OnceCell::const_new();

/// 全局 Codex 模式配置缓存
/// 避免重复创建 WSL 进程检测模式配置
static CODEX_MODE_CONFIG_CACHE: OnceCell<CodexModeInfo> = OnceCell::const_new();

/// Codex mode configuration info (for frontend display)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModeInfo {
    /// Currently configured mode
    pub mode: String,
    /// WSL distro (if configured)
    pub wsl_distro: Option<String>,
    /// Actual mode being used (detection result)
    pub actual_mode: String,
    /// Whether native Windows Codex is available
    pub native_available: bool,
    /// Whether WSL Codex is available
    pub wsl_available: bool,
    /// List of available WSL distros
    pub available_distros: Vec<String>,
    /// Whether the current platform is Windows (WSL options are only relevant on Windows)
    pub is_windows: bool,
}

/// Codex provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderConfig {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub website_url: Option<String>,
    pub category: Option<String>,
    pub auth: serde_json::Value, // JSON object for auth.json
    pub config: String,          // TOML string for config.toml
    pub is_official: Option<bool>,
    pub is_partner: Option<bool>,
    pub created_at: Option<i64>,
}

/// Current Codex configuration (from ~/.codex directory)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentCodexConfig {
    pub auth: serde_json::Value,
    pub config: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

// ============================================================================
// Path Utilities
// ============================================================================

pub fn expand_user_path(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return Err("Path is empty".to_string());
    }

    let path = if input == "~" || input.starts_with("~/") {
        let home = dirs::home_dir().ok_or("Cannot find home directory".to_string())?;
        if input == "~" {
            home
        } else {
            home.join(input.trim_start_matches("~/"))
        }
    } else {
        PathBuf::from(input)
    };

    let path = if path.is_relative() {
        std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?
            .join(path)
    } else {
        path
    };

    Ok(path)
}

/// Resolve Windows executable path by trying common extensions
/// This handles cases where users input paths without extensions (e.g., "codex" instead of "codex.cmd")
fn resolve_windows_executable(path: &PathBuf) -> Result<PathBuf, String> {
    // If path exists and is a file, use it directly
    if path.exists() && path.is_file() {
        return Ok(path.clone());
    }

    // On Windows, try common executable extensions
    #[cfg(target_os = "windows")]
    {
        let extensions = [".cmd", ".exe", ".bat", ".ps1"];

        // If the path doesn't have an extension, try adding common ones
        if path.extension().is_none() {
            for ext in &extensions {
                let with_ext = PathBuf::from(format!("{}{}", path.display(), ext));
                if with_ext.exists() && with_ext.is_file() {
                    log::info!(
                        "[Codex] Resolved path with extension: {}",
                        with_ext.display()
                    );
                    return Ok(with_ext);
                }
            }
        }

        // If path is a directory, try to find codex executable inside
        if path.exists() && path.is_dir() {
            for ext in &extensions {
                let candidate = path.join(format!("codex{}", ext));
                if candidate.exists() && candidate.is_file() {
                    log::info!("[Codex] Found codex in directory: {}", candidate.display());
                    return Ok(candidate);
                }
            }
            return Err(format!(
                "Path is a directory but no codex executable found inside: {}",
                path.display()
            ));
        }

        // Path doesn't exist and no extension variant found
        if !path.exists() {
            return Err(format!(
                "File does not exist: {}. On Windows, try specifying the full path with extension (e.g., codex.cmd)",
                path.display()
            ));
        }
    }

    // On non-Windows, just check if path exists
    #[cfg(not(target_os = "windows"))]
    {
        if !path.exists() {
            return Err("File does not exist".to_string());
        }
        if !path.is_file() {
            return Err("Path is not a file".to_string());
        }
    }

    Ok(path.clone())
}

pub fn update_binary_override(tool: &str, override_path: &str) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory".to_string())?;
    let config_path = home.join(".claude").join("binaries.json");

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let mut json: serde_json::Value = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read binaries.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let section = json
        .as_object_mut()
        .ok_or("Invalid binaries.json format (not an object)".to_string())?;

    let entry = section
        .entry(tool.to_string())
        .or_insert_with(|| serde_json::json!({}));

    if let Some(obj) = entry.as_object_mut() {
        obj.insert(
            "override_path".to_string(),
            serde_json::Value::String(override_path.to_string()),
        );
    }

    let serialized = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize binaries.json: {}", e))?;
    std::fs::write(&config_path, serialized)
        .map_err(|e| format!("Failed to write binaries.json: {}", e))?;

    Ok(())
}

pub fn clear_binary_override(tool: &str) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory".to_string())?;
    let config_path = home.join(".claude").join("binaries.json");
    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read binaries.json: {}", e))?;
    let mut json: serde_json::Value =
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}));

    if let Some(section) = json.as_object_mut() {
        if let Some(entry) = section.get_mut(tool) {
            if let Some(obj) = entry.as_object_mut() {
                obj.remove("override_path");
            }
        }
    }

    let serialized = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize binaries.json: {}", e))?;
    std::fs::write(&config_path, serialized)
        .map_err(|e| format!("Failed to write binaries.json: {}", e))?;
    Ok(())
}

pub fn get_binary_override(tool: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".claude").join("binaries.json");
    if !config_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&config_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    json.get(tool)?
        .get("override_path")?
        .as_str()
        .map(|s| s.to_string())
}

// ============================================================================
// Sessions Directory
// ============================================================================

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
// Availability Check
// ============================================================================

/// Checks if Codex is available and properly configured
/// 使用全局缓存避免重复检测，减少 WSL 进程创建
#[tauri::command]
pub async fn check_codex_availability() -> Result<CodexAvailability, String> {
    // 使用缓存避免重复检测
    let result = CODEX_AVAILABILITY_CACHE
        .get_or_init(|| async {
            log::info!("[Codex] Checking availability (first time)...");
            do_check_codex_availability().await
        })
        .await;

    log::debug!("[Codex] Returning cached availability: {:?}", result);
    Ok(result.clone())
}

/// 实际执行 Codex 可用性检测（内部函数）
async fn do_check_codex_availability() -> CodexAvailability {
    // 1) Windows: Check WSL mode first
    #[cfg(target_os = "windows")]
    {
        let wsl_config = wsl_utils::get_wsl_config();
        if wsl_config.enabled {
            if let Some(ref codex_path) = wsl_config.codex_path_in_wsl {
                let version = wsl_utils::get_wsl_codex_version(wsl_config.distro.as_deref())
                    .unwrap_or_else(|| "Unknown version".to_string());

                log::info!(
                    "[Codex] Available in WSL ({:?}) - path: {}, version: {}",
                    wsl_config.distro,
                    codex_path,
                    version
                );

                return CodexAvailability {
                    available: true,
                    version: Some(format!("WSL: {}", version)),
                    error: None,
                };
            }
        }
        log::info!("[Codex] WSL mode not available, trying native paths...");
    }

    // 2) Runtime detection (env vars / PATH / registry / common dirs / user config)
    let (_env_info, detected) = detect_binary_for_tool("codex", "CODEX_PATH", "codex");
    if let Some(inst) = detected {
        let mut cmd = Command::new(&inst.path);
        cmd.arg("--version");
        apply_no_window_async(&mut cmd);

        match cmd.output().await {
            Ok(output) => {
                let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let version = if !stdout_str.is_empty() {
                    stdout_str.clone()
                } else if !stderr_str.is_empty() {
                    stderr_str.clone()
                } else {
                    inst.version
                        .clone()
                        .unwrap_or_else(|| "Unknown version".to_string())
                };

                if output.status.success() {
                    log::info!(
                        "[Codex] Available - path: {}, source: {}, version: {}",
                        inst.path,
                        inst.source,
                        version
                    );
                    return CodexAvailability {
                        available: true,
                        version: Some(version),
                        error: None,
                    };
                } else {
                    log::warn!(
                        "[Codex] Version probe failed for {} (status {:?}), stderr: {}",
                        inst.path,
                        output.status.code(),
                        stderr_str
                    );
                }
            }
            Err(e) => {
                log::warn!(
                    "[Codex] Failed to run version check for {}: {}",
                    inst.path,
                    e
                );
            }
        }
    }

    // 3) Fallback: use legacy candidate list
    let codex_commands = get_codex_command_candidates();
    for cmd_path in codex_commands {
        log::info!("[Codex] Fallback trying: {}", cmd_path);

        let mut cmd = Command::new(&cmd_path);
        cmd.arg("--version");
        apply_no_window_async(&mut cmd);

        match cmd.output().await {
            Ok(output) => {
                let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();

                if output.status.success() {
                    let version = if !stdout_str.is_empty() {
                        stdout_str
                    } else if !stderr_str.is_empty() {
                        stderr_str
                    } else {
                        "Unknown version".to_string()
                    };

                    log::info!("[Codex] Available via fallback - version: {}", version);
                    return CodexAvailability {
                        available: true,
                        version: Some(version),
                        error: None,
                    };
                }
            }
            Err(e) => {
                log::warn!("[Codex] Fallback command '{}' failed: {}", cmd_path, e);
            }
        }
    }

    // 4) Complete failure
    log::error!("[Codex] Codex CLI not found via runtime detection or fallback list");
    CodexAvailability {
        available: false,
        version: None,
        error: Some("Codex CLI not found. Please set CODEX_PATH or install codex CLI".to_string()),
    }
}

// ============================================================================
// Custom Path Management
// ============================================================================

/// Validate Codex CLI path without persisting it
#[tauri::command]
pub async fn validate_codex_path_cmd(path: String) -> Result<bool, String> {
    log::info!("[Codex] Validating path: {}", path);

    let expanded_path = expand_user_path(&path)?;
    let resolved_path = resolve_windows_executable(&expanded_path)?;

    let path_str = resolved_path
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_string();

    let mut cmd = Command::new(&path_str);
    cmd.arg("--version");
    apply_no_window_async(&mut cmd);

    match cmd.output().await {
        Ok(output) => Ok(output.status.success()),
        Err(e) => Err(format!("Failed to test Codex CLI: {}", e)),
    }
}

/// Set custom Codex CLI path, supports ~ expansion and relative paths
#[tauri::command]
pub async fn set_custom_codex_path(app: AppHandle, custom_path: String) -> Result<(), String> {
    log::info!("[Codex] Setting custom path: {}", custom_path);

    let expanded_path = expand_user_path(&custom_path)?;

    // On Windows, try to resolve the executable path with extensions
    let resolved_path = resolve_windows_executable(&expanded_path)?;

    let path_str = resolved_path
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_string();

    let mut cmd = Command::new(&path_str);
    cmd.arg("--version");
    apply_no_window_async(&mut cmd);

    match cmd.output().await {
        Ok(output) => {
            if !output.status.success() {
                return Err("File is not a valid Codex CLI executable".to_string());
            }
        }
        Err(e) => return Err(format!("Failed to test Codex CLI: {}", e)),
    }

    // Write to binaries.json for unified detection
    if let Err(e) = update_binary_override("codex", &path_str) {
        log::warn!("[Codex] Failed to update binaries.json: {}", e);
    }

    // Also store in app_settings for compatibility
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let db_path = app_data_dir.join("agents.db");
        if let Some(parent) = db_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                log::warn!("[Codex] Failed to create app data directory: {}", e);
            }
        }
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = conn.execute(
                "CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )",
                [],
            );
            let _ = conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                rusqlite::params!["codex_binary_path", path_str],
            );
        }
    }

    Ok(())
}

fn read_custom_codex_path_from_db(app: &AppHandle) -> Option<String> {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let db_path = app_data_dir.join("agents.db");
        if db_path.exists() {
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                if let Ok(val) = conn.query_row(
                    "SELECT value FROM app_settings WHERE key = 'codex_binary_path'",
                    [],
                    |row| row.get::<_, String>(0),
                ) {
                    return Some(val);
                }
            }
        }
    }
    None
}

/// Get current Codex path (custom first, then runtime detection)
#[tauri::command]
pub async fn get_codex_path(app: AppHandle) -> Result<String, String> {
    if let Some(override_path) = get_binary_override("codex") {
        return Ok(override_path);
    }
    if let Some(db_path) = read_custom_codex_path_from_db(&app) {
        return Ok(db_path);
    }

    let (_env, detected) = detect_binary_for_tool("codex", "CODEX_PATH", "codex");
    if let Some(inst) = detected {
        return Ok(inst.path);
    }

    Err("Codex CLI not found. Please set CODEX_PATH or install codex CLI".to_string())
}

/// Clear custom Codex path, restore auto detection
#[tauri::command]
pub async fn clear_custom_codex_path(app: AppHandle) -> Result<(), String> {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let db_path = app_data_dir.join("agents.db");
        if db_path.exists() {
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let _ = conn.execute(
                    "DELETE FROM app_settings WHERE key = 'codex_binary_path'",
                    [],
                );
            }
        }
    }

    if let Err(e) = clear_binary_override("codex") {
        log::warn!("[Codex] Failed to clear binaries.json override: {}", e);
    }

    Ok(())
}

// ============================================================================
// Shell Path Utilities (macOS)
// ============================================================================

/// Get the shell's PATH on macOS
/// GUI applications on macOS don't inherit the PATH from shell configuration files
/// This function runs the user's default shell to get the actual PATH
#[cfg(target_os = "macos")]
fn get_shell_path_codex() -> Option<String> {
    use std::process::Command as StdCommand;

    // Get the user's default shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    log::debug!("[Codex] User's default shell: {}", shell);

    // Run shell in login mode to source all profile scripts and get PATH
    let mut cmd = StdCommand::new(&shell);
    cmd.args(["-l", "-c", "echo $PATH"]);

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                log::info!("[Codex] Got shell PATH: {}", path);
                return Some(path);
            }
        }
        Ok(output) => {
            log::debug!(
                "[Codex] Shell command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Err(e) => {
            log::debug!("[Codex] Failed to execute shell: {}", e);
        }
    }

    // Fallback: construct PATH from common locations
    if let Ok(home) = std::env::var("HOME") {
        let common_paths: Vec<String> = vec![
            "/opt/homebrew/bin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/bin".to_string(),
            "/bin".to_string(),
            format!("{}/.local/bin", home),
            format!("{}/.npm-global/bin", home),
            format!("{}/.volta/bin", home),
            format!("{}/.fnm", home),
        ];

        let existing_paths: Vec<&str> = common_paths
            .iter()
            .map(|s| s.as_ref())
            .filter(|p| std::path::Path::new(p).exists())
            .collect();

        if !existing_paths.is_empty() {
            let path = existing_paths.join(":");
            log::info!("[Codex] Constructed fallback PATH: {}", path);
            return Some(path);
        }
    }

    None
}

/// Get npm global prefix directory
#[cfg(target_os = "macos")]
fn get_npm_prefix_codex() -> Option<String> {
    use std::process::Command as StdCommand;

    // Try to run `npm config get prefix`
    let mut cmd = StdCommand::new("npm");
    cmd.args(["config", "get", "prefix"]);

    // Also try with common paths in PATH
    if let Some(shell_path) = get_shell_path_codex() {
        cmd.env("PATH", &shell_path);
    }

    match cmd.output() {
        Ok(output) if output.status.success() => {
            let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !prefix.is_empty() && prefix != "undefined" {
                log::debug!("[Codex] npm prefix: {}", prefix);
                return Some(prefix);
            }
        }
        _ => {}
    }

    // Fallback to common npm prefix locations
    if let Ok(home) = std::env::var("HOME") {
        let common_prefixes = vec![
            format!("{}/.npm-global", home),
            "/usr/local".to_string(),
            "/opt/homebrew".to_string(),
        ];

        for prefix in common_prefixes {
            if std::path::Path::new(&prefix).exists() {
                log::debug!("[Codex] Using fallback npm prefix: {}", prefix);
                return Some(prefix);
            }
        }
    }

    None
}

/// Returns a list of possible Codex command paths to try
pub fn get_codex_command_candidates() -> Vec<String> {
    let mut candidates = vec!["codex".to_string()];

    // Windows: npm global install paths
    #[cfg(target_os = "windows")]
    {
        // npm global install path (APPDATA - standard location)
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(format!(r"{}\npm\codex.cmd", appdata));
            candidates.push(format!(r"{}\npm\codex", appdata));
            // nvm-windows installed Node.js versions
            let nvm_dir = format!(r"{}\nvm", appdata);
            if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let codex_path = entry.path().join("codex.cmd");
                        if codex_path.exists() {
                            candidates.push(codex_path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }

        // npm global install path (LOCALAPPDATA)
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!(r"{}\npm\codex.cmd", localappdata));
            candidates.push(format!(r"{}\npm\codex", localappdata));
            // pnpm global install path
            candidates.push(format!(r"{}\pnpm\codex.cmd", localappdata));
            candidates.push(format!(r"{}\pnpm\codex", localappdata));
            // Yarn global install path
            candidates.push(format!(r"{}\Yarn\bin\codex.cmd", localappdata));
            candidates.push(format!(r"{}\Yarn\bin\codex", localappdata));
        }

        // User directory install paths
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            // Custom npm global directory
            candidates.push(format!(r"{}\.npm-global\bin\codex.cmd", userprofile));
            candidates.push(format!(r"{}\.npm-global\bin\codex", userprofile));
            // Volta install path
            candidates.push(format!(r"{}\.volta\bin\codex.cmd", userprofile));
            candidates.push(format!(r"{}\.volta\bin\codex", userprofile));
            // fnm install path
            candidates.push(format!(r"{}\.fnm\aliases\default\codex.cmd", userprofile));
            // Scoop install path
            candidates.push(format!(r"{}\scoop\shims\codex.cmd", userprofile));
            candidates.push(format!(
                r"{}\scoop\apps\nodejs\current\codex.cmd",
                userprofile
            ));
            // Local bin directory
            candidates.push(format!(r"{}\.local\bin\codex.cmd", userprofile));
            candidates.push(format!(r"{}\.local\bin\codex", userprofile));
        }

        // Node.js install path
        if let Ok(programfiles) = std::env::var("ProgramFiles") {
            candidates.push(format!(r"{}\nodejs\codex.cmd", programfiles));
            candidates.push(format!(r"{}\nodejs\codex", programfiles));
        }

        // Chocolatey install path
        if let Ok(programdata) = std::env::var("ProgramData") {
            candidates.push(format!(r"{}\chocolatey\bin\codex.cmd", programdata));
            candidates.push(format!(r"{}\chocolatey\bin\codex", programdata));
        }
    }

    // macOS-specific paths
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            // npm global install paths
            candidates.push(format!("{}/.npm-global/bin/codex", home));
            candidates.push(format!("{}/.npm/bin/codex", home));
            candidates.push(format!("{}/npm/bin/codex", home));

            // pnpm global paths
            candidates.push(format!("{}/Library/pnpm/codex", home));
            candidates.push(format!("{}/.local/share/pnpm/codex", home));
            candidates.push(format!("{}/.pnpm-global/bin/codex", home));

            // Node version managers
            candidates.push(format!("{}/.volta/bin/codex", home));
            candidates.push(format!("{}/.n/bin/codex", home));
            candidates.push(format!("{}/.asdf/shims/codex", home));
            candidates.push(format!("{}/.local/bin/codex", home));

            // fnm (Fast Node Manager) paths
            candidates.push(format!("{}/.fnm/aliases/default/bin/codex", home));
            candidates.push(format!(
                "{}/.local/share/fnm/aliases/default/bin/codex",
                home
            ));
            candidates.push(format!(
                "{}/Library/Application Support/fnm/aliases/default/bin/codex",
                home
            ));

            // nvm current symlink
            candidates.push(format!("{}/.nvm/current/bin/codex", home));

            // Dynamically add npm prefix path
            if let Some(npm_prefix) = get_npm_prefix_codex() {
                let npm_bin_path = format!("{}/bin/codex", npm_prefix);
                if !candidates.contains(&npm_bin_path) {
                    log::debug!("[Codex] Adding npm prefix path: {}", npm_bin_path);
                    candidates.push(npm_bin_path);
                }
            }

            // Scan nvm node version directories
            let nvm_versions_dir = format!("{}/.nvm/versions/node", home);
            if let Ok(entries) = std::fs::read_dir(&nvm_versions_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let codex_path = entry.path().join("bin").join("codex");
                        if codex_path.exists() {
                            candidates.push(codex_path.to_string_lossy().to_string());
                        }
                    }
                }
            }

            // Scan fnm node version directories
            for fnm_base in &[
                format!("{}/.fnm/node-versions", home),
                format!("{}/.local/share/fnm/node-versions", home),
                format!("{}/Library/Application Support/fnm/node-versions", home),
            ] {
                if let Ok(entries) = std::fs::read_dir(fnm_base) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            let codex_path =
                                entry.path().join("installation").join("bin").join("codex");
                            if codex_path.exists() {
                                candidates.push(codex_path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }

        // Homebrew paths (Apple Silicon and Intel)
        candidates.push("/opt/homebrew/bin/codex".to_string()); // Apple Silicon (M1/M2/M3)
        candidates.push("/usr/local/bin/codex".to_string()); // Intel Mac / Homebrew legacy

        // NPM global lib paths
        candidates.push("/opt/homebrew/lib/node_modules/@openai/codex/bin/codex".to_string());
        candidates.push("/usr/local/lib/node_modules/@openai/codex/bin/codex".to_string());

        // MacPorts
        candidates.push("/opt/local/bin/codex".to_string());
    }

    // Linux: npm global paths
    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(format!("{}/.npm-global/bin/codex", home));
            candidates.push(format!("{}/.local/bin/codex", home));
            candidates.push(format!("{}/.volta/bin/codex", home));
            candidates.push(format!("{}/.asdf/shims/codex", home));
            candidates.push(format!("{}/.nvm/current/bin/codex", home));
        }
        candidates.push("/usr/local/bin/codex".to_string());
        candidates.push("/usr/bin/codex".to_string());
    }

    candidates
}

// ============================================================================
// Mode Configuration API
// ============================================================================

/// Get Codex mode configuration
/// 使用全局缓存避免重复检测，减少 WSL 进程创建
#[tauri::command]
pub async fn get_codex_mode_config() -> Result<CodexModeInfo, String> {
    // 使用缓存避免重复检测
    let result = CODEX_MODE_CONFIG_CACHE
        .get_or_init(|| async {
            log::info!("[Codex] Getting mode configuration (first time)...");
            do_get_codex_mode_config()
        })
        .await;

    log::debug!("[Codex] Returning cached mode config: {:?}", result);
    Ok(result.clone())
}

/// 实际执行 Codex 模式配置获取（内部函数）
fn do_get_codex_mode_config() -> CodexModeInfo {
    let config = wsl_utils::get_codex_config();
    let wsl_config = wsl_utils::get_wsl_config();

    // Check availability
    #[cfg(target_os = "windows")]
    let (native_available, wsl_available, available_distros, is_windows) = {
        let native = wsl_utils::is_native_codex_available();
        let distros = wsl_utils::get_wsl_distros();
        // 可用性检查需要与用户选择的 distro 保持一致，避免默认发行版导致的误判
        let wsl = !distros.is_empty()
            && wsl_utils::check_wsl_codex(config.wsl_distro.as_deref()).is_some();
        (native, wsl, distros, true)
    };

    #[cfg(not(target_os = "windows"))]
    let (native_available, wsl_available, available_distros, is_windows) =
        (true, false, vec![], false);

    let mode_str = match config.mode {
        wsl_utils::CodexMode::Auto => "auto",
        wsl_utils::CodexMode::Native => "native",
        wsl_utils::CodexMode::Wsl => "wsl",
    };

    let actual_mode = if wsl_config.enabled { "wsl" } else { "native" };

    CodexModeInfo {
        mode: mode_str.to_string(),
        wsl_distro: config.wsl_distro.clone(),
        actual_mode: actual_mode.to_string(),
        native_available,
        wsl_available,
        available_distros,
        is_windows,
    }
}

/// Set Codex mode configuration
#[tauri::command]
pub async fn set_codex_mode_config(
    mode: String,
    wsl_distro: Option<String>,
) -> Result<String, String> {
    log::info!(
        "[Codex] Setting mode configuration: mode={}, wsl_distro={:?}",
        mode,
        wsl_distro
    );

    let codex_mode = match mode.to_lowercase().as_str() {
        "auto" => wsl_utils::CodexMode::Auto,
        "native" => wsl_utils::CodexMode::Native,
        "wsl" => wsl_utils::CodexMode::Wsl,
        _ => {
            return Err(format!(
                "Invalid mode: {}. Use 'auto', 'native', or 'wsl'",
                mode
            ))
        }
    };

    let config = wsl_utils::CodexConfig {
        mode: codex_mode,
        wsl_distro,
    };

    wsl_utils::save_codex_config(&config)?;

    Ok(
        "Configuration saved. Would you like to restart the app for changes to take effect?"
            .to_string(),
    )
}

// ============================================================================
// Provider Configuration Paths
// ============================================================================

/// Check if WSL mode should be used for Codex configuration
/// Returns true if WSL is enabled and has a valid config directory
fn should_use_wsl_config() -> bool {
    let wsl_config = wsl_utils::get_wsl_config();
    wsl_config.enabled && wsl_config.codex_dir_unc.is_some()
}

/// Get Codex config directory path (supports both Native and WSL modes)
/// When WSL mode is enabled, returns the WSL UNC path (e.g., \\wsl$\Ubuntu\home\user\.codex)
/// Otherwise returns the Windows native path (e.g., C:\Users\xxx\.codex)
fn get_codex_config_dir() -> Result<PathBuf, String> {
    // Check if WSL mode is enabled
    if should_use_wsl_config() {
        if let Some(wsl_dir) = wsl_utils::get_wsl_codex_dir() {
            log::info!("[Codex Provider] Using WSL config directory: {:?}", wsl_dir);
            return Ok(wsl_dir);
        }
    }

    // Fall back to native Windows path
    let home_dir = dirs::home_dir().ok_or_else(|| "Cannot get home directory".to_string())?;
    let native_dir = home_dir.join(".codex");
    log::debug!(
        "[Codex Provider] Using native config directory: {:?}",
        native_dir
    );
    Ok(native_dir)
}

/// Get Codex auth.json path
fn get_codex_auth_path() -> Result<PathBuf, String> {
    Ok(get_codex_config_dir()?.join("auth.json"))
}

/// Get Codex config.toml path
fn get_codex_config_path() -> Result<PathBuf, String> {
    Ok(get_codex_config_dir()?.join("config.toml"))
}

/// Get Codex providers.json path (for custom presets)
/// Note: Providers are stored in native Windows path, not WSL
/// because they are managed by Workbench, not by Codex CLI
fn get_codex_providers_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Cannot get home directory".to_string())?;
    Ok(home_dir.join(".codex").join("providers.json"))
}

/// Extract API key from auth JSON
fn extract_api_key_from_auth(auth: &serde_json::Value) -> Option<String> {
    auth.get("OPENAI_API_KEY")
        .or_else(|| auth.get("OPENAI_KEY"))
        .or_else(|| auth.get("API_KEY"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract base_url from config.toml text
fn extract_base_url_from_config(config: &str) -> Option<String> {
    let re = regex::Regex::new(r#"base_url\s*=\s*"([^"]+)""#).ok()?;
    re.captures(config)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract model from config.toml text
fn extract_model_from_config(config: &str) -> Option<String> {
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("model =") {
            let re = regex::Regex::new(r#"model\s*=\s*"([^"]+)""#).ok()?;
            return re
                .captures(trimmed)
                .and_then(|caps| caps.get(1))
                .map(|m| m.as_str().to_string());
        }
    }
    None
}

// ============================================================================
// Provider Management Commands
// ============================================================================

/// Get Codex provider presets (custom user-defined presets)
#[tauri::command]
pub async fn get_codex_provider_presets() -> Result<Vec<CodexProviderConfig>, String> {
    log::info!("[Codex Provider] Getting provider presets");

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;

    let providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    Ok(providers)
}

/// Get current Codex configuration
/// Supports both Native Windows and WSL modes
#[tauri::command]
pub async fn get_current_codex_config() -> Result<CurrentCodexConfig, String> {
    let is_wsl_mode = should_use_wsl_config();
    log::info!(
        "[Codex Provider] Getting current config (WSL mode: {})",
        is_wsl_mode
    );

    let auth_path = get_codex_auth_path()?;
    let config_path = get_codex_config_path()?;

    log::debug!("[Codex Provider] Auth path: {:?}", auth_path);
    log::debug!("[Codex Provider] Config path: {:?}", config_path);

    // Read auth.json
    let auth: serde_json::Value = if auth_path.exists() {
        let content = fs::read_to_string(&auth_path)
            .map_err(|e| format!("Failed to read auth.json: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse auth.json: {}", e))?
    } else {
        serde_json::json!({})
    };

    // Read config.toml
    let config: String = if config_path.exists() {
        fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?
    } else {
        String::new()
    };

    // Extract values
    let api_key = extract_api_key_from_auth(&auth);
    let base_url = extract_base_url_from_config(&config);
    let model = extract_model_from_config(&config);

    Ok(CurrentCodexConfig {
        auth,
        config,
        api_key,
        base_url,
        model,
    })
}

/// Switch to a Codex provider configuration
/// Preserves user's custom settings and OAuth tokens
/// Supports both Native Windows and WSL modes
#[tauri::command]
pub async fn switch_codex_provider(config: CodexProviderConfig) -> Result<String, String> {
    log::info!("[Codex Provider] Switching to provider: {}", config.name);

    let is_wsl_mode = should_use_wsl_config();
    log::info!("[Codex Provider] WSL mode: {}", is_wsl_mode);

    let config_dir = get_codex_config_dir()?;
    let auth_path = get_codex_auth_path()?;
    let config_path = get_codex_config_path()?;

    log::info!("[Codex Provider] Config directory: {:?}", config_dir);
    log::info!("[Codex Provider] Auth path: {:?}", auth_path);
    log::info!("[Codex Provider] Config path: {:?}", config_path);

    // Ensure config directory exists
    if !config_dir.exists() {
        log::info!(
            "[Codex Provider] Creating config directory: {:?}",
            config_dir
        );
        fs::create_dir_all(&config_dir).map_err(|e| {
            format!(
                "Failed to create .codex directory at {:?}: {}",
                config_dir, e
            )
        })?;
    }

    // Validate new TOML if not empty
    let new_config_table: Option<toml::Table> = if !config.config.trim().is_empty() {
        Some(
            toml::from_str(&config.config)
                .map_err(|e| format!("Invalid TOML configuration: {}", e))?,
        )
    } else {
        None
    };

    // Merge auth.json - preserve existing OAuth tokens and other credentials
    // API key related fields that should be cleared when switching to official auth
    let api_key_fields = ["OPENAI_API_KEY", "OPENAI_KEY", "API_KEY"];

    let final_auth = if auth_path.exists() {
        let existing_content = fs::read_to_string(&auth_path)
            .map_err(|e| format!("Failed to read existing auth.json: {}", e))?;

        if let Ok(mut existing_auth) =
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&existing_content)
        {
            // Merge new auth into existing - new values take precedence
            if let serde_json::Value::Object(new_auth_map) = serde_json::to_value(&config.auth)
                .map_err(|e| format!("Failed to convert auth: {}", e))?
            {
                // Check if new auth has any API key set (non-empty value)
                let new_auth_has_api_key = api_key_fields.iter().any(|key| {
                    new_auth_map.get(*key).map_or(false, |v| {
                        !v.is_null() && v != &serde_json::Value::String(String::new())
                    })
                });

                // If new auth doesn't have API key (e.g., switching to official OAuth),
                // clear existing API key fields to avoid using stale credentials
                if !new_auth_has_api_key {
                    for key in &api_key_fields {
                        existing_auth.remove(*key);
                    }
                    log::info!("[Codex Provider] Cleared API key fields for official auth mode");
                }

                for (key, value) in new_auth_map {
                    // Only update if the new value is not empty/null
                    if !value.is_null() && value != serde_json::Value::String(String::new()) {
                        existing_auth.insert(key, value);
                    }
                }
            }
            serde_json::Value::Object(existing_auth)
        } else {
            // Existing auth is invalid, use new auth directly
            serde_json::to_value(&config.auth)
                .map_err(|e| format!("Failed to convert auth: {}", e))?
        }
    } else {
        // No existing auth, use new auth directly
        serde_json::to_value(&config.auth).map_err(|e| format!("Failed to convert auth: {}", e))?
    };

    // Write merged auth.json
    let auth_content = serde_json::to_string_pretty(&final_auth)
        .map_err(|e| format!("Failed to serialize auth: {}", e))?;
    fs::write(&auth_path, auth_content).map_err(|e| format!("Failed to write auth.json: {}", e))?;

    // Merge config.toml - preserve user's custom settings
    let final_config = if config_path.exists() {
        let existing_content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read existing config.toml: {}", e))?;

        if let Ok(mut existing_table) = toml::from_str::<toml::Table>(&existing_content) {
            // Provider-specific keys that will be overwritten
            let provider_keys = [
                "model_provider",
                "model",
                "model_providers",
                "model_reasoning_effort",
                "plan_mode_reasoning_effort",
                "model_verbosity",
                "service_tier",
                "model_catalog_json",
            ];

            if let Some(new_table) = new_config_table {
                // Remove provider-specific keys from existing config
                for key in &provider_keys {
                    existing_table.remove(*key);
                }

                // Merge: new provider settings take precedence
                for (key, value) in new_table {
                    existing_table.insert(key, value);
                }

                // Serialize back to TOML string
                toml::to_string_pretty(&existing_table)
                    .map_err(|e| format!("Failed to serialize merged config: {}", e))?
            } else {
                // New config is empty (official OpenAI), just remove provider keys
                for key in &provider_keys {
                    existing_table.remove(*key);
                }
                toml::to_string_pretty(&existing_table)
                    .map_err(|e| format!("Failed to serialize config: {}", e))?
            }
        } else {
            // Existing config is invalid, use new config directly
            config.config.clone()
        }
    } else {
        // No existing config, use new config directly
        config.config.clone()
    };

    // Write merged config.toml
    fs::write(&config_path, &final_config)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log::info!("[Codex Provider] Successfully switched to: {}", config.name);

    // Return success message with mode info
    let mode_info = if is_wsl_mode { " (WSL)" } else { "" };
    Ok(format!(
        "Successfully switched to Codex provider: {}{}",
        config.name, mode_info
    ))
}

/// Add a new Codex provider configuration
#[tauri::command]
pub async fn add_codex_provider_config(config: CodexProviderConfig) -> Result<String, String> {
    log::info!("[Codex Provider] Adding provider: {}", config.name);

    let providers_path = get_codex_providers_path()?;

    // Ensure parent directory exists
    if let Some(parent) = providers_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    // Load existing providers
    let mut providers: Vec<CodexProviderConfig> = if providers_path.exists() {
        let content = fs::read_to_string(&providers_path)
            .map_err(|e| format!("Failed to read providers.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };

    // Check for duplicate ID
    if providers.iter().any(|p| p.id == config.id) {
        return Err(format!("Provider with ID '{}' already exists", config.id));
    }

    providers.push(config.clone());

    // Save providers
    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!(
        "[Codex Provider] Successfully added provider: {}",
        config.name
    );
    Ok(format!(
        "Successfully added Codex provider: {}",
        config.name
    ))
}

/// Update an existing Codex provider configuration
#[tauri::command]
pub async fn update_codex_provider_config(config: CodexProviderConfig) -> Result<String, String> {
    log::info!("[Codex Provider] Updating provider: {}", config.name);

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Err(format!("Provider with ID '{}' not found", config.id));
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let mut providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    // Find and update the provider
    let index = providers
        .iter()
        .position(|p| p.id == config.id)
        .ok_or_else(|| format!("Provider with ID '{}' not found", config.id))?;

    providers[index] = config.clone();

    // Save providers
    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!(
        "[Codex Provider] Successfully updated provider: {}",
        config.name
    );
    Ok(format!(
        "Successfully updated Codex provider: {}",
        config.name
    ))
}

/// Delete a Codex provider configuration
#[tauri::command]
pub async fn delete_codex_provider_config(id: String) -> Result<String, String> {
    log::info!("[Codex Provider] Deleting provider: {}", id);

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Err(format!("Provider with ID '{}' not found", id));
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let mut providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    // Find and remove the provider
    let initial_len = providers.len();
    providers.retain(|p| p.id != id);

    if providers.len() == initial_len {
        return Err(format!("Provider with ID '{}' not found", id));
    }

    // Save providers
    let content = serde_json::to_string_pretty(&providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!("[Codex Provider] Successfully deleted provider: {}", id);
    Ok(format!("Successfully deleted Codex provider: {}", id))
}

/// Reorder Codex provider configurations
#[tauri::command]
pub async fn reorder_codex_provider_configs(ids: Vec<String>) -> Result<String, String> {
    log::info!("[Codex Provider] Reordering providers");

    let providers_path = get_codex_providers_path()?;

    if !providers_path.exists() {
        return Ok("No providers to reorder".to_string());
    }

    let content = fs::read_to_string(&providers_path)
        .map_err(|e| format!("Failed to read providers.json: {}", e))?;
    let providers: Vec<CodexProviderConfig> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse providers.json: {}", e))?;

    // Reorder based on provided IDs
    let mut reordered: Vec<CodexProviderConfig> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(provider) = providers.iter().find(|p| &p.id == id) {
            reordered.push(provider.clone());
        }
    }

    // Add any providers not in the ids list (keep original order)
    for provider in providers {
        if !ids.contains(&provider.id) {
            reordered.push(provider);
        }
    }

    // Save providers
    let content = serde_json::to_string_pretty(&reordered)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(&providers_path, content)
        .map_err(|e| format!("Failed to write providers.json: {}", e))?;

    log::info!("[Codex Provider] Successfully reordered providers");
    Ok("Successfully reordered Codex providers".to_string())
}

/// Clear Codex provider configuration (reset to official)
#[tauri::command]
pub async fn clear_codex_provider_config() -> Result<String, String> {
    log::info!("[Codex Provider] Clearing config");

    let auth_path = get_codex_auth_path()?;
    let config_path = get_codex_config_path()?;

    // Remove auth.json if exists
    if auth_path.exists() {
        fs::remove_file(&auth_path).map_err(|e| format!("Failed to remove auth.json: {}", e))?;
    }

    // Remove config.toml if exists
    if config_path.exists() {
        fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config.toml: {}", e))?;
    }

    log::info!("[Codex Provider] Successfully cleared config");
    Ok("Successfully cleared Codex configuration. Now using official OpenAI.".to_string())
}

/// Test Codex provider connection
#[tauri::command]
pub async fn test_codex_provider_connection(
    base_url: String,
    api_key: Option<String>,
) -> Result<String, String> {
    log::info!("[Codex Provider] Testing connection to: {}", base_url);

    // Simple connectivity test - just try to reach the endpoint
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let test_url = format!("{}/models", base_url.trim_end_matches('/'));

    let mut request = client.get(&test_url);

    if let Some(key) = api_key {
        request = request.header("Authorization", format!("Bearer {}", key));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() || status.as_u16() == 401 {
                // 401 means the endpoint exists but auth is required
                Ok(format!(
                    "Connection test successful: endpoint is reachable (status: {})",
                    status
                ))
            } else {
                Ok(format!("Connection test completed with status: {}", status))
            }
        }
        Err(e) => Err(format!("Connection test failed: {}", e)),
    }
}

/// Update Codex reasoning effort level in config.toml
/// This updates the model_reasoning_effort field in ~/.codex/config.toml
/// Supports both Native Windows and WSL modes
#[tauri::command]
pub async fn update_codex_reasoning_level(level: String) -> Result<String, String> {
    log::info!("[Codex] Updating reasoning level to: {}", level);

    // Validate level
    // Note: 'xhigh' is used in config.toml for extra high reasoning level
    let valid_levels = ["minimal", "low", "medium", "high", "xhigh"];
    if !valid_levels.contains(&level.as_str()) {
        return Err(format!(
            "Invalid reasoning level: {}. Valid values are: minimal, low, medium, high, xhigh",
            level
        ));
    }

    let is_wsl_mode = should_use_wsl_config();
    log::info!("[Codex] WSL mode: {}", is_wsl_mode);

    let config_dir = get_codex_config_dir()?;
    let config_path = get_codex_config_path()?;

    log::info!("[Codex] Config directory: {:?}", config_dir);
    log::info!("[Codex] Config path: {:?}", config_path);

    // Ensure config directory exists
    if !config_dir.exists() {
        log::info!("[Codex] Creating config directory: {:?}", config_dir);
        fs::create_dir_all(&config_dir).map_err(|e| {
            format!(
                "Failed to create .codex directory at {:?}: {}",
                config_dir, e
            )
        })?;
    }

    // Read existing config or create new one
    let mut config_table: toml::Table = if config_path.exists() {
        let existing_content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?;
        toml::from_str(&existing_content).unwrap_or_else(|_| toml::Table::new())
    } else {
        toml::Table::new()
    };

    // Update reasoning level
    config_table.insert(
        "model_reasoning_effort".to_string(),
        toml::Value::String(level.clone()),
    );

    // Write back to config.toml
    let final_config = toml::to_string_pretty(&config_table)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, &final_config)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log::info!("[Codex] Successfully updated reasoning level to: {}", level);

    let mode_info = if is_wsl_mode { " (WSL)" } else { "" };
    Ok(format!(
        "Successfully updated reasoning level to: {}{}",
        level, mode_info
    ))
}

// ============================================================================
// Multi-Agent Configuration (Experimental)
// ============================================================================

/// Multi-agent feature configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMultiAgentConfig {
    pub enabled: bool,
    pub subagent_model: Option<String>,
    pub subagent_reasoning_effort: Option<String>,
}

/// Get Codex multi-agent configuration from config.toml [features] section
#[tauri::command]
pub async fn get_codex_multi_agent_config() -> Result<CodexMultiAgentConfig, String> {
    log::info!("[Codex] Getting multi-agent configuration");

    let config_path = get_codex_config_path()?;

    if !config_path.exists() {
        return Ok(CodexMultiAgentConfig {
            enabled: false,
            subagent_model: None,
            subagent_reasoning_effort: None,
        });
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.toml: {}", e))?;
    let config_table: toml::Table = toml::from_str(&content).unwrap_or_else(|_| toml::Table::new());

    let enabled = config_table
        .get("features")
        .and_then(|f| f.as_table())
        .and_then(|t| t.get("multi_agent"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let subagent_model = config_table
        .get("features")
        .and_then(|f| f.as_table())
        .and_then(|t| t.get("subagent_model"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let subagent_reasoning_effort = config_table
        .get("features")
        .and_then(|f| f.as_table())
        .and_then(|t| t.get("subagent_reasoning_effort"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(CodexMultiAgentConfig {
        enabled,
        subagent_model,
        subagent_reasoning_effort,
    })
}

/// Set Codex multi-agent configuration in config.toml [features] section
#[tauri::command]
pub async fn set_codex_multi_agent_config(config: CodexMultiAgentConfig) -> Result<String, String> {
    log::info!(
        "[Codex] Setting multi-agent config: enabled={}",
        config.enabled
    );

    let config_dir = get_codex_config_dir()?;
    let config_path = get_codex_config_path()?;

    // Ensure config directory exists
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create .codex directory: {}", e))?;
    }

    // Read existing config
    let mut config_table: toml::Table = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config.toml: {}", e))?;
        toml::from_str(&content).unwrap_or_else(|_| toml::Table::new())
    } else {
        toml::Table::new()
    };

    // Update [features] section
    let features = config_table
        .entry("features".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));

    if let Some(features_table) = features.as_table_mut() {
        features_table.insert(
            "multi_agent".to_string(),
            toml::Value::Boolean(config.enabled),
        );

        if let Some(model) = &config.subagent_model {
            features_table.insert(
                "subagent_model".to_string(),
                toml::Value::String(model.clone()),
            );
        } else {
            features_table.remove("subagent_model");
        }

        if let Some(effort) = &config.subagent_reasoning_effort {
            features_table.insert(
                "subagent_reasoning_effort".to_string(),
                toml::Value::String(effort.clone()),
            );
        } else {
            features_table.remove("subagent_reasoning_effort");
        }
    }

    // Write back
    let final_config = toml::to_string_pretty(&config_table)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, &final_config)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    log::info!("[Codex] Multi-agent config updated successfully");
    Ok(format!(
        "Multi-agent {} successfully",
        if config.enabled {
            "enabled"
        } else {
            "disabled"
        }
    ))
}
