/**
 * 图片路径工具 —— 供 Claude Code 引擎的 @文件引用使用。
 *
 * 背景：Claude Code CLI 的 @文件引用解析器面向 Unix 实现，会把反斜杠当作转义字符消费。
 * 例如 `@C:\Users\x\img.png` 中的 `\U` `\x` 会被吞掉，路径塌缩为 `C:Usersximg.png`，
 * 导致 CLI 找不到文件、图片无法解析（参见 anthropics/claude-code issues #19338 / #6898）。
 * 因此所有发往 Claude CLI 的图片路径都必须先经 {@link normalizeImagePath} 规范化为正斜杠。
 */

/**
 * 判断是否为绝对路径，兼容 Unix（`/...`）与 Windows 盘符（`C:\` 或 `C:/`）。
 */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * 将路径中的反斜杠统一替换为正斜杠，使其能被 Claude CLI 的 @引用解析器正确解析。
 * `data:` URL 原样返回（它不是文件路径，且可能包含合法反斜杠）。
 *
 * @example
 * normalizeImagePath("C:\\Users\\x\\img.png") // => "C:/Users/x/img.png"
 * normalizeImagePath("/tmp/a.png")            // => "/tmp/a.png"
 * normalizeImagePath("data:image/png;base64,AAAA") // => 原样
 */
export function normalizeImagePath(path: string): string {
  if (path.startsWith("data:")) return path;
  return path.replace(/\\/g, "/");
}

/**
 * 为 Claude Code CLI 构造单个图片的 @文件引用 mention。
 * 先规范化分隔符，路径含空格时用引号包裹（`@"..."` 是官方认可的含空格写法，见 issue #4012）。
 */
export function toClaudeImageMention(path: string): string {
  if (path.startsWith("data:")) {
    return `@"${path}"`;
  }
  const normalized = normalizeImagePath(path);
  return normalized.includes(" ") ? `@"${normalized}"` : `@${normalized}`;
}
