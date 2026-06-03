import { describe, it, expect } from "vitest";
import {
  isAbsolutePath,
  normalizeImagePath,
  toClaudeImageMention,
} from "@/lib/imagePath";

describe("normalizeImagePath", () => {
  it("将 Windows 反斜杠绝对路径转换为正斜杠", () => {
    expect(
      normalizeImagePath(
        "C:\\Users\\Administrator\\AppData\\Local\\Temp\\claude_workbench_clipboard_images\\clipboard_image_20260603.png"
      )
    ).toBe(
      "C:/Users/Administrator/AppData/Local/Temp/claude_workbench_clipboard_images/clipboard_image_20260603.png"
    );
  });

  it("保留盘符不丢失（回归 anthropics/claude-code #19338 / #6898 的路径塌缩）", () => {
    // 修复前 @C:\Users\... 会被 CLI 当转义吞掉 \U 塌缩为 C:Users...；修复后盘符与分隔符均保留
    const result = normalizeImagePath("C:\\Users\\mcsei\\.claude\\img.png");
    expect(result).toBe("C:/Users/mcsei/.claude/img.png");
    expect(result.startsWith("C:/")).toBe(true);
  });

  it("正斜杠路径保持不变（幂等）", () => {
    expect(normalizeImagePath("C:/Users/x/img.png")).toBe("C:/Users/x/img.png");
    expect(normalizeImagePath("/tmp/a.png")).toBe("/tmp/a.png");
  });

  it("data: URL 原样返回，不动其内容", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    expect(normalizeImagePath(dataUrl)).toBe(dataUrl);
  });

  it("混合分隔符全部归一为正斜杠", () => {
    expect(normalizeImagePath("C:\\Users/x\\img.png")).toBe("C:/Users/x/img.png");
  });
});

describe("isAbsolutePath", () => {
  it("识别 Unix 绝对路径", () => {
    expect(isAbsolutePath("/tmp/a.png")).toBe(true);
  });

  it("识别 Windows 盘符绝对路径（反斜杠与正斜杠）", () => {
    expect(isAbsolutePath("C:\\Users\\x\\img.png")).toBe(true);
    expect(isAbsolutePath("C:/Users/x/img.png")).toBe(true);
    expect(isAbsolutePath("d:/lower/drive.png")).toBe(true);
  });

  it("相对路径返回 false", () => {
    expect(isAbsolutePath("assets/img.png")).toBe(false);
    expect(isAbsolutePath("./img.png")).toBe(false);
    expect(isAbsolutePath("img.png")).toBe(false);
  });
});

describe("toClaudeImageMention", () => {
  it("无空格路径生成 @正斜杠路径", () => {
    expect(toClaudeImageMention("C:\\Users\\x\\img.png")).toBe(
      "@C:/Users/x/img.png"
    );
  });

  it("含空格路径用引号包裹（官方 #4012 认可写法）", () => {
    expect(toClaudeImageMention("C:\\My Pictures\\a b.png")).toBe(
      '@"C:/My Pictures/a b.png"'
    );
  });

  it("data: URL 用引号包裹", () => {
    expect(toClaudeImageMention("data:image/png;base64,AAAA")).toBe(
      '@"data:image/png;base64,AAAA"'
    );
  });
});
