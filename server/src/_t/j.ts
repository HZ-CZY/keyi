import { judgeViolation } from '../lib/auto-reply';
const cases = [
  'asdfghjkl qwerty zxcvb',
  '今天天气真好，你们班几点放学',
  '1+1等于几',
  '最近好烦啊不想学了',
  '你能不能帮我写作业',
  '你们这个游戏做的什么垃圾',
  '为什么我的签到天数变成0了',
  '卡顿',
];
(async () => {
  for (const c of cases) {
    const t0 = Date.now();
    const v = await judgeViolation(c);
    console.log(`>> ${v.violation ? '封7天 ' + v.kind : '放行'}  ${Date.now() - t0}ms  ${c}`);
  }
})();
