import "./assets/shimmer.css";
import "./styles.css";
import "./i18n"; // ✅ i18n 必须同步加载（App 立即需要使用）
import { startApp } from "./bootstrapApp";

void startApp();
