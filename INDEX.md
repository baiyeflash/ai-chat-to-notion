# 项目索引 — AI Chat to Notion 扩展

> 维护规则：每次新增/重命名函数、调整文件结构后，**必须同步更新本文件**。
> 阅读时机：开始任何代码改动前先查这里定位文件 + 行号，只读必要的文件段，**不要全文加载**。

---

## 0. 行数约束（重要）

| 类型 | 软上限 | 硬上限 | 说明 |
|------|--------|--------|------|
| `.js` | 400 行 | 600 行 | 超过软上限考虑拆分，超过硬上限必须拆分 |
| `.css` | 300 行 | 500 行 | 同上 |
| `.html` | 200 行 | 300 行 | 通常只是模板 |

**触发拆分时**：在动手改代码之前，先把超标文件拆好，再做功能改动 —— 不要边改边拆。

### 当前状态（2026-09-08）

| 文件 | 行数 | 状态 |
|------|------|------|
| `background.js` | 284 | ✅ 健康 |
| `popup.js` | 103 | ✅ 健康 |
| `popup.css` | 164 | ✅ 健康 |
| `popup.html` | 56 | ✅ 健康 |
| `manifest.json` | 47 | ✅ 健康 |
| `content/utils.js` | 45 | ✅ 健康 |
| `content/api.js` | 67 | ✅ 健康 |
| `content/extractor.js` | 381 | ✅ 健康（DOM 适配器 + 快照签名 + 连续 user 合并） |
| `content/chatgpt-cache.js` | 416 | ⚠ 超软上限（当前会话缓存 + 扫描等待 + observer 生命周期；未超过 600 行硬上限） |
| `content/converter.js` | 450 | ✅ 健康（含 ChatGPT / KaTeX / 行内 LaTeX code / 复杂引用转换） |
| `content/builder.js` | 87 | ✅ 健康 |
| `content/ui-button.js` | 159 | ✅ 健康 |
| `content/ui-position.js` | 379 | ✅ 健康（右侧常驻位置选择 + 长页面窗口化 + 复杂引用预览） |
| `content/ui-modal.js` | 393 | ✅ 健康 |
| `content/main.js` | 34 | ✅ 健康 |
| `content/base.css` | 182 | ✅ 健康 |
| `content/modal.css` | 142 | ✅ 健康 |
| `content/forms.css` | 251 | ✅ 健康 |
| `content/position.css` | 227 | ✅ 健康（面板布局 / 快速位置工具栏 / 虚拟列表 / 插入槽） |
| `content/position-blocks.css` | 215 | ✅ 健康（Notion block 预览外观） |
| `content/toast.css` | 31 | ✅ 健康 |
| `tests/extractor-fixture.html` | 281 | ⚠ 超软上限（真实DOM、34节点配对和格式转换夹具；未超过300行硬上限） |
| `tests/chatgpt-cache-fixture.html` | 187 | ✅ 健康 |
| `tests/modal-loading-fixture.html` | 86 | ✅ 健康 |
| `tests/position-panel-fixture.html` | 130 | ✅ 健康 |
| `tests/equation-preview-fixture.html` | 61 | ✅ 健康 |
| `tests/quote-preview-fixture.html` | 101 | ✅ 健康 |
| `tests/last-export-target-fixture.html` | 118 | ✅ 健康 |
| `tests/export-error-fixture.html` | 76 | ✅ 健康 |

---

## 1. 架构总览

```
┌──────────────────────┐    sendMessage     ┌──────────────────┐
│  content/ (10 个 JS) │ ─────────────────► │  background.js   │
│  注入 Claude/ChatGPT │                    │  Notion API 代理 │
│  - 提取+当前会话缓存 │ ◄───────────────── │                  │
│  - 渲染浮动按钮+面板 │                    └──────────────────┘
│  - HTML → Blocks     │                            ▲
│  - 选择插入位置      │                            │ fetch
└──────────────────────┘                            ▼
                                            ┌──────────────────┐
                                            │  Notion REST API │
                                            └──────────────────┘

┌──────────────────────┐
│  popup.html/.js/.css │  扩展图标点出来的设置弹窗
│  Token / 默认页面 ID │  通过 chrome.storage.local 与 content/ 共享
└──────────────────────┘
```

**为什么需要 background**：Chrome 扩展的 content_script 不能直接 fetch Notion API（CORS 限制），所有 API 请求通过 background service worker 中转。

**content/ 多文件加载机制**：manifest.json 里 `content_scripts.js` 数组**按顺序加载到同一个 isolated world 作用域**，所有 `function xxx() {}` 声明跨文件可见；`let`/`const` 声明同理（注意 TDZ，不要在文件顶层执行代码引用后加载文件的变量）。

---

## 2. content/ 子目录（10 个 JS 文件）

### 2.1 加载顺序（manifest.json 里 js 数组的顺序）

| # | 文件 | 行数 | 职责简述 |
|---|------|------|----------|
| 1 | `utils.js` | 45 | escapeHtml / truncate / sleep / showStatus / showToast |
| 2 | `api.js` | 67 | sendToBackground / getSettings / searchNotionPages / getNotionPageBlocks / exportToNotion |
| 3 | `extractor.js` | 381 | 平台识别、DOM 提取、内容签名、连续 user 合并、Q&A 配对统计 |
| 4 | `chatgpt-cache.js` | 416 | 当前会话快照、局部/路由 observer、事件驱动扫描与逻辑轮次进度 |
| 5 | `converter.js` | 450 | htmlToNotionBlocks 及其全部辅助（HTML DOM → Notion block） |
| 6 | `builder.js` | 87 | buildPageBlocks / deduplicateBlocks（Q&A pair → 单页 block 数组） |
| 7 | `ui-button.js` | 159 | injectFloatingButton（含拖拽）+ handleFloatButtonClick |
| 8 | `ui-position.js` | 325 | 右侧常驻位置选择：快速位置工具栏、窗口化渲染、单一事件委托、loadPositionOptions + getSelectedPosition |
| 9 | `ui-modal.js` | 393 | 等尺寸双面板 + 异步读取/遮罩状态 + 导出执行（separate/merged） |
| 10 | `main.js` | 34 | 全局状态（isModalOpen / currentExportPairs 等）+ init() 启动 |

### 2.2 utils.js（第 1 个，45 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `escapeHtml(str)` | 7 | innerHTML 安全转义 |
| `truncate(str, max)` | 13 | 字符串截断带省略号 |
| `sleep(ms)` | 18 | Promise 化 setTimeout |
| `showStatus(text, type)` | 23 | 面板底部状态栏（依赖 DOM `#c2n-status`） |
| `showToast(message, type)` | 31 | 右下角浮层通知，3s 自动消失 |

### 2.3 api.js（第 2 个，67 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `sendToBackground(message)` | 8 | Promise 化的 chrome.runtime.sendMessage |
| `getSettings()` | 22 | 读 chrome.storage.local（notionToken / defaultPageId / defaultPageTitle） |
| `searchNotionPages(query)` | 28 | 触发 background 调用 Notion search |
| `getNotionPageBlocks(pageId)` | 41 | **新增**：拉目标页面顶层 block 列表（用于位置选择） |
| `exportToNotion(parentId, title, blocks, position)` | 56 | 触发 background 创建子页面，position 可选 |

### 2.4 extractor.js（第 3 个，381 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `PLATFORM_CONFIG` / `SELECTORS` | 9 / 24 | 平台文案和 Claude / ChatGPT DOM 选择器集中配置 |
| `detectCurrentPlatform(hostname)` | 38 | 根据域名识别 Claude 或 ChatGPT |
| `extractConversationPairs()` | 51 | async 通用入口；ChatGPT 扫描完整虚拟列表，Claude 保持原逻辑 |
| `extractClaudeConversationPairs(root)` | 62 | 提取 Claude Q&A pairs |
| `extractChatGPTConversationPairs(root)` | 84 | 从静态 DOM 提取 ChatGPT Q&A pairs |
| `hashChatGPTSnapshotValue(value)` | 88 | 生成轻量内容哈希，避免缓存中保留整份签名文本 |
| `getChatGPTContentSignature(...)` | 96 | 按文字和语义元素结构判断安全 DOM 克隆能否复用 |
| `collectChatGPTRoleSnapshots(root, knownSnapshots)` | 111 | 生成 turn + role 稳定键；内容未变时复用已有克隆 |
| `buildChatGPTPairsFromSnapshots(...)` | 162 | 按 turn 排序；回答前的连续 user 节点合并为一轮 |
| `getOrderedUniqueChatGPTSnapshots(...)` | 200 | 对多视口快照去重并恢复真实 turn 顺序 |
| `getChatGPTPairingStats(...)` | 212 | 按同一配对规则统计逻辑轮、完整轮和未完成轮 |
| `combineChatGPTSnapshotContent(...)` | 258 | 合并同一轮的附件占位、提问文字或回答片段 |
| `combineChatGPTContent(...)` | 269 | 组合多个安全 DOM 克隆，回答片段间保留分隔线 |
| `isChatGPTMessageVisible(roleEl)` | 282 | 排除隐藏的旧回答分支 |
| `findChatGPTContentRoot(roleEl, role)` | 294 | 定位用户或助手的正文根节点 |
| `cloneChatGPTContent(contentRoot)` | 302 | 克隆正文并移除复制、反馈等操作按钮 |
| `describeUnsupportedMedia(turn)` | 318 | 为纯图片/附件消息保留占位说明 |
| `findClaudeResponseFor(userEl, root)` | 349 | 向上爬找 Claude 回复（含 DOM 顺序兜底） |

### 2.4b chatgpt-cache.js（第 4 个，416 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `chatGPTConversationCache` | 10 | 当前标签页、当前会话的内存 Map；不写磁盘 |
| `mergeChatGPTSnapshots(...)` | 34 | 按 turn + role 合并并覆盖流式更新/回答分支 |
| `updateChatGPTSnapshotCache(...)` | 59 | 合并快照并在分支切换时清理分叉点后的旧消息 |
| `scanChatGPTConversationPairs(...)` | 99 | 面板后方扫描虚拟列表，报告逻辑轮次、响应取消并恢复位置 |
| `findChatGPTScrollContainer(root)` | 192 | 定位会话滚动容器，并以 document scroller 兜底 |
| `waitForChatGPTRender(...)` | 240 | DOM 变化/双帧稳定驱动的等待，80ms 为节流兜底 |
| `captureCurrentChatGPTDOM(root)` | 297 | 复用未变化克隆，把当前消息并入缓存并维护完整状态 |
| `bindChatGPTConversationObserver()` | 336 | 把高频内容观察限制在当前会话容器 |
| `initializeChatGPTConversationCache()` | 356 | 安装局部内容和全局路由两个 observer |
| `getCompleteChatGPTConversationPairs(...)` | 380 | 完整缓存直接返回，否则共享一次可验证的后台扫描 |

### 2.5 converter.js（第 5 个，450 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `MAX_NOTION_EQUATION_LENGTH` | 10 | Notion equation expression 的官方 1000 字符上限 |
| `htmlToNotionBlocks(element)` | 15 | 入口：DOM 元素 → Notion block 数组 |
| `processChildren(parent, blocks)` | 35 | 递归处理子节点 |
| `processElement(el, blocks)` | 49 | 按 tag 分发，并优先把独立公式转换为 equation block |
| `processBlockquote(el, blocks)` | 158 | 简单引用保留 rich_text；复杂引用用 quote children 保留公式、列表和段落 |
| `processTable(tableEl, blocks)` | 251 | `<table>` → Notion table block（含列数补齐） |
| `extractRichText(element)` | 291 | 提取格式化 rich_text，含行内 equation |
| `extractMathExpression(element)` | 369 | 从 `data-math-source` / `aria-label` / KaTeX annotation 提取原始 LaTeX |
| `extractInlineCodeMathExpression(element)` | 387 | 识别用户行内 code 中明确的 LaTeX，同时排除普通路径/代码 |
| `createEquationBlock(expression)` | 402 | LaTeX → Notion equation block |
| `splitLongText(text)` | 410 | Notion 单个 rich_text 限 2000 字符，超出拆 chunk |
| `splitTextToBlocks(text)` | 423 | 纯文本太长拆多个 paragraph block |
| `createParagraphBlock(text)` | 377 | 纯文本 → paragraph block 快捷构造 |
| `mapLanguage(lang)` | 387 | 代码块语言别名映射 |

### 2.6 builder.js（第 6 个，87 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `buildPageBlocks(pair)` | 17 | 单条 Q&A → 页面 blocks，回答标题随 Claude / ChatGPT 自动切换 |
| `deduplicateBlocks(blocks)` | 59 | 去除连续重复 paragraph |
| `extractBlockText(block)` | 79 | 提取 text / equation 内容（用于去重比较） |

### 2.7 ui-button.js（第 7 个，159 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `injectFloatingButton()` | 12 | 注入左下角 N 按钮 + 扩展版本标记 + 拖拽逻辑 + 位置记忆 |
| `handleFloatButtonClick()` | 103 | ChatGPT 先开面板再后台读取；Claude 保持先提取再开面板 |

### 2.7b ui-position.js（第 8 个，379 行）

Notion 风格的插入位置选择 UI。目标页面在主导出面板右侧等尺寸常驻，两侧共享无缝圆角外壳；长页面只把当前视口附近的 block 放入 DOM，用户仍可连续滚动并点击两个 block 之间的“插入槽”。

| 符号 | 行号 | 作用 |
|------|------|------|
| `renderNotionBlock(block)` | 14 | 将单个 block 渲染为 Notion 风格 HTML；equation 显示真实 expression，quote 连同 children 放进统一引用容器 |
| `renderPositionWindow(state)` | 204 | 根据 scrollTop 二分定位可见区，只渲染可见项及前后 10 项缓冲 |
| `createPositionVirtualList(...)` | 227 | 建立高度索引、单一 scroll/click 监听和 ResizeObserver |
| `loadPositionOptions(pageId)` | 296 | 拉取目标页面 blocks，防止切页请求串台，并创建右侧窗口化预览 |
| `resetPrecisePositionSelection()` | 354 | 用户改选“开头/末尾”时清除精准锚点 |
| `destroyPositionSelector()` | 360 | 关闭/换页时移除 timer、监听器和 ResizeObserver |
| `getSelectedPosition()` | 374 | 返回快速位置或窗口化状态中保存的精准锚点 |

### 2.8 ui-modal.js（第 9 个，393 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `showExportModal(pairs, settings, options)` | 10 | 立即渲染面板，并设置 scanning / ready 遮罩状态 |
| `updateExportModalScanProgress(...)` | 188 | 按与最终列表相同口径显示已识别逻辑轮数 |
| `completeExportModalScan(...)` | 198 | 填充异步结果、切换轻遮罩并启用导出 |
| `failExportModalScan(...)` | 221 | 保留面板、恢复轻遮罩并明确展示读取错误 |
| `handleSearch()` | 239 | 搜索 Notion 页面 + 渲染列表 + 触发 loadPositionOptions |
| `handleExport()` | 273 | 从 `currentExportPairs` 读取异步结果并分发导出 |
| `handleSeparateExport(...)` | 303 | **单页模式**：每条对话 → 独立子页面；`after_block` 时反序保序 |
| `handleMergedExport(...)` | 346 | **合并模式**：所有对话 → 一个子页面 |
| `closeModal()` | 385 | 关闭双面板、销毁位置选择器并使当前扫描会话失效 |

### 2.9 main.js（第 10 个，34 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| `isModalOpen` / `currentExportPairs` / `exportModalSessionId` | 10-14 | 面板、异步结果和取消标识的跨文件状态 |
| `init()` | 16 | 注入按钮 + 初始化 ChatGPT 内存缓存 + SPA 监听 |

---

## 3. background.js（284 行 ✅）

Notion API 代理。所有 fetch 都在这里。

| 函数 | 行号 | 作用 |
|------|------|------|
| `chrome.runtime.onMessage.addListener` | 10 | 接收 `NOTION_API` 消息 |
| `handleNotionRequest(request)` | 23 | 按 `action` 分发 |
| `searchPages(headers, query)` | 63 | `POST /v1/search`，过滤 `object=page`，按 `last_edited_time` 倒序，最多 20 条 |
| `createPage(headers, parentId, title, blocks, position)` | 111 | `POST /v1/pages`，前 100 个 block 一次性提交；**支持 position 参数**控制新子页面在父页面中的位置 |
| `getPageBlocks(headers, pageId)` | 153 | 拉取页面顶层 blocks；对 `quote.has_children` 继续读取直接 children，返回完整引用预览数据 |
| `retrieveBlockChildren(headers, blockId)` | 170 | 分页调用 `GET /v1/blocks/{id}/children?page_size=100` |
| `serializePreviewBlock(block)` | 192 | block 对象 → 精准选择面板所需的安全预览字段 |
| `makeBlockPreview(block)` | 217 | block 对象 → 人类可读预览字符串（供兜底使用） |
| `appendBlocks(headers, pageId, blocks)` | 261 | 外部入口（目前未直接被调用） |
| `appendBlocksInBatches(headers, blockId, blocks)` | 268 | 每批 100 个 block PATCH 到 `/v1/blocks/{id}/children` |

### Notion API 限制速记

- 每次创建/追加最多 **100 个 children block**
- 单个 rich_text 内容最多 **2000 字符**
- API rate limit 约 **3 req/s**，content/ui-modal.js 中 separate 模式两次请求间 `sleep 350ms`
- `POST /v1/pages` 的 `position` 参数支持：
  - `{ type: 'page_start' }` — 父页面开头
  - `{ type: 'page_end' }` — 父页面末尾（默认）
  - `{ type: 'after_block', after_block: { id } }` — 指定 block 之后
- 子页面**不能通过 PATCH children** 创建（child_page block 在 PATCH 端点不被支持），所以"创建子页面在指定位置"必须用 `POST /v1/pages` 的 `position` 字段

---

## 4. popup.html / popup.js / popup.css（共 323 行 ✅）

扩展图标点出来的 380px 宽设置弹窗。

### popup.html（56 行）

字段：
- `#token` — Notion Integration Token（password 输入）
- `#pageId` — 默认父页面 ID（可选）
- `#pageTitle` — 隐藏字段，保存页面标题
- `#save` / `#test` — 保存设置 / 测试连接
- `#message` — 提示消息

### popup.js（103 行）

| 符号 | 行号 | 作用 |
|------|------|------|
| 加载已保存设置 | 13 | 从 chrome.storage.local 读 token / pageId / pageTitle |
| 保存按钮 | 20 | 清洗 pageId 后写入 chrome.storage.local |
| 测试连接 | 39 | 用当前 token 触发一次 search_pages |
| `cleanPageId(input)` | 80 | 从 URL / UUID / 纯 hex 三种格式中提取 32 位页面 ID |
| `showMessage(text, type)` | 100 | 消息行渲染 |

---

## 5. CSS 文件（content/ 内 4 个，popup 1 个）

### content/base.css（182 行）

- 浮动按钮 `#c2n-float-btn`
- 有 scanning / ready 深浅状态且不使用全屏 blur 的遮罩 `#c2n-overlay`
- 模态外壳 `#c2n-modal` + header
- 滚动条（page-list / pair-list / **position-list** / modal-body）
- 动画 keyframes（fadeIn / slideUp）

### content/modal.css（142 行）

- 段落 `.c2n-section` / `.c2n-label` / `.c2n-hint` / `.c2n-error`
- 63px 单行底部 `.c2n-modal-footer` + 主次按钮
- 可截断状态行 `.c2n-status`

### content/forms.css（246 行）

- 搜索 `.c2n-search-row`
- 页面列表 `.c2n-page-list` + `.c2n-page-item`
- 模式切换 `.c2n-mode-toggle` / `.c2n-mode-btn` / `.c2n-merged-title-row`
- 全选操作 `.c2n-select-actions`
- 对话列表 `.c2n-pair-list` / `.c2n-pair-item` / `.c2n-pair-title`

### content/position.css（227 行）

- 快速按钮 `.c2n-pos-quick-row` / `.c2n-pos-quick-btn`
- 右侧等尺寸常驻面板 `#c2n-position-panel`，与主面板无缝拼接并以 1px 边线分区
- 常驻快速位置工具栏 `.c2n-position-toolbar`；未选页面禁用，选中后原地启用
- 窗口化滚动容器 `.c2n-pos-page` / `.c2n-pos-virtual-*`
- 插入槽 `.c2n-slot` / `.c2n-slot-line` / `.c2n-slot-label`

### content/position-blocks.css（215 行）

- Notion 风格 block 渲染 `.c2n-nb` + 各类型变体（`.c2n-nb-h1` ~ `.c2n-nb-media`）
- 复杂引用用 `.c2n-nb-quote-main` / `.c2n-nb-quote-children` 让主行与子内容共享完整左竖线

### content/toast.css（31 行）

- `.c2n-toast` / `.c2n-toast-success` / `.c2n-toast-error` / `.c2n-toast-fade`

### popup.css（164 行）

设置弹窗样式，独立。

---

## 6. 数据流速记

### 导出单条对话（separate 模式）

```
[ChatGPT 页面运行]
  → initializeChatGPTConversationCache()                // chatgpt-cache.js
    → 局部 MutationObserver 静默累计当前 DOM 消息
[点击按钮]
  → showExportModal([], { loading: true })              // ui-modal.js，立即显示
  → getCompleteChatGPTConversationPairs()               // chatgpt-cache.js
    → 完整缓存：直接返回
    → 缓存不完整：面板后方 scanChatGPTConversationPairs()
      → DOM 换页驱动地从顶部扫描到末尾并报告逻辑轮数
      → 按 conversation-turn + role 覆盖、排序、清理旧分支
      → assistant 前的连续 user 节点合并为同一轮
      → 恢复用户原滚动位置
  → completeExportModalScan()                           // 填充列表、轻遮罩、启用导出
  → 同期 loadPositionOptions(默认页面)                 // 用户可先选 Notion 设置
      → getNotionPageBlocks(pageId)                    // api.js
        → background.getPageBlocks                     // background.js
  → [用户勾选 + 选位置 + 点导出]
  → handleExport → handleSeparateExport                // ui-modal.js
    → getSelectedPosition()                            // ui-modal.js
    → for 每条:
      → buildPageBlocks(pair)                          // builder.js
      → exportToNotion(pageId, title, blocks, pos)     // api.js
        → background.createPage with position          // background.js
```

> **after_block 多条对话顺序**：handleSeparateExport 检测到 `position.type === 'after_block'` 会反序遍历 selectedIndices，避免每条都接在同一锚点导致结果反序。

### 导出合并对话（merged 模式）

```
... handleExport → handleMergedExport                  // ui-modal.js
  → 拼接所有 buildPageBlocks(pair) 到 allBlocks（中间 divider）
  → 一次 exportToNotion(pageId, mergedTitle, allBlocks, position)
```

### chrome.storage.local 数据键

| key | 写者 | 读者 | 内容 |
|-----|------|------|------|
| `notionToken` | popup.js | content/api.js + popup.js | Integration token |
| `defaultPageId` | popup.js | content/api.js + ui-modal.js | 默认父页面 ID（32 hex） |
| `defaultPageTitle` | popup.js | content/api.js + ui-modal.js | 默认父页面标题（显示用） |
| `btnLeft` / `btnTop` | content/ui-button.js | content/ui-button.js | 浮动按钮拖拽后的位置 |

### DOM 适配器验证

八份 fixture 都不依赖项目 npm 包：`extractor-fixture.html` 覆盖 DOM 提取、连续 user 附件节点合并和 Notion 格式转换；`chatgpt-cache-fixture.html` 覆盖虚拟列表累计、进度、取消、回答变化、分支清理和 14,000px 扫描性能；`modal-loading-fixture.html` 覆盖按逻辑轮计数的异步 UI、遮罩状态和 64px 内的单行 footer；`position-panel-fixture.html` 用 1200 个 block 覆盖右侧常驻工具栏、header 对齐、左侧无跳变、窗口化节点预算、滚动到底和精准锚点选择；`equation-preview-fixture.html` 覆盖公式 expression 从 Notion API 响应到右侧安全预览的完整链路；`quote-preview-fixture.html` 覆盖复杂 quote 的直接子 blocks 从 API 读取到统一引用样式渲染；`last-export-target-fixture.html` 覆盖同一来源页在当前标签页内连续导出时恢复上次成功导入页面，并高亮刚导入内容之后的位置；`export-error-fixture.html` 覆盖单条导出失败时在状态栏保留 Notion API 的具体错误。

---

## 7. 改动 checklist（每次写完代码必看）

- [ ] 函数新增/重命名/移位 → 更新本文件相关表格的行号
- [ ] 新文件 → 在 §1 架构图、§0 行数表、对应章节增加条目
- [ ] 文件突破软上限 → 在 §0 状态表标 ⚠️
- [ ] 文件突破硬上限 → 在 §0 状态表标 ⚠️，下次改动该文件**必须先拆**
- [ ] 新增 chrome.storage 键 → 更新 §6 表格
- [ ] 新增 Notion API 调用 → 更新 §3 限制速记 + 数据流图

---

## 8. 命名前缀速记

| 前缀 | 含义 |
|------|------|
| `c2n-*` | DOM id/class（历史前缀，现由 Claude / ChatGPT 共用） |
| `c2n-float-btn` | 浮动按钮 |
| `c2n-overlay` / `c2n-modal` | 遮罩 / 模态 |
| `c2n-section` / `c2n-label` | 模态内段落 |
| `c2n-page-list` / `c2n-page-item` | 父页面选择 |
| `c2n-pos-quick-*` / `c2n-position-panel` / `c2n-pos-page` | 插入位置：快速按钮 / 右侧常驻面板 / 窗口化页面 |
| `c2n-nb` / `c2n-nb-h1` ~ `c2n-nb-media` | Notion 风格 block 渲染 |
| `c2n-slot` / `c2n-slot-line` / `c2n-slot-label` | 可点击插入槽 |
| `c2n-mode-toggle` / `c2n-mode-btn` | 导出模式切换 |
| `c2n-pair-list` / `c2n-pair-item` / `c2n-pair-title` | 对话条目 |
| `c2n-merged-title-row` | 合并模式标题输入框 |
| `c2n-status` / `c2n-toast` | 状态/通知 |
| `c2n-btn-primary` / `c2n-btn-secondary` | 按钮 |
