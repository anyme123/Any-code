/**
 * Gemini Usage Statistics Module
 *
 * Handles usage statistics for Gemini sessions including:
 * - Token usage aggregation
 * - Cost calculation
 * - Model-level statistics
 * - Per-project statistics
 */
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use super::config::get_gemini_dir;
use super::types::GeminiSessionDetail;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiSessionUsage {
    pub session_id: String,
    pub project_path: String,
    pub project_hash: String,
    pub model: String,
    pub total_cost: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub start_time: String,
    pub first_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiModelUsage {
    pub model: String,
    pub total_cost: f64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
    pub session_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiDailyUsage {
    pub date: String,
    pub total_cost: f64,
    pub total_tokens: u64,
    pub models_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiProjectUsage {
    pub project_path: String,
    pub project_name: String,
    pub total_cost: f64,
    pub total_tokens: u64,
    pub session_count: u64,
    pub last_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiUsageStats {
    pub total_cost: f64,
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_sessions: u64,
    pub by_model: Vec<GeminiModelUsage>,
    pub by_date: Vec<GeminiDailyUsage>,
    pub by_project: Vec<GeminiProjectUsage>,
    pub sessions: Vec<GeminiSessionUsage>,
}

// ============================================================================
// Pricing (Must match frontend pricing.ts)
// ============================================================================

#[derive(Debug, Clone, Copy)]
struct ModelPricing {
    input: f64,
    output: f64,
    cache_read: f64,
}

fn get_gemini_pricing(model: &str) -> ModelPricing {
    let normalized = model.to_lowercase();

    // Gemini CLI Auto/Pro alias maps to Gemini 3 Pro Preview for conservative estimates.
    if normalized.contains("auto-gemini-3") || normalized == "auto" || normalized == "pro" {
        return ModelPricing {
            input: 2.00,
            output: 12.00,
            cache_read: 0.20,
        };
    }

    // Gemini CLI Flash-Lite alias
    if normalized == "flash-lite" {
        return ModelPricing {
            input: 0.10,
            output: 0.40,
            cache_read: 0.01,
        };
    }

    // Gemini CLI Flash alias / Gemini 3 Flash Preview
    if normalized == "flash"
        || normalized.contains("gemini-3-flash")
        || normalized.contains("gemini_3_flash")
    {
        return ModelPricing {
            input: 0.50,
            output: 3.00,
            cache_read: 0.05,
        };
    }

    // Gemini 3.1 Pro Preview
    if normalized.contains("gemini-3.1-pro")
        || normalized.contains("gemini_3_1_pro")
        || normalized.contains("3.1-pro")
    {
        return ModelPricing {
            input: 2.50,
            output: 15.00,
            cache_read: 0.25,
        };
    }

    // Gemini 3 Pro Preview
    if normalized.contains("gemini-3-pro") || normalized.contains("gemini_3_pro") {
        return ModelPricing {
            input: 2.00,
            output: 12.00,
            cache_read: 0.20,
        };
    }

    // Gemini 2.5 Pro
    if normalized.contains("2.5-pro") || normalized.contains("2_5_pro") {
        return ModelPricing {
            input: 1.25,
            output: 10.00,
            cache_read: 0.125,
        };
    }

    // Gemini 2.5 Flash-Lite
    if normalized.contains("2.5-flash-lite") || normalized.contains("2_5_flash_lite") {
        return ModelPricing {
            input: 0.10,
            output: 0.40,
            cache_read: 0.01,
        };
    }

    // Gemini 2.5 Flash
    if normalized.contains("2.5-flash") || normalized.contains("2_5_flash") {
        return ModelPricing {
            input: 0.30,
            output: 2.50,
            cache_read: 0.03,
        };
    }

    // Gemini 2.0 Flash
    if normalized.contains("2.0-flash") || normalized.contains("2_0_flash") {
        return ModelPricing {
            input: 0.10,
            output: 0.40,
            cache_read: 0.025,
        };
    }

    // Default to Gemini 3 Pro Preview pricing
    ModelPricing {
        input: 2.00,
        output: 12.00,
        cache_read: 0.20,
    }
}

fn calculate_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let pricing = get_gemini_pricing(model);

    let input_cost = (input_tokens as f64 / 1_000_000.0) * pricing.input;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * pricing.output;

    input_cost + output_cost
}

// ============================================================================
// Session Parsing
// ============================================================================

fn read_session_detail_from_path(path: &PathBuf) -> Result<GeminiSessionDetail, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read session file: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse session file: {}", e))
}

fn parse_session_for_usage(path: &PathBuf, project_hash: &str) -> Option<GeminiSessionUsage> {
    let detail = read_session_detail_from_path(path).ok()?;

    // Extract token usage from messages
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut model = "auto-gemini-3".to_string();
    let mut first_message: Option<String> = None;

    for message in &detail.messages {
        // Extract model if available
        if let Some(m) = message.get("model").and_then(|v| v.as_str()) {
            model = m.to_string();
        }

        // Extract tokens if available
        if let Some(tokens) = message.get("tokens").and_then(|v| v.as_object()) {
            if let Some(input) = tokens.get("input").and_then(|v| v.as_u64()) {
                total_input_tokens += input;
            }
            if let Some(output) = tokens.get("output").and_then(|v| v.as_u64()) {
                total_output_tokens += output;
            }
        }

        // Get first user message
        if first_message.is_none() {
            if message.get("type").and_then(|v| v.as_str()) == Some("user") {
                if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
                    // Skip task/subagent messages
                    if !content.trim_start().starts_with("Your task is to") {
                        first_message = Some(content.to_string());
                    }
                }
            }
        }
    }

    // Skip empty sessions
    if total_input_tokens == 0 && total_output_tokens == 0 {
        return None;
    }

    let total_cost = calculate_cost(&model, total_input_tokens, total_output_tokens);

    Some(GeminiSessionUsage {
        session_id: detail.session_id,
        project_path: String::new(), // Will be populated later if we can find it
        project_hash: project_hash.to_string(),
        model,
        total_cost,
        input_tokens: total_input_tokens,
        output_tokens: total_output_tokens,
        start_time: detail.start_time,
        first_message,
    })
}

fn collect_all_sessions() -> Vec<GeminiSessionUsage> {
    let gemini_dir = match get_gemini_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };

    let tmp_dir = gemini_dir.join("tmp");
    if !tmp_dir.exists() {
        return Vec::new();
    }

    let mut sessions = Vec::new();

    // Iterate over all project hash directories
    if let Ok(entries) = fs::read_dir(&tmp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let project_hash = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            // Check chats/ subdirectory
            let chats_dir = path.join("chats");
            if !chats_dir.exists() {
                continue;
            }

            if let Ok(chat_entries) = fs::read_dir(&chats_dir) {
                for chat_entry in chat_entries.flatten() {
                    let chat_path = chat_entry.path();
                    if chat_path.extension().and_then(|s| s.to_str()) == Some("json") {
                        if let Some(mut session) =
                            parse_session_for_usage(&chat_path, &project_hash)
                        {
                            // Try to find project path from session data
                            // For now, use the hash as identifier
                            session.project_path = format!("project:{}", project_hash);
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    // Sort by start time (newest first)
    sessions.sort_by(|a, b| b.start_time.cmp(&a.start_time));
    sessions
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get Gemini usage statistics
#[tauri::command]
pub async fn get_gemini_usage_stats(
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<GeminiUsageStats, String> {
    log::info!(
        "get_gemini_usage_stats called: start={:?}, end={:?}",
        start_date,
        end_date
    );

    let all_sessions = collect_all_sessions();

    // Filter by date range if provided
    let filtered_sessions: Vec<GeminiSessionUsage> =
        if let (Some(start), Some(end)) = (&start_date, &end_date) {
            let start_naive = NaiveDate::parse_from_str(start, "%Y-%m-%d")
                .map_err(|e| format!("Invalid start date: {}", e))?;
            let end_naive = NaiveDate::parse_from_str(end, "%Y-%m-%d")
                .map_err(|e| format!("Invalid end date: {}", e))?;

            all_sessions
                .into_iter()
                .filter(|s| {
                    // Parse start_time (ISO 8601 format)
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&s.start_time) {
                        let date = dt.date_naive();
                        date >= start_naive && date <= end_naive
                    } else {
                        false
                    }
                })
                .collect()
        } else {
            all_sessions
        };

    // Aggregate statistics
    let mut total_cost = 0.0;
    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;

    let mut model_stats: HashMap<String, GeminiModelUsage> = HashMap::new();
    let mut daily_stats: HashMap<String, GeminiDailyUsage> = HashMap::new();
    let mut project_stats: HashMap<String, GeminiProjectUsage> = HashMap::new();

    for session in &filtered_sessions {
        total_cost += session.total_cost;
        total_input_tokens += session.input_tokens;
        total_output_tokens += session.output_tokens;

        // Update model stats
        let model_stat = model_stats
            .entry(session.model.clone())
            .or_insert(GeminiModelUsage {
                model: session.model.clone(),
                total_cost: 0.0,
                total_tokens: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
                session_count: 0,
            });
        model_stat.total_cost += session.total_cost;
        model_stat.input_tokens += session.input_tokens;
        model_stat.output_tokens += session.output_tokens;
        model_stat.total_tokens = model_stat.input_tokens + model_stat.output_tokens;
        model_stat.session_count += 1;

        // Update daily stats
        let date = if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&session.start_time) {
            dt.format("%Y-%m-%d").to_string()
        } else {
            session
                .start_time
                .split('T')
                .next()
                .unwrap_or("unknown")
                .to_string()
        };

        let daily_stat = daily_stats.entry(date.clone()).or_insert(GeminiDailyUsage {
            date,
            total_cost: 0.0,
            total_tokens: 0,
            models_used: vec![],
        });
        daily_stat.total_cost += session.total_cost;
        daily_stat.total_tokens += session.input_tokens + session.output_tokens;
        if !daily_stat.models_used.contains(&session.model) {
            daily_stat.models_used.push(session.model.clone());
        }

        // Update project stats (use project_hash as key)
        let project_name = if session.project_path.starts_with("project:") {
            session.project_hash.chars().take(8).collect::<String>()
        } else {
            session
                .project_path
                .split(['/', '\\'])
                .last()
                .unwrap_or(&session.project_path)
                .to_string()
        };

        let project_stat =
            project_stats
                .entry(session.project_hash.clone())
                .or_insert(GeminiProjectUsage {
                    project_path: session.project_path.clone(),
                    project_name,
                    total_cost: 0.0,
                    total_tokens: 0,
                    session_count: 0,
                    last_used: session.start_time.clone(),
                });
        project_stat.total_cost += session.total_cost;
        project_stat.total_tokens += session.input_tokens + session.output_tokens;
        project_stat.session_count += 1;
        if session.start_time > project_stat.last_used {
            project_stat.last_used = session.start_time.clone();
        }
    }

    // Convert to sorted vectors
    let mut by_model: Vec<GeminiModelUsage> = model_stats.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap());

    let mut by_date: Vec<GeminiDailyUsage> = daily_stats.into_values().collect();
    by_date.sort_by(|a, b| a.date.cmp(&b.date));

    let mut by_project: Vec<GeminiProjectUsage> = project_stats.into_values().collect();
    by_project.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap());

    Ok(GeminiUsageStats {
        total_cost,
        total_tokens: total_input_tokens + total_output_tokens,
        total_input_tokens,
        total_output_tokens,
        total_sessions: filtered_sessions.len() as u64,
        by_model,
        by_date,
        by_project,
        sessions: filtered_sessions,
    })
}
