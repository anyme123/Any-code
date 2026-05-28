use anyhow::Result;
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::claude::get_claude_dir;

/// Represents a Plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    /// Plugin name
    pub name: String,
    /// Plugin description
    pub description: Option<String>,
    /// Plugin version
    pub version: String,
    /// Author information
    pub author: Option<String>,
    /// Marketplace source
    pub marketplace: Option<String>,
    /// Plugin directory path
    pub path: String,
    /// Whether plugin is enabled
    pub enabled: bool,
    /// Components count
    pub components: PluginComponents,
}

/// Simple component item (command, skill, agent)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginComponentItem {
    /// Component name
    pub name: String,
    /// Component description
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginComponents {
    pub commands: usize,
    pub agents: usize,
    pub skills: usize,
    pub hooks: usize,
    pub mcp_servers: usize,
    /// Detailed command list
    #[serde(default)]
    pub command_list: Vec<PluginComponentItem>,
    /// Detailed skill list
    #[serde(default)]
    pub skill_list: Vec<PluginComponentItem>,
    /// Detailed agent list
    #[serde(default)]
    pub agent_list: Vec<PluginComponentItem>,
}

/// Represents a Subagent file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentFile {
    /// Agent name (file name without extension)
    pub name: String,
    /// Full file path
    pub path: String,
    /// Scope: "project" or "user"
    pub scope: String,
    /// Description from frontmatter or first line
    pub description: Option<String>,
    /// File content
    pub content: String,
}

/// Represents an Agent Skill file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillFile {
    /// Skill name (file name without SKILL.md)
    pub name: String,
    /// Full file path
    pub path: String,
    /// Scope: "project" or "user"
    pub scope: String,
    /// Description from frontmatter or first line
    pub description: Option<String>,
    /// File content
    pub content: String,
}

/// Parse YAML frontmatter if present
fn parse_description_from_content(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();

    // Check for YAML frontmatter
    if lines.len() > 2 && lines[0] == "---" {
        for line in lines.iter().skip(1) {
            if *line == "---" {
                // Found end of frontmatter
                break;
            }
            if line.starts_with("description:") {
                return Some(line.trim_start_matches("description:").trim().to_string());
            }
        }
    }

    // Fallback: use first non-empty line as description
    lines
        .iter()
        .find(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .map(|line| line.trim().to_string())
}

/// List all subagents in project and user directories
#[tauri::command]
pub async fn list_subagents(project_path: Option<String>) -> Result<Vec<SubagentFile>, String> {
    info!("Listing subagents");
    let mut agents = Vec::new();

    // User-level agents (~/.claude/agents/)
    if let Ok(claude_dir) = get_claude_dir() {
        let user_agents_dir = claude_dir.join("agents");
        if user_agents_dir.exists() {
            agents.extend(scan_agents_directory(&user_agents_dir, "user")?);
        }
    }

    // Project-level agents (.claude/agents/)
    if let Some(proj_path) = project_path {
        let project_agents_dir = Path::new(&proj_path).join(".claude").join("agents");
        if project_agents_dir.exists() {
            agents.extend(scan_agents_directory(&project_agents_dir, "project")?);
        }
    }

    Ok(agents)
}

/// Scan agents directory for .md files
fn scan_agents_directory(dir: &Path, scope: &str) -> Result<Vec<SubagentFile>, String> {
    let mut agents = Vec::new();

    for entry in WalkDir::new(dir)
        .max_depth(2) // Limit depth
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Only process .md files
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Read file content
        match fs::read_to_string(path) {
            Ok(content) => {
                let description = parse_description_from_content(&content);

                agents.push(SubagentFile {
                    name,
                    path: path.to_string_lossy().to_string(),
                    scope: scope.to_string(),
                    description,
                    content,
                });
            }
            Err(e) => {
                debug!("Failed to read agent file {:?}: {}", path, e);
            }
        }
    }

    Ok(agents)
}

/// List all Agent Skills in project and user directories
#[tauri::command]
pub async fn list_agent_skills(
    project_path: Option<String>,
) -> Result<Vec<AgentSkillFile>, String> {
    info!("Listing agent skills");
    let mut skills = Vec::new();

    // User-level skills (~/.claude/skills/)
    if let Ok(claude_dir) = get_claude_dir() {
        let user_skills_dir = claude_dir.join("skills");
        if user_skills_dir.exists() {
            skills.extend(scan_skills_directory(&user_skills_dir, "user")?);
        }
    }

    // Project-level skills (.claude/skills/)
    if let Some(proj_path) = project_path {
        let project_skills_dir = Path::new(&proj_path).join(".claude").join("skills");
        if project_skills_dir.exists() {
            skills.extend(scan_skills_directory(&project_skills_dir, "project")?);
        }
    }

    Ok(skills)
}

/// Scan skills directory for SKILL.md files
fn scan_skills_directory(dir: &Path, scope: &str) -> Result<Vec<AgentSkillFile>, String> {
    let mut skills = Vec::new();

    for entry in WalkDir::new(dir)
        .max_depth(2)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Only process files ending with SKILL.md
        if !path.is_file() {
            continue;
        }

        let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");

        if !file_name.ends_with("SKILL.md") {
            continue;
        }

        // Extract skill name from parent directory or file name
        // Skills can be:
        // 1. {name}/SKILL.md -> use directory name
        // 2. {name}.SKILL.md -> use file prefix
        let name = if file_name == "SKILL.md" {
            // Case 1: skill-name/SKILL.md -> use parent directory name
            path.parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        } else {
            // Case 2: skill-name.SKILL.md -> remove .SKILL.md suffix
            file_name.trim_end_matches(".SKILL.md").to_string()
        };

        // Read file content
        match fs::read_to_string(path) {
            Ok(content) => {
                let description = parse_description_from_content(&content);

                skills.push(AgentSkillFile {
                    name,
                    path: path.to_string_lossy().to_string(),
                    scope: scope.to_string(),
                    description,
                    content,
                });
            }
            Err(e) => {
                debug!("Failed to read skill file {:?}: {}", path, e);
            }
        }
    }

    Ok(skills)
}

/// Read a specific subagent file
#[tauri::command]
pub async fn read_subagent(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read subagent file: {}", e))
}

/// Read a specific skill file
#[tauri::command]
pub async fn read_skill(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read skill file: {}", e))
}

/// Open agents directory in file explorer
#[tauri::command]
pub async fn open_agents_directory(project_path: Option<String>) -> Result<String, String> {
    let agents_dir = if let Some(proj_path) = project_path {
        Path::new(&proj_path).join(".claude").join("agents")
    } else {
        get_claude_dir().map_err(|e| e.to_string())?.join("agents")
    };

    // Create directory if it doesn't exist
    fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create agents directory: {}", e))?;

    Ok(agents_dir.to_string_lossy().to_string())
}

/// Open skills directory in file explorer
#[tauri::command]
pub async fn open_skills_directory(project_path: Option<String>) -> Result<String, String> {
    let skills_dir = if let Some(proj_path) = project_path {
        Path::new(&proj_path).join(".claude").join("skills")
    } else {
        get_claude_dir().map_err(|e| e.to_string())?.join("skills")
    };

    // Create directory if it doesn't exist
    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    Ok(skills_dir.to_string_lossy().to_string())
}

/// List all installed plugins
///
/// Claude Code stores installed plugins in:
/// - ~/.claude/plugins/installed_plugins.json (main config file)
/// - ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ (plugin files)
#[tauri::command]
pub async fn list_plugins(_project_path: Option<String>) -> Result<Vec<PluginInfo>, String> {
    info!("Listing installed plugins");
    let mut plugins = Vec::new();

    // Read from installed_plugins.json
    if let Ok(claude_dir) = get_claude_dir() {
        let installed_plugins_path = claude_dir.join("plugins").join("installed_plugins.json");

        if installed_plugins_path.exists() {
            debug!("Reading installed_plugins.json from {:?}", installed_plugins_path);

            if let Ok(content) = fs::read_to_string(&installed_plugins_path) {
                if let Ok(installed) = serde_json::from_str::<serde_json::Value>(&content) {
                    // Parse plugins from installed_plugins.json
                    // Format: { "version": 2, "plugins": { "plugin-name@marketplace": [{ scope, installPath, ... }] } }
                    if let Some(plugins_obj) = installed.get("plugins").and_then(|p| p.as_object()) {
                        for (plugin_key, installations) in plugins_obj {
                            // plugin_key format: "plugin-name@marketplace"
                            let parts: Vec<&str> = plugin_key.split('@').collect();
                            let plugin_name = parts.first().unwrap_or(&"unknown").to_string();
                            let marketplace = parts.get(1).map(|s| s.to_string());

                            // Get the first (active) installation
                            if let Some(installation) = installations.as_array().and_then(|arr| arr.first()) {
                                let install_path = installation
                                    .get("installPath")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");

                                let version = installation
                                    .get("version")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("0.0.0")
                                    .to_string();

                                let scope = installation
                                    .get("scope")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("user")
                                    .to_string();

                                let enabled = !installation
                                    .get("disabled")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);

                                // Read plugin.json from install path for detailed info
                                let install_dir = Path::new(install_path);
                                let plugin_json_path = install_dir.join(".claude-plugin").join("plugin.json");

                                let (description, author) = if plugin_json_path.exists() {
                                    if let Ok(manifest_content) = fs::read_to_string(&plugin_json_path) {
                                        if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_content) {
                                            let desc = manifest
                                                .get("description")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string());

                                            let auth = manifest
                                                .get("author")
                                                .and_then(|v| v.get("name"))
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string());

                                            (desc, auth)
                                        } else {
                                            (None, None)
                                        }
                                    } else {
                                        (None, None)
                                    }
                                } else {
                                    (None, None)
                                };

                                // Count components from the install directory
                                let components = if install_dir.exists() {
                                    count_plugin_components(install_dir)
                                } else {
                                    PluginComponents {
                                        commands: 0,
                                        agents: 0,
                                        skills: 0,
                                        hooks: 0,
                                        mcp_servers: 0,
                                        command_list: Vec::new(),
                                        skill_list: Vec::new(),
                                        agent_list: Vec::new(),
                                    }
                                };

                                plugins.push(PluginInfo {
                                    name: plugin_name,
                                    description,
                                    version,
                                    author,
                                    marketplace,
                                    path: install_path.to_string(),
                                    enabled,
                                    components,
                                });

                                debug!("Found plugin: {} (scope: {}, enabled: {})",
                                    plugin_key, scope, enabled);
                            }
                        }
                    }
                }
            }
        } else {
            debug!("installed_plugins.json not found at {:?}", installed_plugins_path);
        }
    }

    info!("Found {} installed plugins", plugins.len());
    Ok(plugins)
}

/// Scan plugins directory
fn scan_plugins_directory(dir: &Path) -> Result<Vec<PluginInfo>, String> {
    let mut plugins = Vec::new();

    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read plugins directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        // Look for .claude-plugin/plugin.json
        let plugin_json_path = path.join(".claude-plugin").join("plugin.json");

        if plugin_json_path.exists() {
            if let Ok(content) = fs::read_to_string(&plugin_json_path) {
                if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                    let name = manifest
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let description = manifest
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let version = manifest
                        .get("version")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0.0.0")
                        .to_string();

                    let author = manifest
                        .get("author")
                        .and_then(|v| v.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Count components
                    let components = count_plugin_components(&path);

                    plugins.push(PluginInfo {
                        name,
                        description,
                        version,
                        author,
                        marketplace: None,
                        path: path.to_string_lossy().to_string(),
                        enabled: true, // TODO: 从配置读取实际状态
                        components,
                    });
                }
            }
        }
    }

    Ok(plugins)
}

/// Count plugin components and collect detailed list
fn count_plugin_components(plugin_dir: &Path) -> PluginComponents {
    let mut components = PluginComponents {
        commands: 0,
        agents: 0,
        skills: 0,
        hooks: 0,
        mcp_servers: 0,
        command_list: Vec::new(),
        skill_list: Vec::new(),
        agent_list: Vec::new(),
    };

    // Collect commands
    let commands_dir = plugin_dir.join("commands");
    if commands_dir.exists() {
        for entry in WalkDir::new(&commands_dir)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        {
            let path = entry.path();
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            // Read description from file
            let description = if let Ok(content) = fs::read_to_string(path) {
                parse_description_from_content(&content)
            } else {
                None
            };

            components.command_list.push(PluginComponentItem { name, description });
        }
        components.commands = components.command_list.len();
    }

    // Collect agents
    let agents_dir = plugin_dir.join("agents");
    if agents_dir.exists() {
        for entry in WalkDir::new(&agents_dir)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        {
            let path = entry.path();
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let description = if let Ok(content) = fs::read_to_string(path) {
                parse_description_from_content(&content)
            } else {
                None
            };

            components.agent_list.push(PluginComponentItem { name, description });
        }
        components.agents = components.agent_list.len();
    }

    // Collect skills
    let skills_dir = plugin_dir.join("skills");
    if skills_dir.exists() {
        for entry in WalkDir::new(&skills_dir)
            .max_depth(3) // skills/<skill-name>/SKILL.md
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s == "SKILL.md")
                    .unwrap_or(false)
            })
        {
            let path = entry.path();
            // Get skill name from parent directory
            let name = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let description = if let Ok(content) = fs::read_to_string(path) {
                parse_description_from_content(&content)
            } else {
                None
            };

            components.skill_list.push(PluginComponentItem { name, description });
        }
        components.skills = components.skill_list.len();
    }

    // Check for hooks
    let hooks_file = plugin_dir.join("hooks").join("hooks.json");
    if hooks_file.exists() {
        components.hooks = 1;
    }

    // Check for MCP servers
    let mcp_file = plugin_dir.join(".mcp.json");
    if mcp_file.exists() {
        components.mcp_servers = 1;
    }

    components
}

/// Toggle a plugin's enabled/disabled status
///
/// Reads installed_plugins.json, finds the plugin by key, toggles the "disabled" field,
/// and writes back. Returns the new enabled state (true = enabled, false = disabled).
#[tauri::command]
pub async fn toggle_plugin_enabled(plugin_name: String) -> Result<bool, String> {
    info!("Toggling plugin enabled state: {}", plugin_name);

    let claude_dir = get_claude_dir().map_err(|e| e.to_string())?;
    let installed_plugins_path = claude_dir.join("plugins").join("installed_plugins.json");

    if !installed_plugins_path.exists() {
        return Err("installed_plugins.json not found".to_string());
    }

    let content = fs::read_to_string(&installed_plugins_path)
        .map_err(|e| format!("Failed to read installed_plugins.json: {}", e))?;

    let mut root: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse installed_plugins.json: {}", e))?;

    // Navigate to plugins.<plugin_name>[0].disabled
    let plugins = root
        .get_mut("plugins")
        .and_then(|p| p.as_object_mut())
        .ok_or("Invalid installed_plugins.json: missing 'plugins' object")?;

    let installations = plugins
        .get_mut(&plugin_name)
        .and_then(|v| v.as_array_mut())
        .ok_or(format!("Plugin '{}' not found", plugin_name))?;

    let installation = installations
        .first_mut()
        .and_then(|v| v.as_object_mut())
        .ok_or(format!("Plugin '{}' has no installations", plugin_name))?;

    // Toggle: if disabled is true, set to false; if false/absent, set to true
    let currently_disabled = installation
        .get("disabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let new_disabled = !currently_disabled;
    installation.insert(
        "disabled".to_string(),
        serde_json::Value::Bool(new_disabled),
    );

    // Write back with pretty formatting
    let output = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize installed_plugins.json: {}", e))?;

    fs::write(&installed_plugins_path, output)
        .map_err(|e| format!("Failed to write installed_plugins.json: {}", e))?;

    let new_enabled = !new_disabled;
    info!(
        "Plugin '{}' is now {}",
        plugin_name,
        if new_enabled { "enabled" } else { "disabled" }
    );

    Ok(new_enabled)
}

/// Uninstall a plugin completely
///
/// Removes the plugin entry from installed_plugins.json and deletes
/// the plugin's install directory from disk.
#[tauri::command]
pub async fn uninstall_plugin(plugin_name: String) -> Result<(), String> {
    info!("Uninstalling plugin: {}", plugin_name);

    let claude_dir = get_claude_dir().map_err(|e| e.to_string())?;
    let installed_plugins_path = claude_dir.join("plugins").join("installed_plugins.json");

    if !installed_plugins_path.exists() {
        return Err("installed_plugins.json not found".to_string());
    }

    let content = fs::read_to_string(&installed_plugins_path)
        .map_err(|e| format!("Failed to read installed_plugins.json: {}", e))?;

    let mut root: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse installed_plugins.json: {}", e))?;

    let plugins = root
        .get_mut("plugins")
        .and_then(|p| p.as_object_mut())
        .ok_or("Invalid installed_plugins.json: missing 'plugins' object")?;

    // Get the install path before removing the entry
    let install_path = plugins
        .get(&plugin_name)
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|inst| inst.get("installPath"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Remove the plugin entry
    if plugins.remove(&plugin_name).is_none() {
        return Err(format!("Plugin '{}' not found", plugin_name));
    }

    // Write back the modified JSON
    let output = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize installed_plugins.json: {}", e))?;

    fs::write(&installed_plugins_path, output)
        .map_err(|e| format!("Failed to write installed_plugins.json: {}", e))?;

    // Delete the install directory if it exists
    if let Some(path_str) = install_path {
        let install_dir = Path::new(&path_str);
        if install_dir.exists() {
            fs::remove_dir_all(install_dir).map_err(|e| {
                format!(
                    "Plugin removed from config but failed to delete directory '{}': {}",
                    path_str, e
                )
            })?;
            info!("Deleted plugin directory: {}", path_str);
        }
    }

    info!("Plugin '{}' uninstalled successfully", plugin_name);
    Ok(())
}

/// Reinstall a plugin by running `claude /install-plugin <source>`
///
/// Executes the Claude CLI to reinstall the plugin from its marketplace source.
/// Returns the CLI output (stdout + stderr) for display to the user.
#[tauri::command]
pub async fn reinstall_plugin(plugin_source: String) -> Result<String, String> {
    info!("Reinstalling plugin from source: {}", plugin_source);

    use std::process::Command as StdCommand;

    // Determine the claude binary name based on platform
    let claude_cmd = if cfg!(target_os = "windows") {
        "claude.exe"
    } else {
        "claude"
    };

    let output = StdCommand::new(claude_cmd)
        .args(["/install-plugin", &plugin_source])
        .output()
        .map_err(|e| format!("Failed to execute claude CLI: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let error_msg = if stderr.is_empty() {
            stdout.clone()
        } else {
            stderr.clone()
        };
        return Err(format!(
            "Plugin reinstall failed (exit code {}): {}",
            output.status.code().unwrap_or(-1),
            error_msg
        ));
    }

    let result = if stdout.is_empty() {
        "Plugin reinstalled successfully".to_string()
    } else {
        stdout
    };

    info!("Plugin reinstall result: {}", result.trim());
    Ok(result)
}

/// Open plugins directory
#[tauri::command]
pub async fn open_plugins_directory(project_path: Option<String>) -> Result<String, String> {
    let plugins_dir = if let Some(proj_path) = project_path {
        Path::new(&proj_path).join(".claude").join("plugins")
    } else {
        get_claude_dir().map_err(|e| e.to_string())?.join("plugins")
    };

    // Create directory if it doesn't exist
    fs::create_dir_all(&plugins_dir)
        .map_err(|e| format!("Failed to create plugins directory: {}", e))?;

    Ok(plugins_dir.to_string_lossy().to_string())
}

/// Create a new subagent file
/// According to Claude Code docs, subagents are .md files in .claude/agents/
#[tauri::command]
pub async fn create_subagent(
    name: String,
    description: String,
    content: String,
    scope: String,
    project_path: Option<String>,
) -> Result<SubagentFile, String> {
    info!("Creating subagent: {} (scope: {})", name, scope);

    // Validate name (no special characters except hyphens and underscores)
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Agent name can only contain letters, numbers, hyphens, and underscores".into(),
        );
    }

    // Determine target directory based on scope
    let agents_dir = if scope == "project" {
        let proj_path = project_path.ok_or("Project path is required for project scope")?;
        Path::new(&proj_path).join(".claude").join("agents")
    } else {
        get_claude_dir().map_err(|e| e.to_string())?.join("agents")
    };

    // Create directory if it doesn't exist
    fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create agents directory: {}", e))?;

    // Build the file path
    let file_path = agents_dir.join(format!("{}.md", name));

    // Check if file already exists
    if file_path.exists() {
        return Err(format!("Subagent '{}' already exists", name));
    }

    // Build file content with frontmatter
    let full_content = format!(
        r#"---
description: {}
---

{}"#,
        description, content
    );

    // Write file
    fs::write(&file_path, &full_content)
        .map_err(|e| format!("Failed to write subagent file: {}", e))?;

    info!("Created subagent at: {:?}", file_path);

    Ok(SubagentFile {
        name,
        path: file_path.to_string_lossy().to_string(),
        scope,
        description: Some(description),
        content: full_content,
    })
}

/// Create a new Agent Skill
/// According to Claude Code docs, skills are SKILL.md files in .claude/skills/<skill-name>/
#[tauri::command]
pub async fn create_skill(
    name: String,
    description: String,
    content: String,
    scope: String,
    project_path: Option<String>,
) -> Result<AgentSkillFile, String> {
    info!("Creating skill: {} (scope: {})", name, scope);

    // Validate name (no special characters except hyphens and underscores)
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Skill name can only contain letters, numbers, hyphens, and underscores".into(),
        );
    }

    // Determine target directory based on scope
    let skills_dir = if scope == "project" {
        let proj_path = project_path.ok_or("Project path is required for project scope")?;
        Path::new(&proj_path).join(".claude").join("skills")
    } else {
        get_claude_dir().map_err(|e| e.to_string())?.join("skills")
    };

    // Create skill subdirectory: .claude/skills/<skill-name>/
    let skill_dir = skills_dir.join(&name);
    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    // Build the file path: .claude/skills/<skill-name>/SKILL.md
    let file_path = skill_dir.join("SKILL.md");

    // Check if file already exists
    if file_path.exists() {
        return Err(format!("Skill '{}' already exists", name));
    }

    // Build file content with YAML frontmatter (per Claude Code docs)
    let full_content = format!(
        r#"---
name: {}
description: {}
---

# {}

## Instructions

{}

## Examples

<!-- Add examples of using this skill here -->
"#,
        name, description, name, content
    );

    // Write file
    fs::write(&file_path, &full_content)
        .map_err(|e| format!("Failed to write skill file: {}", e))?;

    info!("Created skill at: {:?}", file_path);

    Ok(AgentSkillFile {
        name,
        path: file_path.to_string_lossy().to_string(),
        scope,
        description: Some(description),
        content: full_content,
    })
}

// ============================================================================
// Custom Slash Commands
// ============================================================================

/// Represents a custom slash command file
/// Commands are .md files in .claude/commands/ directories
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSlashCommand {
    /// Command name (file name without extension, or directory name)
    pub name: String,
    /// Full file path
    pub path: String,
    /// Scope: "project" or "user"
    pub scope: String,
    /// Description from frontmatter
    pub description: Option<String>,
    /// Argument hint from frontmatter (e.g., "<file>" or "[query]")
    pub arg_hint: Option<String>,
    /// File content (the command template)
    pub content: String,
}

/// Parse frontmatter for slash commands
/// Extracts description and argument-hint from YAML frontmatter
fn parse_command_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let lines: Vec<&str> = content.lines().collect();
    let mut description = None;
    let mut arg_hint = None;

    // Check for YAML frontmatter
    if lines.len() > 2 && lines[0] == "---" {
        for line in lines.iter().skip(1) {
            if *line == "---" {
                // Found end of frontmatter
                break;
            }
            if line.starts_with("description:") {
                description = Some(line.trim_start_matches("description:").trim().to_string());
            }
            if line.starts_with("argument-hint:") {
                arg_hint = Some(line.trim_start_matches("argument-hint:").trim().to_string());
            }
        }
    }

    // Fallback for description: use first non-empty, non-header line after frontmatter
    if description.is_none() {
        let mut in_frontmatter = false;
        for line in &lines {
            if *line == "---" {
                in_frontmatter = !in_frontmatter;
                continue;
            }
            if !in_frontmatter && !line.trim().is_empty() && !line.starts_with('#') {
                description = Some(line.trim().to_string());
                break;
            }
        }
    }

    (description, arg_hint)
}

/// List all custom slash commands in project and user directories
/// Commands are .md files in .claude/commands/ following Claude Code convention
#[tauri::command]
pub async fn list_custom_slash_commands(
    project_path: Option<String>,
) -> Result<Vec<CustomSlashCommand>, String> {
    info!("Listing custom slash commands");
    let mut commands = Vec::new();

    // User-level commands (~/.claude/commands/)
    if let Ok(claude_dir) = get_claude_dir() {
        let user_commands_dir = claude_dir.join("commands");
        if user_commands_dir.exists() {
            commands.extend(scan_commands_directory(&user_commands_dir, "user")?);
        }
    }

    // Project-level commands (.claude/commands/)
    if let Some(proj_path) = project_path {
        let project_commands_dir = Path::new(&proj_path).join(".claude").join("commands");
        if project_commands_dir.exists() {
            commands.extend(scan_commands_directory(&project_commands_dir, "project")?);
        }
    }

    info!("Found {} custom slash commands", commands.len());
    Ok(commands)
}

/// Scan commands directory for .md files
/// Handles both flat files (command.md) and nested directories (command/index.md or command/$ARGUMENTS.md)
fn scan_commands_directory(dir: &Path, scope: &str) -> Result<Vec<CustomSlashCommand>, String> {
    let mut commands = Vec::new();

    for entry in WalkDir::new(dir)
        .max_depth(2) // Support nested structure like command-name/index.md
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Only process .md files
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        // Determine command name based on file structure
        // 1. Flat: commands/my-command.md -> "my-command"
        // 2. Nested: commands/my-command/index.md -> "my-command"
        // 3. With args: commands/my-command/$ARGUMENTS.md -> "my-command" (with arg hint)
        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        let parent_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("");

        // Skip if file is directly in commands dir but named something weird
        let name = if parent_name == "commands" || parent_name == dir.file_name().and_then(|s| s.to_str()).unwrap_or("") {
            // Flat structure: commands/my-command.md
            file_name.to_string()
        } else if file_name == "index" || file_name.starts_with('$') {
            // Nested structure: commands/my-command/index.md or commands/my-command/$ARGUMENTS.md
            parent_name.to_string()
        } else {
            // Other nested file: commands/my-command/subcommand.md -> "my-command:subcommand"
            format!("{}:{}", parent_name, file_name)
        };

        // Skip hidden files and special files
        if name.starts_with('.') || name.is_empty() {
            continue;
        }

        // Read file content
        match fs::read_to_string(path) {
            Ok(content) => {
                let (description, arg_hint) = parse_command_frontmatter(&content);

                commands.push(CustomSlashCommand {
                    name,
                    path: path.to_string_lossy().to_string(),
                    scope: scope.to_string(),
                    description,
                    arg_hint,
                    content,
                });
            }
            Err(e) => {
                debug!("Failed to read command file {:?}: {}", path, e);
            }
        }
    }

    Ok(commands)
}

/// Open commands directory in file explorer
#[tauri::command]
pub async fn open_commands_directory(project_path: Option<String>) -> Result<String, String> {
    let commands_dir = if let Some(proj_path) = project_path {
        Path::new(&proj_path).join(".claude").join("commands")
    } else {
        get_claude_dir()
            .map_err(|e| e.to_string())?
            .join("commands")
    };

    // Create directory if it doesn't exist
    fs::create_dir_all(&commands_dir)
        .map_err(|e| format!("Failed to create commands directory: {}", e))?;

    Ok(commands_dir.to_string_lossy().to_string())
}

// ============================================================================
// Gemini Custom Slash Commands
// ============================================================================

/// Get Gemini config directory (~/.gemini/)
fn get_gemini_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".gemini"))
}

/// Parse TOML frontmatter for Gemini slash commands
/// Gemini uses TOML format with 'description' and 'prompt' fields
fn parse_gemini_command_toml(content: &str) -> (Option<String>, Option<String>) {
    // Try to parse as TOML
    if let Ok(value) = content.parse::<toml::Value>() {
        let description = value
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Gemini doesn't have a standard arg_hint field, but we can look for patterns
        let arg_hint = value
            .get("argument-hint")
            .or_else(|| value.get("argHint"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        return (description, arg_hint);
    }

    // Fallback: try to extract description from comments or first line
    let first_line = content.lines().next().unwrap_or("");
    if first_line.starts_with('#') {
        return (Some(first_line.trim_start_matches('#').trim().to_string()), None);
    }

    (None, None)
}

/// List all custom slash commands for Gemini CLI
/// Commands are .toml files in .gemini/commands/ directories
#[tauri::command]
pub async fn list_gemini_custom_slash_commands(
    project_path: Option<String>,
) -> Result<Vec<CustomSlashCommand>, String> {
    info!("Listing Gemini custom slash commands");
    let mut commands = Vec::new();

    // User-level commands (~/.gemini/commands/)
    if let Ok(gemini_dir) = get_gemini_dir() {
        let user_commands_dir = gemini_dir.join("commands");
        if user_commands_dir.exists() {
            commands.extend(scan_gemini_commands_directory(&user_commands_dir, "user")?);
        }
    }

    // Project-level commands (.gemini/commands/)
    if let Some(proj_path) = project_path {
        let project_commands_dir = Path::new(&proj_path).join(".gemini").join("commands");
        if project_commands_dir.exists() {
            commands.extend(scan_gemini_commands_directory(&project_commands_dir, "project")?);
        }
    }

    info!("Found {} Gemini custom slash commands", commands.len());
    Ok(commands)
}

/// Scan Gemini commands directory for .toml files
/// Handles both flat files (command.toml) and nested directories (namespace/command.toml)
fn scan_gemini_commands_directory(dir: &Path, scope: &str) -> Result<Vec<CustomSlashCommand>, String> {
    let mut commands = Vec::new();

    for entry in WalkDir::new(dir)
        .max_depth(2) // Support namespaced commands like git/commit.toml -> git:commit
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Only process .toml files
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }

        // Determine command name based on file structure
        // 1. Flat: commands/my-command.toml -> "my-command"
        // 2. Namespaced: commands/git/commit.toml -> "git:commit"
        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        let parent_name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("");

        let dir_name = dir.file_name().and_then(|s| s.to_str()).unwrap_or("");

        // Build command name
        let name = if parent_name == "commands" || parent_name == dir_name {
            // Flat structure: commands/my-command.toml
            file_name.to_string()
        } else {
            // Namespaced: commands/git/commit.toml -> "git:commit"
            format!("{}:{}", parent_name, file_name)
        };

        // Skip hidden files and special files
        if name.starts_with('.') || name.is_empty() {
            continue;
        }

        // Read file content
        match fs::read_to_string(path) {
            Ok(content) => {
                let (description, arg_hint) = parse_gemini_command_toml(&content);

                commands.push(CustomSlashCommand {
                    name,
                    path: path.to_string_lossy().to_string(),
                    scope: scope.to_string(),
                    description,
                    arg_hint,
                    content,
                });
            }
            Err(e) => {
                debug!("Failed to read Gemini command file {:?}: {}", path, e);
            }
        }
    }

    Ok(commands)
}
