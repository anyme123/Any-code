use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

use super::models::{Project, Session};
use super::paths::{decode_project_path, get_claude_dir, normalize_path_for_comparison};
use super::session_history::extract_session_metadata;

pub struct ProjectStore {
    claude_dir: PathBuf,
}

pub struct BatchDeleteOutcome {
    pub deleted_count: usize,
    pub failed_count: usize,
    pub errors: Vec<String>,
}

impl ProjectStore {
    pub fn new() -> Result<Self, String> {
        let claude_dir = get_claude_dir().map_err(|e| e.to_string())?;
        Ok(Self { claude_dir })
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, String> {
        log::info!("Listing projects from ~/.claude/projects");

        let mut all_projects = Vec::new();
        let projects_dir = self.projects_dir();
        let mut hidden_projects = self.load_hidden_projects()?;

        if projects_dir.exists() {
            let entries: Vec<_> = fs::read_dir(&projects_dir)
                .map_err(|e| format!("Failed to read projects directory: {}", e))?
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();

            let total_project_count = entries.len();

            // Safety check: if hidden_projects would hide ALL projects, clear the hidden list
            if total_project_count > 0 && hidden_projects.len() >= total_project_count {
                log::warn!(
                    "Safety check triggered: hidden_projects ({}) >= total projects ({}). Clearing hidden list.",
                    hidden_projects.len(),
                    total_project_count
                );
                if let Err(e) = self.save_hidden_projects(&[]) {
                    log::error!("Failed to clear hidden projects file: {}", e);
                }
                hidden_projects.clear();
            }

            for entry in entries {
                let path = entry.path();
                let dir_name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(name) => name.to_string(),
                    None => continue,
                };

                if hidden_projects.contains(&dir_name) {
                    continue;
                }

                let created_at = entry.metadata()
                    .ok()
                    .and_then(|m| m.modified().ok().or_else(|| m.created().ok()))
                    .unwrap_or(SystemTime::UNIX_EPOCH)
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                let project_path = match get_project_path_from_sessions(&path) {
                    Ok(path) => path,
                    Err(_) => decode_project_path(&dir_name),
                };

                // Fast session enumeration: only use file metadata, don't read contents
                let mut sessions = Vec::new();
                let mut latest_activity = created_at;

                if let Ok(session_entries) = fs::read_dir(&path) {
                    for session_entry in session_entries.flatten() {
                        let session_path = session_entry.path();
                        if session_path.is_file()
                            && session_path.extension().and_then(|s| s.to_str()) == Some("jsonl")
                        {
                            if let Some(session_id) = session_path.file_stem().and_then(|s| s.to_str()) {
                                // Skip agent files
                                if session_id.starts_with("agent-") {
                                    continue;
                                }
                                // Use file size as a quick validity check (skip empty/tiny files)
                                let is_valid = session_entry.metadata()
                                    .map(|m| m.len() > 50)
                                    .unwrap_or(false);

                                if is_valid {
                                    sessions.push(session_id.to_string());

                                    // Use file modification time for activity tracking
                                    if let Ok(m) = session_entry.metadata() {
                                        let modified = m.modified()
                                            .unwrap_or(SystemTime::UNIX_EPOCH)
                                            .duration_since(SystemTime::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs();
                                        if modified > latest_activity {
                                            latest_activity = modified;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                all_projects.push(Project {
                    id: dir_name,
                    path: project_path,
                    sessions,
                    created_at: latest_activity,
                });
            }
        } else {
            log::warn!("Projects directory does not exist: {:?}", projects_dir);
        }

        self.deduplicate_projects(all_projects, hidden_projects.len())
    }

    pub fn get_project_sessions(&self, project_id: &str) -> Result<Vec<Session>, String> {
        log::info!("Getting sessions for project: {}", project_id);

        let project_dir = self.projects_dir().join(project_id);
        let todos_dir = self.todos_dir();

        if !project_dir.exists() {
            return Err(format!("Project directory not found: {}", project_id));
        }

        let project_path = match get_project_path_from_sessions(&project_dir) {
            Ok(path) => path,
            Err(_) => decode_project_path(project_id),
        };

        let mut sessions = Vec::new();
        let entries = fs::read_dir(&project_dir)
            .map_err(|e| format!("Failed to read project directory: {}", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            let path = entry.path();

            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                if let Some(session_id) = path.file_stem().and_then(|s| s.to_str()) {
                    if session_id.starts_with("agent-") {
                        continue;
                    }

                    let created_at = entry.metadata()
                        .ok()
                        .and_then(|m| m.created().ok().or_else(|| m.modified().ok()))
                        .unwrap_or(SystemTime::UNIX_EPOCH)
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    // Single-pass metadata extraction (reads file once instead of 3 times)
                    let metadata = extract_session_metadata(&path);

                    let first_message = metadata.first_message.or_else(|| {
                        let has_content = metadata.last_message_timestamp.is_some()
                            && path.metadata()
                                .ok()
                                .map(|m| m.len() > 100)
                                .unwrap_or(false);

                        if has_content {
                            let short_id = if session_id.len() >= 8 {
                                &session_id[..8]
                            } else {
                                session_id
                            };
                            Some(format!("Resumed Session ({}...)", short_id))
                        } else {
                            None
                        }
                    });

                    let todo_path = todos_dir.join(format!("{}.json", session_id));
                    let todo_data = if todo_path.exists() {
                        fs::read_to_string(&todo_path)
                            .ok()
                            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
                    } else {
                        None
                    };

                    sessions.push(Session {
                        id: session_id.to_string(),
                        project_id: project_id.to_string(),
                        project_path: project_path.clone(),
                        todo_data,
                        created_at,
                        first_message,
                        message_timestamp: metadata.message_timestamp,
                        last_message_timestamp: metadata.last_message_timestamp,
                        model: metadata.model,
                    });
                }
            }
        }

        sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(sessions)
    }

    pub fn delete_session(&self, project_id: &str, session_id: &str) -> Result<bool, String> {
        log::info!(
            "Deleting session {} from project {}",
            session_id,
            project_id
        );

        let mut session_deleted = false;

        let session_file = self
            .projects_dir()
            .join(project_id)
            .join(format!("{}.jsonl", session_id));

        if session_file.exists() {
            fs::remove_file(&session_file)
                .map_err(|e| format!("Failed to delete session file: {}", e))?;
            log::info!("Deleted session file: {:?}", session_file);
            session_deleted = true;
        } else {
            log::warn!("Session file not found: {:?}", session_file);
        }

        let todo_file = self
            .claude_dir
            .join("todos")
            .join(format!("{}.json", session_id));

        if todo_file.exists() {
            fs::remove_file(&todo_file)
                .map_err(|e| format!("Failed to delete TODO file: {}", e))?;
            log::info!("Deleted TODO file: {:?}", todo_file);
        }

        let git_records_file = self
            .claude_dir
            .join("sessions")
            .join(project_id)
            .join(format!("{}.git-records.json", session_id));

        if git_records_file.exists() {
            if let Err(e) = fs::remove_file(&git_records_file) {
                log::warn!(
                    "Failed to delete git records file for {}: {}",
                    session_id,
                    e
                );
            } else {
                log::info!("Deleted git records file: {:?}", git_records_file);
            }
        }

        Ok(session_deleted)
    }

    pub fn delete_sessions_batch(
        &self,
        project_id: &str,
        session_ids: &[String],
    ) -> BatchDeleteOutcome {
        let mut deleted_count = 0;
        let mut failed_count = 0;
        let mut errors = Vec::new();

        for session_id in session_ids {
            match self.delete_session(project_id, session_id) {
                Ok(session_deleted) => {
                    if session_deleted {
                        deleted_count += 1;
                    } else {
                        failed_count += 1;
                        errors.push(format!("Session file not found for ID: {}", session_id));
                    }
                }
                Err(e) => {
                    failed_count += 1;
                    errors.push(format!("Failed to delete session {}: {}", session_id, e));
                }
            }
        }

        BatchDeleteOutcome {
            deleted_count,
            failed_count,
            errors,
        }
    }

    pub fn hide_project(&self, project_id: &str) -> Result<bool, String> {
        let mut hidden_projects = self.load_hidden_projects()?;
        if hidden_projects.contains(&project_id.to_string()) {
            return Ok(false);
        }

        hidden_projects.push(project_id.to_string());
        self.save_hidden_projects(&hidden_projects)?;
        Ok(true)
    }

    pub fn restore_project(&self, project_id: &str) -> Result<(), String> {
        let mut hidden_projects = self.load_hidden_projects()?;

        if let Some(pos) = hidden_projects.iter().position(|x| x == project_id) {
            hidden_projects.remove(pos);
            self.save_hidden_projects(&hidden_projects)?;
            Ok(())
        } else {
            Err(format!(
                "Project '{}' is not in the hidden list",
                project_id
            ))
        }
    }

    pub fn delete_project_permanently(&self, project_id: &str) -> Result<String, String> {
        log::info!("Permanently deleting project: {}", project_id);

        let projects_dir = self.projects_dir();
        let project_dir = projects_dir.join(project_id);

        let mut actual_project_dir = None;
        let mut actual_project_id = project_id.to_string();

        if project_dir.exists() {
            actual_project_dir = Some(project_dir);
        } else if let Ok(entries) = fs::read_dir(&projects_dir) {
            let target_normalized_path =
                normalize_path_for_comparison(&decode_project_path(project_id));

            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(dir_name) = entry.file_name().to_str() {
                        let candidate_path = match get_project_path_from_sessions(&entry.path()) {
                            Ok(path) => path,
                            Err(_) => decode_project_path(dir_name),
                        };

                        if normalize_path_for_comparison(&candidate_path) == target_normalized_path
                        {
                            actual_project_dir = Some(entry.path());
                            actual_project_id = dir_name.to_string();
                            log::info!(
                                "Found actual project directory: {} -> {}",
                                project_id,
                                actual_project_id
                            );
                            break;
                        }
                    }
                }
            }
        }

        let dir_to_delete = actual_project_dir.ok_or_else(|| {
            if project_id.contains("--") && !project_id.contains("---") {
                format!(
                    "项目目录不存在。可能已被手动删除，或使用了不同的编码格式。原始ID: {}",
                    project_id
                )
            } else {
                format!("项目目录不存在: {:?}", projects_dir.join(project_id))
            }
        })?;

        fs::remove_dir_all(&dir_to_delete)
            .map_err(|e| format!("Failed to delete project directory: {}", e))?;

        self.remove_from_hidden_projects(&[project_id, &actual_project_id])?;

        Ok(actual_project_id)
    }

    pub fn list_hidden_projects(&self) -> Result<Vec<String>, String> {
        log::info!("Listing hidden projects with directory validation");

        let mut hidden_projects = self.load_hidden_projects()?;
        let projects_dir = self.projects_dir();

        let mut validated_hidden_projects = Vec::new();
        let mut projects_to_remove = Vec::new();

        for hidden_project_id in &hidden_projects {
            let project_dir = projects_dir.join(hidden_project_id);

            if project_dir.exists() {
                validated_hidden_projects.push(hidden_project_id.clone());
                log::debug!("Hidden project directory exists: {}", hidden_project_id);
            } else {
                let normalized_path =
                    normalize_path_for_comparison(&decode_project_path(hidden_project_id));
                let mut found_match = false;

                if let Ok(entries) = fs::read_dir(&projects_dir) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            if let Some(dir_name) = entry.file_name().to_str() {
                                let candidate_path =
                                    match get_project_path_from_sessions(&entry.path()) {
                                        Ok(path) => path,
                                        Err(_) => decode_project_path(dir_name),
                                    };

                                if normalize_path_for_comparison(&candidate_path) == normalized_path
                                {
                                    validated_hidden_projects.push(dir_name.to_string());
                                    log::debug!(
                                        "Found matching directory for hidden project {} -> {}",
                                        hidden_project_id,
                                        dir_name
                                    );
                                    found_match = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                if !found_match {
                    log::warn!(
                        "Hidden project directory not found (will remove from list): {}",
                        hidden_project_id
                    );
                    projects_to_remove.push(hidden_project_id.clone());
                }
            }
        }

        if !projects_to_remove.is_empty() {
            hidden_projects.retain(|id| !projects_to_remove.contains(id));
            self.save_hidden_projects(&hidden_projects)?;
            log::info!(
                "Removed {} invalid hidden projects",
                projects_to_remove.len()
            );
        }

        Ok(validated_hidden_projects)
    }

    fn projects_dir(&self) -> PathBuf {
        self.claude_dir.join("projects")
    }

    fn todos_dir(&self) -> PathBuf {
        self.claude_dir.join("todos")
    }

    fn load_hidden_projects(&self) -> Result<Vec<String>, String> {
        let hidden_projects_file = self.hidden_projects_file();

        if hidden_projects_file.exists() {
            let content = fs::read_to_string(&hidden_projects_file)
                .map_err(|e| format!("Failed to read hidden projects file: {}", e))?;
            Ok(serde_json::from_str(&content).unwrap_or_else(|_| Vec::new()))
        } else {
            Ok(Vec::new())
        }
    }

    fn save_hidden_projects(&self, projects: &[String]) -> Result<(), String> {
        let hidden_projects_file = self.hidden_projects_file();
        let content = serde_json::to_string_pretty(projects)
            .map_err(|e| format!("Failed to serialize hidden projects: {}", e))?;
        fs::write(&hidden_projects_file, content)
            .map_err(|e| format!("Failed to write hidden projects file: {}", e))
    }

    fn hidden_projects_file(&self) -> PathBuf {
        self.claude_dir.join("hidden_projects.json")
    }

    fn deduplicate_projects(
        &self,
        all_projects: Vec<Project>,
        hidden_count: usize,
    ) -> Result<Vec<Project>, String> {
        let original_count = all_projects.len();
        let mut unique_projects_map: HashMap<String, Project> = HashMap::new();

        for project in all_projects {
            let normalized_path = normalize_path_for_comparison(&project.path);

            match unique_projects_map.get_mut(&normalized_path) {
                Some(existing_project) => {
                    log::debug!(
                        "Merging duplicate project with path: {} (existing: {}, new: {})",
                        project.path,
                        existing_project.id,
                        project.id
                    );

                    let mut new_sessions = project.sessions;
                    for session in new_sessions.drain(..) {
                        if !existing_project.sessions.contains(&session) {
                            existing_project.sessions.push(session);
                        }
                    }

                    if project.created_at > existing_project.created_at {
                        existing_project.created_at = project.created_at;
                    }

                    let should_update_id = project.id.len() < existing_project.id.len()
                        || (project.id.len() == existing_project.id.len()
                            && !project.id.contains("--")
                            && existing_project.id.contains("--"))
                        || (project.id.len() == existing_project.id.len()
                            && project.id.chars().any(|c| c.is_uppercase())
                            && existing_project.id.chars().all(|c| !c.is_uppercase()));

                    if should_update_id {
                        log::debug!(
                            "Updating project ID from '{}' to '{}'",
                            existing_project.id,
                            project.id
                        );
                        existing_project.id = project.id;
                    }
                }
                None => {
                    unique_projects_map.insert(normalized_path, project);
                }
            }
        }

        let mut unique_projects: Vec<Project> = unique_projects_map
            .into_values()
            .map(|mut project| {
                let mut unique_sessions = HashSet::new();
                project
                    .sessions
                    .retain(|session| unique_sessions.insert(session.clone()));
                project
            })
            .collect();

        unique_projects.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        log::info!(
            "Found {} unique projects (filtered {} hidden, {} duplicates)",
            unique_projects.len(),
            hidden_count,
            original_count - unique_projects.len()
        );

        Ok(unique_projects)
    }

    fn remove_from_hidden_projects(&self, project_ids: &[&str]) -> Result<(), String> {
        let hidden_projects_file = self.hidden_projects_file();
        if hidden_projects_file.exists() {
            let mut hidden_projects = self.load_hidden_projects()?;
            let original_len = hidden_projects.len();
            hidden_projects.retain(|id| !project_ids.contains(&id.as_str()));

            if hidden_projects.len() != original_len {
                self.save_hidden_projects(&hidden_projects)?;
                log::info!(
                    "Removed project(s) from hidden list: {}",
                    project_ids.join(", ")
                );
            }
        }
        Ok(())
    }
}

fn get_project_path_from_sessions(project_dir: &Path) -> Result<String, String> {
    let entries = fs::read_dir(project_dir)
        .map_err(|e| format!("Failed to read project directory: {}", e))?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                if let Ok(file) = fs::File::open(&path) {
                    let reader = BufReader::new(file);
                    // Read up to 10 lines to find cwd field
                    for line_result in reader.lines().take(10) {
                        if let Ok(line) = line_result {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                                if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                                    let cleaned_cwd = cwd.replace("\\\\", "\\");

                                    // On macOS, avoid canonicalize() as it resolves symlinks and can cause
                                    // path mismatches (e.g., /tmp -> /private/tmp, /var -> /private/var)
                                    // Also, canonicalize() fails if the path doesn't exist (project moved/deleted)
                                    #[cfg(target_os = "macos")]
                                    let normalized_cwd = normalize_macos_path(&cleaned_cwd);

                                    #[cfg(target_os = "windows")]
                                    let normalized_cwd = Path::new(&cleaned_cwd)
                                        .canonicalize()
                                        .map(|p| {
                                            let path_str = p.to_string_lossy().to_string();
                                            // Remove Windows long path prefix (\\?\)
                                            if path_str.starts_with("\\\\?\\") {
                                                path_str[4..].to_string()
                                            } else {
                                                path_str
                                            }
                                        })
                                        .unwrap_or_else(|_| cleaned_cwd.clone());

                                    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                                    let normalized_cwd = cleaned_cwd.clone();

                                    return Ok(normalized_cwd);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Could not determine project path from session files".to_string())
}

/// Normalize macOS paths without using canonicalize()
/// This avoids issues with:
/// 1. Symlink resolution (e.g., /tmp -> /private/tmp)
/// 2. Non-existent paths (project moved/deleted)
/// 3. iCloud Drive and other special paths
#[cfg(target_os = "macos")]
fn normalize_macos_path(path: &str) -> String {
    let mut normalized = path.to_string();

    // Remove /private prefix if present (macOS symlink target)
    // This ensures consistency: /private/tmp and /tmp should be treated the same
    if normalized.starts_with("/private/tmp/") {
        normalized = normalized.replacen("/private/tmp/", "/tmp/", 1);
    } else if normalized.starts_with("/private/var/") {
        normalized = normalized.replacen("/private/var/", "/var/", 1);
    } else if normalized.starts_with("/private/etc/") {
        normalized = normalized.replacen("/private/etc/", "/etc/", 1);
    }

    // Remove trailing slash if present (except for root)
    if normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }

    normalized
}
