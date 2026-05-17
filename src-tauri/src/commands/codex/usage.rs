/**
 * Codex Usage Statistics Module
 *
 * Handles usage statistics for Codex sessions including:
 * - Token usage aggregation
 * - Cost calculation
 * - Model-level statistics
 * - Per-project statistics
 */
use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use super::config::get_codex_sessions_dir;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CodexSessionUsage {
    pub session_id: String,
    pub project_path: String,
    pub model: String,
    pub total_cost: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub created_at: u64,
    pub updated_at: u64,
    pub first_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CodexModelUsage {
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
pub struct CodexDailyUsage {
    pub date: String,
    pub total_cost: f64,
    pub total_tokens: u64,
    pub models_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CodexProjectUsage {
    pub project_path: String,
    pub project_name: String,
    pub total_cost: f64,
    pub total_tokens: u64,
    pub session_count: u64,
    pub last_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CodexUsageStats {
    pub total_cost: f64,
    pub total_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_input_tokens: u64,
    pub total_sessions: u64,
    pub by_model: Vec<CodexModelUsage>,
    pub by_date: Vec<CodexDailyUsage>,
    pub by_project: Vec<CodexProjectUsage>,
    pub sessions: Vec<CodexSessionUsage>,
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

fn get_codex_pricing(model: &str) -> ModelPricing {
    let normalized = model.to_lowercase();

    // GPT-5.5 Pro (premium tier)
    if normalized.contains("5.5-pro") || normalized.contains("5_5_pro") {
        return ModelPricing {
            input: 30.00,
            output: 180.00,
            cache_read: 0.00,
        };
    }

    // GPT-5 Pro
    if normalized.contains("gpt-5-pro") || normalized.contains("gpt_5_pro") {
        return ModelPricing {
            input: 15.00,
            output: 120.00,
            cache_read: 0.00,
        };
    }

    // GPT-5.5 (recommended Codex model)
    if normalized.contains("gpt-5.5")
        || normalized.contains("gpt5.5")
        || normalized.contains("gpt_5_5")
        || normalized.contains("5.5")
    {
        return ModelPricing {
            input: 5.00,
            output: 30.00,
            cache_read: 0.50,
        };
    }

    // GPT-5.4 Pro (premium tier)
    if normalized.contains("5.4-pro") || normalized.contains("5_4_pro") {
        return ModelPricing {
            input: 30.00,
            output: 180.00,
            cache_read: 3.00,
        };
    }

    // GPT-5.4 Mini
    if normalized.contains("5.4-mini") || normalized.contains("5_4_mini") {
        return ModelPricing {
            input: 0.75,
            output: 4.50,
            cache_read: 0.075,
        };
    }

    // GPT-5.4 Nano
    if normalized.contains("5.4-nano") || normalized.contains("5_4_nano") {
        return ModelPricing {
            input: 0.20,
            output: 1.25,
            cache_read: 0.02,
        };
    }

    // GPT-5.4 Fast Mode (1.5x speed, 2x credit consumption)
    if normalized.contains("5.4") && normalized.contains("fast") {
        return ModelPricing {
            input: 5.00,
            output: 30.00,
            cache_read: 0.50,
        };
    }

    // GPT-5.4 (latest flagship - March 2026)
    if normalized.contains("gpt-5.4")
        || normalized.contains("gpt5.4")
        || normalized.contains("gpt_5_4")
        || normalized.contains("5.4")
    {
        return ModelPricing {
            input: 2.50,
            output: 15.00,
            cache_read: 0.25,
        };
    }

    // GPT-5.3 Codex Spark (lightweight fast version)
    if normalized.contains("5.3-codex-spark") || normalized.contains("5_3_codex_spark") {
        return ModelPricing {
            input: 1.50,
            output: 12.00,
            cache_read: 0.15,
        };
    }

    // GPT-5.3 Codex (latest - February 2026)
    if normalized.contains("5.3-codex")
        || normalized.contains("5_3_codex")
        || normalized.contains("gpt-5.3")
        || normalized.contains("gpt5.3")
    {
        return ModelPricing {
            input: 2.00,
            output: 16.00,
            cache_read: 0.20,
        };
    }

    // GPT-5.2 Codex
    if normalized.contains("5.2-codex") || normalized.contains("5_2_codex") {
        return ModelPricing {
            input: 1.75,
            output: 14.00,
            cache_read: 0.175,
        };
    }

    // GPT-5.2 (non-codex naming)
    if normalized.contains("gpt-5.2") || normalized.contains("gpt5.2") {
        return ModelPricing {
            input: 1.75,
            output: 14.00,
            cache_read: 0.175,
        };
    }

    // GPT-5.1-Codex variants
    if normalized.contains("5.1-codex-max") || normalized.contains("5_1_codex_max") {
        return ModelPricing {
            input: 1.25,
            output: 10.00,
            cache_read: 0.125,
        };
    }
    if normalized.contains("5.1-codex-mini") || normalized.contains("5_1_codex_mini") {
        return ModelPricing {
            input: 0.25,
            output: 2.00,
            cache_read: 0.025,
        };
    }
    if normalized.contains("5.1-codex") || normalized.contains("5_1_codex") {
        return ModelPricing {
            input: 1.25,
            output: 10.00,
            cache_read: 0.125,
        };
    }

    // GPT-5.1 (non-codex naming)
    if normalized.contains("gpt-5.1") || normalized.contains("gpt5.1") {
        return ModelPricing {
            input: 1.25,
            output: 10.00,
            cache_read: 0.125,
        };
    }

    // codex-mini-latest (default CLI model)
    if normalized.contains("codex-mini-latest") || normalized.contains("codex_mini_latest") {
        return ModelPricing {
            input: 1.50,
            output: 6.00,
            cache_read: 0.375,
        };
    }

    // o4-mini
    if normalized.contains("o4-mini") || normalized.contains("o4_mini") {
        return ModelPricing {
            input: 1.10,
            output: 4.40,
            cache_read: 0.275,
        };
    }

    // Default to gpt-5.5 pricing
    ModelPricing {
        input: 5.00,
        output: 30.00,
        cache_read: 0.50,
    }
}

fn calculate_cost(model: &str, input_tokens: u64, output_tokens: u64, cached_tokens: u64) -> f64 {
    let pricing = get_codex_pricing(model);

    let input_cost = (input_tokens as f64 / 1_000_000.0) * pricing.input;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * pricing.output;
    let cache_cost = (cached_tokens as f64 / 1_000_000.0) * pricing.cache_read;

    input_cost + output_cost + cache_cost
}

// ============================================================================
// Session Parsing
// ============================================================================

fn parse_session_for_usage(path: &PathBuf) -> Option<CodexSessionUsage> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    // Read first line (session_meta)
    let first_line = lines.next()?.ok()?;
    let meta: serde_json::Value = serde_json::from_str(&first_line).ok()?;

    if meta["type"].as_str()? != "session_meta" {
        return None;
    }

    let payload = &meta["payload"];
    let session_id = payload["id"].as_str()?.to_string();
    let timestamp_str = payload["timestamp"].as_str()?;
    let created_at = chrono::DateTime::parse_from_rfc3339(timestamp_str)
        .ok()?
        .timestamp() as u64;

    // Get cwd and convert from WSL path format if needed
    let cwd_raw = payload["cwd"].as_str().unwrap_or("");
    #[cfg(target_os = "windows")]
    let cwd = {
        if cwd_raw.starts_with("/mnt/") {
            super::super::wsl_utils::wsl_to_windows_path(cwd_raw)
        } else {
            cwd_raw.to_string()
        }
    };
    #[cfg(not(target_os = "windows"))]
    let cwd = cwd_raw.to_string();

    // Initialize accumulators
    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut total_cached_tokens: u64 = 0;
    let mut model: String = "unknown".to_string();
    let mut first_message: Option<String> = None;
    let mut last_timestamp: Option<String> = None;
    let mut last_total_input_tokens: Option<u64> = None;
    let mut last_total_output_tokens: Option<u64> = None;
    let mut last_total_cached_tokens: Option<u64> = None;

    // Parse all lines to extract usage data
    for line_result in lines {
        if let Ok(line) = line_result {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                // Update last timestamp
                if let Some(ts) = event["timestamp"].as_str() {
                    last_timestamp = Some(ts.to_string());
                }

                let event_type = event["type"].as_str().unwrap_or("");

                // Extract model from session_meta, model_selected, or turn_context
                if event_type == "session_meta"
                    || event_type == "model_selected"
                    || event_type == "turn_context"
                {
                    if let Some(m) = event["payload"]["model"].as_str() {
                        model = m.to_string();
                    }
                }

                // Extract usage from turn.completed events (incremental usage per turn)
                if event_type == "turn.completed" {
                    if let Some(usage) = event["usage"].as_object() {
                        if let Some(input) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                            total_input_tokens += input;
                        }
                        if let Some(output) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                            total_output_tokens += output;
                        }
                        if let Some(cached) =
                            usage.get("cached_input_tokens").and_then(|v| v.as_u64())
                        {
                            total_cached_tokens += cached;
                        }
                    }
                }

                // Extract usage from token_count events (incremental)
                if event_type == "token_count" {
                    if let Some(payload_obj) = event["payload"].as_object() {
                        if let Some(info) = payload_obj.get("info").and_then(|v| v.as_object()) {
                            if let Some(input) = info.get("input_tokens").and_then(|v| v.as_u64()) {
                                total_input_tokens += input;
                            }
                            if let Some(output) = info.get("output_tokens").and_then(|v| v.as_u64())
                            {
                                total_output_tokens += output;
                            }
                            if let Some(cached) = info
                                .get("cached_input_tokens")
                                .or_else(|| info.get("cached_tokens"))
                                .and_then(|v| v.as_u64())
                            {
                                total_cached_tokens += cached;
                            }
                        }
                    }
                }

                // Extract usage from event_msg token_count events (current CLI format)
                if event_type == "event_msg" {
                    let payload_obj = event["payload"].as_object();
                    let payload_type = payload_obj
                        .and_then(|p| p.get("type"))
                        .and_then(|v| v.as_str());
                    if payload_type == Some("token_count") {
                        if let Some(info) = payload_obj
                            .and_then(|p| p.get("info"))
                            .and_then(|v| v.as_object())
                        {
                            let get_cached =
                                |usage: &serde_json::Map<String, serde_json::Value>| {
                                    usage
                                        .get("cached_input_tokens")
                                        .or_else(|| usage.get("cached_tokens"))
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0)
                                };

                            if let Some(last_usage) =
                                info.get("last_token_usage").and_then(|v| v.as_object())
                            {
                                let input = last_usage
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let output = last_usage
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let cached = get_cached(last_usage);
                                total_input_tokens += input;
                                total_output_tokens += output;
                                total_cached_tokens += cached;
                            } else if let Some(total_usage) =
                                info.get("total_token_usage").and_then(|v| v.as_object())
                            {
                                let input = total_usage
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let output = total_usage
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0);
                                let cached = get_cached(total_usage);

                                let delta_input = match last_total_input_tokens {
                                    Some(prev) if input >= prev => input - prev,
                                    Some(_) => input,
                                    None => input,
                                };
                                let delta_output = match last_total_output_tokens {
                                    Some(prev) if output >= prev => output - prev,
                                    Some(_) => output,
                                    None => output,
                                };
                                let delta_cached = match last_total_cached_tokens {
                                    Some(prev) if cached >= prev => cached - prev,
                                    Some(_) => cached,
                                    None => cached,
                                };

                                total_input_tokens += delta_input;
                                total_output_tokens += delta_output;
                                total_cached_tokens += delta_cached;

                                last_total_input_tokens = Some(input);
                                last_total_output_tokens = Some(output);
                                last_total_cached_tokens = Some(cached);
                            }
                        }
                    }
                }

                // Find first user message
                if first_message.is_none() && event_type == "response_item" {
                    if let Some(payload_obj) = event["payload"].as_object() {
                        if payload_obj.get("role").and_then(|r| r.as_str()) == Some("user") {
                            if let Some(content) =
                                payload_obj.get("content").and_then(|c| c.as_array())
                            {
                                for item in content {
                                    if item["type"].as_str() == Some("input_text") {
                                        if let Some(text) = item["text"].as_str() {
                                            if !text.contains("<environment_context>")
                                                && !text.contains("# AGENTS.md")
                                                && !text.trim().is_empty()
                                            {
                                                first_message = Some(text.to_string());
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let updated_at = last_timestamp
        .as_ref()
        .and_then(|ts| chrono::DateTime::parse_from_rfc3339(ts).ok())
        .map(|dt| dt.timestamp() as u64)
        .unwrap_or(created_at);

    let total_cost = calculate_cost(
        &model,
        total_input_tokens,
        total_output_tokens,
        total_cached_tokens,
    );

    Some(CodexSessionUsage {
        session_id,
        project_path: cwd,
        model,
        total_cost,
        input_tokens: total_input_tokens,
        output_tokens: total_output_tokens,
        cached_input_tokens: total_cached_tokens,
        created_at,
        updated_at,
        first_message,
    })
}

fn collect_all_sessions() -> Vec<CodexSessionUsage> {
    let sessions_dir = match get_codex_sessions_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };

    if !sessions_dir.exists() {
        return Vec::new();
    }

    let mut sessions = Vec::new();

    // Walk through date-organized directories (2025/11/23/rollout-xxx.jsonl)
    if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
        for year_entry in entries.flatten() {
            if let Ok(month_entries) = std::fs::read_dir(year_entry.path()) {
                for month_entry in month_entries.flatten() {
                    if let Ok(day_entries) = std::fs::read_dir(month_entry.path()) {
                        for day_entry in day_entries.flatten() {
                            if day_entry.path().is_dir() {
                                if let Ok(file_entries) = std::fs::read_dir(day_entry.path()) {
                                    for file_entry in file_entries.flatten() {
                                        let path = file_entry.path();
                                        if path.extension().and_then(|s| s.to_str())
                                            == Some("jsonl")
                                        {
                                            if let Some(session) = parse_session_for_usage(&path) {
                                                sessions.push(session);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by creation time (newest first)
    sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sessions
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Get Codex usage statistics
#[tauri::command]
pub async fn get_codex_usage_stats(
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<CodexUsageStats, String> {
    log::info!(
        "get_codex_usage_stats called: start={:?}, end={:?}",
        start_date,
        end_date
    );

    let all_sessions = collect_all_sessions();

    // Filter by date range if provided
    let filtered_sessions: Vec<CodexSessionUsage> =
        if let (Some(start), Some(end)) = (&start_date, &end_date) {
            let start_naive = NaiveDate::parse_from_str(start, "%Y-%m-%d")
                .map_err(|e| format!("Invalid start date: {}", e))?;
            let end_naive = NaiveDate::parse_from_str(end, "%Y-%m-%d")
                .map_err(|e| format!("Invalid end date: {}", e))?;

            all_sessions
                .into_iter()
                .filter(|s| {
                    let session_date =
                        chrono::NaiveDateTime::from_timestamp_opt(s.created_at as i64, 0)
                            .map(|dt| dt.date());
                    if let Some(date) = session_date {
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
    let mut total_cached_tokens = 0u64;

    let mut model_stats: HashMap<String, CodexModelUsage> = HashMap::new();
    let mut daily_stats: HashMap<String, CodexDailyUsage> = HashMap::new();
    let mut project_stats: HashMap<String, CodexProjectUsage> = HashMap::new();

    for session in &filtered_sessions {
        total_cost += session.total_cost;
        total_input_tokens += session.input_tokens;
        total_output_tokens += session.output_tokens;
        total_cached_tokens += session.cached_input_tokens;

        // Update model stats
        let model_stat = model_stats
            .entry(session.model.clone())
            .or_insert(CodexModelUsage {
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
        model_stat.cache_read_tokens += session.cached_input_tokens;
        model_stat.total_tokens = model_stat.input_tokens + model_stat.output_tokens;
        model_stat.session_count += 1;

        // Update daily stats
        let date = chrono::NaiveDateTime::from_timestamp_opt(session.created_at as i64, 0)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let daily_stat = daily_stats.entry(date.clone()).or_insert(CodexDailyUsage {
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

        // Update project stats
        let project_name = session
            .project_path
            .split(['/', '\\'])
            .last()
            .unwrap_or(&session.project_path)
            .to_string();

        let last_used = chrono::NaiveDateTime::from_timestamp_opt(session.updated_at as i64, 0)
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let project_stat =
            project_stats
                .entry(session.project_path.clone())
                .or_insert(CodexProjectUsage {
                    project_path: session.project_path.clone(),
                    project_name,
                    total_cost: 0.0,
                    total_tokens: 0,
                    session_count: 0,
                    last_used: last_used.clone(),
                });
        project_stat.total_cost += session.total_cost;
        project_stat.total_tokens += session.input_tokens + session.output_tokens;
        project_stat.session_count += 1;
        if last_used > project_stat.last_used {
            project_stat.last_used = last_used;
        }
    }

    // Convert to sorted vectors
    let mut by_model: Vec<CodexModelUsage> = model_stats.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap());

    let mut by_date: Vec<CodexDailyUsage> = daily_stats.into_values().collect();
    by_date.sort_by(|a, b| a.date.cmp(&b.date));

    let mut by_project: Vec<CodexProjectUsage> = project_stats.into_values().collect();
    by_project.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap());

    Ok(CodexUsageStats {
        total_cost,
        total_tokens: total_input_tokens + total_output_tokens,
        total_input_tokens,
        total_output_tokens,
        total_cached_input_tokens: total_cached_tokens,
        total_sessions: filtered_sessions.len() as u64,
        by_model,
        by_date,
        by_project,
        sessions: filtered_sessions,
    })
}
