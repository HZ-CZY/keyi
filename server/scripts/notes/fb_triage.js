/**
 * 反馈分诊与待办（人工判断，2026-11-06）
 * ============================================================
 * Agnes 免费池 503 跑不动，69 条由我逐条读完标注。
 * 字段：
 *   id        feedback 主键
 *   type      bug / 建议 / 咨询 / 投诉 / 闲聊
 *   module    模块
 *   sev       0=P0资产数据损失 1=P1功能坏 2=P2体验 3=P3闲聊
 *   brief     一句话
 *   group     归并用的根因编号（同一 group = 同一个待办）
 *   reply     给用户的回复（不承诺时间、不声称已修）
 *   human     1=需要人工答（咨询类，模型不懂实现）
 */
module.exports = [
  // ══════════ P0：资产/数据损失 ══════════
  {
    id: 348, type: 'bug', module: '签到任务', sev: 0, group: 'G01',
    brief: '签到 20 天突然变 0',
    reply: '20 天不会自己变 0，这不正常。我去翻一下你账号的签到记录，查到原因给你把天数恢复回来。',
  },
  {
    id: 349, type: 'bug', module: '竞技场', sev: 0, group: 'G02',
    brief: '好友房创建即扣 50，取消不退',
    reply: '确实不合理，点一下创建就扣，退出来还不退。改成进对局才扣，光开着房间不算。',
  },
  {
    id: 341, type: 'bug', module: '竞技场', sev: 0, group: 'G02',
    brief: '决斗场好友邀请扣 50 不还',
    reply: '跟别人反馈的是同一处，好友邀请一创建就扣 50、退出来不退。一起改。',
  },
  {
    id: 338, type: 'bug', module: '竞技场', sev: 0, group: 'G02',
    brief: '好友对战退出不退铜板',
    reply: '这个我认，点进去就扣、退出来一分不退，跟正式对战不一样。改成进去才扣。',
  },
  {
    id: 339, type: 'bug', module: '竞技场', sev: 0, group: 'G02',
    brief: '用户在等十分钟退款',
    reply: '看到了，你等的那笔 50 我记着，等改完一起处理，不用一直等。',
  },
  {
    id: 325, type: 'bug', module: '部落', sev: 0, group: 'G03',
    brief: '训兵后退出部落，队列和圣水都没了',
    reply: '训练队列在退出部落时被清掉了，圣水却已经扣了——这是漏的。队列要跟着部落一起存。',
  },
  {
    id: 259, type: 'bug', module: '部落', sev: 0, group: 'G03',
    brief: '退出重进训练队列清空，圣水照扣',
    reply: '和上面那位一样的问题，训练队列没存住。已经在改这块。',
  },
  {
    id: 335, type: 'bug', module: '部落', sev: 0, group: 'G04',
    brief: '升迫击炮卡顿，吞 840 铜板',
    reply: '升级没走完就把铜板扣了，卡了一下就退出流程。这个顺序要改成先升级成功再扣。',
  },
  {
    id: 334, type: 'bug', module: '部落', sev: 0, group: 'G04',
    brief: '用户追问 840 铜板',
    reply: '那 840 我记着了，跟升级卡住是同一件事，一起处理。',
  },
  {
    id: 328, type: 'bug', module: '部落', sev: 0, group: 'G04',
    brief: '升迫击炮误退出，钱扣了没升级',
    reply: '一样的问题：铜板先扣、升级没成。改成升级成功才扣费。',
  },
  {
    id: 331, type: 'bug', module: '部落', sev: 0, group: 'G04',
    brief: '催修复',
    reply: '在弄了，扣了钱没升级这个我知道，不会赖。',
  },
  {
    id: 265, type: 'bug', module: '部落', sev: 0, group: 'G05',
    brief: '矿场装 10 天零产出，要求补偿',
    reply: '矿场装了没产出是坏了，不是你操作的问题。我把你这些天的记录查出来，该补的补上。',
  },
  {
    id: 322, type: 'bug', module: '部落', sev: 0, group: 'G05',
    brief: '矿场不产铜板',
    reply: '矿场确实不出铜板了，不只是你一个人，是这块坏了。',
  },
  {
    id: 295, type: 'bug', module: '部落', sev: 0, group: 'G05',
    brief: '矿场不产铜板（第二人报）',
    reply: '同上，矿场产出这块有问题，好几个人报了，在查。',
  },
  {
    id: 330, type: 'bug', module: '部落', sev: 0, group: 'G05',
    brief: '矿场写 15 每天，实际只有 5',
    reply: '数据写 15、实际给 5，这是算错了，不是显示错。按 15 给你补回去。',
  },
  {
    id: 329, type: 'bug', module: '部落', sev: 0, group: 'G05',
    brief: '矿场完全不挖矿',
    reply: '矿场这块确实不动了，好几个人报同一个。',
  },
  {
    id: 327, type: 'bug', module: '部落', sev: 0, group: 'G05',
    brief: '两个矿场零收益，问机制',
    reply: '不是你不会用——矿场现在确实不给收益，是坏了，不是你建错。',
  },
  {
    id: 286, type: 'bug', module: '部落', sev: 0, group: 'G06',
    brief: '拆城墙不退铜板',
    reply: '拆了不退这个说不过去，拆也该按比例退。我改一下。',
  },
  {
    id: 293, type: 'bug', module: '部落', sev: 0, group: 'G07',
    brief: '长按按键再开界面能卡进部落',
    reply: '长按弹新界面再点部落能钻进去，这是个口子。我堵一下。',
  },

  // ══════════ P0/P1：分数与加成不正确 ══════════
  {
    id: 236, type: 'bug', module: '排行榜', sev: 0, group: 'G08',
    brief: '重置卡组后总榜不加分',
    reply: '重置卡组之后学的不算分，这是漏算了。重置不该影响总榜累计。',
  },
  {
    id: 242, type: 'bug', module: '排行榜', sev: 0, group: 'G08',
    brief: '总榜不加分，且换不了头像',
    reply: '总榜不加分和换头像这两件事我都记下了，分开查。',
  },
  {
    id: 257, type: 'bug', module: '排行榜', sev: 0, group: 'G08',
    brief: '排行榜显示异常，怀疑卡 bug',
    reply: '排行这块确实出过显示不对，我看下现在的数据。',
  },
  {
    id: 292, type: 'bug', module: '铜板经济', sev: 0, group: 'G09',
    brief: '学习矿脉加成看不到，每天还是 +1',
    reply: '买了矿脉但铜板还是 +1，说明加没生效。我查一下你账号的加成有没有算进去。',
  },
  {
    id: 291, type: 'bug', module: '铜板经济', sev: 0, group: 'G09',
    brief: '感觉学习铜板没加成',
    reply: '不是错觉，加成这块确实可能没算上。我去核对。',
  },
  {
    id: 254, type: 'bug', module: '铜板经济', sev: 0, group: 'G09',
    brief: '买了矿脉后加成消失，之前还显示',
    reply: '之前有显示、现在没了，那是中间改坏了。我把它恢复。',
  },
  {
    id: 294, type: 'bug', module: '铜板经济', sev: 0, group: 'G10',
    brief: '铜板只显示支出，收入是 0',
    reply: '只有支出没有收入，是流水那边漏记了收入。我查一下你的账。',
  },
  {
    id: 298, type: 'bug', module: '铜板经济', sev: 0, group: 'G10',
    brief: '今日总收入与支出对不上',
    reply: '收支对不上说明有一边算漏了。我核一下今天的流水。',
  },
  {
    id: 332, type: 'bug', module: '竞技场', sev: 1, group: 'G11',
    brief: '打别人只给 1 铜板',
    reply: '打赢只给 1 个肯定不对。我看下你最近几场是怎么结算的。',
  },

  // ══════════ P1：功能不可用 ══════════
  {
    id: 297, type: 'bug', module: '头像', sev: 1, group: 'G12',
    brief: '上传头像报令牌无效或已过期',
    reply: '传头像报「令牌无效」是登录状态没续上，不是你图片的问题。我修一下。',
  },
  {
    id: 333, type: '咨询', module: '头像', sev: 3, group: 'G12',
    brief: '问头像什么时候审好',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 336, type: 'bug', module: '竞技场', sev: 1, group: 'G13',
    brief: '段位只能匹配到同一个对手',
    reply: '只能匹到李嘉权，说明你这个段位附近人太少、被卡在同一个对手上了。放宽匹配范围。',
  },
  {
    id: 289, type: 'bug', module: '签到任务', sev: 1, group: 'G14',
    brief: '每日任务「到期复习」永远完不成',
    reply: '学过的卡太多，一天的到期复习量根本做不完，这个任务门槛定得不对。改成按当天实际到期量来算。',
  },
  {
    id: 238, type: 'bug', module: '签到任务', sev: 1, group: 'G14',
    brief: '需要复习的词不到 20 个，任务做不了',
    reply: '反过来也会卡：到期的不够 20 个，任务就没法完成。这个任务该跟着实际量走，不该写死。',
  },
  {
    id: 240, type: '咨询', module: '签到任务', sev: 2, group: 'G14',
    brief: '问完成复习以什么为标准',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 239, type: '咨询', module: '签到任务', sev: 3, group: 'G14',
    brief: '追问今天的情况',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 255, type: 'bug', module: '签到任务', sev: 1, group: 'G15',
    brief: '每天复习了但任务天数不增加',
    reply: '天天复习任务天数不涨，是判定没认到你的复习记录。我去查你账号这几天的数据。',
  },
  {
    id: 288, type: '咨询', module: '训练场', sev: 2, group: 'G16',
    brief: '问训练场 300 上限包含什么',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 283, type: '咨询', module: '训练场', sev: 2, group: 'G16',
    brief: '问 300 上限是不是把别的算进来了',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 326, type: 'bug', module: '卡组学习', sev: 1, group: 'G17',
    brief: '没有卡片可学可复习了',
    reply: '卡全部学完了会这样。我给你加一组新的，或者你重置某组从头过一遍也行。',
  },
  {
    id: 231, type: '建议', module: '铜板经济', sev: 1, group: 'G18',
    brief: '负债的人没法玩训练场还债',
    reply: '负债进不去训练场，就只能干等着，这确实死循环。让负债也能打、收益先抵债。',
  },

  // ══════════ P2：看不清 / 数值不合理 ══════════
  {
    id: 251, type: 'bug', module: '训练场', sev: 2, group: 'G19',
    brief: '义项速判看不出哪个字加粗',
    reply: '加粗几乎看不出来，等于这题没法答。我把考点的字加大加重。',
  },
  {
    id: 245, type: 'bug', module: '部落', sev: 2, group: 'G19',
    brief: '部落铜板菜单字没加粗',
    reply: '跟训练场同一个毛病：该突出的字没突出。一起改。',
  },
  {
    id: 244, type: 'bug', module: '部落', sev: 2, group: 'G19',
    brief: '部落答题增益看不清加粗',
    reply: '加粗不明显这个我知道，好几个都提了。统一把考点字加粗放大。',
  },
  {
    id: 241, type: '建议', module: '其他', sev: 2, group: 'G20',
    brief: '首页背景模糊、有白雾',
    reply: '那层白雾是叠出来的遮罩，糊了图。我去掉它，图也换清晰的。',
  },
  {
    id: 225, type: '建议', module: '铜板经济', sev: 2, group: 'G21',
    brief: '日上限 80 太低，建议 150',
    reply: '80 确实低了点，一天学下来很快就顶到。这个数我调一下。',
  },
  {
    id: 279, type: '建议', module: '铜板经济', sev: 2, group: 'G21',
    brief: '每天能赚的铜板太少',
    reply: '赚得少主要是上限卡着。上限这块我松一点。',
  },
  {
    id: 299, type: '建议', module: '铜板经济', sev: 2, group: 'G21',
    brief: '铜板获取途径太少',
    reply: '途径确实单一，基本只有学习一条。我加几个能稳定赚的口子。',
  },
  {
    id: 280, type: '建议', module: '部落', sev: 2, group: 'G22',
    brief: '希望能用时间修部落、加保护期',
    reply: '修不起、修好又被打，这个循环确实难受。加个保护期，被打完有一段时间不能动你。',
  },
  {
    id: 270, type: '建议', module: '部落', sev: 2, group: 'G22',
    brief: '被打后想选择不修复',
    reply: '可以不修——但不修就没防御。我加个「暂不修复」的选项，你自己决定。',
  },
  {
    id: 301, type: '建议', module: '部落', sev: 2, group: 'G23',
    brief: '攻击建筑要显示攻击范围',
    reply: '只有数字确实抽象，摆的时候不知道能打多远。加个圈出来。',
  },
  {
    id: 285, type: '建议', module: '部落', sev: 2, group: 'G24',
    brief: '进攻要加确认键',
    reply: '点一下就出兵、退出来兵全没了，确实该有个确认。加上。',
  },
  {
    id: 321, type: '建议', module: '部落', sev: 2, group: 'G25',
    brief: '想用自己的兵打自己部落测试',
    reply: '想试阵容的摆法，这个需求合理。我加个演练模式，不损失兵。',
  },
  {
    id: 266, type: '建议', module: '铜板经济', sev: 2, group: 'G26',
    brief: '想看铜板收入来源明细',
    reply: '现在只有个总数，看不出哪来的。加个明细，按来源分开列。',
  },
  {
    id: 227, type: '建议', module: '部落', sev: 2, group: 'G27',
    brief: '希望恢复实时战报',
    reply: '实时战报之前有，后来去掉了。我把它放回来。',
  },
  {
    id: 337, type: '建议', module: '竞技场', sev: 2, group: 'G28',
    brief: '想加「发起再战」',
    reply: '输了一把想马上打回来，这个我加：打完直接点再来一局。',
  },
  {
    id: 340, type: '建议', module: '竞技场', sev: 2, group: 'G28',
    brief: '好友对决加「邀请再来一局」',
    reply: '同上，跟好友打完能直接约下一把，不用退回房间重开。',
  },
  {
    id: 232, type: '建议', module: '卡组学习', sev: 2, group: 'G29',
    brief: '卡组想再多一些',
    reply: '不想重学也不想复习，说明现在这几组都过完了。我加新卡组。',
  },
  {
    id: 233, type: '建议', module: '商城', sev: 2, group: 'G30',
    brief: '商城想出别的东西',
    reply: '商城现在东西太少了，我加几样。',
  },
  {
    id: 346, type: '建议', module: '商城', sev: 2, group: 'G31',
    brief: '称号 buff 能否叠加、能否自定义称号',
    reply: '称号叠加这个可以考虑，但得防着全买满就无敌。自定义称号要做审核，不然榜上会乱。',
  },

  // ══════════ P2：排行榜与积分口径 ══════════
  {
    id: 344, type: '建议', module: '排行榜', sev: 2, group: 'G08',
    brief: '要求改排行榜分数',
    reply: '排行分数这块我重新核一遍算法。',
  },
  {
    id: 345, type: '投诉', module: '排行榜', sev: 2, group: 'G32',
    brief: '榜上积分高得离谱，怀疑刷分',
    reply: '榜上那几个分确实不正常，正常学不出来。我查一下是不是有刷分的路子。',
  },
  {
    id: 347, type: '闲聊', module: '排行榜', sev: 3, group: 'G32',
    brief: '调侃榜一 66 亿分',
    reply: '66 亿确实离谱，我也在查这个数怎么来的。',
  },
  {
    id: 342, type: '建议', module: '排行榜', sev: 2, group: 'G33',
    brief: '建议加铜板排行榜',
    reply: '铜板榜比分数榜更能看出谁在刷，这个思路对。我加一个。',
  },

  // ══════════ P3：闲聊 / 无诉求 ══════════
  {
    id: 343, type: '闲聊', module: '铜板经济', sev: 3, group: 'G34',
    brief: '随口说要赚钱',
    reply: '想赚铜板就多刷训练场，那边稳定出。',
  },
  {
    id: 324, type: '闲聊', module: '铜板经济', sev: 3, group: 'G34',
    brief: '讨要铜板',
    reply: '铜板得自己挣，我这儿不发空头。',
  },
  {
    id: 323, type: '闲聊', module: '其他', sev: 3, group: 'G34',
    brief: '打招呼「神回来了」',
    reply: '回来了。',
  },
  {
    id: 271, type: '咨询', module: '账号', sev: 3, group: 'G35',
    brief: '问 admin 是谁',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 229, type: '咨询', module: '部落', sev: 3, group: 'G36',
    brief: '问部落什么时候上线',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
  {
    id: 228, type: '咨询', module: '部落', sev: 3, group: 'G36',
    brief: '问部落要修多久',
    reply: '这个我去确认一下，晚点回你。', human: 1,
  },
];
