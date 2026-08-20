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

  // 检索词 → 默认栏目（classify 会按正文再校正）
  const QUERIES = [
    { q: "外贸 进出口 政策", def: "policy" },
    { q: "商务部 海关 外贸", def: "policy" },
    { q: "关税 汇率 人民币 出口退税", def: "tariff" },
    { q: "海外贸易市场 出海", def: "market" },
    { q: "跨境物流 航运 运价 港口", def: "logistics" },
    { q: "跨境电商 亚马逊 TikTok Shop 平台规则", def: "platform" },
    { q: "外贸企业 行业 订单", def: "industry" }
  ];

  // 分类关键词（按优先级匹配）
  const CAT_KEYWORDS = {
    policy:    ["政策", "商务部", "海关", "税务", "规定", "办法", "通知", "条例", "监管", "合规", "国务院", "发改委", "豁免", "准入", "清单", "立法", "部长", "外贸", "进出口", "出口", "贸易"],
    tariff:    ["关税", "汇率", "人民币", "美元", "退税", "反倾销", "反补贴", "外汇", "结汇", "货币"],
    logistics: ["物流", "航运", "港口", "海运", "班列", "运价", "集装箱", "货运", "空运", "中欧", "红海", "铁海联运", "运费"],
    platform:  ["亚马逊", "TikTok", "阿里国际", "eBay", "Shopify", "独立站", "Lazada", "Shopee", "沃尔玛", "平台", "跨境", "电商", "黑五", "FBE", "电子商务法"],
    market:    ["出海", "海外", "国际", "美国", "欧盟", "东南亚", "市场", "全球", "开放", "金融", "银行"]
  };
  const CAT_ORDER = ["policy", "tariff", "logistics", "platform", "market"];

  function classify(text) {
    for (const c of CAT_ORDER) {
      if (CAT_KEYWORDS[c].some(k => text.includes(k))) return c;
    }
    return "industry";
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
    const sys = '你是外贸资讯编辑。将新闻改写为中文摘要（不超过120字），提取3-5个标签，确认分类(policy/tariff/market/logistics/platform/industry)，并整理一份结构化情报简报（brief，HTML片段，包含<h4>核心事实</h4><p>...</p><h4>影响看点</h4><ul><li>...</li></ul><h4>涉及主体/市场</h4><p>...</p>）。只输出JSON：{"summary":"","tags":[],"cat":"","brief":""}';
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
      return { summary: c.summary || item.desc.slice(0, 150), tags: c.tags || [], cat: CATS_LABEL[c.cat] ? c.cat : cat, brief };
    } catch (e) { console.error("DeepSeek 失败，降级：", e.message); return null; }
  }

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

  if (raw.length === 0) {
    console.error("\n⚠️ 未抓到任何新闻（网络/源异常），保留上一次 news.js，不覆盖。");
    process.exit(1);
  }

  // 去重（按标题）
  const seen = new Set();
  const dedup = raw.filter(x => { const k = x.title; if (seen.has(k)) return false; seen.add(k); return true; });

  // 分类 + 相对时间
  let list = dedup.map(x => {
    const text = x.title + " " + x.desc;
    const cat = classify(text) !== "industry" ? classify(text) : (x.defCat || "industry");
    return { ...x, cat, time: relTime(x.pub) };
  });

  // 按发布时间倒序，取前 30
  list.sort((a, b) => new Date(b.pub) - new Date(a.pub));
  list = list.slice(0, 30);

  // AI 重写（有 key 才调）
  const useAI = !!process.env.DEEPSEEK_API_KEY;
  for (const n of list) {
    let summary, tags, cat = n.cat, brief;
    if (useAI) {
      const r = await rewriteWithAI(n, n.cat);
      if (r) { summary = r.summary; tags = r.tags; cat = r.cat; brief = r.brief; }
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

  // 组装输出
  const data = list.map((n, i) => ({
    id: i + 1,
    cat: n.cat,
    time: n.time,
    top: i === 0,
    ai: "要点提炼",
    title: n.title,
    summary: n.summary,
    source: n.source,
    url: n.link,
    tags: n.tags,
    topicTags: extractTopicTags(n.title, n.summary),
    body: n.desc || n.title,
    brief: n.brief
  }));

  const out = `window.NEWS_DATA = ${JSON.stringify(data, null, 0)};\nwindow.SITE_META = ${JSON.stringify({ total: data.length, updated: new Date().toISOString() }, null, 0)};\n`;
  fs.writeFileSync(path.join(__dirname, "news.js"), out);
  fs.writeFileSync(path.join(__dirname, "news.json"), JSON.stringify(data, null, 2));

  console.log(`\n✅ 生成完成：${data.length} 条情报 -> news.js / news.json`);
  console.log(`   AI 重写：${useAI ? "已启用 (DeepSeek)" : "未启用（降级模式，填 DEEPSEEK_API_KEY 即自动重写）"}`);
  const c = {}; data.forEach(n => c[n.cat] = (c[n.cat] || 0) + 1);
  console.log("   分类分布:", c);
})();
