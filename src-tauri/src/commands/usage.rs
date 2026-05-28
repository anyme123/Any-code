// Simplified usage tracking from opcode project
// Source: https://github.com/meistrari/opcode

use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageEntry {
    timestamp: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    cost: f64,
    session_id: String,
    project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsageStats {
    total_cost: f64,
    total_tokens: u64,
    total_input_tokens: u64,
    total_output_tokens: u64,
    total_cache_creation_tokens: u64,
    total_cache_read_tokens: u64,
    total_sessions: u64,
    by_model: Vec<ModelUsage>,
    by_date: Vec<DailyUsage>,
    by_project: Vec<ProjectUsage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelUsage {
    model: String,
    total_cost: f64,
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    session_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyUsage {
    date: String,
    total_cost: f64,
    total_tokens: u64,
    models_used: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectUsage {
    project_path: String,
    project_name: String,
    total_cost: f64,
    total_tokens: u64,
    session_count: u64,
    last_used: String,
}

// ============================================================================
// Claude Model Pricing - Single Source of Truth
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// Last Updated: February 2026
// ============================================================================

/// Model pricing structure (prices per million tokens)
#[derive(Debug, Clone, Copy)]
struct ModelPricing {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

/// Model family enumeration for categorization
#[derive(Debug, Clone, Copy, PartialEq)]
enum ModelFamily {
    Opus47,     // Claude 4.7 Opus
    Opus47Fast, // Claude 4.7 Opus Fast Mode
    Opus46,     // Claude 4.6 Opus
    Opus46Fast, // Claude 4.6 Opus Fast Mode
    Sonnet46,   // Claude 4.6 Sonnet
    Opus45,     // Claude 4.5 Opus
    Opus41,     // Claude 4.1 Opus
    Sonnet45,   // Claude 4.5 Sonnet
    Haiku45,    // Claude 4.5 Haiku
    Unknown,    // Unknown model
}

impl ModelPricing {
    /// Get pricing for a specific model family
    const fn for_family(family: ModelFamily) -> Self {
        match family {
            // Claude 4.7/4.6 Series
            ModelFamily::Opus47 => ModelPricing {
                input: 5.0,
                output: 25.0,
                cache_write: 6.25,
                cache_read: 0.50,
            },
            ModelFamily::Opus47Fast => ModelPricing {
                input: 30.0,
                output: 150.0,
                cache_write: 37.5,
                cache_read: 3.0,
            },
            ModelFamily::Opus46 => ModelPricing {
                input: 5.0,
                output: 25.0,
                cache_write: 6.25,
                cache_read: 0.50,
            },
            ModelFamily::Opus46Fast => ModelPricing {
                input: 30.0,
                output: 150.0,
                cache_write: 37.5,
                cache_read: 3.0,
            },
            ModelFamily::Sonnet46 => ModelPricing {
                input: 3.0,
                output: 15.0,
                cache_write: 3.75,
                cache_read: 0.30,
            },
            // Claude 4.5 Series
            ModelFamily::Opus45 => ModelPricing {
                input: 5.0,
                output: 25.0,
                cache_write: 6.25,
                cache_read: 0.50,
            },
            ModelFamily::Sonnet45 => ModelPricing {
                input: 3.0,
                output: 15.0,
                cache_write: 3.75,
                cache_read: 0.30,
            },
            ModelFamily::Haiku45 => ModelPricing {
                input: 1.0,
                output: 5.0,
                cache_write: 1.25,
                cache_read: 0.10,
            },
            // Claude 4.1 Series
            ModelFamily::Opus41 => ModelPricing {
                input: 15.0,
                output: 75.0,
                cache_write: 18.75,
                cache_read: 1.50,
            },
            ModelFamily::Unknown => ModelPricing {
                input: 0.0,
                output: 0.0,
                cache_write: 0.0,
                cache_read: 0.0,
            },
        }
    }
}

/// Parse model name and determine its family
///
/// This function handles various model name formats including:
/// - Full names: claude-sonnet-4-5-20250929
/// - Aliases: claude-sonnet-4-5
/// - Short names: sonnet-4-5
/// - Bedrock format: anthropic.claude-sonnet-4-5-20250929-v1:0
/// - Vertex AI format: claude-sonnet-4-5@20250929
fn parse_model_family(model: &str) -> ModelFamily {
    // Normalize the model name (lowercase + remove common prefixes/suffixes)
    let mut normalized = model.to_lowercase();
    normalized = normalized.replace("anthropic.", "");
    normalized = normalized.replace("-v1:0", "");

    // Handle @ symbol for Vertex AI format
    if let Some(pos) = normalized.find('@') {
        normalized = normalized[..pos].to_string();
    }

    // Priority-based matching (order matters!)
    // Check for specific model families in order from most to least specific

    // Claude 4.7 Series
    if normalized.contains("opus") && (normalized.contains("4.7") || normalized.contains("4-7")) {
        if normalized.contains("fast") {
            return ModelFamily::Opus47Fast;
        }
        return ModelFamily::Opus47;
    }

    // Claude 4.6 Series
    if normalized.contains("opus") && (normalized.contains("4.6") || normalized.contains("4-6")) {
        if normalized.contains("fast") {
            return ModelFamily::Opus46Fast;
        }
        return ModelFamily::Opus46;
    }
    if normalized.contains("sonnet") && (normalized.contains("4.6") || normalized.contains("4-6")) {
        return ModelFamily::Sonnet46;
    }

    // Claude 4.5 Series (Latest)
    if normalized.contains("opus") && (normalized.contains("4.5") || normalized.contains("4-5")) {
        return ModelFamily::Opus45;
    }
    if normalized.contains("haiku") && (normalized.contains("4.5") || normalized.contains("4-5")) {
        return ModelFamily::Haiku45;
    }
    if normalized.contains("sonnet") && (normalized.contains("4.5") || normalized.contains("4-5")) {
        return ModelFamily::Sonnet45;
    }

    // Claude 4.1 Series
    if normalized.contains("opus") && (normalized.contains("4.1") || normalized.contains("4-1")) {
        return ModelFamily::Opus41;
    }

    // Generic family detection (fallback)
    if normalized.contains("haiku") {
        return ModelFamily::Haiku45; // Default to latest Haiku
    }
    if normalized.contains("opus") {
        return ModelFamily::Opus47; // Default to latest Opus
    }
    if normalized.contains("sonnet") {
        return ModelFamily::Sonnet46; // Default to latest Sonnet
    }

    ModelFamily::Unknown
}

#[derive(Debug, Deserialize)]
struct JsonlEntry {
    timestamp: String,
    message: Option<MessageData>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "costUSD")]
    cost_usd: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct MessageData {
    id: Option<String>,
    model: Option<String>,
    usage: Option<UsageData>,
}

#[derive(Debug, Deserialize)]
struct UsageData {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

/// Calculate cost for a model usage
///
/// This is the single source of truth for cost calculations.
/// All cost computations in the application should ultimately use this function.
fn calculate_cost(model: &str, usage: &UsageData) -> f64 {
    let input_tokens = usage.input_tokens.unwrap_or(0) as f64;
    let output_tokens = usage.output_tokens.unwrap_or(0) as f64;
    let cache_creation_tokens = usage.cache_creation_input_tokens.unwrap_or(0) as f64;
    let cache_read_tokens = usage.cache_read_input_tokens.unwrap_or(0) as f64;

    // Parse model and get pricing
    let family = parse_model_family(model);
    let pricing = ModelPricing::for_family(family);

    // Log unrecognized models for debugging
    if family == ModelFamily::Unknown {
        log::warn!(
            "Unknown model detected: '{}'. Cost calculation will return 0.",
            model
        );
    }

    // Calculate cost (prices are per million tokens)
    let cost = (input_tokens * pricing.input / 1_000_000.0)
        + (output_tokens * pricing.output / 1_000_000.0)
        + (cache_creation_tokens * pricing.cache_write / 1_000_000.0)
        + (cache_read_tokens * pricing.cache_read / 1_000_000.0);

    cost
}

fn parse_jsonl_file(
    path: &PathBuf,
    encoded_project_name: &str,
    processed_hashes: &mut HashSet<String>,
) -> Vec<UsageEntry> {
    let mut entries = Vec::new();
    let mut actual_project_path: Option<String> = None;

    if let Ok(content) = fs::read_to_string(path) {
        // Extract session ID from the file path
        let session_id = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(line) {
                // Extract the actual project path from cwd if we haven't already
                if actual_project_path.is_none() {
                    if let Some(cwd) = json_value.get("cwd").and_then(|v| v.as_str()) {
                        actual_project_path = Some(cwd.to_string());
                    }
                }

                // Try to parse as JsonlEntry for usage data
                if let Ok(entry) = serde_json::from_value::<JsonlEntry>(json_value) {
                    if let Some(message) = &entry.message {
                        // Deduplication based on message ID and request ID
                        if let (Some(msg_id), Some(req_id)) = (&message.id, &entry.request_id) {
                            let unique_hash = format!("{}:{}", msg_id, req_id);
                            if processed_hashes.contains(&unique_hash) {
                                continue; // Skip duplicate entry
                            }
                            processed_hashes.insert(unique_hash);
                        }

                        if let Some(usage) = &message.usage {
                            // Skip entries without meaningful token usage
                            if usage.input_tokens.unwrap_or(0) == 0
                                && usage.output_tokens.unwrap_or(0) == 0
                                && usage.cache_creation_input_tokens.unwrap_or(0) == 0
                                && usage.cache_read_input_tokens.unwrap_or(0) == 0
                            {
                                continue;
                            }

                            let cost = entry.cost_usd.unwrap_or_else(|| {
                                if let Some(model_str) = &message.model {
                                    calculate_cost(model_str, usage)
                                } else {
                                    0.0
                                }
                            });

                            // Use actual project path if found, otherwise use encoded name
                            let project_path = actual_project_path
                                .clone()
                                .unwrap_or_else(|| encoded_project_name.to_string());

                            entries.push(UsageEntry {
                                timestamp: entry.timestamp,
                                model: message
                                    .model
                                    .clone()
                                    .unwrap_or_else(|| "unknown".to_string()),
                                input_tokens: usage.input_tokens.unwrap_or(0),
                                output_tokens: usage.output_tokens.unwrap_or(0),
                                cache_creation_tokens: usage
                                    .cache_creation_input_tokens
                                    .unwrap_or(0),
                                cache_read_tokens: usage.cache_read_input_tokens.unwrap_or(0),
                                cost,
                                session_id: entry.session_id.unwrap_or_else(|| session_id.clone()),
                                project_path,
                            });
                        }
                    }
                }
            }
        }
    }

    entries
}

fn get_earliest_timestamp(path: &PathBuf) -> Option<String> {
    if let Ok(content) = fs::read_to_string(path) {
        let mut earliest_timestamp: Option<String> = None;
        for line in content.lines() {
            if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(timestamp_str) = json_value.get("timestamp").and_then(|v| v.as_str()) {
                    if let Some(current_earliest) = &earliest_timestamp {
                        if timestamp_str < current_earliest.as_str() {
                            earliest_timestamp = Some(timestamp_str.to_string());
                        }
                    } else {
                        earliest_timestamp = Some(timestamp_str.to_string());
                    }
                }
            }
        }
        return earliest_timestamp;
    }
    None
}

fn get_all_usage_entries(claude_path: &PathBuf) -> Vec<UsageEntry> {
    let mut all_entries = Vec::new();
    let mut processed_hashes = HashSet::new();
    let projects_dir = claude_path.join("projects");

    let mut files_to_process: Vec<(PathBuf, String)> = Vec::new();

    if let Ok(projects) = fs::read_dir(&projects_dir) {
        for project in projects.flatten() {
            if project.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let project_name = project.file_name().to_string_lossy().to_string();
                let project_path = project.path();

                walkdir::WalkDir::new(&project_path)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
                    .for_each(|entry| {
                        files_to_process.push((entry.path().to_path_buf(), project_name.clone()));
                    });
            }
        }
    }

    // Sort files by their earliest timestamp to ensure chronological processing
    // and deterministic deduplication
    files_to_process.sort_by_cached_key(|(path, _)| get_earliest_timestamp(path));

    for (path, project_name) in files_to_process {
        let entries = parse_jsonl_file(&path, &project_name, &mut processed_hashes);
        all_entries.extend(entries);
    }

    // Sort by timestamp
    all_entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    all_entries
}

#[command]
pub fn get_usage_stats(days: Option<u32>) -> Result<UsageStats, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let all_entries = get_all_usage_entries(&claude_path);

    if all_entries.is_empty() {
        return Ok(UsageStats {
            total_cost: 0.0,
            total_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_creation_tokens: 0,
            total_cache_read_tokens: 0,
            total_sessions: 0,
            by_model: vec![],
            by_date: vec![],
            by_project: vec![],
        });
    }

    // Filter by days if specified
    // 🚀 修复时区问题：使用本地时区进行日期比较
    let filtered_entries = if let Some(days) = days {
        let cutoff = Local::now().date_naive() - chrono::Duration::days(days as i64);
        all_entries
            .into_iter()
            .filter(|e| {
                if let Ok(dt) = DateTime::parse_from_rfc3339(&e.timestamp) {
                    // 转换为本地时区后提取日期进行比较
                    dt.with_timezone(&Local).date_naive() >= cutoff
                } else {
                    false
                }
            })
            .collect()
    } else {
        all_entries
    };

    // Calculate aggregated stats
    let mut total_cost = 0.0;
    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;
    let mut total_cache_creation_tokens = 0u64;
    let mut total_cache_read_tokens = 0u64;

    let mut model_stats: HashMap<String, ModelUsage> = HashMap::new();
    let mut daily_stats: HashMap<String, DailyUsage> = HashMap::new();
    let mut project_stats: HashMap<String, ProjectUsage> = HashMap::new();

    for entry in &filtered_entries {
        // Update totals
        total_cost += entry.cost;
        total_input_tokens += entry.input_tokens;
        total_output_tokens += entry.output_tokens;
        total_cache_creation_tokens += entry.cache_creation_tokens;
        total_cache_read_tokens += entry.cache_read_tokens;

        // Update model stats
        let model_stat = model_stats
            .entry(entry.model.clone())
            .or_insert(ModelUsage {
                model: entry.model.clone(),
                total_cost: 0.0,
                total_tokens: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
                session_count: 0,
            });
        model_stat.total_cost += entry.cost;
        model_stat.input_tokens += entry.input_tokens;
        model_stat.output_tokens += entry.output_tokens;
        model_stat.cache_creation_tokens += entry.cache_creation_tokens;
        model_stat.cache_read_tokens += entry.cache_read_tokens;
        model_stat.total_tokens = model_stat.input_tokens + model_stat.output_tokens;
        model_stat.session_count += 1;

        // Update daily stats
        // 🚀 修复时区问题：使用本地日期而不是 UTC 日期
        let date = if let Ok(dt) = DateTime::parse_from_rfc3339(&entry.timestamp) {
            // 转换为本地时间后提取日期
            dt.with_timezone(&Local).format("%Y-%m-%d").to_string()
        } else {
            // 降级：直接从字符串提取（可能不准确）
            entry
                .timestamp
                .split('T')
                .next()
                .unwrap_or(&entry.timestamp)
                .to_string()
        };
        let daily_stat = daily_stats.entry(date.clone()).or_insert(DailyUsage {
            date,
            total_cost: 0.0,
            total_tokens: 0,
            models_used: vec![],
        });
        daily_stat.total_cost += entry.cost;
        daily_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        if !daily_stat.models_used.contains(&entry.model) {
            daily_stat.models_used.push(entry.model.clone());
        }

        // Update project stats
        let project_stat =
            project_stats
                .entry(entry.project_path.clone())
                .or_insert(ProjectUsage {
                    project_path: entry.project_path.clone(),
                    project_name: entry
                        .project_path
                        .split('/')
                        .last()
                        .unwrap_or(&entry.project_path)
                        .to_string(),
                    total_cost: 0.0,
                    total_tokens: 0,
                    session_count: 0,
                    last_used: entry.timestamp.clone(),
                });
        project_stat.total_cost += entry.cost;
        project_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        project_stat.session_count += 1;
        if entry.timestamp > project_stat.last_used {
            project_stat.last_used = entry.timestamp.clone();
        }
    }

    let total_tokens = total_input_tokens
        + total_output_tokens
        + total_cache_creation_tokens
        + total_cache_read_tokens;
    let total_sessions = filtered_entries.len() as u64;

    // Convert hashmaps to sorted vectors
    let mut by_model: Vec<ModelUsage> = model_stats.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(Ordering::Equal));

    let mut by_date: Vec<DailyUsage> = daily_stats.into_values().collect();
    by_date.sort_by(|a, b| a.date.cmp(&b.date));

    let mut by_project: Vec<ProjectUsage> = project_stats.into_values().collect();
    by_project.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(Ordering::Equal));

    Ok(UsageStats {
        total_cost,
        total_tokens,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_sessions,
        by_model,
        by_date,
        by_project,
    })
}

#[command]
pub fn get_usage_by_date_range(start_date: String, end_date: String) -> Result<UsageStats, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let all_entries = get_all_usage_entries(&claude_path);

    // Parse dates
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").or_else(|_| {
        DateTime::parse_from_rfc3339(&start_date)
            .map(|dt| dt.naive_local().date())
            .map_err(|e| format!("Invalid start date: {}", e))
    })?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").or_else(|_| {
        DateTime::parse_from_rfc3339(&end_date)
            .map(|dt| dt.naive_local().date())
            .map_err(|e| format!("Invalid end date: {}", e))
    })?;

    // Filter entries by date range
    // 🚀 修复时区问题：转换为本地时区后进行日期比较
    let filtered_entries: Vec<_> = all_entries
        .into_iter()
        .filter(|e| {
            if let Ok(dt) = DateTime::parse_from_rfc3339(&e.timestamp) {
                // 先转换为本地时区，再提取日期进行比较
                let date = dt.with_timezone(&Local).date_naive();
                date >= start && date <= end
            } else {
                false
            }
        })
        .collect();

    if filtered_entries.is_empty() {
        return Ok(UsageStats {
            total_cost: 0.0,
            total_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_creation_tokens: 0,
            total_cache_read_tokens: 0,
            total_sessions: 0,
            by_model: vec![],
            by_date: vec![],
            by_project: vec![],
        });
    }

    // Calculate aggregated stats from filtered entries
    let mut total_cost = 0.0;
    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;
    let mut total_cache_creation_tokens = 0u64;
    let mut total_cache_read_tokens = 0u64;

    let mut model_stats: HashMap<String, ModelUsage> = HashMap::new();
    let mut daily_stats: HashMap<String, DailyUsage> = HashMap::new();
    let mut project_stats: HashMap<String, ProjectUsage> = HashMap::new();

    for entry in &filtered_entries {
        // Update totals
        total_cost += entry.cost;
        total_input_tokens += entry.input_tokens;
        total_output_tokens += entry.output_tokens;
        total_cache_creation_tokens += entry.cache_creation_tokens;
        total_cache_read_tokens += entry.cache_read_tokens;

        // Update model stats
        let model_stat = model_stats
            .entry(entry.model.clone())
            .or_insert(ModelUsage {
                model: entry.model.clone(),
                total_cost: 0.0,
                total_tokens: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
                session_count: 0,
            });
        model_stat.total_cost += entry.cost;
        model_stat.input_tokens += entry.input_tokens;
        model_stat.output_tokens += entry.output_tokens;
        model_stat.cache_creation_tokens += entry.cache_creation_tokens;
        model_stat.cache_read_tokens += entry.cache_read_tokens;
        model_stat.total_tokens = model_stat.input_tokens + model_stat.output_tokens;
        model_stat.session_count += 1;

        // Update daily stats
        // 🚀 修复时区问题：使用本地日期而不是 UTC 日期
        let date = if let Ok(dt) = DateTime::parse_from_rfc3339(&entry.timestamp) {
            // 转换为本地时间后提取日期
            dt.with_timezone(&Local).format("%Y-%m-%d").to_string()
        } else {
            // 降级：直接从字符串提取（可能不准确）
            entry
                .timestamp
                .split('T')
                .next()
                .unwrap_or(&entry.timestamp)
                .to_string()
        };
        let daily_stat = daily_stats.entry(date.clone()).or_insert(DailyUsage {
            date,
            total_cost: 0.0,
            total_tokens: 0,
            models_used: vec![],
        });
        daily_stat.total_cost += entry.cost;
        daily_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        if !daily_stat.models_used.contains(&entry.model) {
            daily_stat.models_used.push(entry.model.clone());
        }

        // Update project stats
        let project_stat =
            project_stats
                .entry(entry.project_path.clone())
                .or_insert(ProjectUsage {
                    project_path: entry.project_path.clone(),
                    project_name: entry
                        .project_path
                        .split('/')
                        .last()
                        .unwrap_or(&entry.project_path)
                        .to_string(),
                    total_cost: 0.0,
                    total_tokens: 0,
                    session_count: 0,
                    last_used: entry.timestamp.clone(),
                });
        project_stat.total_cost += entry.cost;
        project_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        project_stat.session_count += 1;
        if entry.timestamp > project_stat.last_used {
            project_stat.last_used = entry.timestamp.clone();
        }
    }

    let unique_sessions: HashSet<_> = filtered_entries.iter().map(|e| &e.session_id).collect();

    let mut by_model: Vec<ModelUsage> = model_stats.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(Ordering::Equal));

    let mut by_date: Vec<DailyUsage> = daily_stats.into_values().collect();
    by_date.sort_by(|a, b| a.date.cmp(&b.date));

    let mut by_project: Vec<ProjectUsage> = project_stats.into_values().collect();
    by_project.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(Ordering::Equal));

    Ok(UsageStats {
        total_cost,
        total_tokens: total_input_tokens
            + total_output_tokens
            + total_cache_creation_tokens
            + total_cache_read_tokens,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_sessions: unique_sessions.len() as u64,
        by_model,
        by_date,
        by_project,
    })
}

#[command]
pub fn get_session_stats(
    since: Option<String>,
    until: Option<String>,
    order: Option<String>,
) -> Result<Vec<ProjectUsage>, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let all_entries = get_all_usage_entries(&claude_path);

    // Filter by date range if provided
    // 🚀 修复时区问题：转换为本地时区后进行日期比较
    let filtered_entries: Vec<_> = all_entries
        .into_iter()
        .filter(|e| {
            if let (Some(since_str), Some(until_str)) = (&since, &until) {
                if let (Ok(since_date), Ok(until_date)) = (
                    NaiveDate::parse_from_str(since_str, "%Y%m%d"),
                    NaiveDate::parse_from_str(until_str, "%Y%m%d"),
                ) {
                    if let Ok(dt) = DateTime::parse_from_rfc3339(&e.timestamp) {
                        // 先转换为本地时区，再提取日期进行比较
                        let date = dt.with_timezone(&Local).date_naive();
                        return date >= since_date && date <= until_date;
                    }
                }
            }
            true
        })
        .collect();

    // Group by project
    let mut project_stats: HashMap<String, ProjectUsage> = HashMap::new();
    for entry in filtered_entries {
        let project_stat =
            project_stats
                .entry(entry.project_path.clone())
                .or_insert(ProjectUsage {
                    project_path: entry.project_path.clone(),
                    project_name: entry
                        .project_path
                        .split('/')
                        .last()
                        .unwrap_or(&entry.project_path)
                        .to_string(),
                    total_cost: 0.0,
                    total_tokens: 0,
                    session_count: 0,
                    last_used: entry.timestamp.clone(),
                });
        project_stat.total_cost += entry.cost;
        project_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        project_stat.session_count += 1;
        if entry.timestamp > project_stat.last_used {
            project_stat.last_used = entry.timestamp.clone();
        }
    }

    let mut by_session: Vec<ProjectUsage> = project_stats.into_values().collect();

    // Sort by order
    let order_str = order.unwrap_or_else(|| "desc".to_string());
    if order_str == "asc" {
        by_session.sort_by(|a, b| a.total_cost.partial_cmp(&b.total_cost).unwrap_or(Ordering::Equal));
    } else {
        by_session.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap_or(Ordering::Equal));
    }

    Ok(by_session)
}
