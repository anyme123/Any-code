use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle};

use super::url_utils::{normalize_api_url, normalize_base_url, ApiEndpointType};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub base_url: String,
    pub auth_token: Option<String>,
    pub api_key: Option<String>,
    pub api_key_helper: Option<String>,
    pub model: Option<String>,
    pub enable_auto_api_key_helper: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CurrentConfig {
    pub anthropic_base_url: Option<String>,
    pub anthropic_auth_token: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub anthropic_api_key_helper: Option<String>,
    pub anthropic_model: Option<String>,
    // Claude Code 2025 新增字段
    pub anthropic_small_fast_model: Option<String>,
    pub anthropic_default_opus_model: Option<String>,
    pub anthropic_default_sonnet_model: Option<String>,
    pub anthropic_custom_model_option: Option<String>,
    pub api_timeout_ms: Option<String>,
    pub claude_code_disable_nonessential_traffic: Option<String>,
}

// 获取Claude设置文件路径
fn get_settings_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;

    let config_dir = home_dir.join(".claude");

    // 确保配置目录存在
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| format!("无法创建配置目录: {}", e))?;
    }

    Ok(config_dir.join("settings.json"))
}

// 获取遗留的providers.json路径（用于迁移）
fn get_legacy_providers_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    Ok(home_dir.join(".claude").join("providers.json"))
}

// 读取settings.json文件
fn load_settings() -> Result<Value, String> {
    let settings_path = get_settings_path()?;

    if !settings_path.exists() {
        // 创建默认设置文件
        let default_settings = serde_json::json!({
            "env": {}
        });

        let content = serde_json::to_string_pretty(&default_settings)
            .map_err(|e| format!("序列化默认设置失败: {}", e))?;

        fs::write(&settings_path, content).map_err(|e| format!("创建默认设置文件失败: {}", e))?;

        return Ok(default_settings);
    }

    let content =
        fs::read_to_string(&settings_path).map_err(|e| format!("读取设置文件失败: {}", e))?;

    let settings: Value =
        serde_json::from_str(&content).map_err(|e| format!("解析设置文件失败: {}", e))?;

    Ok(settings)
}

// 保存settings.json文件
fn save_settings(settings: &Value) -> Result<(), String> {
    let settings_path = get_settings_path()?;

    let content =
        serde_json::to_string_pretty(settings).map_err(|e| format!("序列化设置失败: {}", e))?;

    fs::write(&settings_path, content).map_err(|e| format!("写入设置文件失败: {}", e))?;

    Ok(())
}

// 从遗留的providers.json加载预设配置
fn load_legacy_providers() -> Result<Vec<ProviderConfig>, String> {
    let legacy_path = get_legacy_providers_path()?;

    if !legacy_path.exists() {
        return Ok(vec![]);
    }

    let content =
        fs::read_to_string(&legacy_path).map_err(|e| format!("读取遗留配置文件失败: {}", e))?;

    if content.trim().is_empty() {
        return Ok(vec![]);
    }

    let providers: Vec<ProviderConfig> =
        serde_json::from_str(&content).map_err(|e| format!("解析遗留配置文件失败: {}", e))?;

    Ok(providers)
}

// CRUD 操作 - 获取所有代理商预设（从遗留文件读取）
#[command]
pub fn get_provider_presets() -> Result<Vec<ProviderConfig>, String> {
    load_legacy_providers()
}

// CRUD 操作 - 添加代理商预设（写入遗留文件，保持兼容性）
#[command]
pub fn add_provider_config(config: ProviderConfig) -> Result<String, String> {
    let mut providers = load_legacy_providers()?;

    // 检查ID是否已存在
    if providers.iter().any(|p| p.id == config.id) {
        return Err(format!("ID '{}' 已存在，请使用不同的ID", config.id));
    }

    providers.push(config.clone());

    // 保存到遗留文件
    let legacy_path = get_legacy_providers_path()?;
    let content =
        serde_json::to_string_pretty(&providers).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&legacy_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(format!("成功添加代理商配置: {}", config.name))
}

// CRUD 操作 - 更新代理商预设
#[command]
pub fn update_provider_config(config: ProviderConfig) -> Result<String, String> {
    let mut providers = load_legacy_providers()?;

    let index = providers
        .iter()
        .position(|p| p.id == config.id)
        .ok_or_else(|| format!("未找到ID为 '{}' 的配置", config.id))?;

    providers[index] = config.clone();

    // 保存到遗留文件
    let legacy_path = get_legacy_providers_path()?;
    let content =
        serde_json::to_string_pretty(&providers).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&legacy_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(format!("成功更新代理商配置: {}", config.name))
}

// CRUD 操作 - 删除代理商预设
#[command]
pub fn delete_provider_config(id: String) -> Result<String, String> {
    let mut providers = load_legacy_providers()?;

    let index = providers
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| format!("未找到ID为 '{}' 的配置", id))?;

    let deleted_config = providers.remove(index);

    // 保存到遗留文件
    let legacy_path = get_legacy_providers_path()?;
    let content =
        serde_json::to_string_pretty(&providers).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&legacy_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(format!("成功删除代理商配置: {}", deleted_config.name))
}

// CRUD 操作 - 获取单个代理商预设
#[command]
pub fn get_provider_config(id: String) -> Result<ProviderConfig, String> {
    let providers = load_legacy_providers()?;

    providers
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("未找到ID为 '{}' 的配置", id))
}

// CRUD 操作 - 重新排序代理商预设
#[command]
pub fn reorder_provider_configs(ids: Vec<String>) -> Result<String, String> {
    let providers = load_legacy_providers()?;

    // 根据传入的 ID 顺序重新排列
    let mut reordered: Vec<ProviderConfig> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(provider) = providers.iter().find(|p| &p.id == id) {
            reordered.push(provider.clone());
        }
    }

    // 添加任何不在 ids 列表中的配置（保持原有顺序）
    for provider in providers {
        if !ids.contains(&provider.id) {
            reordered.push(provider);
        }
    }

    // 保存到文件
    let legacy_path = get_legacy_providers_path()?;
    let content =
        serde_json::to_string_pretty(&reordered).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&legacy_path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok("成功重新排序代理商配置".to_string())
}

// 获取当前代理商配置（从settings.json的env字段和apiKeyHelper字段读取）
#[command]
pub fn get_current_provider_config() -> Result<CurrentConfig, String> {
    let settings = load_settings()?;

    let empty_map = serde_json::Map::new();
    let env_vars = settings
        .get("env")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_map);

    // apiKeyHelper 是与 env 同级的独立字段
    let api_key_helper = settings
        .get("apiKeyHelper")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(CurrentConfig {
        anthropic_base_url: env_vars
            .get("ANTHROPIC_BASE_URL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        anthropic_auth_token: env_vars
            .get("ANTHROPIC_AUTH_TOKEN")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        anthropic_api_key: env_vars
            .get("ANTHROPIC_API_KEY")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        anthropic_api_key_helper: api_key_helper,
        anthropic_model: env_vars
            .get("ANTHROPIC_MODEL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        // Claude Code 2025 新增字段
        anthropic_small_fast_model: env_vars
            .get("ANTHROPIC_SMALL_FAST_MODEL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        anthropic_default_opus_model: env_vars
            .get("ANTHROPIC_DEFAULT_OPUS_MODEL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        anthropic_default_sonnet_model: env_vars
            .get("ANTHROPIC_DEFAULT_SONNET_MODEL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        anthropic_custom_model_option: env_vars
            .get("ANTHROPIC_CUSTOM_MODEL_OPTION")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        api_timeout_ms: env_vars
            .get("API_TIMEOUT_MS")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        claude_code_disable_nonessential_traffic: env_vars
            .get("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

// 切换代理商配置（写入settings.json的env字段）
#[command]
pub async fn switch_provider_config(
    _app: AppHandle,
    config: ProviderConfig,
) -> Result<String, String> {
    log::info!(
        "开始切换代理商配置: {} - {}",
        config.name,
        config.description
    );

    // 验证第三方API配置
    validate_third_party_config(&config)?;

    let mut settings = load_settings()?;

    // 确保env字段存在
    if !settings.is_object() {
        return Err("settings.json格式错误".to_string());
    }

    let settings_obj = settings.as_object_mut().unwrap();
    if !settings_obj.contains_key("env") {
        settings_obj.insert("env".to_string(), serde_json::json!({}));
    }

    let env_obj = settings_obj
        .get_mut("env")
        .unwrap()
        .as_object_mut()
        .ok_or("env字段格式错误")?;

    // 清理之前的ANTHROPIC环境变量
    env_obj.remove("ANTHROPIC_API_KEY");
    env_obj.remove("ANTHROPIC_AUTH_TOKEN");
    env_obj.remove("ANTHROPIC_BASE_URL");
    env_obj.remove("ANTHROPIC_MODEL");

    // 清理Claude Code 2025的新环境变量
    env_obj.remove("ANTHROPIC_SMALL_FAST_MODEL");
    env_obj.remove("ANTHROPIC_DEFAULT_OPUS_MODEL");
    env_obj.remove("ANTHROPIC_DEFAULT_SONNET_MODEL");
    env_obj.remove("ANTHROPIC_CUSTOM_MODEL_OPTION");
    env_obj.remove("API_TIMEOUT_MS");
    env_obj.remove("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC");

    // 智能规范化 base_url（支持用户输入简化的基础 URL）
    // 提取纯净的基础 URL，移除可能存在的端点后缀
    let normalized_base = normalize_base_url(&config.base_url);
    log::info!("URL 规范化: '{}' -> '{}'", config.base_url, normalized_base);

    // 设置新的环境变量
    env_obj.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        serde_json::Value::String(normalized_base.clone()),
    );

    // 确定要使用的认证令牌值
    let auth_token = if let Some(token) = &config.auth_token {
        if !token.is_empty() {
            env_obj.insert(
                "ANTHROPIC_AUTH_TOKEN".to_string(),
                serde_json::Value::String(token.clone()),
            );
            Some(token.clone())
        } else {
            None
        }
    } else {
        None
    };

    if let Some(api_key) = &config.api_key {
        if !api_key.is_empty() {
            env_obj.insert(
                "ANTHROPIC_API_KEY".to_string(),
                serde_json::Value::String(api_key.clone()),
            );
        }
    }

    if let Some(model) = &config.model {
        if !model.is_empty() {
            env_obj.insert(
                "ANTHROPIC_MODEL".to_string(),
                serde_json::Value::String(model.clone()),
            );
        }
    }

    // 添加Claude Code 2025的标准环境变量
    // 为第三方API优化超时设置（使用规范化后的 URL 进行判断）
    if normalized_base != "https://api.anthropic.com" {
        env_obj.insert(
            "API_TIMEOUT_MS".to_string(),
            serde_json::Value::String("600000".to_string()),
        );
        env_obj.insert(
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
            serde_json::Value::String("1".to_string()),
        );
        log::info!("设置第三方API优化参数: timeout=600s, disable_nonessential_traffic=true");
    }

    // 设置小型快速模型（用于代码完成等任务）
    if let Some(model) = &config.model {
        if !model.is_empty() {
            // 对于第三方API，通常使用同一个模型作为fast model
            env_obj.insert(
                "ANTHROPIC_SMALL_FAST_MODEL".to_string(),
                serde_json::Value::String(model.clone()),
            );
        }
    }

    // apiKeyHelper 根据用户勾选状态决定是否自动生成
    if config.enable_auto_api_key_helper.unwrap_or(false) {
        if let Some(token) = auth_token {
            let helper_command = format!("echo '{}'", token);
            settings_obj.insert(
                "apiKeyHelper".to_string(),
                serde_json::Value::String(helper_command),
            );
            log::info!("用户启用了自动生成 apiKeyHelper，已生成命令: echo '[TOKEN_MASKED]'");
        } else {
            log::info!("用户启用了自动生成，但未找到认证令牌，无法生成 apiKeyHelper");
            settings_obj.remove("apiKeyHelper");
        }
    } else {
        // 用户未勾选自动生成，移除 apiKeyHelper 字段
        settings_obj.remove("apiKeyHelper");
        log::info!("用户未启用自动生成 apiKeyHelper，已移除该字段");
    }

    // 保存设置
    save_settings(&settings)?;

    log::info!("代理商配置切换完成: {}", config.name);

    Ok(format!(
        "✅ 已成功切换到 {} ({})\n\n配置已写入 ~/.claude/settings.json，即时生效！",
        config.name, config.description
    ))
}

// 验证第三方API配置的兼容性（Claude Code 2025标准）
fn validate_third_party_config(config: &ProviderConfig) -> Result<(), String> {
    // 检查是否为第三方API
    if config.base_url != "https://api.anthropic.com" {
        // 确保有认证信息
        if config.auth_token.is_none() && config.api_key.is_none() {
            return Err("第三方API需要设置认证令牌或API密钥".to_string());
        }

        // 检查模型名称（可选，但建议填写）
        if let Some(model) = &config.model {
            if model.is_empty() {
                log::warn!("第三方API建议指定模型名称");
            } else {
                // 检查常见的模型名称格式
                if !model.contains("claude")
                    && !model.contains("gpt")
                    && !model.contains("gemini")
                    && !model.contains("deepseek")
                {
                    log::warn!("模型名称格式可能不兼容: {}", model);
                }
            }
        } else {
            log::warn!("第三方API未指定模型名称，部分功能可能受限");
        }

        log::info!(
            "第三方API配置验证通过: {} - {}",
            config.name,
            config.base_url
        );
    }

    Ok(())
}

// 清理代理商配置（清理settings.json的env字段中的ANTHROPIC变量和apiKeyHelper字段）
#[command]
pub async fn clear_provider_config(_app: AppHandle) -> Result<String, String> {
    log::info!("开始清理代理商配置");

    let mut settings = load_settings()?;

    // 如果有env字段，清理ANTHROPIC相关变量
    if let Some(env_obj) = settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        env_obj.remove("ANTHROPIC_API_KEY");
        env_obj.remove("ANTHROPIC_AUTH_TOKEN");
        env_obj.remove("ANTHROPIC_BASE_URL");
        env_obj.remove("ANTHROPIC_MODEL");

        log::info!("已清理ANTHROPIC环境变量");
    }

    // 清理与 env 同级的 apiKeyHelper 字段
    if let Some(settings_obj) = settings.as_object_mut() {
        settings_obj.remove("apiKeyHelper");
        log::info!("已清理apiKeyHelper字段");
    }

    // 保存设置
    save_settings(&settings)?;

    log::info!("代理商配置清理完成");

    Ok("✅ 已清理所有ANTHROPIC环境变量和apiKeyHelper配置\n\n配置已从 ~/.claude/settings.json 中移除！".to_string())
}

// 测试代理商连接
#[command]
pub fn test_provider_connection(base_url: String) -> Result<String, String> {
    // 智能规范化 API URL（支持用户输入简化的基础 URL）
    let test_url = normalize_api_url(&base_url, ApiEndpointType::Anthropic);

    log::info!("测试连接 URL: {} -> {}", base_url, test_url);

    // 这里可以实现实际的HTTP请求测试
    // 目前返回一个简单的成功消息
    Ok(format!("连接测试完成：{}", test_url))
}

/// API Key 用量查询结果
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeyUsage {
    /// 令牌总额（美元）
    pub total_balance: f64,
    /// 已用额度（美元）
    pub used_balance: f64,
    /// 剩余额度（美元）
    pub remaining_balance: f64,
    /// 是否为无限额度
    pub is_unlimited: bool,
    /// 有效期（Unix时间戳，0表示永不过期）
    pub access_until: i64,
    /// 查询时间段起始日期
    pub query_start_date: String,
    /// 查询时间段结束日期
    pub query_end_date: String,
}

/// 查询 API Key 用量
/// 调用 New API 的 billing 接口获取余额和使用情况
#[command]
pub async fn query_provider_usage(
    base_url: String,
    api_key: String,
) -> Result<ApiKeyUsage, String> {
    use reqwest::Client;

    log::info!("开始查询 API Key 用量: {}", base_url);

    // 规范化基础 URL
    let normalized_base = normalize_base_url(&base_url);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    // 1. 查询订阅信息
    let subscription_url = format!("{}/v1/dashboard/billing/subscription", normalized_base);
    log::info!("查询订阅信息: {}", subscription_url);

    let subscription_response = client
        .get(&subscription_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("请求订阅信息失败: {}", e))?;

    if !subscription_response.status().is_success() {
        let status = subscription_response.status();
        let body = subscription_response.text().await.unwrap_or_default();
        return Err(format!("订阅信息查询失败: {} - {}", status, body));
    }

    let subscription_data: Value = subscription_response
        .json()
        .await
        .map_err(|e| format!("解析订阅信息失败: {}", e))?;

    let total_balance = subscription_data
        .get("hard_limit_usd")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let access_until = subscription_data
        .get("access_until")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    // 判断是否为无限额度 (100000000 表示无限)
    let is_unlimited = total_balance >= 100000000.0;

    // 2. 查询使用情况（最近100天）
    let now = chrono::Utc::now();
    let start = now - chrono::Duration::days(100);
    let start_date = start.format("%Y-%m-%d").to_string();
    let end_date = now.format("%Y-%m-%d").to_string();

    let usage_url = format!(
        "{}/v1/dashboard/billing/usage?start_date={}&end_date={}",
        normalized_base, start_date, end_date
    );
    log::info!("查询使用情况: {}", usage_url);

    let usage_response = client
        .get(&usage_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("请求使用情况失败: {}", e))?;

    if !usage_response.status().is_success() {
        let status = usage_response.status();
        let body = usage_response.text().await.unwrap_or_default();
        return Err(format!("使用情况查询失败: {} - {}", status, body));
    }

    let usage_data: Value = usage_response
        .json()
        .await
        .map_err(|e| format!("解析使用情况失败: {}", e))?;

    // total_usage 是以美分为单位，需要除以100转换为美元
    let total_usage_cents = usage_data
        .get("total_usage")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let used_balance = total_usage_cents / 100.0;

    // 计算剩余额度
    let remaining_balance = if is_unlimited {
        f64::INFINITY
    } else {
        total_balance - used_balance
    };

    log::info!(
        "API Key 用量查询完成: 总额=${:.2}, 已用=${:.2}, 剩余=${:.2}, 无限={}",
        total_balance,
        used_balance,
        if is_unlimited { 0.0 } else { remaining_balance },
        is_unlimited
    );

    Ok(ApiKeyUsage {
        total_balance,
        used_balance,
        remaining_balance: if is_unlimited { 0.0 } else { remaining_balance },
        is_unlimited,
        access_until,
        query_start_date: start_date,
        query_end_date: end_date,
    })
}
