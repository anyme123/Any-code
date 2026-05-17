# Claude Workbench Design System

## 设计目标

Claude Workbench 是开发者工作台，不做营销页式的大视觉。界面应该高密度、低干扰、偏终端和 IDE 气质：深色默认、细边框分层、主操作用暖色强调，代码、工具调用和会话流是第一优先级。

## 色彩

- 默认深色背景使用接近 `#0d0f14` 的中性黑，不使用大面积蓝紫渐变。
- 主操作色使用暖珊瑚色，来自 Claude 的人文感，但只用于主要按钮、活动状态和重点标识。
- 成功、警告、信息、错误使用语义 token：`success`、`warning`、`info`、`destructive`。
- 层级主要靠 `surface-panel`、`surface-code`、`surface-hairline` 区分，少用阴影。
- 亮色模式使用温暖纸白背景，保留相同的层级和语义色。

## 排版

- UI 字体使用 Inter / Segoe UI / Microsoft YaHei UI。
- 代码和终端内容使用 JetBrains Mono / SF Mono / Consolas。
- 工作台内不使用负字距；紧凑面板标题保持 14-18px。
- Markdown 阅读区控制行高，代码块使用独立的深色命令面。

## 布局

- 应用骨架：左侧导航 + 主工作区，主工作区不使用浮夸背景。
- 侧栏宽度保持紧凑，活动项用细色条和浅背景标识。
- 项目列表、会话列表和工具输出使用 8-12px 圆角、1px hairline 边框。
- 会话流最大宽度受控，消息之间保持足够分隔但不做大卡片堆叠。

## 组件规则

- 按钮：8px 圆角，主按钮暖色，次级按钮用边框或中性 surface。
- 输入框：使用 `surface-code`，聚焦时只改变边框和 ring。
- 消息：用户消息使用深蓝工作台色；助手消息使用中性 surface + hairline。
- 工具调用：统一 `command-surface`，状态色只走语义 token。
- 代码块：保留语言标签、复制按钮、行号和横向滚动。
- 动效：只做短时 opacity/position 过渡，不做夸张缩放和漂浮装饰。

## 禁止项

- 不使用大面积蓝紫渐变、渐变光球、bokeh 或装饰性 orb。
- 不在工作台主屏使用 landing page hero。
- 不把页面 section 做成嵌套卡片。
- 不用颜色本身承载业务语义，必须走语义 token。
