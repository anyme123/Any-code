use std::process::Command as StdCommand;

fn try_editor_command(editor: &str, file_path: &str, line: Option<u32>, column: Option<u32>) -> Result<(), String> {
    let mut cmd = StdCommand::new(editor);

    match editor {
        "idea" | "webstorm" | "pycharm" | "goland" | "rubymine" | "phpstorm" | "clion" | "rider" => {
            if let Some(l) = line {
                cmd.arg("--line").arg(l.to_string());
                if let Some(c) = column {
                    cmd.arg("--column").arg(c.to_string());
                }
            }
            cmd.arg(file_path);
        }
        _ => {
            let goto = match (line, column) {
                (Some(l), Some(c)) => format!("{}:{}:{}", file_path, l, c),
                (Some(l), None) => format!("{}:{}", file_path, l),
                _ => file_path.to_string(),
            };
            if line.is_some() {
                cmd.arg("--goto").arg(&goto);
            } else {
                cmd.arg(&goto);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("{}: {}", editor, e))
}

#[tauri::command]
pub async fn open_path_in_editor(
    file_path: String,
    line: Option<u32>,
    column: Option<u32>,
    editor: Option<String>,
) -> Result<(), String> {
    let preference = editor.unwrap_or_else(|| "auto".to_string());

    let candidates: Vec<&str> = match preference.as_str() {
        "system" => vec![],
        "cursor" => vec!["cursor"],
        "code" | "vscode" => vec!["code"],
        "idea" | "jetbrains" => vec!["idea"],
        "webstorm" => vec!["webstorm"],
        "pycharm" => vec!["pycharm"],
        _ => vec!["cursor", "code", "idea"],
    };

    for editor_bin in &candidates {
        if try_editor_command(editor_bin, &file_path, line, column).is_ok() {
            return Ok(());
        }
    }

    open_file_with_default_app(file_path).await
}

/// Open a directory in the system file explorer (cross-platform)
#[tauri::command]
pub async fn open_directory_in_explorer(directory_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = StdCommand::new("explorer");
        cmd.arg(&directory_path);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .arg(&directory_path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        StdCommand::new("xdg-open")
            .arg(&directory_path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    Ok(())
}

/// Open a file with the system's default application (cross-platform)
#[tauri::command]
pub async fn open_file_with_default_app(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Use 'start' command through cmd to open file with default app
        let mut cmd = StdCommand::new("cmd");
        cmd.args(&["/C", "start", "", &file_path]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        StdCommand::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}
