# AGENTS.md · 格奇外贸情报站

> 给维护者 / AI 助理的活文档。改功能前先读这份，别重新探索环境。

## 1. 项目定位（一句话）
给**外贸 / 出海企业**看的**每日外贸动态**静态站：单文件前端 + 每日自动管线（Google News 抓取 → DeepSeek 简报 → 自动部署）。定位是 **SEO / GEO 优化公司**的对外展示与引流，**不做政策解读服务**。

## 2. 技术栈（一句话）
单文件 `index.html`（Tailwind CDN + Material Symbols + Inter，**无构建步骤**）→ GitHub 仓库 → **Vercel 自动部署**；数据由 **Node 零依赖脚本**每日生成；**DeepSeek** 可选生成结构化简报。

## 3. 目录与文件职责（改哪看哪）

| 文件 | 职责 | 何时动 |
|------|------|--------|
| `index.html` | 全部前端（630 行，含内联脚本与样式） | 改展示 / 交互 / 样式 |
| `pipeline.js` | **生产管线**（GitHub Actions 调用）：抓 RSS → 分类 → 简报 → 输出 | 改数据源 / 栏目 / 简报结构 |
| `topics.js` | `extractTopicTags()` 话题标签提取器（被 pipeline 引用） | 改"相关情报"匹配逻辑 |
| `news.js` / `news.json` | 数据（60 条/日，自动生成，勿手改） | 仅管线写；前端只读 `window.NEWS_DATA` |
| `gen_news.js` | 沙箱兜底：内置 22 条真实新闻写 `news.js` | 仅本地无网时一次性用 |
| `enrich_briefs.js` | 一次性回填 `brief` 的 dev 脚本 | 历史数据补简报时用 |
| `enrich_topics.js` | 一次性回填 `topicTags` 的 dev 脚本 | 历史数据补标签时用 |
| `README.md` | 面向辉哥的部署手册（三步） | 部署流程变更时同步 |
| `.github/workflows/daily-news.yml` | 每日 07:00 定时跑管线并提交 | 改定时 / Node 版本 / 提交逻辑 |

## 4. 数据契约（`news.js` / `news.json` 每条字段）

| 字段 | 类型 | 含义 / 来源 |
|------|------|------------|
| `id` | number | 序号（1 起，倒序=越新越小） |
| `cat` | string | 栏目：`policy`/`tariff`/`market`/`logistics`/`platform`/`industry` |
| `time` | string | 相对时间，如"2小时前"（管线 `relTime` 生成） |
| `top` | bool | 是否头条（仅第 1 条 `true`） |
| `ai` | string | 固定 `"要点提炼"`（标识 AI 整理） |
| `title` | string | 标题 |
| `summary` | string | 摘要（≤150 字，DeepSeek 或无 key 降级） |
| `source` | string | 来源名 |
| `url` | string | **原始报道链接**（相关情报条目直接打开它） |
| `tags` | string[] | 展示用标签（前 5，抽关键词） |
| `topicTags` | string[] | **事件级标签+主题簇**（2~4 个，驱动"相关情报"精准匹配） |
| `body` | string | 长文正文；**当前详情页用 `brief`，`body` 暂未渲染**（要全文展示可接此处） |
| `brief` | string | **HTML 简报**：`<h4>核心事实</h4><p>…</p><h4>影响看点</h4><ul><li>…</li></ul><h4>涉及主体/市场</h4><p>…</p>` |

输出还带 `window.SITE_META = { total, updated }`（前端暂未用）。

## 5. 功能模块清单（增减功能对照表）

| 功能 | 实现位置 | 增减指引 |
|------|----------|----------|
| 6 栏目导航 | `CATS` `index.html:282`；`setCat()` `:474` | 加栏目→改 `CATS` + `pipeline.js` 的 `QUERIES`/`CAT_KEYWORDS` |
| 频道联动（Hero+标签云随频道变） | `getHeroItem()` `:423`、`renderHero()` `:427`、`setCat()` 内 `renderHero/renderFeed/renderTags` | 联动逻辑都在 `setCat`，改这里 |
| Hero 头条 | `renderHero()` `:427` | 改文案/样式在此 |
| 新闻列表 + 加载更多 | `renderFeed()` `:444`、`loadMore()` `:498`、`filtered()` | 每屏 6 条（`state.visible`） |
| 搜索 + 标签筛选 | `searchInput` `:135`、`filterByTag()` `:483` | 筛选用 `state.query` |
| 收藏 / 分享 | `toggleSave()` `:500`、`share()` `:506`（复制 `#news-{id}` 链接） | — |
| 详情弹窗 + 情报速览 | `openDetail()` `:535`；样式 `.brief-content` `:100` | 弹窗高度已限 `max-h`+`overflow-y-auto`（防超屏）；改简报版式动 `.brief-content` CSS |
| **相关情报精准化** | `getRelated()` `:514` + `topics.js` | 同 `topicTags` 重叠度排序取前 3，无重叠退同栏目；**改匹配规则动 `getRelated` 与 `topics.js` 的 `SPECIFIC`/`THEME`** |
| SEO/GEO 咨询抽屉 | `consultDrawer` `:238`、`openConsult()` `~:575` | 原为"政策解读"，已改 SEO/GEO 定位 |
| **预约表单真实收数据（Formspree）** | `CONSULT_FORM_ID` 常量 + submit handler（`index.html` consult 段，搜 `xljravoa`） | 客户提交 → fetch POST `https://formspree.io/f/xljravoa` → **预约记录进 Formspree 后台 + 邮件提醒到辉哥注册邮箱**；同时 localStorage（`geqi_consult`）留底。`CONSULT_FORM_ID` 清空时**明确报错引导电话/微信联系，绝不假装成功**（防旧缓存版吞线索）。提交数据带 `_v` 版本戳 + `_v` 常量 `CONSULT_VER`；失败 toast 区分「网络不通/服务异常」；fetch `cache:no-store`，head 已加 no-cache meta |
| **视觉增强（图标+插画）** | `CAT_ICON`/`CAT_COLOR` `index.html:291~310`、`heroIllustration()` `:332`；卡片/详情/Hero 栏目徽章均带图标 | 纯内联 SVG+Material Symbols，零外部图片依赖；加栏目需同步 `CAT_ICON`/`CAT_COLOR` |
| **侧栏数据图表（圆环+条形）** | `renderCatDonut()` `:349`、`renderTagBars()` `:370`、`renderCharts()` `:384`（`init()` 调用）；DOM 挂载点 `#catDonut`/`#catLegend`/`#tagBars`（右侧栏） | 由 `NEWS`（即 `window.NEWS_DATA`）实时统计生成，无新闻时为空；改配色动 `CAT_COLOR`；**不依赖图表库** |
| 每日自动管线 | `pipeline.js`：`QUERIES`(中文16组)、`EN_QUERIES`(英文6组)、`classify()`、`rewriteWithAI()`、输出 | 数据源=Google News RSS（16 组中文检索词 + 6 组英文检索词，英文经 DeepSeek 翻译成中文后并入，每组限取 5 条控占比）；**分类用本地规则 `classify()`（确定性），AI 只负责翻译/摘要/标签/简报，不决定分类**；无 key 降级原文；取前 60 条 |

## 6. 已刻意移除的功能（不是 bug，勿"修"）
- 订阅邮箱卡片、4 个统计卡片、`#tagCloud` 趋势标签云（元素已删，`renderTags()` 留空壳带 null 保护）。
- "政策解读 / 咨询格奇解读"按钮 → 改为 **SEO/GEO 咨询抽屉**（公司定位）。
- 详情页"查看原始来源"按钮 → 删除；相关情报每条改为**直接打开原链接 `url`**。

## 7. 外部依赖与密钥
| 依赖 | 位置 / 值 | 说明 |
|------|-----------|------|
| GitHub PAT | **已长期存储（2026-08-20 配）**：Windows 凭据管理器条目 `git:https://github.com`（用户 `Ryan-Ma-spec`），git 凭据助手 `wincred` 自动读取，**push 零输入** | 有效期 90 天（约 11-18 到期）。换新 token 一条命令：`cmdkey /generic:git:https://github.com /user:Ryan-Ma-spec /pass:<新token>`；GitHub 访问已配本地代理（`git config --global http.https://github.com.proxy http://127.0.0.1:7890`），代理软件须开着；勿再用 `helper-selector`（无窗口环境会静默崩溃，已从系统 gitconfig 移除） |
| `DEEPSEEK_API_KEY` | GitHub **Secrets**（名 `DEEPSEEK_API_KEY`） | **不填则简报退化为原文摘要**（质量下降）；填了每日 AI 生成 |
| Vercel | 连 GitHub 仓库 `geqi-trade-news`，push 即部署 | 框架=纯静态，构建命令留空，输出目录 `.` |
| 自定义域名 | `geqitradeconsulting.com`（腾讯云购，DNSPod 解析） | `@` A → `216.198.79.1`；`www` CNAME → `fe0bfe18ef7be893.vercel-dns-017.com` |
| Formspree（预约表单收数据） | form ID `xljravoa`，硬编码在 `index.html`（非密钥，公开可见无妨） | 辉哥注册的免费账号（注册邮箱即接收提醒的邮箱），**免费版每月限 50 条提交**；预约后台：https://formspree.io 登录查看；首次某域名提交可能需点邮件里的验证链接 |

## 8. 部署与定时
- **每日 07:00（cron `0 23 * * *`）** GitHub Actions 跑 `pipeline.js` → 有变化则提交 `news.js`/`news.json` → Vercel 自动部署。
- 手动触发：仓库 **Actions → Daily News Update → Run workflow**。
- Node 版本固定 **22**（workflow 已设，勿回退 20，GitHub 已弃用）。

## 9. 运维提醒
- **DeepSeek 余额见底** → 简报退化为原文摘要，监控 Secrets / 余额。
- 域名 **`geqitradeconsulting.com` 年费续费**（腾讯云提前提醒）。
- 旧 GitHub PAT 用后吊销，降低泄露风险。
- 改完任何脚本先 `node --check` 语法校验，再 push。
