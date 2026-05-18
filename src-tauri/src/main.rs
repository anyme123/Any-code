// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude_binary;
mod commands;
mod process;
mod utils; // 新增：通用工具模块

// MCP 多应用支持模块
mod mcp;
mod claude_mcp;
mod codex_mcp;
mod gemini_mcp;

use claude_binary::init_shell_environment;

use std::sync::{Arc, Mutex};

use commands::acemcp::{
    enhance_prompt_with_context, export_acemcp_sidecar, get_extracted_sidecar_path,
    load_acemcp_config, preindex_project, save_acemcp_config, test_acemcp_availability,
};
use commands::claude::{
    cancel_claude_execution, check_claude_version, clear_custom_claude_path, continue_claude_code,
    delete_project, delete_project_permanently, delete_session, delete_sessions_batch,
    execute_claude_code, find_claude_md_files, get_available_tools, get_claude_execution_config,
    get_claude_path, get_claude_permission_config, get_claude_session_output, get_claude_settings,
    get_codex_system_prompt, get_hooks_config, get_permission_presets, get_project_sessions,
    get_system_prompt, list_directory_contents, list_hidden_projects, list_projects,
    list_running_claude_sessions, load_session_history, open_new_session, read_claude_md_file,
    reset_claude_execution_config, restore_project, resume_claude_code, save_claude_md_file,
    save_claude_settings, save_codex_system_prompt, save_system_prompt, search_files,
    set_custom_claude_path, update_claude_execution_config, update_claude_permission_config,
    update_hooks_config, update_thinking_mode, validate_hook_command, validate_permission_config,
    // Claude WSL mode configuration
    get_claude_wsl_mode_config, set_claude_wsl_mode_config,
    ClaudeProcessState,
};
use commands::mcp::{
    mcp_add, mcp_add_from_claude_desktop, mcp_add_json, mcp_export_config, mcp_get,
    mcp_get_server_status, mcp_list, mcp_read_project_config, mcp_remove,
    mcp_reset_project_choices, mcp_save_project_config, mcp_serve, mcp_test_connection,
    // 多应用 MCP 支持（新增）
    mcp_get_claude_status, mcp_upsert_server, mcp_delete_server, mcp_toggle_app,
    mcp_import_from_app, mcp_validate_command, mcp_read_claude_config, mcp_get_all_servers,
    mcp_get_unified_servers,
    // 多引擎独立隔离控制 API（新设计）
    mcp_get_engine_servers, mcp_upsert_engine_server, mcp_delete_engine_server,
    mcp_toggle_engine_server, mcp_get_engine_servers_with_status,
};
use commands::storage::{init_database, AgentDb};

use commands::clipboard::{read_from_clipboard, save_clipboard_image, write_to_clipboard};
use commands::prompt_tracker::{
    check_rewind_capabilities, get_prompt_list, get_unified_prompt_list, mark_prompt_completed,
    record_prompt_sent, revert_to_prompt,
};
use commands::provider::{
    add_provider_config, clear_provider_config, delete_provider_config, fetch_anthropic_models,
    get_current_provider_config, get_provider_config, get_provider_presets, query_provider_usage,
    reorder_provider_configs, switch_provider_config, test_provider_connection, update_provider_config,
};
use commands::simple_git::{check_and_init_git, check_reset_safety, precise_revert_code};
use commands::storage::{
    storage_analyze_query, storage_delete_row, storage_execute_sql, storage_get_performance_stats,
    storage_insert_row, storage_list_tables, storage_read_table, storage_reset_database,
    storage_update_row,
};
use commands::translator::{
    clear_translation_cache, detect_text_language, get_translation_cache_stats,
    get_translation_config, init_translation_service_command, translate, translate_batch,
    update_translation_config,
};
use commands::usage::{get_session_stats, get_usage_by_date_range, get_usage_stats};
use commands::window::{
    broadcast_to_session_windows, close_session_window, create_session_window, emit_to_window,
    focus_session_window, list_session_windows, set_titlebar_theme,
};

use commands::codex::{
    add_codex_provider_config,
    cancel_codex,
    check_codex_availability,
    check_codex_rewind_capabilities,
    clear_codex_provider_config,
    clear_custom_codex_path,
    convert_claude_to_codex,
    convert_codex_to_claude,
    // Session conversion
    convert_session,
    delete_codex_provider_config,
    delete_codex_session,
    execute_codex,
    // Codex mode configuration
    get_codex_mode_config,
    get_codex_path,
    get_codex_prompt_list,
    // Codex provider management
    get_codex_provider_presets,
    // Codex usage statistics
    get_codex_usage_stats,
    get_current_codex_config,
    list_codex_sessions,
    load_codex_session_history,
    record_codex_prompt_completed,
    // Codex rewind commands
    record_codex_prompt_sent,
    reorder_codex_provider_configs,
    resume_codex,
    resume_last_codex,
    revert_codex_to_prompt,
    set_codex_mode_config,
    set_custom_codex_path,
    switch_codex_provider,
    test_codex_provider_connection,
    update_codex_provider_config,
    update_codex_reasoning_level,
    get_codex_multi_agent_config,
    set_codex_multi_agent_config,
    validate_codex_path_cmd,
    CodexProcessState,
};
use commands::enhanced_hooks::{
    execute_pre_commit_review, test_hook_condition, trigger_hook_event,
};
use commands::extensions::{
    create_skill, create_subagent, list_agent_skills, list_custom_slash_commands,
    list_gemini_custom_slash_commands, list_plugins, list_subagents, open_agents_directory,
    open_commands_directory, open_plugins_directory, open_skills_directory, read_skill,
    read_subagent, reinstall_plugin, toggle_plugin_enabled, uninstall_plugin,
};
use commands::file_operations::{open_directory_in_explorer, open_file_with_default_app, open_path_in_editor};
use commands::gemini::{
    add_gemini_provider_config,
    cancel_gemini,
    check_gemini_installed,
    check_gemini_rewind_capabilities,
    clear_gemini_provider_config,
    delete_gemini_provider_config,
    delete_gemini_session,
    execute_gemini,
    get_current_gemini_provider_config,
    get_gemini_config,
    get_gemini_models,
    // Gemini Rewind commands
    get_gemini_prompt_list,
    // Gemini Provider commands
    get_gemini_provider_presets,
    get_gemini_session_detail,
    get_gemini_session_logs,
    get_gemini_system_prompt,
    // Gemini Usage Statistics
    get_gemini_usage_stats,
    // Gemini WSL commands
    get_gemini_wsl_mode_config,
    list_gemini_sessions,
    record_gemini_prompt_completed,
    record_gemini_prompt_sent,
    reorder_gemini_provider_configs,
    revert_gemini_to_prompt,
    save_gemini_system_prompt,
    set_gemini_wsl_mode_config,
    switch_gemini_provider,
    test_gemini_provider_connection,
    update_gemini_config,
    update_gemini_provider_config,
    GeminiProcessState,
};
use commands::git_stats::{get_git_diff_stats, get_session_code_changes};
use process::ProcessRegistryState;
use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::Builder as WindowStatePlugin;

fn main() {
    // Initialize logger
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            WindowStatePlugin::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all())
                .build(),
        )
        .setup(|app| {
            // Initialize shell environment for macOS GUI applications
            // This must be done early to ensure CLI tools (claude, codex, etc.) can be found
            init_shell_environment();

            // Initialize database for storage operations
            let conn = init_database(&app.handle()).expect("Failed to initialize database");
            app.manage(AgentDb(Mutex::new(conn)));

            // Initialize process registry
            app.manage(ProcessRegistryState::default());

            // Initialize Claude process state
            app.manage(ClaudeProcessState::default());

            // Initialize Codex process state
            app.manage(CodexProcessState::default());

            // Initialize Gemini process state
            app.manage(GeminiProcessState::default());

            // Initialize auto-compact manager for context management
            let auto_compact_manager =
                Arc::new(commands::context_manager::AutoCompactManager::new());
            let app_handle_for_monitor = app.handle().clone();
            let manager_for_monitor = auto_compact_manager.clone();

            // Start monitoring in background
            tauri::async_runtime::spawn(async move {
                if let Err(e) = manager_for_monitor
                    .start_monitoring(app_handle_for_monitor)
                    .await
                {
                    log::error!("Failed to start auto-compact monitoring: {}", e);
                }
            });

            app.manage(commands::context_manager::AutoCompactState(
                auto_compact_manager,
            ));

            // Initialize translation service with saved configuration
            tauri::async_runtime::spawn(async move {
                commands::translator::init_translation_service_with_saved_config().await;
            });

            // Fallback window show mechanism for macOS
            // In case frontend JS fails to execute window.show()
            if let Some(main_window) = app.get_webview_window("main") {
                let window_clone = main_window.clone();
                tauri::async_runtime::spawn(async move {
                    // Wait for frontend to potentially show the window first
                    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
                    // Show window as fallback (no-op if already visible)
                    if let Err(e) = window_clone.show() {
                        log::error!("Fallback: Failed to show main window: {}", e);
                    }
                    if let Err(e) = window_clone.set_focus() {
                        log::error!("Fallback: Failed to focus main window: {}", e);
                    }
                    log::info!("Fallback window show mechanism executed");
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle main window close - close all session windows
            if let WindowEvent::CloseRequested { .. } = event {
                let window_label = window.label();

                // If main window is closing, close all session windows
                if window_label == "main" {
                    log::info!("[Window] Main window closing, closing all session windows");

                    let app = window.app_handle();
                    let windows_to_close: Vec<String> = app
                        .webview_windows()
                        .keys()
                        .filter(|label| label.starts_with("session-window-"))
                        .cloned()
                        .collect();

                    for label in windows_to_close {
                        if let Some(win) = app.get_webview_window(&label) {
                            log::info!("[Window] Closing session window: {}", label);
                            if let Err(e) = win.close() {
                                log::error!(
                                    "[Window] Failed to close session window {}: {}",
                                    label,
                                    e
                                );
                            }
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Claude & Project Management
            list_projects,
            get_project_sessions,
            delete_session,
            delete_sessions_batch,
            delete_project,
            restore_project,
            list_hidden_projects,
            delete_project_permanently,
            get_claude_settings,
            open_new_session,
            get_system_prompt,
            get_codex_system_prompt,
            check_claude_version,
            save_system_prompt,
            save_codex_system_prompt,
            save_claude_settings,
            update_thinking_mode,
            find_claude_md_files,
            read_claude_md_file,
            save_claude_md_file,
            load_session_history,
            execute_claude_code,
            continue_claude_code,
            resume_claude_code,
            cancel_claude_execution,
            list_running_claude_sessions,
            get_claude_session_output,
            list_directory_contents,
            search_files,
            get_hooks_config,
            update_hooks_config,
            validate_hook_command,
            // 权限管理命令
            get_claude_execution_config,
            update_claude_execution_config,
            reset_claude_execution_config,
            get_claude_permission_config,
            update_claude_permission_config,
            get_permission_presets,
            get_available_tools,
            validate_permission_config,
            set_custom_claude_path,
            get_claude_path,
            clear_custom_claude_path,
            // Claude WSL Mode Configuration
            get_claude_wsl_mode_config,
            set_claude_wsl_mode_config,
            // Acemcp Integration
            enhance_prompt_with_context,
            test_acemcp_availability,
            save_acemcp_config,
            load_acemcp_config,
            preindex_project,
            export_acemcp_sidecar,
            get_extracted_sidecar_path,
            // Enhanced Hooks Automation
            trigger_hook_event,
            test_hook_condition,
            execute_pre_commit_review,
            // Usage & Analytics (Simplified from opcode)
            get_usage_stats,
            get_usage_by_date_range,
            get_session_stats,
            // MCP (Model Context Protocol)
            mcp_add,
            mcp_list,
            mcp_get,
            mcp_remove,
            mcp_add_json,
            mcp_add_from_claude_desktop,
            mcp_serve,
            mcp_test_connection,
            mcp_reset_project_choices,
            mcp_get_server_status,
            mcp_export_config,
            mcp_read_project_config,
            mcp_save_project_config,
            // MCP 多应用支持（新增）
            mcp_get_claude_status,
            mcp_upsert_server,
            mcp_delete_server,
            mcp_toggle_app,
            mcp_import_from_app,
            mcp_validate_command,
            mcp_read_claude_config,
            mcp_get_all_servers,
            mcp_get_unified_servers,
            // 多引擎独立隔离控制 API
            mcp_get_engine_servers,
            mcp_upsert_engine_server,
            mcp_delete_engine_server,
            mcp_toggle_engine_server,
            mcp_get_engine_servers_with_status,
            // Storage Management
            storage_list_tables,
            storage_read_table,
            storage_update_row,
            storage_delete_row,
            storage_insert_row,
            storage_execute_sql,
            storage_reset_database,
            storage_get_performance_stats,
            storage_analyze_query,
            // Clipboard
            save_clipboard_image,
            write_to_clipboard,
            read_from_clipboard,
            // Provider Management
            get_provider_presets,
            get_current_provider_config,
            switch_provider_config,
            clear_provider_config,
            test_provider_connection,
            fetch_anthropic_models,
            add_provider_config,
            update_provider_config,
            delete_provider_config,
            get_provider_config,
            query_provider_usage,
            reorder_provider_configs,
            // Translation
            translate,
            translate_batch,
            get_translation_config,
            update_translation_config,
            clear_translation_cache,
            get_translation_cache_stats,
            detect_text_language,
            init_translation_service_command,
            // Auto-Compact Context Management
            commands::context_commands::init_auto_compact_manager,
            commands::context_commands::register_auto_compact_session,
            commands::context_commands::update_session_context,
            commands::context_commands::trigger_manual_compaction,
            commands::context_commands::get_auto_compact_config,
            commands::context_commands::update_auto_compact_config,
            commands::context_commands::get_session_context_stats,
            commands::context_commands::get_all_monitored_sessions,
            commands::context_commands::unregister_auto_compact_session,
            commands::context_commands::stop_auto_compact_monitoring,
            commands::context_commands::start_auto_compact_monitoring,
            commands::context_commands::get_auto_compact_status,
            // Prompt Revert System
            check_and_init_git,
            check_reset_safety,
            precise_revert_code,
            record_prompt_sent,
            mark_prompt_completed,
            revert_to_prompt,
            get_prompt_list,
            get_unified_prompt_list,
            check_rewind_capabilities,
            // Claude Extensions (Plugins, Subagents, Skills & Custom Commands)
            list_plugins,
            toggle_plugin_enabled,
            uninstall_plugin,
            reinstall_plugin,
            list_subagents,
            list_agent_skills,
            list_custom_slash_commands,
            list_gemini_custom_slash_commands,
            read_subagent,
            read_skill,
            create_subagent,
            create_skill,
            open_plugins_directory,
            open_agents_directory,
            open_skills_directory,
            open_commands_directory,
            // File Operations
            open_directory_in_explorer,
            open_file_with_default_app,
            open_path_in_editor,
            // Git Statistics
            get_git_diff_stats,
            get_session_code_changes,
            // OpenAI Codex Integration
            execute_codex,
            resume_codex,
            resume_last_codex,
            cancel_codex,
            list_codex_sessions,
            delete_codex_session,
            load_codex_session_history,
            get_codex_prompt_list,
            check_codex_rewind_capabilities,
            check_codex_availability,
            // Codex Mode Configuration
            get_codex_mode_config,
            set_codex_mode_config,
            // Codex Rewind Commands
            record_codex_prompt_sent,
            record_codex_prompt_completed,
            revert_codex_to_prompt,
            // Codex custom path
            validate_codex_path_cmd,
            set_custom_codex_path,
            get_codex_path,
            clear_custom_codex_path,
            // Codex Provider Management
            get_codex_provider_presets,
            get_current_codex_config,
            switch_codex_provider,
            add_codex_provider_config,
            update_codex_provider_config,
            delete_codex_provider_config,
            clear_codex_provider_config,
            test_codex_provider_connection,
            update_codex_reasoning_level,
            get_codex_multi_agent_config,
            set_codex_multi_agent_config,
            reorder_codex_provider_configs,
            // Codex Usage Statistics
            get_codex_usage_stats,
            // Session Conversion (Claude ↔ Codex)
            convert_session,
            convert_claude_to_codex,
            convert_codex_to_claude,
            // Window Management (Multi-window support)
            create_session_window,
            close_session_window,
            list_session_windows,
            focus_session_window,
            emit_to_window,
            broadcast_to_session_windows,
            set_titlebar_theme,
            // Google Gemini CLI Integration
            execute_gemini,
            cancel_gemini,
            check_gemini_installed,
            get_gemini_config,
            update_gemini_config,
            get_gemini_models,
            // Gemini Session History
            get_gemini_session_logs,
            list_gemini_sessions,
            get_gemini_session_detail,
            delete_gemini_session,
            // Gemini System Prompt
            get_gemini_system_prompt,
            save_gemini_system_prompt,
            // Gemini Rewind Commands
            get_gemini_prompt_list,
            check_gemini_rewind_capabilities,
            record_gemini_prompt_sent,
            record_gemini_prompt_completed,
            revert_gemini_to_prompt,
            // Gemini Provider Commands
            get_gemini_provider_presets,
            get_current_gemini_provider_config,
            switch_gemini_provider,
            add_gemini_provider_config,
            update_gemini_provider_config,
            delete_gemini_provider_config,
            clear_gemini_provider_config,
            test_gemini_provider_connection,
            reorder_gemini_provider_configs,
            // Gemini WSL Commands
            get_gemini_wsl_mode_config,
            set_gemini_wsl_mode_config,
            // Gemini Usage Statistics
            get_gemini_usage_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
