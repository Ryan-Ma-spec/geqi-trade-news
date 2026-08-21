# 格奇外贸情报站 · 部署手册

一个**中文外贸资讯站**单文件原型，自动抓取真实外贸新闻、每日更新，面向出海企业客户展示格奇的 SEO/GEO 专业能力。

---

## 一、项目文件

| 文件 | 作用 |
|------|------|
| `index.html` | 站点主页面（单文件，接 `news.js` 渲染） |
| `news.js` / `news.json` | 真实新闻数据（22 条 2026-08 真实外贸新闻，含 AI 结构化简报） |
| `pipeline.js` | 生产管线：抓 Google News RSS（中文 16 组 + 英文 3 组，英文 DeepSeek 翻译成中文）→ 本地规则分类 → 相对时间 →（可选）DeepSeek 重写摘要/标签/简报 → 输出 news.js |
| `topics.js` | 话题标签词典（给每条打"事件级标签 + 主题簇"，用于"相关情报"精准匹配） |
| `enrich_briefs.js` | 给新闻生成结构化情报简报（DeepSeek） |
| `enrich_topics.js` | 给新闻补话题标签（本地规则，零 API） |
| `gen_news.js` | 沙箱兜底数据生成（WebFetch 抓到的真实新闻烘焙进 news.js） |
| `.github/workflows/daily-news.yml` | 每天 07:00 北京时自动跑管线、提交 news.js |
| `.env.example` | 环境变量样例（`DEEPSEEK_API_KEY=`） |

---

## 二、一键上线（三步）

> 目标：代码推到 GitHub → EdgeOne Pages 连仓库自动部署 → 每天新闻自动更新。

### 第 1 步：建 GitHub 仓库并推代码

1. 浏览器打开 [github.com](https://github.com)，登录你的账号。
2. 点右上角 **＋ → New repository**。
3. 仓库名填 `geqi-trade-news`（随便起，英文小写），**不要**勾选 "Add a README"（保持空仓库）。
4. 点 **Create repository**，进到新仓库页面，复制仓库地址（形如 `https://github.com/你的用户名/geqi-trade-news.git`）。
5. 把地址告诉呆呆（或自己本地执行）：
   ```bash
   git remote add origin https://github.com/你的用户名/geqi-trade-news.git
   git branch -M main
   git push -u origin main
   ```
   > 也可以直接让呆呆帮你推——但需要你先在 WorkBuddy 里**连接 GitHub 连接器**（左侧连接器里点 GitHub → 授权），否则呆呆没有推送权限。

### 第 2 步：EdgeOne Pages 连仓库，实现"推送即部署"

1. 登录 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)。
2. 点 **新建项目 → 导入 Git 仓库**，选第 1 步里的 GitHub 仓库。
3. 框架预设选 **「无框架 / 纯静态」**（本站在根目录直接是 `index.html`，无需构建）。
4. **构建命令**：留空。**输出目录**：填 `.`（一个点，表示根目录）。
5. 点 **部署**。以后只要 GitHub 仓库有新的 push，EdgeOne 就会**自动重新部署**，给你一个公网可访问的网址。

### 第 3 步：填 DeepSeek key，开线上 AI 重写（推荐，可选）

1. 打开 [platform.deepseek.com](https://platform.deepseek.com) 注册并充值，拿到 **API Key**。
2. 回到 GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**。
3. Name 填 `DEEPSEEK_API_KEY`，Secret 粘贴你的 key，点 **Add secret**。
4. 填了之后，每日管线会自动用 DeepSeek 把新闻重写成结构化简报；**不填则自动降级用原文**，站点照常运行。

---

## 三、日常是怎么自动更新的

- GitHub Actions 每天 **07:00（北京时间）** 自动运行 `pipeline.js`：
  - 抓 Google News 实时外贸检索结果（中文 16 组 + 英文 3 组，英文经 DeepSeek 翻译成中文后并入，覆盖 6 大栏目）。
  - 分类、算相对时间、有 key 则 DeepSeek 重写摘要+标签+简报。
  - 若 news.js 有变化 → 自动提交 → **EdgeOne 自动重新部署**。
- 想手动跑一次：GitHub 仓库 → **Actions → 每日外贸情报更新 → Run workflow**。

---

## 四、本地预览（不改线上）

```bash
# 在项目根目录执行任意一种静态服务：
python -m http.server 8080
# 或
npx serve .
```
浏览器打开 `http://localhost:8080` 即可看到站点（需联网加载 Tailwind CDN）。

---

## 五、注意事项

- `news.js` / `news.json` 是**自动生成文件**，不要手改，改了也会被每日管线覆盖。
- `.env` 含真实 key，**已加入 .gitignore，不会进仓库**。
- 站点文案已统一为「格奇」品牌，定位 SEO/GEO 优化服务（不含政策解读类服务）。
