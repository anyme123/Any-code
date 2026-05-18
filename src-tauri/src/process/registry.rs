use super::JobObject;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::process::Child;

// 子进程实时输出缓冲上限，超出后丢弃最旧 50% 防止 OOM
const MAX_LIVE_OUTPUT_BYTES: usize = 4 * 1024 * 1024; // 4MB

/// Type of process being tracked
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProcessType {
    AgentRun { agent_id: i64, agent_name: String },
    ClaudeSession { session_id: String },
}

/// Information about a running agent process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub run_id: i64,
    pub process_type: ProcessType,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub project_path: String,
    pub task: String,
    pub model: String,
}

/// Information about a running process with handle
#[allow(dead_code)]
pub struct ProcessHandle {
    pub info: ProcessInfo,
    pub child: Arc<Mutex<Option<Child>>>,
    pub live_output: Arc<Mutex<String>>,
    #[cfg(windows)]
    pub job_object: Option<Arc<JobObject>>, // Job object for automatic cleanup on Windows
}

/// Registry for tracking active agent processes
pub struct ProcessRegistry {
    processes: Arc<Mutex<HashMap<i64, ProcessHandle>>>, // run_id -> ProcessHandle
    next_id: Arc<Mutex<i64>>, // Auto-incrementing ID for non-agent processes
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1000000)), // Start at high number to avoid conflicts
        }
    }

    /// Generate a unique ID for non-agent processes
    pub fn generate_id(&self) -> Result<i64, String> {
        let mut next_id = self.next_id.lock().map_err(|e| e.to_string())?;
        let id = *next_id;
        *next_id += 1;
        Ok(id)
    }

    /// Register a new running agent process
    #[allow(dead_code)]
    pub fn register_process(
        &self,
        run_id: i64,
        agent_id: i64,
        agent_name: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
        child: Child,
    ) -> Result<(), String> {
        let process_info = ProcessInfo {
            run_id,
            process_type: ProcessType::AgentRun {
                agent_id,
                agent_name,
            },
            pid,
            started_at: Utc::now(),
            project_path,
            task,
            model,
        };

        self.register_process_internal(run_id, process_info, child)
    }

    /// Register a new Claude session (without child process - handled separately)
    /// DEPRECATED: Use register_claude_session_with_job instead for proper child process cleanup
    #[allow(dead_code)]
    pub fn register_claude_session(
        &self,
        session_id: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
    ) -> Result<i64, String> {
        // Call the new function with no pre-created job object (will create one here)
        #[cfg(windows)]
        {
            self.register_claude_session_with_job(session_id, pid, project_path, task, model, None)
        }
        #[cfg(not(windows))]
        {
            self.register_claude_session_with_job(session_id, pid, project_path, task, model, None)
        }
    }

    /// Register a new Claude session with an optional pre-created Job Object
    ///
    /// 🔧 FIX: This function accepts a pre-created Job Object that was created immediately
    /// after spawning the Claude process. This ensures all child processes (including MCP
    /// node processes) are added to the Job Object and will be terminated when the session ends.
    ///
    /// If no Job Object is provided, one will be created here (legacy behavior, but may miss
    /// child processes that were already started).
    #[cfg(windows)]
    pub fn register_claude_session_with_job(
        &self,
        session_id: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
        pre_created_job: Option<Arc<JobObject>>,
    ) -> Result<i64, String> {
        let run_id = self.generate_id()?;

        let process_info = ProcessInfo {
            run_id,
            process_type: ProcessType::ClaudeSession { session_id },
            pid,
            started_at: Utc::now(),
            project_path,
            task,
            model,
        };

        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;

        // Use pre-created Job Object if provided, otherwise create one here (legacy fallback)
        let job_object = if let Some(job) = pre_created_job {
            log::info!(
                "🔧 FIX: Using pre-created Job Object for process {} (child processes included)",
                pid
            );
            Some(job)
        } else {
            // Legacy fallback: create Job Object here (may miss already-started child processes)
            log::warn!(
                "Creating Job Object late for process {} - child processes may not be included",
                pid
            );
            match JobObject::create() {
                Ok(job) => {
                    match job.assign_process_by_pid(pid) {
                        Ok(_) => {
                            log::info!(
                                "Assigned process {} to Job Object for automatic cleanup",
                                pid
                            );
                            Some(Arc::new(job))
                        }
                        Err(e) => {
                            log::warn!("Failed to assign process {} to Job Object: {}", pid, e);
                            None
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to create Job Object: {}", e);
                    None
                }
            }
        };

        let process_handle = ProcessHandle {
            info: process_info,
            child: Arc::new(Mutex::new(None)),
            live_output: Arc::new(Mutex::new(String::new())),
            job_object,
        };

        processes.insert(run_id, process_handle);
        Ok(run_id)
    }

    /// Register a new Claude session with an optional pre-created Job Object (non-Windows version)
    #[cfg(not(windows))]
    pub fn register_claude_session_with_job(
        &self,
        session_id: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
        _pre_created_job: Option<()>,
    ) -> Result<i64, String> {
        let run_id = self.generate_id()?;

        let process_info = ProcessInfo {
            run_id,
            process_type: ProcessType::ClaudeSession { session_id },
            pid,
            started_at: Utc::now(),
            project_path,
            task,
            model,
        };

        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;

        let process_handle = ProcessHandle {
            info: process_info,
            child: Arc::new(Mutex::new(None)),
            live_output: Arc::new(Mutex::new(String::new())),
        };

        processes.insert(run_id, process_handle);
        Ok(run_id)
    }

    /// Internal method to register any process
    #[allow(dead_code)]
    fn register_process_internal(
        &self,
        run_id: i64,
        process_info: ProcessInfo,
        child: Child,
    ) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;

        // Create Job Object on Windows for automatic process cleanup
        #[cfg(windows)]
        let job_object = {
            let pid = process_info.pid;
            match JobObject::create() {
                Ok(job) => {
                    // Assign the process to the job
                    match job.assign_process_by_pid(pid) {
                        Ok(_) => {
                            log::info!(
                                "Assigned process {} to Job Object for automatic cleanup",
                                pid
                            );
                            Some(Arc::new(job))
                        }
                        Err(e) => {
                            log::warn!("Failed to assign process {} to Job Object: {}", pid, e);
                            None
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to create Job Object: {}", e);
                    None
                }
            }
        };

        let process_handle = ProcessHandle {
            info: process_info,
            child: Arc::new(Mutex::new(Some(child))),
            live_output: Arc::new(Mutex::new(String::new())),
            #[cfg(windows)]
            job_object,
        };

        processes.insert(run_id, process_handle);
        Ok(())
    }

    /// Get all running Claude sessions
    pub fn get_running_claude_sessions(&self) -> Result<Vec<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .filter_map(|handle| match &handle.info.process_type {
                ProcessType::ClaudeSession { .. } => Some(handle.info.clone()),
                _ => None,
            })
            .collect())
    }

    /// Get a specific Claude session by session ID
    pub fn get_claude_session_by_id(
        &self,
        session_id: &str,
    ) -> Result<Option<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .find(|handle| match &handle.info.process_type {
                ProcessType::ClaudeSession { session_id: sid } => sid == session_id,
                _ => false,
            })
            .map(|handle| handle.info.clone()))
    }

    /// Unregister a process (called when it completes)
    #[allow(dead_code)]
    pub fn unregister_process(&self, run_id: i64) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;
        processes.remove(&run_id);
        Ok(())
    }

    /// Get all running processes
    #[allow(dead_code)]
    pub fn get_running_processes(&self) -> Result<Vec<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .map(|handle| handle.info.clone())
            .collect())
    }

    /// Get all running agent processes
    #[allow(dead_code)]
    pub fn get_running_agent_processes(&self) -> Result<Vec<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .filter_map(|handle| match &handle.info.process_type {
                ProcessType::AgentRun { .. } => Some(handle.info.clone()),
                _ => None,
            })
            .collect())
    }

    /// Get a specific running process
    #[allow(dead_code)]
    pub fn get_process(&self, run_id: i64) -> Result<Option<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes.get(&run_id).map(|handle| handle.info.clone()))
    }

    /// Kill a running process with proper cleanup
    pub async fn kill_process(&self, run_id: i64) -> Result<bool, String> {
        use log::{error, info, warn};

        // First check if the process exists and get its PID
        let (pid, child_arc) = {
            let processes = self.processes.lock().map_err(|e| e.to_string())?;
            if let Some(handle) = processes.get(&run_id) {
                (handle.info.pid, handle.child.clone())
            } else {
                warn!("Process {} not found in registry", run_id);
                return Ok(false); // Process not found
            }
        };

        info!(
            "Attempting graceful shutdown of process {} (PID: {})",
            run_id, pid
        );

        // IMPORTANT: First kill all child processes to prevent orphans
        info!(
            "Killing child processes of PID {} before killing parent",
            pid
        );
        let _ = self.kill_child_processes(pid);

        // Send kill signal to the process
        let kill_sent = {
            let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;
            if let Some(child) = child_guard.as_mut() {
                match child.start_kill() {
                    Ok(_) => {
                        info!("Successfully sent kill signal to process {}", run_id);
                        true
                    }
                    Err(e) => {
                        error!("Failed to send kill signal to process {}: {}", run_id, e);
                        // Don't return error here, try fallback method
                        false
                    }
                }
            } else {
                warn!(
                    "No child handle available for process {} (PID: {}), attempting system kill",
                    run_id, pid
                );
                false // Process handle not available, try fallback
            }
        };

        // If direct kill didn't work, try system command as fallback
        if !kill_sent {
            info!(
                "Attempting fallback kill for process {} (PID: {})",
                run_id, pid
            );
            match self.kill_process_by_pid(run_id, pid).await {
                Ok(true) => return Ok(true),
                Ok(false) => warn!(
                    "Fallback kill also failed for process {} (PID: {})",
                    run_id, pid
                ),
                Err(e) => error!("Error during fallback kill: {}", e),
            }
            // Continue with the rest of the cleanup even if fallback failed
        }

        // Wait for the process to exit (with timeout)
        let wait_result = tokio::time::timeout(tokio::time::Duration::from_secs(5), async {
            loop {
                // Check if process has exited
                let status = {
                    let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;
                    if let Some(child) = child_guard.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                info!("Process {} exited with status: {:?}", run_id, status);
                                *child_guard = None; // Clear the child handle
                                Some(Ok::<(), String>(()))
                            }
                            Ok(None) => {
                                // Still running
                                None
                            }
                            Err(e) => {
                                error!("Error checking process status: {}", e);
                                Some(Err(e.to_string()))
                            }
                        }
                    } else {
                        // Process already gone
                        Some(Ok(()))
                    }
                };

                match status {
                    Some(result) => return result,
                    None => {
                        // Still running, wait a bit
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    }
                }
            }
        })
        .await;

        match wait_result {
            Ok(Ok(_)) => {
                info!("Process {} exited gracefully", run_id);
            }
            Ok(Err(e)) => {
                error!("Error waiting for process {}: {}", run_id, e);
            }
            Err(_) => {
                warn!("Process {} didn't exit within 5 seconds after kill", run_id);
                // Force clear the handle
                if let Ok(mut child_guard) = child_arc.lock() {
                    *child_guard = None;
                }
                // One more attempt with system kill
                let _ = self.kill_process_by_pid(run_id, pid).await;
            }
        }

        // Remove from registry after killing
        self.unregister_process(run_id)?;

        Ok(true)
    }

    /// Kill all child processes of a given PID
    /// This is crucial for cleaning up orphaned node processes
    fn kill_child_processes(&self, parent_pid: u32) -> Result<(), String> {
        use log::info;

        #[cfg(target_os = "windows")]
        {
            // On Windows, use WMIC to find and kill child processes
            use std::os::windows::process::CommandExt;

            info!("Searching for child processes of PID {}", parent_pid);

            // Get child process IDs using WMIC
            let output = std::process::Command::new("wmic")
                .args([
                    "process",
                    "where",
                    &format!("ParentProcessId={}", parent_pid),
                    "get",
                    "ProcessId",
                ])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();

            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Parse PIDs from output
                for line in stdout.lines().skip(1) {
                    // Skip header
                    let pid_str = line.trim();
                    if !pid_str.is_empty() {
                        if let Ok(child_pid) = pid_str.parse::<u32>() {
                            info!("Found child process: PID {}", child_pid);
                            // Kill child process with /F /T
                            let _ = std::process::Command::new("taskkill")
                                .args(["/F", "/T", "/PID", &child_pid.to_string()])
                                .creation_flags(0x08000000)
                                .output();
                        }
                    }
                }
            }
        }

        #[cfg(unix)]
        {
            // On Unix, use pgrep to find child processes
            info!("Searching for child processes of PID {}", parent_pid);

            let output = std::process::Command::new("pgrep")
                .args(["-P", &parent_pid.to_string()])
                .output();

            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let pid_str = line.trim();
                    if !pid_str.is_empty() {
                        if let Ok(child_pid) = pid_str.parse::<i32>() {
                            info!("Found child process: PID {}", child_pid);
                            // Kill child process
                            let _ = std::process::Command::new("kill")
                                .args(["-KILL", &child_pid.to_string()])
                                .output();
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Kill a process by PID using system commands (fallback method)
    pub async fn kill_process_by_pid(&self, run_id: i64, pid: u32) -> Result<bool, String> {
        use log::{error, info, warn};

        info!("Attempting to kill process {} by PID {}", run_id, pid);

        // First, try to kill all child processes
        let _ = self.kill_child_processes(pid);

        let kill_result = if cfg!(target_os = "windows") {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()]) // Added /T to kill process tree
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .output()
            }
            #[cfg(not(target_os = "windows"))]
            {
                // This branch will never be reached due to the outer if condition
                // but is needed for compilation on non-Windows platforms
                std::process::Command::new("kill")
                    .args(["-KILL", &pid.to_string()])
                    .output()
            }
        } else {
            // On Unix, kill the entire process group
            // First try SIGTERM to the process group (negative PID)
            let pgid = format!("-{}", pid); // Negative PID targets the process group
            let term_result = std::process::Command::new("kill")
                .args(["-TERM", &pgid])
                .output();

            match &term_result {
                Ok(output) if output.status.success() => {
                    info!("Sent SIGTERM to process group {}", pid);
                    // Give it 2 seconds to exit gracefully
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

                    // Check if still running
                    let check_result = std::process::Command::new("kill")
                        .args(["-0", &pid.to_string()])
                        .output();

                    if let Ok(output) = check_result {
                        if output.status.success() {
                            // Still running, send SIGKILL to process group
                            warn!(
                                "Process {} still running after SIGTERM, sending SIGKILL to process group",
                                pid
                            );
                            std::process::Command::new("kill")
                                .args(["-KILL", &pgid])
                                .output()
                        } else {
                            term_result
                        }
                    } else {
                        term_result
                    }
                }
                _ => {
                    // SIGTERM to process group failed, try SIGKILL to process group directly
                    warn!(
                        "SIGTERM failed for process group {}, trying SIGKILL to process group",
                        pid
                    );
                    let pgid = format!("-{}", pid);
                    std::process::Command::new("kill")
                        .args(["-KILL", &pgid])
                        .output()
                }
            }
        };

        match kill_result {
            Ok(output) => {
                if output.status.success() {
                    info!("Successfully killed process with PID {}", pid);
                    // Remove from registry
                    self.unregister_process(run_id)?;
                    Ok(true)
                } else {
                    let error_msg = String::from_utf8_lossy(&output.stderr);
                    warn!("Failed to kill PID {}: {}", pid, error_msg);
                    Ok(false)
                }
            }
            Err(e) => {
                error!("Failed to execute kill command for PID {}: {}", pid, e);
                Err(format!("Failed to execute kill command: {}", e))
            }
        }
    }

    /// Check if a process is still running by trying to get its status
    #[allow(dead_code)]
    pub async fn is_process_running(&self, run_id: i64) -> Result<bool, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;

        if let Some(handle) = processes.get(&run_id) {
            let child_arc = handle.child.clone();
            drop(processes); // Release the lock before async operation

            let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut child) = child_guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        // Process has exited
                        *child_guard = None;
                        Ok(false)
                    }
                    Ok(None) => {
                        // Process is still running
                        Ok(true)
                    }
                    Err(_) => {
                        // Error checking status, assume not running
                        *child_guard = None;
                        Ok(false)
                    }
                }
            } else {
                Ok(false) // No child handle
            }
        } else {
            Ok(false) // Process not found in registry
        }
    }

    /// Append to live output for a process
    pub fn append_live_output(&self, run_id: i64, output: &str) -> Result<(), String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = processes.get(&run_id) {
            let mut live_output = handle.live_output.lock().map_err(|e| e.to_string())?;
            // 超出上限时保留最新一半，丢弃最旧的，防止长会话 OOM
            if live_output.len() > MAX_LIVE_OUTPUT_BYTES {
                let drain_to = live_output.len() / 2;
                live_output.drain(..drain_to);
            }
            live_output.push_str(output);
            live_output.push('\n');
        }
        Ok(())
    }

    /// Get live output for a process
    pub fn get_live_output(&self, run_id: i64) -> Result<String, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = processes.get(&run_id) {
            let live_output = handle.live_output.lock().map_err(|e| e.to_string())?;
            Ok(live_output.clone())
        } else {
            Ok(String::new())
        }
    }

    /// Cleanup finished processes
    #[allow(dead_code)]
    pub async fn cleanup_finished_processes(&self) -> Result<Vec<i64>, String> {
        let mut finished_runs = Vec::new();
        let processes_lock = self.processes.clone();

        // First, collect all process IDs (lock released immediately)
        let run_ids: Vec<i64> = {
            let processes = processes_lock.lock().map_err(|e| e.to_string())?;
            processes.keys().cloned().collect()
        }; // ✅ Lock is released here, before any await points

        // Then check each process (no lock held during async operations)
        for run_id in run_ids {
            if !self.is_process_running(run_id).await? {
                finished_runs.push(run_id);
            }
        }

        // Then remove them from the registry
        {
            let mut processes = processes_lock.lock().map_err(|e| e.to_string())?;
            for run_id in &finished_runs {
                processes.remove(run_id);
            }
        }

        Ok(finished_runs)
    }

    /// Kill all processes by name (last resort cleanup)
    /// This finds and kills any remaining claude/node processes
    fn kill_orphaned_processes_by_name(&self) {
        use log::info;

        info!("Performing last-resort cleanup: killing orphaned claude/node processes");

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;

            // Kill any remaining claude.exe processes
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "claude.exe"])
                .creation_flags(0x08000000)
                .output();

            // Kill any remaining node.exe processes that might be spawned by claude
            // Note: This is aggressive and might kill unrelated node processes
            // We'll only do this if we're sure there were claude processes
            info!("Cleaning up any orphaned node processes related to claude");
        }

        #[cfg(unix)]
        {
            // Kill remaining claude processes
            let _ = std::process::Command::new("pkill")
                .args(["-9", "claude"])
                .output();

            info!("Cleaned up any orphaned claude processes");
        }
    }

    /// Kill all registered processes (for application shutdown)
    /// This is a critical cleanup function to prevent orphaned processes
    pub async fn kill_all_processes(&self) -> Result<usize, String> {
        use log::{info, warn};

        info!("Starting cleanup of all registered processes for application shutdown");

        // Get all run IDs with their PIDs
        let process_info: Vec<(i64, u32)> = {
            let processes = self.processes.lock().map_err(|e| e.to_string())?;
            processes
                .iter()
                .map(|(id, handle)| (*id, handle.info.pid))
                .collect()
        };

        let total_processes = process_info.len();
        info!("Found {} processes to cleanup", total_processes);

        let mut killed_count = 0;

        // First pass: Kill child processes explicitly
        for (_run_id, pid) in &process_info {
            let _ = self.kill_child_processes(*pid);
        }

        // Small delay to let child processes terminate
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Second pass: Kill main processes
        for (run_id, _pid) in process_info {
            match self.kill_process(run_id).await {
                Ok(true) => {
                    info!("Successfully killed process {}", run_id);
                    killed_count += 1;
                }
                Ok(false) => {
                    warn!("Process {} was not found or already exited", run_id);
                }
                Err(e) => {
                    warn!("Failed to kill process {}: {}", run_id, e);
                }
            }
        }

        // Final cleanup: Kill any remaining orphaned processes by name
        self.kill_orphaned_processes_by_name();

        info!(
            "Cleanup complete: killed {}/{} processes",
            killed_count, total_processes
        );
        Ok(killed_count)
    }
}

impl Default for ProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Global process registry state
pub struct ProcessRegistryState(pub Arc<ProcessRegistry>);

impl Default for ProcessRegistryState {
    fn default() -> Self {
        Self(Arc::new(ProcessRegistry::new()))
    }
}

impl Drop for ProcessRegistryState {
    fn drop(&mut self) {
        // When the application exits, clean up all processes
        use log::info;
        info!("ProcessRegistryState dropping, cleaning up all processes...");

        // Use a runtime to execute the async cleanup
        let registry = self.0.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            // We're in a tokio runtime context
            handle.block_on(async move {
                match registry.kill_all_processes().await {
                    Ok(count) => {
                        info!("Cleanup on drop: Successfully killed {} processes", count);
                    }
                    Err(e) => {
                        info!("Cleanup on drop: Error killing processes: {}", e);
                    }
                }
            });
        } else {
            // Create a temporary runtime for cleanup
            if let Ok(rt) = tokio::runtime::Runtime::new() {
                rt.block_on(async move {
                    match registry.kill_all_processes().await {
                        Ok(count) => {
                            info!("Cleanup on drop: Successfully killed {} processes", count);
                        }
                        Err(e) => {
                            info!("Cleanup on drop: Error killing processes: {}", e);
                        }
                    }
                });
            }
        }
    }
}
