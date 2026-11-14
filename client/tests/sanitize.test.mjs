/**
 * 净化器实测 —— 用真实代码 + 真实数据验证
 * 运行: cd <workspace> && node --experimental-strip-types sanitize.test.mjs
 */
import { parseHTML } from 'linkedom';

// ── 搭 DOM 环境（浏览器里这些是原生全局）──
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.DOMParser = class {
  parseFromString(html) {
    return parseHTML(html).document;
  }
};

const { sanitizeHtml, sanitizeAnnouncementHtml, sanitizeCardHtml } =
  await import('file:///C:/Users/Administrator/WorkBuddy%20AI/2026-09-12-11-37-47/keyi-src/client/src/lib/sanitizeHtml.ts');

const oldRenderMarkup = (t) =>
  t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
   .replace(/==(.+?)==/g, '<mark class="highlight">$1</mark>');

const newRenderMarkup = (t) =>
  sanitizeCardHtml(
    t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
     .replace(/==(.+?)==/g, '<mark class="highlight">$1</mark>')
  );

let pass = 0, fail = 0;
const check = (name, actual, expect) => {
  const ok = actual === expect;
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  if (!ok) {
    console.log(`      期望: ${JSON.stringify(expect)}`);
    console.log(`      实际: ${JSON.stringify(actual)}`);
  }
};
const checkHas = (name, actual, needle) => check(name, actual.includes(needle), true);
const checkNot = (name, actual, needle) => check(name, actual.toLowerCase().includes(needle.toLowerCase()), false);

console.log('\n========== 0. 不得带出容器 div ==========');
check('公告：无外层 div 包裹', sanitizeAnnouncementHtml('<b>x</b>'), '<b>x</b>');
check('卡片：无外层 div 包裹', sanitizeCardHtml('纯文本'), '纯文本');
check('无 __root 残留', sanitizeCardHtml('<b>x</b>').includes('__root'), false);

console.log('\n========== 1. 真实数据回归（不能改坏现有显示）==========');
// 取自 keyi.db notes.fields 的真实样本
const realCases = [
  '<b>**爱**</b>其子，择师而教之',
  '==爱护==',
  '喜**爱**自己的孩子，选择老师来教导他。',
  '向<b>使</b>三国各<b>**爱**</b>其地',
  '==爱惜，吝惜<br>使：假使==',
  '假使当初韩、魏、楚三国各自**爱**惜自己的土地。',
  '风雨不动<b>**安**</b>如山',
  '==安稳==',
];
for (const [i, f] of realCases.entries()) {
  const after = newRenderMarkup(f);
  if (f.includes('<b>')) checkHas(`[${i}] 保留 <b>`, after, '<b>');
  if (f.includes('**')) checkHas(`[${i}] ** → <strong>`, after, '<strong>');
  if (f.includes('==')) checkHas(`[${i}] == → <mark class="highlight">`, after, '<mark class="highlight">');
  if (f.includes('<br>')) checkHas(`[${i}] <br> → <br/>`, after, '<br/>');
  if (!f.includes('<')) {
    // 输入不含标签时，输出里除 markup 自己生成的 <strong>/<mark> 外不应再有 '<'
    const stripped = after
      .replace(/<\/?strong>/g, '')
      .replace(/<mark class="highlight">/g, '')
      .replace(/<\/mark>/g, '');
    checkNot(`[${i}] 原始文本中的 < 已被转义`, stripped, '<');
  }
  console.log(`      [${f.slice(0, 30)}]`);
  console.log(`        旧: ${oldRenderMarkup(f)}`);
  console.log(`        新: ${after}`);
}

console.log('\n========== 2. XSS 载荷必须被清除 ==========');
const attacks = [
  ['img onerror', '<img src=x onerror="alert(1)">', 'onerror'],
  ['script 标签', '<script>alert(1)</script>', '<script'],
  ['svg onload', '<svg onload="alert(1)"></svg>', 'onload'],
  ['iframe', '<iframe src="javascript:alert(1)"></iframe>', '<iframe'],
  ['a href javascript', '<a href="javascript:alert(1)">x</a>', 'javascript:'],
  ['事件属性', '<b onclick="alert(1)">粗</b>', 'onclick'],
  ['style 注入', '<span style="background:url(javascript:alert(1))">x</span>', 'javascript:'],
  ['form/input', '<form action="/x"><input name="a"></form>', '<form'],
  ['object', '<object data="x"></object>', '<object'],
  ['大写绕过', '<IMG SRC=x ONERROR="alert(1)">', 'onerror'],
  ['嵌套绕过', '<scr<script>ipt>alert(1)</script>', '<script'],
  ['mark 带事件', '<mark class="highlight" onmouseover="alert(1)">x</mark>', 'onmouseover'],
  ['data URI', '<img src="data:text/html;base64,PHNjcmlwdD4=">', '<img'],
  ['a 标签整体剥壳', '<a href="https://evil.com">点我</a>', '<a '],
  ['style 标签', '<style>body{display:none}</style>', '<style'],
  ['base 标签', '<base href="//evil.com/">', '<base'],
  ['meta 刷新', '<meta http-equiv="refresh" content="0;url=//evil">', '<meta'],
  ['textarea', '<textarea></textarea>', '<textarea'],
];
for (const [name, payload, mustNotContain] of attacks) {
  const out = newRenderMarkup(payload);
  const clean = !out.toLowerCase().includes(mustNotContain.toLowerCase());
  clean ? pass++ : fail++;
  console.log(`${clean ? '  ✓' : '  ✗'} ${name}`);
  console.log(`      in : ${payload}`);
  console.log(`      out: ${out}`);
}

console.log('\n========== 3. 公告净化器（抽出后行为核对）==========');
check('span + 合法 color', sanitizeAnnouncementHtml('<span style="color:#ff0000">红</span>'), '<span style="color:#ff0000">红</span>');
check('span + 非法 color → 无样式 span', sanitizeAnnouncementHtml('<span style="color:expression(alert(1))">x</span>'), '<span>x</span>');
check('font color → 归一化 span', sanitizeAnnouncementHtml('<font color="#00ff00">绿</font>'), '<span style="color:#00ff00">绿</span>');
check('font style → 归一化 span', sanitizeAnnouncementHtml('<font style="color: rgb(1, 2, 3)">x</font>'), '<span style="color:rgb(1, 2, 3)">x</span>');
check('br', sanitizeAnnouncementHtml('a<br>b'), 'a<br/>b');
check('加粗', sanitizeAnnouncementHtml('<b>粗</b>'), '<b>粗</b>');
check('script 整段丢弃', sanitizeAnnouncementHtml('a<script>x</script>b'), 'ab');
check('未知标签剥壳', sanitizeAnnouncementHtml('<h1>标题</h1>'), '标题');
check('文本转义', sanitizeAnnouncementHtml('a & b < c'), 'a &amp; b &lt; c');
check('实体不双重转义', sanitizeAnnouncementHtml('A &amp; B'), 'A &amp; B');
check('空输入', sanitizeAnnouncementHtml(''), '');
check('null 输入', sanitizeAnnouncementHtml(null), '');
check('mark 在公告 profile 下被剥壳', sanitizeAnnouncementHtml('<mark class="highlight">x</mark>'), 'x');
check('div 保留（公告正文分段）', sanitizeAnnouncementHtml('<div>段1</div><div>段2</div>'), '<div>段1</div><div>段2</div>');

console.log('\n========== 4. 卡片 profile 的 class 白名单 ==========');
check('合法 class 保留', sanitizeCardHtml('<mark class="highlight">x</mark>'), '<mark class="highlight">x</mark>');
check('非法 class 丢弃', sanitizeCardHtml('<span class="evil">x</span>'), '<span>x</span>');
check('混合 class 只留白名单', sanitizeCardHtml('<span class="evil highlight">x</span>'), '<span class="highlight">x</span>');
check('mark 无 class 保留', sanitizeCardHtml('<mark>y</mark>'), '<mark>y</mark>');
check('hr 自闭合', sanitizeCardHtml('a<hr>b'), 'a<hr/>b');
check('div 保留', sanitizeCardHtml('<div>x</div>'), '<div>x</div>');
check('服务端 span.mark-highlight 保留', sanitizeCardHtml('<span class="mark-highlight">x</span>'), '<span class="mark-highlight">x</span>');

console.log('\n========== 5. 幂等性（重复净化不劣化）==========');
const once = sanitizeCardHtml('<b>**爱**</b>其子');
const twice = sanitizeCardHtml(once);
check('二次净化结果一致', twice, once);

console.log('\n========================================');
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
