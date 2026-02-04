# Gemini 引擎在 Windows 原生环境被误判为 WSL 环境

## 问题描述

Gemini 引擎在 Windows 原生环境下被错误地识别为 WSL 环境，导致对话失败。

**实际安装路径：** `D:\Program Files\nvm\node_global\gemini`

## 问题根源

1. `is_native_gemini_available()` 函数（wsl_utils.rs:501-528）检测失败
2. `GeminiMode::Auto` 模式下，因检测失败错误地执行了 WSL 配置检测
3. `get_native_gemini_paths()` 函数的预定义路径列表中未包含 nvm-windows 的自定义全局路径

## 环境信息

- **操作系统：** Windows（原生环境，非 WSL）
- **Gemini 安装方式：** nvm-windows
- **Gemini 安装路径：** `D:\Program Files\nvm\node_global\gemini`
- **当前行为：** 被误判为 WSL 环境
- **预期行为：** 正确识别为 Windows 原生环境

## 重现步骤

1. 在 Windows 环境下使用 nvm-windows 安装 Gemini
2. 设置自定义全局路径（如 `D:\Program Files\nvm\node_global`）
3. 尝试使用 Gemini 引擎进行对话
4. 观察到系统错误地尝试使用 WSL 配置

## 建议修复方案

### 方案 1：扩展路径检测列表

在 `get_native_gemini_paths()` 函数中增加对 nvm-windows 自定义全局路径的支持：

```rust
// 添加对 nvm-windows 全局路径的检测
if let Ok(nvm_prefix) = std::env::var("NVM_HOME") {
    let global_path = PathBuf::from(&nvm_prefix).join("node_global").join("gemini");
    paths.push(global_path);
}
```

### 方案 2：改进检测逻辑

改进 `is_native_gemini_available()` 的检测逻辑：

1. 首先检查 `PATH` 环境变量中的 `gemini` 命令
2. 然后检查预定义路径列表
3. 最后检查常见的包管理器安装路径（npm global, nvm-windows, etc.）

### 方案 3：优化 Auto 模式

在 `GeminiMode::Auto` 模式下：

1. 优先检测 Windows 原生环境
2. 使用 `which gemini` 或 `where gemini` 命令验证可执行文件
3. 只有在明确检测失败后才回退到 WSL 检测

## 相关代码位置

- `wsl_utils.rs:501-528` - `is_native_gemini_available()` 函数
- `get_native_gemini_paths()` - 预定义路径列表
- Gemini 模式配置逻辑

## 影响范围

此问题影响所有使用 nvm-windows 并设置了自定义全局路径的 Windows 用户。

## 标签建议

- `bug`
- `windows`
- `gemini`
- `detection`
