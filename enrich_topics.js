#!/usr/bin/env node
/**
 * 给 news.json 每条新闻补「具体话题标签」topicTags（纯本地规则，零 API）。
 * 读取标题+摘要 → extractTopicTags → 写回 news.json 与 news.js。
 * 支持断点续跑（已有 topicTags 且非空则跳过）。
 */
const fs = require("fs");
const path = require("path");
const { extractTopicTags } = require("./topics.js");

const newsPath = path.join(__dirname, "news.json");
const news = JSON.parse(fs.readFileSync(newsPath, "utf8"));

let done = 0, skip = 0;
for (const n of news) {
  if (Array.isArray(n.topicTags) && n.topicTags.length) { skip++; continue; }
  n.topicTags = extractTopicTags(n.title, n.summary);
  done++;
}

fs.writeFileSync(newsPath, JSON.stringify(news, null, 2));
const meta = { total: news.length, updated: new Date().toISOString() };
const out = `window.NEWS_DATA = ${JSON.stringify(news, null, 0)};\nwindow.SITE_META = ${JSON.stringify(meta, null, 0)};\n`;
fs.writeFileSync(path.join(__dirname, "news.js"), out);

console.log(`topicTags 补标完成：新增 ${done} / 跳过 ${skip} / 共 ${news.length} 条`);
console.log("已更新 news.js / news.json");
