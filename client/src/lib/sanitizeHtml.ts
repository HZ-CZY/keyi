/**
 * 通用 HTML 白名单净化器（浏览器端，基于原生 DOMParser）
 *
 * 背景：本项目多处需要把「用户/管理员可编辑的内容」以 HTML 形式渲染
 * （笔记字段、公告正文）。直接 dangerouslySetInnerHTML 会带来存储型 XSS。
 *
 * 安全模型（正向白名单，而非黑名单过滤）：
 *   - 只保留 profile 允许的标签，其余标签「剥壳」只留文本
 *   - script/style/iframe/object/embed/form 等整段丢弃
 *   - 属性一律丢弃，仅按 profile 保留：
 *       · 白名单内的 class 值
 *       · 通过正则校验的 color 内联样式
 *   - 所有文本节点转义 & < > "
 *
 * 【2026-09-12】从 components/AnnouncementRichText.tsx 抽出为共享模块，
 * 供公告正文与卡片正文（lib/markup.ts）复用，默认 profile 与原实现完全等价。
 */

/** 默认允许保留的标签（公告正文用） */
const DEFAULT_ALLOWED_TAGS = ['p', 'div', 'br', 'span', 'b', 'strong', 'u', 'i', 'em'];

/** 默认整段丢弃的标签 */
const DEFAULT_BLOCK_TAGS = [
  'script', 'style', 'iframe', 'link', 'meta', 'object', 'embed',
  'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'base',
];

const COLOR_RE =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;

export interface SanitizeProfile {
  /** 允许保留的标签（小写）。缺省用 DEFAULT_ALLOWED_TAGS */
  allowedTags?: readonly string[];
  /** 整段丢弃的标签（小写）。缺省用 DEFAULT_BLOCK_TAGS */
  blockTags?: readonly string[];
  /** 允许保留的 class 值白名单；未列出的 class 会被丢弃。缺省为空集（丢弃全部 class） */
  allowedClasses?: readonly string[];
  /** 是否保留合法的 color 内联样式（含把 <font color> 归一化为 <span style="color:…">） */
  allowColor?: boolean;
  /** 标签别名归一化，如 { font: 'span' } */
  aliasTags?: Readonly<Record<string, string>>;
  /** <img> 允许的 src 前缀白名单；不传则任何 img 一律丢弃（默认关闭） */
  allowImageSrc?: readonly string[];
}

/**
 * 净化 HTML 片段，返回可安全交给 innerHTML 的字符串。
 * 空输入返回 ''。
 */
export function sanitizeHtml(input: string | null | undefined, profile: SanitizeProfile = {}): string {
  if (!input) return '';
  const raw = String(input);

  const allowed = new Set((profile.allowedTags ?? DEFAULT_ALLOWED_TAGS).map((t) => t.toLowerCase()));
  const blocked = new Set((profile.blockTags ?? DEFAULT_BLOCK_TAGS).map((t) => t.toLowerCase()));
  const allowedClasses = new Set(profile.allowedClasses ?? []);
  const aliasTags = profile.aliasTags ?? {};
  const allowColor = profile.allowColor === true;
  const imageSrcPrefixes = profile.allowImageSrc ?? [];

  const doc = new DOMParser().parseFromString(`<div id="__root">${raw}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return '';

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const originalTag = el.tagName.toLowerCase();
    let tag = originalTag;
    if (blocked.has(tag)) return '';                       // 危险标签：整段丢弃

    const inner = Array.from(el.childNodes).map(clean).join('');

    // 图片：仅放行白名单前缀的 src（本站托管），属性只保留 src/alt
    if (tag === 'img') {
      if (imageSrcPrefixes.length === 0) return '';
      const src = (el.getAttribute('src') || '').trim();
      if (!src || !imageSrcPrefixes.some((pre) => src.startsWith(pre))) return '';
      const alt = (el.getAttribute('alt') || '').trim();
      const altAttr = alt ? ' alt="' + esc(alt) + '"' : '';
      return '<img src="' + esc(src) + '"' + altAttr + '/>';
    }

    // 自闭合标签：只保留标签本身，不产出结束标签
    if (tag === 'br' || tag === 'hr') return `<${tag}/>`;

    // 别名归一化（font → span）
    if (aliasTags[tag]) tag = aliasTags[tag];

    if (!allowed.has(tag)) return inner;                   // 未知标签：剥壳只留文本

    // ── 属性重建：只保留白名单 class 与合法 color，其余一律丢弃 ──
    const attrs: string[] = [];

    if (allowedClasses.size > 0) {
      const cls = (el.getAttribute('class') || '')
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => allowedClasses.has(c));
      if (cls.length > 0) attrs.push(`class="${cls.join(' ')}"`);
    }

    if (allowColor) {
      const style = (el.getAttribute('style') || '').toLowerCase();
      const sm = /color\s*:\s*([^;]+)/.exec(style);
      let val = sm ? sm[1].trim() : '';
      // 仅 <font color="…"> 才回退读 color 属性（与抽出前的行为保持一致）
      if (!val && originalTag === 'font') {
        val = (el.getAttribute('color') || '').trim();
      }
      if (val && COLOR_RE.test(val)) attrs.push(`style="color:${val}"`);
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `<${tag}${attrStr}>${inner}</${tag}>`;
  };

  // 只返回 root 各子节点的净化结果 —— 不要把 DOMParser 用的容器 div 本身带出去。
  // （抽出前的旧实现是 clean(root)，会把外层 <div id="__root"> 一起输出；
  //   对公告只是多一层无意义 div，但对卡片正文会插入块级元素、破坏行内排版，
  //   故这里统一改为只输出内容。）
  return Array.from(root.childNodes).map(clean).join('');
}

/** 默认 profile 的便捷入口（公告正文用，行为与抽出前完全一致） */
export function sanitizeAnnouncementHtml(input: string | null | undefined): string {
  return sanitizeHtml(input, {
    allowedTags: [...DEFAULT_ALLOWED_TAGS, 'img'],
    allowColor: true,
    aliasTags: { font: 'span' },
    // 公告配图只允许本站托管：外链图片一律丢弃，避免追踪像素与防盗链失效
    allowImageSrc: ['https://iamczy.cn/uploads/', '/uploads/'],
  });
}

/**
 * 卡片正文 profile —— 比公告宽松，因为卡片字段里本来就含服务端生成的标签：
 *   · server/src/routes/cards.ts 的 renderTemplate 会产出 <b> 与
 *     <span class="mark-highlight">（库中 576 条笔记含 <b>）
 *   · client 的 renderMarkup 会产出 <strong> 与 <mark class="highlight">
 * 因此这里额外允许 mark，并放行这几个已知安全的 class 值。
 */
const CARD_ALLOWED_CLASSES = ['highlight', 'mark-highlight', 'study-bold', 'blank-slot', 'keyword'];

export function sanitizeCardHtml(input: string | null | undefined): string {
  return sanitizeHtml(input, {
    allowedTags: [...DEFAULT_ALLOWED_TAGS, 'mark', 'hr', 'sub', 'sup'],
    allowedClasses: CARD_ALLOWED_CLASSES,
    allowColor: true,
    aliasTags: { font: 'span' },
  });
}
