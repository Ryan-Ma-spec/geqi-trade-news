// 一次性回填：给现有 news.js / news.json 的每条新闻补 date 字段
// - 有 pub（真实发布时间）→ 真实日期
// - 无 pub 但有 time（相对时间字符串）→ 以最后生成时刻为基准反推近似日期
// - 两者皆无 → date 置 null，前端兜底显示 time
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "news.js"), "utf8");
const m = src.match(/window\.NEWS_DATA\s*=\s*(\[[\s\S]*?\]);/);
const meta = src.match(/window\.SITE_META\s*=\s*(\{[\s\S]*?\});/);
const data = JSON.parse(m[1]);

// 基准：最后生成时刻（relTime 当年以此为 now 计算），从 SITE_META.updated 读取
const metaObj = meta ? JSON.parse(meta[1]) : {};
const T0 = new Date(metaObj.updated || "2026-08-23T23:24:17Z");

function fmt(d) {
  return (d.getUTCMonth() + 1) + "-" + d.getUTCDate();
}
function fromPub(pub) {
  const d = new Date(pub);
  return isNaN(d.getTime()) ? null : fmt(d);
}
function fromTime(t) {
  if (!t) return null;
  const h = t.match(/(\d+)\s*小时前/);
  if (h) { const d = new Date(T0); d.setUTCHours(d.getUTCHours() - +h[1]); return fmt(d); }
  const day = t.match(/(\d+)\s*天前/);
  if (day) { const d = new Date(T0); d.setUTCDate(d.getUTCDate() - +day[1]); return fmt(d); }
  const wk = t.match(/(\d+)\s*周前/);
  if (wk) { const d = new Date(T0); d.setUTCDate(d.getUTCDate() - (+wk[1] * 7)); return fmt(d); }
  if (t.includes("昨天")) { const d = new Date(T0); d.setUTCDate(d.getUTCDate() - 1); return fmt(d); }
  if (t.includes("刚刚") || t.includes("近日")) return fmt(T0);
  return null;
}

let real = 0, approx = 0, none = 0;
for (const n of data) {
  if (n.pub) {
    const d = fromPub(n.pub);
    if (d) { n.date = d; real++; continue; }
  }
  if (n.time) {
    const d = fromTime(n.time);
    if (d) { n.date = d; approx++; continue; }
  }
  n.date = null; none++;
}

const out = `window.NEWS_DATA = ${JSON.stringify(data, null, 0)};\nwindow.SITE_META = ${meta ? meta[1] : JSON.stringify({ total: data.length, updated: new Date().toISOString() })};\n`;
fs.writeFileSync(path.join(__dirname, "news.js"), out);
fs.writeFileSync(path.join(__dirname, "news.json"), JSON.stringify(data, null, 2));
console.log(`date 回填完成：真实(pub) ${real} 条 | 近似(time反推) ${approx} 条 | 无日期 ${none} 条`);
