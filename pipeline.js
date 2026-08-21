#!/usr/bin/env node
/**
 * 格奇外贸情报 · 真实数据管线（生产版）
 * ---------------------------------------------------------------
 * 抓取 Google News 实时检索 RSS → 解析 → 关键词分类(6栏目) → 相对时间
 *   → [可选] DeepSeek 重写摘要/标签 → 去重排序 → 输出 news.js / news.json
 *
 * 数据源：Google News RSS 搜索（中文外贸语境），覆盖 6 大栏目关键词，
 *         拿到的是「当日/近周」真实新闻，而非官方站的静态归档。
 *
 * 运行：
 *   node pipeline.js                  # 无 key：降级，直接整理原文
 *   node --env-file=.env pipeline.js  # 有 key：自动调用 DeepSeek 重写
 *
 * 定时：配合 .github/workflows/daily-news.yml 每日自动跑并 commit news.js
 * 依赖：Node 18+（内置 fetch，零安装）
 * ---------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const { extractTopicTags } = require("./topics.js");

// 读取 .env（若存在）
(async () => {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  }

  // 栏目中文名
  const CATS_LABEL = { policy: "政策速递", tariff: "关税汇率", market: "海外市场", logistics: "物流航运", platform: "平台规则", industry: "行业精选" };

  // 检索词 → 默认栏目（classify 会按正文再校正）；扩充覆盖面以增加信息来源量
  const QUERIES = [
    // policy 政策速递
    { q: "外贸 进出口 政策", def: "policy" },
    { q: "商务部 海关 外贸", def: "policy" },
    { q: "出口管制 反倾销 贸易救济", def: "policy" },
    // tariff 关税汇率
    { q: "关税 汇率 人民币 出口退税", def: "tariff" },
    { q: "人民币 汇率 走势 外贸企业", def: "tariff" },
    { q: "加征关税 反补贴 关税豁免", def: "tariff" },
    // market 海外市场
    { q: "海外贸易市场 出海", def: "market" },
    { q: "出海 东南亚 欧盟 美国 市场", def: "market" },
    { q: "一带一路 RCEP 海外市场", def: "market" },
    // logistics 物流航运
    { q: "跨境物流 航运 运价 港口", def: "logistics" },
    { q: "中欧班列 海运 集装箱 运费", def: "logistics" },
    // platform 平台规则
    { q: "跨境电商 亚马逊 TikTok Shop 平台规则", def: "platform" },
    { q: "亚马逊 Temu SHEIN 速卖通 独立站", def: "platform" },
    // industry 行业精选
    { q: "外贸企业 行业 订单", def: "industry" },
    { q: "跨境电商 出口 制造业 工厂", def: "industry" },
    { q: "海外仓 品牌出海 独立站 外贸", def: "industry" }
  ];

  // 英文检索词（海外视角，AI 翻译成中文后并入；每组限取最新若干条，避免喧宾夺主）
  const EN_QUERIES = [
    { q: "China export tariff trade", def: "tariff" },
    { q: "global trade shipping freight", def: "logistics" },
    { q: "cross-border ecommerce export", def: "platform" },
    { q: "Southeast Asia market China export", def: "market" },
    { q: "China manufacturing export factory orders", def: "industry" },
    { q: "US EU China trade policy sanctions", def: "policy" }
  ];
  const EN_LIMIT = 5; // 每组英文源最多取条数（控制英文源占比，避免喧宾夺主）

  // 分类关键词（按优先级匹配）
  const CAT_KEYWORDS = {
    policy:    ["政策", "商务部", "海关", "税务", "规定", "办法", "通知", "条例", "监管", "国务院", "发改委", "准入", "清单", "立法", "部长", "出口管制"],
    tariff:    ["关税", "汇率", "人民币", "美元", "退税", "反倾销", "反补贴", "外汇", "结汇", "货币", "保证金"],
    logistics: ["物流", "航运", "港口", "海运", "班列", "运价", "集装箱", "货运", "空运", "中欧", "红海", "铁海联运", "运费", "运河", "滚装"],
    platform:  ["亚马逊", "TikTok", "阿里国际", "eBay", "Shopify", "独立站", "Lazada", "Shopee", "沃尔玛", "跨境", "电商", "黑五", "FBE", "电子商务法", "Temu", "SHEIN", "速卖通"],
    market:    ["出海", "海外", "美国", "欧盟", "东南亚", "一带一路", "RCEP", "东盟", "非洲", "中东", "拉美"],
    industry:  ["外贸", "进出口", "出口", "贸易", "订单", "制造业", "工厂", "企业", "行业", "供应商"]
  };
  const CAT_ORDER = ["policy", "tariff", "logistics", "platform", "market", "industry"];

  function classify(text) {
    let first = null;
    for (const c of CAT_ORDER) {
      if (CAT_KEYWORDS[c].some(k => text.includes(k))) { first = c; break; }
    }
    if (!first) return null; // 未命中，由调用方回退 defCat
    // 平台优先：正文含平台具体品牌词、且首命中是 policy 时，归「平台规则」
    // （如"亚马逊严打跟卖政策"本质是平台规则，不应被"政策"一词抢成政策速递）
    if (first === "policy" && CAT_KEYWORDS.platform.some(k => text.includes(k))) return "platform";
    return first;
  }
  function extractTags(text) {
    const set = new Set();
    for (const c of Object.keys(CAT_KEYWORDS))
      CAT_KEYWORDS[c].forEach(k => { if (text.includes(k)) set.add(k); });
    return [...set].slice(0, 5);
  }

  // 工具
  function decode(s) {
    return (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  }
  function stripTags(s) { return decode(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
  function relTime(pub) {
    const d = new Date(pub);
    if (isNaN(d.getTime())) return "近日";
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return "刚刚";
    if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + "分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + "小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + "天前";
    return Math.floor(diff / 86400 / 7) + "周前";
  }

  // 解析 Google News RSS（含 <source> 标签与 "标题 - 来源" 格式）
  function parseGoogleNews(xml, defCat) {
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
    return items.map(it => {
      const g = (re) => { const m = it.match(re); return m ? decode(m[1]) : ""; };
      let title = stripTags(g(/<title>([\s\S]*?)<\/title>/));
      let link = g(/<link>([\s\S]*?)<\/link>/).trim();
      const pub = g(/<pubDate>([\s\S]*?)<\/pubDate>/).trim();
      const sourceTag = g(/<source[^>]*>([\s\S]*?)<\/source>/).trim();
      let desc = stripTags(g(/<description>([\s\S]*?)<\/description>/));

      // Google News 标题形如 "头条 - 来源名"，拆出来源
      let source = sourceTag || "";
      const idx = title.lastIndexOf(" - ");
      if (idx >= 0) {
        if (!source) source = title.slice(idx + 3).trim();
        title = title.slice(0, idx).trim();
      }
      if (!source) source = "Google News";
      if (!link && pub) link = "https://news.google.com/search?q=" + encodeURIComponent(title);
      return { title, link, pub, desc, source, defCat };
    }).filter(x => x.title && x.link);
  }

  // DeepSeek 重写（可选）
  async function rewriteWithAI(item, cat) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return null;
    const sys = '你是外贸资讯编辑。将新闻（中英文均可）改写为中文：输出中文标题、中文摘要（不超过120字）、3-5个标签、确认分类(policy/tariff/market/logistics/platform/industry)，并整理一份结构化情报简报（brief，HTML片段，包含<h4>核心事实</h4><p>...</p><h4>影响看点</h4><ul><li>...</li></ul><h4>涉及主体/市场</h4><p>...</p>）。英文新闻请完整翻译成中文。只输出JSON：{"title":"","summary":"","tags":[],"cat":"","brief":""}';
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: `标题：${item.title}\n来源：${item.source}\n正文：${item.desc}` }
          ],
          response_format: { type: "json_object" },
          temperature: 0.3
        })
      });
      const j = await r.json();
      const c = JSON.parse(j.choices[0].message.content);
      const brief = c.brief || `<p>${c.summary || item.desc.slice(0, 150)}</p>`;
      return { title: c.title || "", summary: c.summary || item.desc.slice(0, 150), tags: c.tags || [], cat: CATS_LABEL[c.cat] ? c.cat : cat, brief };
    } catch (e) { console.error("DeepSeek 失败，降级：", e.message); return null; }
  }

  // ===== 增量/回填模式配置 =====
  const MODE = process.env.MODE === "backfill" ? "backfill" : "incremental";
  const SINCE_DAYS = parseInt(process.env.SINCE_DAYS || "1", 10) || 1;

  // 读取已有底座（news.js 的 window.NEWS_DATA），增量时在其上追加而非覆盖
  function parseNewsJs() {
    try {
      const s = fs.readFileSync(path.join(__dirname, "news.js"), "utf8");
      const m = s.match(/window\.NEWS_DATA\s*=\s*(\[[\s\S]*?\]);\s*\nwindow\.SITE_META/);
      if (m) return JSON.parse(m[1]);
    } catch (e) { /* 文件不存在或损坏则当作空底座 */ }
    return [];
  }
  function normUrl(u) {
    if (!u) return "";
    try { const x = new URL(u); x.search = ""; x.hash = ""; return x.origin + x.pathname; }
    catch { return String(u).trim(); }
  }

  const existing = parseNewsJs();
  const existKeys = new Set(existing.map(n => normUrl(n.url)).filter(Boolean));
  console.log(`📚 已有底座：${existing.length} 条 | 模式=${MODE} | 增量窗口=${SINCE_DAYS}天`);

  const raw = [];
  for (const { q, def } of QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; GeQiBot/1.0)" }, redirect: "follow" });
      if (!r.ok) { console.warn("✗ 检索失败:", q, r.status); continue; }
      const xml = await r.text();
      const items = parseGoogleNews(xml, def);
      console.log(`✓ "${q}": ${items.length} 条`);
      raw.push(...items);
    } catch (e) { console.warn("✗ 检索异常:", q, e.message); }
  }

  // 英文源（海外视角）：Google News 英文检索，AI 翻译后并入
  for (const { q, def } of EN_QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; GeQiBot/1.0)" }, redirect: "follow" });
      if (!r.ok) { console.warn("✗ 英文检索失败:", q, r.status); continue; }
      const xml = await r.text();
      const items = parseGoogleNews(xml, def).slice(0, EN_LIMIT).map(x => ({ ...x, en: true }));
      console.log(`✓ [英] "${q}": ${items.length} 条`);
      raw.push(...items);
    } catch (e) { console.warn("✗ 英文检索异常:", q, e.message); }
  }

  if (raw.length === 0) {
    console.error("\n⚠️ 未抓到任何新闻（网络/源异常），保留上一次 news.js，不覆盖。");
    process.exit(1);
  }

  // 过滤纯行情播报噪声（"08月19日 美元兑日元跌破..." 类汇率/商品机器播报）
  const cleaned = raw.filter(x => !(/^\d{1,2}月\d{1,2}日/.test(x.title) && /兑/.test(x.title) && /(跌破|突破|涨破)/.test(x.title)));
  if (raw.length !== cleaned.length) console.log(`🧹 过滤行情播报噪声：${raw.length - cleaned.length} 条`);

  // 去重（按标题）
  const seen = new Set();
  const dedup = cleaned.filter(x => { const k = x.title; if (seen.has(k)) return false; seen.add(k); return true; });

  // 分类 + 相对时间
  let list = dedup.map(x => {
    const text = x.title + " " + x.desc;
    // 兜底不再信任检索词预设栏目(defCat)：正文无强关键词命中时，统一归入最通用的「行业精选」，
    // 避免"抓错的新闻被硬塞进特定栏目"（如地缘/军事新闻误入物流航运）。
    const cat = classify(text) || "industry";
    return { ...x, cat, time: relTime(x.pub) };
  });

  // 增量窗口过滤：每日(incremental)只保留最近 SINCE_DAYS 天；回填(backfill)不过滤
  if (MODE === "incremental") {
    const since = Date.now() - SINCE_DAYS * 86400000;
    const before = list.length;
    list = list.filter(x => new Date(x.pub).getTime() >= since);
    console.log(`⏱ 增量窗口(近${SINCE_DAYS}天)：${before} → ${list.length} 条`);
  }

  // AI 重写（有 key 才调）
  const useAI = !!process.env.DEEPSEEK_API_KEY;
  for (const n of list) {
    let summary, tags, cat = n.cat, brief;
    if (useAI) {
      const r = await rewriteWithAI(n, n.cat);
      if (r) { if (r.title) n.title = r.title; summary = r.summary; tags = r.tags; brief = r.brief; }
    }
    if (!summary) {
      summary = n.desc.length > 150 ? n.desc.slice(0, 150) + "…" : (n.desc || n.title);
      tags = extractTags(n.title + " " + n.desc);
      if (tags.length === 0) tags = [CATS_LABEL[cat]];
    }
    if (!brief) brief = `<p>${summary}</p>`;
    n.summary = summary;
    n.tags = (tags && tags.length) ? tags : [CATS_LABEL[cat]];
    n.cat = cat;
    n.brief = brief;
  }

  // 组装本次新条目（含 pub 便于未来精确排序）
  const freshData = list.map(n => ({
    cat: n.cat,
    time: n.time,
    top: false,
    ai: "要点提炼",
    title: n.title,
    summary: n.summary,
    source: n.source,
    url: n.link,
    tags: n.tags,
    topicTags: extractTopicTags(n.title, n.summary),
    body: n.desc || n.title,
    brief: n.brief,
    pub: n.pub
  }));

  // 合并去重（按 url 规范化）：跳过已存在于底座的条目，避免重复累积
  const merged = existing.slice();
  const seenMerged = new Set(merged.map(m => normUrl(m.url)).filter(Boolean));
  let added = 0;
  for (const f of freshData) {
    const k = normUrl(f.url);
    if (k && seenMerged.has(k)) continue;
    if (k && merged.some(m => normUrl(m.url) === k)) continue;
    merged.push(f); added++;
  }
  console.log(`➕ 新增 ${added} 条，底座 → ${merged.length} 条`);

  // 排序：本次新抓按发布时间倒序置顶，已有底座（本身已倒序）顺延在后
  const existingPart = merged.slice(0, existing.length);
  const freshPart = merged.slice(existing.length);
  freshPart.sort((a, b) => new Date(b.pub || 0) - new Date(a.pub || 0));
  const finalList = freshPart.concat(existingPart);
  finalList.forEach((n, i) => { n.id = i + 1; n.top = (i === 0); });

  const out = `window.NEWS_DATA = ${JSON.stringify(finalList, null, 0)};\nwindow.SITE_META = ${JSON.stringify({ total: finalList.length, updated: new Date().toISOString() }, null, 0)};\n`;
  fs.writeFileSync(path.join(__dirname, "news.js"), out);
  fs.writeFileSync(path.join(__dirname, "news.json"), JSON.stringify(finalList, null, 2));

  console.log(`\n✅ 生成完成：底座共 ${finalList.length} 条（新增 ${added}）-> news.js / news.json`);
  console.log(`   模式=${MODE} | 增量窗口=${SINCE_DAYS}天 | AI 重写：${useAI ? "已启用 (DeepSeek)" : "未启用（降级）"}`);
  const c = {}; finalList.forEach(n => c[n.cat] = (c[n.cat] || 0) + 1);
  console.log("   分类分布:", c);
})();
