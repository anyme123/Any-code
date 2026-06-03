use base64::{engine::general_purpose, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{command, AppHandle};

// ⚡ 新增：文本剪贴板支持
use arboard::Clipboard;

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedImageResult {
    pub success: bool,
    pub file_path: Option<String>,
    pub error: Option<String>,
}

/// 保存Base64图片数据到临时文件
#[command]
pub async fn save_clipboard_image(
    _app: AppHandle,
    base64_data: String,
    format: Option<String>,
) -> Result<SavedImageResult, String> {
    println!("Received base64_data length: {}", base64_data.len());
    println!(
        "Base64 data preview: {}",
        &base64_data[..std::cmp::min(100, base64_data.len())]
    );

    // 解析Data URL格式 (data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...)
    let data_url_prefix = "data:image/";
    let (base64_content, extension) = if base64_data.starts_with(data_url_prefix) {
        // 找到逗号位置，分离元数据和Base64数据
        let comma_pos = base64_data
            .find(",")
            .ok_or_else(|| "Invalid data URL format: missing comma separator".to_string())?;

        // 提取MIME类型信息
        let mime_part = &base64_data[data_url_prefix.len()..comma_pos];
        let extension = if mime_part.contains("png") {
            "png"
        } else if mime_part.contains("jpeg") || mime_part.contains("jpg") {
            "jpg"
        } else if mime_part.contains("gif") {
            "gif"
        } else if mime_part.contains("webp") {
            "webp"
        } else {
            "png" // 默认为PNG
        };

        // 提取纯Base64内容
        let base64_content = &base64_data[comma_pos + 1..];
        (base64_content, extension)
    } else {
        // 如果没有Data URL前缀，假设是纯Base64数据
        (base64_data.as_str(), format.as_deref().unwrap_or("png"))
    };

    println!("Detected extension: {}", extension);
    println!("Base64 content length: {}", base64_content.len());

    // 解码Base64数据
    let image_data = general_purpose::STANDARD
        .decode(base64_content)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    println!("Decoded image data size: {} bytes", image_data.len());

    // 获取用户临时目录，确保使用完整路径
    let temp_dir = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMP"))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());

    // 规范化路径，确保获得完整的长文件名路径
    let temp_dir = temp_dir.canonicalize().unwrap_or(temp_dir);

    let images_dir = temp_dir.join("claude_workbench_clipboard_images");

    // 创建目录
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images directory: {}", e))?;

    // 生成唯一文件名
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S_%3f");
    let filename = format!("clipboard_image_{}.{}", timestamp, extension);
    let file_path = images_dir.join(&filename);

    println!("Saving image to: {}", file_path.display());

    // 保存文件
    fs::write(&file_path, image_data).map_err(|e| format!("Failed to write image file: {}", e))?;

    // 验证文件是否成功保存
    if !file_path.exists() {
        return Ok(SavedImageResult {
            success: false,
            file_path: None,
            error: Some("File was not saved successfully".to_string()),
        });
    }

    let file_size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);

    println!("Image saved successfully! File size: {} bytes", file_size);

    // 返回清洁的Windows文件路径，移除UNC前缀
    let mut path_str = file_path.to_string_lossy().to_string();

    // 移除Windows长路径前缀 \\?\
    if path_str.starts_with("\\\\?\\") {
        path_str = path_str[4..].to_string();
    }

    // 🔥 关键修复：将反斜杠统一替换为正斜杠
    // Claude Code CLI 的 @文件引用解析器面向 Unix 实现，会把反斜杠当转义字符消费
    // （如 @C:\Users\x\img.png 中的 \U \x 被吞掉，路径塌缩为 C:Usersximg.png 导致找不到文件）。
    // 正斜杠在 @引用正则中是普通路径字符，Win32 与 Node 均接受，盘符保留，无转义风险。
    // 参见 anthropics/claude-code issues #19338 / #6898。
    path_str = path_str.replace('\\', "/");

    println!("Final cleaned path: {}", path_str);

    Ok(SavedImageResult {
        success: true,
        file_path: Some(path_str),
        error: None,
    })
}

/// 写入文本到剪贴板
#[command]
pub async fn write_to_clipboard(text: String) -> Result<(), String> {
    log::info!("Writing to clipboard, text length: {}", text.len());

    // 使用 arboard 库（跨平台剪贴板）
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;

    clipboard
        .set_text(&text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    log::info!("Successfully wrote to clipboard");
    Ok(())
}

/// 从剪贴板读取文本
#[command]
pub async fn read_from_clipboard() -> Result<String, String> {
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;

    let text = clipboard
        .get_text()
        .map_err(|e| format!("Failed to read from clipboard: {}", e))?;

    Ok(text)
}
