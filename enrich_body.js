#!/usr/bin/env node
/**
 * 给现有 news.json 每条新闻补「正文」（body）。
 * 现状：Google News RSS 的 <description> 基本为空，body 字段退化成「标题+来源」单行噪声，
 *       详情页无真正文可显示。本脚本调用 DeepSeek 基于 标题+摘要+情报速览 生成 300~600 字正文。
 * 支持断点续跑（已存在有效正文的跳过）；失败不中断（跳过继续）。
 * 运行：node enrich_body.js          （需环境变量 DEEPSEEK_API_KEY，或项目根 .env）
 */
const fs = require("fs");
const path = require("path");

(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    });
  }
})();

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error("⚠️ 未设置 DEEPSEEK_API_KEY，无法生成正文。");
  process.exit(1);
}

const DELAY = Number(process.env.DELAY) || 400;

const newsPath = path.join(__dirname, "news.json");
const news = JSON.parse(fs.readFileSync(newsPath, "utf8"));

// 与前端 index.html 的 bodyHTML() 判定一致：有效正文 = HTML(≥80字) 或 纯文本(≥2段)
function hasValidBody(item) {
  const b = (item.body || "").trim();
  if (!b) return false;
  const isHTML = /<[a-z][\s\S]*>/i.test(b);
  if (isHTML) {
    const plain = b.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return plain.length >= 80;
  }
  const paras = b.split(/\n+/).map(p => p.trim()).filter(Boolean);
  return paras.length >= 2;
}

function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const SYS = `你是外贸情报编辑。请根据提供的新闻标题、摘要和情报速览，撰写一篇完整的新闻正文。

要求：
1. 用中文输出 HTML 片段（只含 <p> 段落标签，不要 html/head/body 标签，不要 markdown 代码块，不要 <h4> 标题）。
2. 由 3~5 个 <p> 段落组成，全文约 300~600 字，按「事件背景 → 核心事实 → 对出海/外贸企业的影响 → 行动建议」展开。
3. 信息密度高、务实客观、企业老板能看懂；禁止编造具体数字、人名、引语、日期等未在输入中出现的事实；确需补充行业背景或影响分析时可合理推断，但那是判断性内容，不是捏造数据。
4. 若输入信息不足，宁可写得短而准，也不堆砌空话凑字数。`;

async function enrich(item) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: `标题：${item.title}\n摘要：${item.summary}\n情报速览：${stripTags(item.brief)}\n来源：${item.source}` }
      ],
      temperature: 0.4,
      max_tokens: 1500
    })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.choices[0].message.content || "").trim();
}

function stripCodeFence(s) {
  return s.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim();
}

// 每条成功后立即落盘，中断不丢进度（断点续跑靠 hasValidBody 跳过已完成条目）
function save() {
  fs.writeFileSync(newsPath, JSON.stringify(news, null, 2));
  const meta = { total: news.length, updated: new Date().toISOString() };
  const out = `window.NEWS_DATA = ${JSON.stringify(news, null, 0)};\nwindow.SITE_META = ${JSON.stringify(meta, null, 0)};\n`;
  fs.writeFileSync(path.join(__dirname, "news.js"), out);
}

(async () => {
  let done = 0, skip = 0, fail = 0;
  const failedIdx = [];
  for (let i = 0; i < news.length; i++) {
    const n = news[i];
    if (hasValidBody(n)) { skip++; continue; }
    process.stdout.write(`[${i + 1}/${news.length}] ${n.title.slice(0, 28)}... `);
    try {
      const raw = await enrich(n);
      const body = stripCodeFence(raw);
      // 二次校验：生成结果必须达有效正文标准，否则视为失败（避免写入噪声）
      if (hasValidBody({ body })) {
        n.body = body;
        done++;
        console.log("✓");
        save();
      } else {
        fail++;
        failedIdx.push(i);
        console.log("✗ 生成内容过短，跳过");
      }
    } catch (e) {
      fail++;
      failedIdx.push(i);
      console.log("✗", e.message);
    }
    if (i < news.length - 1) await new Promise(r => setTimeout(r, DELAY));
  }

  save();
  console.log(`\n完成：成功 ${done} / 跳过 ${skip} / 失败 ${fail}`);
  if (failedIdx.length) console.log("失败条目序号(0起)：", failedIdx.join(", "));
  console.log("已更新 news.js / news.json");
})();
