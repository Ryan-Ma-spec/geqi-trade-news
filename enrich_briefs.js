#!/usr/bin/env node
/**
 * 给现有 news.json 每条新闻生成结构化情报简报（brief）。
 * 调用 DeepSeek Chat API，输出带 <h4>/<p>/<ul> 的 HTML 片段。
 * 支持断点续跑（已存在 brief 的跳过）。
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
  console.error("⚠️ 未设置 DEEPSEEK_API_KEY，无法生成简报。");
  process.exit(1);
}

const newsPath = path.join(__dirname, "news.json");
const news = JSON.parse(fs.readFileSync(newsPath, "utf8"));

const SYS = `你是外贸情报编辑。请根据提供的新闻标题、摘要和来源，整理成一份结构化的"外贸情报速览"。

要求：
1. 用中文输出一段 HTML 片段（只包含 body 内部标签，不要 html/head/body 标签，不要 markdown 代码块）。
2. 必须包含以下结构（每个 h4 后跟对应内容）：
   <h4>核心事实</h4><p>...</p>
   <h4>影响看点</h4><ul><li>...</li><li>...</li></ul>
   <h4>涉及主体/市场</h4><p>...</p>
3. 内容要信息密度高、客观专业，但禁止编造具体数字、人物引语或未在输入中出现的事实。
4. 如果摘要信息不足，可以合理推断影响和行业关联，但要明确这是基于公开信息的判断。`;

async function enrich(item) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: `标题：${item.title}\n摘要：${item.summary}\n来源：${item.source}\n发布时间：${item.time}` }
      ],
      temperature: 0.4,
      max_tokens: 600
    })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.choices[0].message.content.trim();
}

function stripCodeFence(s) {
  return s.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim();
}

(async () => {
  let done = 0, skip = 0, fail = 0;
  for (let i = 0; i < news.length; i++) {
    const n = news[i];
    if (n.brief && n.brief.length > 50) { skip++; continue; }
    process.stdout.write(`[${i + 1}/${news.length}] ${n.title.slice(0, 30)}... `);
    try {
      const raw = await enrich(n);
      n.brief = stripCodeFence(raw);
      done++;
      console.log("✓");
      if (i < news.length - 1) await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      fail++;
      console.log("✗", e.message);
    }
  }

  fs.writeFileSync(newsPath, JSON.stringify(news, null, 2));

  const meta = { total: news.length, updated: new Date().toISOString() };
  const out = `window.NEWS_DATA = ${JSON.stringify(news, null, 0)};\nwindow.SITE_META = ${JSON.stringify(meta, null, 0)};\n`;
  fs.writeFileSync(path.join(__dirname, "news.js"), out);

  console.log(`\n完成：成功 ${done} / 跳过 ${skip} / 失败 ${fail}`);
  console.log("已更新 news.js / news.json");
})();
