/**
 * 跨义辨析质量抽检（2026-11-06）
 * ------------------------------------------------------------
 * 判断 AI 写的辨析是不是真的有用，而不是看起来像话。
 *
 * 三个指标：
 *   ① 义项覆盖率 —— 辨析里提到了几个义项（漏太多等于没讲全）
 *   ② 是否具体   —— 有没有真的举出义项原文，还是在讲空话
 *   ③ 长度合理性 —— 太短（<60字）多半是敷衍，太长（>250字）学生不看
 */
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'keyi.db'));

const rows = db
  .prepare('SELECT char, senses, analysis, confusion, tip FROM word_ai_notes')
  .all();

function score(r) {
  const senses = JSON.parse(r.senses || '[]');
  const text = r.analysis + ' ' + r.confusion + ' ' + r.tip;

  // 义项被提到了吗：义项里有 2 字以上的关键词出现在辨析里
  let hit = 0;
  const missed = [];
  for (const s of senses) {
    const def = s.def || '';
    // 取义项的核心词（逗号前的部分，或前 4 字）来判断是否被提及
    const core = def.split(/[，,；;：:（(]/)[0].trim();
    const key = core.length >= 2 ? core : def.slice(0, 2);
    // 允许「或」连接的多义项分别命中
    const parts = key.split(/[、／/]/).filter((x) => x.length >= 1);
    const ok = parts.some((p) => p && text.includes(p));
    if (ok) hit++;
    else missed.push(def);
  }

  const cov = senses.length ? hit / senses.length : 0;
  const len = (r.analysis || '').length;
  const lenOk = len >= 60 && len <= 260;

  // 假大空检测：出现这些词但没有具体义项，多半在讲套话
  const hollow = /^(这个字|该字|此字)(很|非常)?(常用|重要|常见)/.test(r.analysis || '');

  return {
    char: r.char,
    n: senses.length,
    hit,
    cov,
    len,
    lenOk,
    hollow,
    missed,
    sample: (r.analysis || '').slice(0, 50),
  };
}

const all = rows.map(score).sort((a, b) => a.cov - b.cov);

console.log('='.repeat(66));
console.log(`跨义辨析质量抽检　共 ${all.length} 条`);
console.log('='.repeat(66));

const avgCov = all.reduce((s, x) => s + x.cov, 0) / (all.length || 1);
const badLen = all.filter((x) => !x.lenOk);
const lowCov = all.filter((x) => x.cov < 0.6);

console.log(`平均义项覆盖率：${(avgCov * 100).toFixed(1)}%`);
console.log(`覆盖率 <60% 的：${lowCov.length} 条`);
console.log(`长度不合格的：${badLen.length} 条`);
console.log('');

console.log('─── 覆盖率最低的 10 条 ───');
for (const x of all.slice(0, 10)) {
  console.log(
    `${x.char}  ${x.hit}/${x.n} (${(x.cov * 100).toFixed(0)}%)  ${x.len}字  «${x.sample}…»`
  );
  if (x.missed.length) {
    console.log(`      漏掉：${x.missed.slice(0, 4).join(' / ')}`);
  }
}

console.log('');
console.log('─── 覆盖率最高的 3 条（作为质量基准）───');
for (const x of all.slice(-3).reverse()) {
  console.log(`${x.char}  ${x.hit}/${x.n} (${(x.cov * 100).toFixed(0)}%)  ${x.len}字`);
  console.log(`      «${x.sample}…»`);
}
