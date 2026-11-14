(() => {
  // 未传入预设时使用此默认方案；iOS Debug 开关通过宿主参数覆盖。
  const DEFAULT_BOARD_FONT_PRESET = "serif";
  // 诊断开关：?font_hook=off 时跳过自定义字体/字号 hook，用于隔离 SVG 输出问题。
  const BOARD_SKIP_FONT_HOOK = new URLSearchParams(location.search).get("font_hook") === "off";
  // 两套 SVG 字体及动态字形随 Web/iOS 资源分发，禁止字体切换后重新访问 CDN。
  const MATHJAX_FONT_PATH = "/quizboard/vendor/mathjax4/fonts";
  // 衬线方案的公式文字：中文思源宋体，西文 STIX Two Text，箭头与运算符 STIX Two Math，最后思源宋体全字符集补字；
  // 结构（根号、伸缩括号、分数线）用同一设计的 mathjax-stix2（2026-10-01 用户定字体方案）。
  const TEXT_FONT_FAMILY = '"Source Han Serif CN", "Board STIX Two Text", "Board Math Fallback", "Board Symbol Fallback", serif';
  const requestedPreset = window.__quizboardFontPreset
    || new URLSearchParams(location.search).get("font_preset") || DEFAULT_BOARD_FONT_PRESET;
  let fontPreset = ["serif", "wenkai"].includes(requestedPreset) ? requestedPreset : DEFAULT_BOARD_FONT_PRESET;
  let useWenKai = fontPreset === "wenkai";
  document.documentElement.dataset.fontPreset = fontPreset;
  const outputByFont = new Map();
  window.__quizboardSetFontPreset = async (preset) => {
    /** 原位切换字体：每套字体各保留一个 SVG 输出器，往返切换不重复加载。 */
    if (!["serif", "wenkai"].includes(preset) || preset === fontPreset) return false;
    await window.MathJax.startup.promise;
    const doc = window.MathJax.startup.document;
    const font = preset === "wenkai" ? "mathjax-fira" : "mathjax-stix2";
    const previousFont = useWenKai ? "mathjax-fira" : "mathjax-stix2";
    outputByFont.set(previousFont, doc.outputJax);
    if (!outputByFont.has(font)) {
      await MathJax.loader.load(`[${font}]/svg`);
      const fontData = Object.values(MathJax._.output.fonts[font].svg_ts)[0];
      // matchFontHeight 是 SVG 输出器构造时自己写入的内部字段，再传入会触发无效选项警告。
      const { matchFontHeight, ...options } = doc.outputJax.options;
      const output = new doc.outputJax.constructor({
        ...options, font, fontData, dynamicPrefix: `[${font}]/svg/dynamic`,
        // 全局缓存容器只属于页面最初的字体；新输出器改用自带字形定义。字幕页本身不用缓存（none），保持不变。
        fontCache: doc.outputJax.options.fontCache === "global" ? "local" : doc.outputJax.options.fontCache,
      });
      output.setAdaptor(doc.adaptor);
      output.initialize();
      outputByFont.set(font, output);
    }
    doc.outputJax = outputByFont.get(font);
    fontPreset = preset;
    useWenKai = preset === "wenkai";
    document.documentElement.dataset.fontPreset = preset;
    const output = doc.outputJax;
    output?.unknownCache?.clear();
    if (output) output.options.unknownFamily = useWenKai
      ? '"LXGW WenKai", "PingFang SC", "Helvetica Neue", Arial, sans-serif'
      : TEXT_FONT_FAMILY;
    return true;
  };
  const fontLoads = new Map();
  const tokenKinds = new Set(["mi", "mn", "mo", "mtext", "ms"]);
  const textVariants = new Set(["normal", "italic", "bold", "bold-italic", "-tex-mathit"]);

  const regionIntegrals = new Set(["\\iint", "\\iiint", "\\iiiint", "\\oint", "\\oiint", "\\oiiint"]);

  function skipTexTrivia(source, index) {
    /** 参数间空格和注释不参与公式结构判断，返回下一个实际 token 的位置。 */
    return index + (source.slice(index).match(/^(?:\s|%[^\r\n]*(?:\r\n?|\n|$))*/)?.[0].length || 0);
  }

  function hasRegionSubscript(source, index) {
    /** 仅识别完整的单下标区域；双上下界和作者显式限位仍交给 TeX 原规则。 */
    let cursor = skipTexTrivia(source, index);
    if (source[cursor++] !== "_") return false;
    cursor = skipTexTrivia(source, cursor);
    if (cursor >= source.length) return false;
    if (source[cursor] === "{") {
      let depth = 1;
      for (cursor++; cursor < source.length && depth;) {
        const char = source[cursor];
        if (char === "%") { cursor = skipTexTrivia(source, cursor); continue; }
        if (char === "\\") {
          const command = source.slice(cursor).match(/^\\(?:[A-Za-z]+|[\s\S])/)?.[0] || "\\";
          cursor += command.length;
          if (command === "\\verb") {
            if (source[cursor] === "*") cursor++;
            const delimiter = source[cursor], end = delimiter ? source.indexOf(delimiter, cursor + 1) : -1;
            if (end < 0) return false;
            cursor = end + 1;
          }
          continue;
        }
        if (char === "{") depth++;
        if (char === "}") depth--;
        cursor++;
      }
      if (depth) return false;
    } else if (source[cursor] === "\\") {
      const command = source.slice(cursor).match(/^\\(?:[A-Za-z]+|[\s\S])/);
      if (!command) return false;
      cursor += command[0].length;
    } else {
      if (/[}_^]/.test(source[cursor])) return false;
      cursor += String.fromCodePoint(source.codePointAt(cursor)).length;
    }
    cursor = skipTexTrivia(source, cursor);
    return source[cursor] !== "^" && !/^\\(?:no|display)?limits(?![A-Za-z])/.test(source.slice(cursor));
  }

  function normalizeFormulaSource(source) {
    /** 统一文本空白线与区域积分限位；显示规范化不改写原稿，也不碰文本或逐字内容。 */
    // 已保存的题干可能把整条填空线标成 formula；显示修复不改写原始 BoardDoc。
    if (/^_+$/.test(source.trim())) source = `\\text{${source.trim()}}`;
    const scopes = [{ text: false, end: null }];
    // 独立公式里的双重 JSON 转义不是换行；环境中的 \\ 保留原有行分隔语义。
    const recoverEscapedCommands = !/\\begin\s*\{/.test(source);
    let result = "";
    for (let i = 0; i < source.length;) {
      const scope = scopes.at(-1);
      const char = source[i];
      if (char === "%") {
        const comment = source.slice(i).match(/^[^\r\n]*/)[0];
        result += comment;
        i += comment.length;
        continue;
      }
      if (char === "\\") {
        if (recoverEscapedCommands && !scope.text && /^\\\\(?:frac|dfrac|tfrac|sqrt|pi|theta|alpha|beta|gamma|lambda|vec|overrightarrow|boldsymbol)(?![A-Za-z])/.test(source.slice(i))) i += 1;
        const command = source.slice(i).match(/^\\(?:[a-zA-Z]+|[\s\S])/)?.[0] || "\\";
        result += command;
        i += command.length;
        // 多重及闭合积分的单区域下标按原卷放在正下方；普通定积分和显式布局不变。
        if (!scope.text && regionIntegrals.has(command) && hasRegionSubscript(source, i)) result += "\\limits";
        // verb 的分隔符及内容不参与括号、下划线或数学模式识别。
        if (command === "\\verb") {
          if (source[i] === "*") result += source[i++];
          const delimiter = source[i];
          const end = delimiter ? source.indexOf(delimiter, i + 1) : -1;
          if (end >= 0) {
            result += source.slice(i, end + 1);
            i = end + 1;
          }
        } else if (command === "\\text" || (scope.text && command === "\\ensuremath")) {
          const opening = source.slice(i).match(/^(?:\s|%[^\r\n]*[\r\n])*\{/);
          if (opening) {
            result += opening[0];
            i += opening[0].length;
            scopes.push({ text: command === "\\text", end: "}" });
          }
        } else if (command === scope.end) {
          scopes.pop();
        } else if (scope.text && (command === "\\(" || command === "\\[")) {
          scopes.push({ text: false, end: command === "\\(" ? "\\)" : "\\]" });
        }
        continue;
      }
      if (char === "{") scopes.push({ text: scope.text, end: "}" });
      else if (char === scope.end) scopes.pop();
      else if (char === "$" && scope.text) scopes.push({ text: false, end: "$" });
      // textmacros 解释转义：text 中的裸下划线写成 \_ 才显示为字面空白线。
      result += char === "_" && scope.text ? "\\_" : char;
      i += 1;
    }
    return result;
  }

  function prepareFonts(chinese, hasCJK) {
    /** 首次测量前等待实际字形，避免把回退字体的宽度写入公式缓存。 */
    const key = `${fontPreset}:${chinese}:${hasCJK}`;
    if (!fontLoads.has(key)) {
      const families = useWenKai ? ["LXGW WenKai"] : ["Board STIX Two Text"];
      const requests = families.flatMap((family) => ["", "bold ", "italic ", "bold italic "].map(
        (style) => document.fonts.load(`${style}22px "${family}"`, "Abc 012 αθπ +−=")
      ));
      if (hasCJK && !useWenKai) requests.push(document.fonts.load('22px "Source Han Serif CN"', "中文，。"));
      // 补字字体先加载再测量，不能把系统回退字体的宽度写入公式缓存。
      if (!useWenKai) {
        requests.push(document.fonts.load('22px "Board Symbol Fallback"', "△∠⊥"));
        requests.push(document.fonts.load('22px "Board Math Fallback"', "⟂∘⟹⋅ℝ"));
      }
      const state = { ready: false, promise: null };
      // 字体下载慢时不能无限期卡住公式排版：最多等 3 秒，到点就用已到的字形继续。
      const settled = Promise.allSettled(requests).then(() => { state.ready = true; });
      // 超时分支必须同时把 ready 置真：否则 MathJax 重试时会看到 ready 仍为假，
      // 又拿着已 resolve 的 promise 立刻重试，形成忙循环把渲染进程拖死。
      const timeout = new Promise((resolve) => setTimeout(() => {
        if (!state.ready) { state.ready = true; resolve(); }
      }, 3000));
      state.promise = Promise.race([settled, timeout]);
      fontLoads.set(key, state);
    }
    return fontLoads.get(key);
  }

  function applyTeachingFont(math) {
    if (BOARD_SKIP_FONT_HOOK) return;
    /** 在 SVG 排版前指定 token 字体，字形与分数、上下标间距由同一次测量生成。 */
    if (!math.root) return;
    const tokens = [];
    math.root.walkTree((node) => { if (tokenKinds.has(node.kind)) tokens.push(node); });
    const chinese = /^zh/i.test(document.documentElement.lang);
    const hasCJK = tokens.some((node) => /[\u2e80-\u9fff\uf900-\ufaff\ufe10-\uffef]|[\u{20000}-\u{323af}]/u.test(node.getText()));
    const fonts = prepareFonts(chinese, hasCJK);
    if (!fonts.ready) MathJax._.util.Retries.retryAfter(fonts.promise);
    // 往返切换时恢复原 mathvariant，避免已有 MathML 保留衬线字体的显式属性。
    if (useWenKai) {
      for (const node of tokens) {
        const variant = node.getProperty("boardFontVariant");
        if (variant == null) continue;
        const attributes = node.attributes.getAllAttributes();
        for (const name of ["fontfamily", "fontstyle", "fontweight"]) delete attributes[name];
        node.attributes.set("mathvariant", variant);
      }
      return;
    }
    const family = TEXT_FONT_FAMILY;
    for (const node of tokens) {
      const variant = node.getProperty("boardFontVariant") ?? node.attributes.get("mathvariant");
      // 花体、黑板粗体保留数学语义；重音、伸缩括号和大型算子由数学字体排版。
      if (!textVariants.has(variant)) continue;
      // bar / hat / dot 的字形高度参与 mover 定位，不能换成整字高度的文字节点。
      if (node.kind === "mo" && (node.attributes.get("accent")
        || node.attributes.get("stretchy") || node.attributes.get("largeop"))) continue;
      // 普通符号和字母一样使用文字节点；缺字由完整思源宋体及数学字体补齐。
      node.setProperty("boardFontVariant", variant);
      // 移除显式 variant 后 MathJax 才会采用 fontfamily。
      delete node.attributes.getAllAttributes().mathvariant;
      node.attributes.set("fontfamily", family);
      node.attributes.set("fontstyle", variant.includes("italic") || variant === "-tex-mathit" ? "italic" : "normal");
      node.attributes.set("fontweight", variant.includes("bold") ? "bold" : "normal");
    }
  }

  function useMeasuredFontSize(math) {
    if (BOARD_SKIP_FONT_HOOK) return;
    /** 将输出的 ex 换算成测量时的 em，避免宿主字体的 x-height 再次缩放 SVG。 */
    if (useWenKai || !math.typesetRoot?.querySelectorAll) return;
    const exToEm = math.metrics.ex / math.metrics.em;
    const convert = (value) => /^-?[\d.]+ex$/.test(value)
      ? `${Number.parseFloat(value) * exToEm}em` : value;
    for (const svg of math.typesetRoot.querySelectorAll("svg")) {
      for (const name of ["width", "height"]) {
        const value = svg.getAttribute(name);
        if (value) svg.setAttribute(name, convert(value));
      }
      for (const name of ["vertical-align", "min-width"]) {
        const value = svg.style.getPropertyValue(name);
        if (value) svg.style.setProperty(name, convert(value));
      }
    }
  }

  function registerFormulaParts() {
    /**
     * 边讲边画 v1 §2：`\part{id}{X}` 与 `{X}` 排版完全相同，只给 X 的外层节点加可寻址 class。
     * 必须在 defaultReady 创建 TeX 输入器之前注册；主白板、字幕、追问与服务端公式校验共用此入口。
     * 不依赖需要联网自动加载的 html 扩展；注册失败时 runtime 会在排版前把 \part 还原成 {X}。
     */
    try {
      const tex = window.MathJax._.input.tex;
      const TexParser = tex.TexParser.default;
      const { CommandMap } = tex.TokenMap;
      const { Configuration } = tex.Configuration;
      // `__t<n>` 是 v2 §6 题干公式项的渲染端内部片段 id，不会与作者片段 id（字母开头）冲突。
      const partIdPattern = /^(?:[A-Za-z][A-Za-z0-9_]{0,15}|__t[0-9]{1,3})$/;
      const markPart = (node, id) => {
        /** 数学与文本片段共用身份规则，不把片段名混入可见内容。 */
        if (!partIdPattern.test(id)) return;
        const previous = node.attributes?.get?.("class");
        node.attributes?.set?.("class", `${previous ? `${previous} ` : ""}qb-part qb-part-${id}`);
      };
      const quizboardPart = (parser, name) => {
        /** 数学模式下沿用原公式解析与排版。 */
        const id = String(parser.GetArgument(name) || "").trim();
        const body = parser.GetArgument(name);
        const node = new TexParser(`{${body}}`, parser.stack.env, parser.configuration).mml();
        markPart(node, id);
        parser.Push(node);
      };
      new CommandMap("quizboard_part", { part: quizboardPart });
      Configuration.create("quizboardPart", { handler: { macro: ["quizboard_part"] } });
      const config = window.MathJax.config.tex || (window.MathJax.config.tex = {});
      if (Array.isArray(config.packages)) config.packages.push("quizboardPart");
      else if (config.packages && Array.isArray(config.packages["[+]"])) config.packages["[+]"].push("quizboardPart");
      else config.packages = { "[+]": ["quizboardPart"] };
      if (tex.textmacros?.TextParser?.TextParser) {
        // textmacros 使用独立的文本解析器；数学命令映射不能直接用于 \text{…}。
        new CommandMap("quizboard_text_part", { part: (parser, name) => {
          /** 单位、中文与嵌套文本继续按文本排版，仅增加可寻址外层。 */
          const id = String(parser.GetArgument(name) || "").trim();
          parser.saveText();
          const node = parser.ParseArg(name);
          markPart(node, id);
          parser.Push(node);
        } });
        Configuration.create("quizboardTextPart", { parser: "text", handler: { macro: ["quizboard_text_part"] } });
        config.textmacros ||= {};
        config.textmacros.packages = [...(config.textmacros.packages || ["text-base"]), "quizboardTextPart"];
      }
      window.__quizboardFormulaPartsSupported = true;
    } catch (error) {
      window.__quizboardFormulaPartsSupported = false;
      console.warn("[QuizboardMath] \\part macro unavailable", error);
    }
  }

  window.MathJax = {
    loader: {
      paths: {
        "mathjax-stix2": `${MATHJAX_FONT_PATH}/mathjax-stix2`,
        "mathjax-fira": `${MATHJAX_FONT_PATH}/mathjax-fira`,
      },
    },
    tex: {
      formatError(jax, error) {
        /** 错误详情留给诊断，正文和无障碍提示不展示引擎内部英文。 */
        const node = jax.formatError(error);
        const message = /^zh/i.test(document.documentElement.lang)
          ? "公式暂时无法显示" : "Formula unavailable";
        const replaceText = (part) => {
          /** 只替换错误占位的文字，不改公式原文、错误类型或诊断属性。 */
          if (part.kind === "text") part.setText(message);
          else for (const child of part.childNodes || []) replaceText(child);
        };
        replaceText(node);
        node.attributes.set("title", message);
        return node;
      },
      inlineMath: [["$", "$"], ["\\(", "\\)"]],
      // yhmath 的弧记号复用内置伸缩弧；TeX 自己解析参数，覆盖嵌套下标与片段。
      macros: { wideparen: ["\\overparen{#1}", 1] },
    },
    options: {
      enableMenu: false,
      enableSpeech: false,
      enableBraille: false,
      renderActions: {
        boardTeachingFont: [120,
          (doc) => { for (const math of doc.math) applyTeachingFont(math); },
          (math) => applyTeachingFont(math),
        ],
        boardMeasuredFontSize: [160,
          (doc) => { for (const math of doc.math) useMeasuredFontSize(math); },
          (math) => useMeasuredFontSize(math),
        ],
      },
    },
    output: {
      font: useWenKai ? "mathjax-fira" : "mathjax-stix2",
      fontPath: `${MATHJAX_FONT_PATH}/%%FONT%%`,
      mtextInheritFont: true,
      merrorInheritFont: true,
      unknownFamily: useWenKai
        ? '"LXGW WenKai", "PingFang SC", "Helvetica Neue", Arial, sans-serif'
        : TEXT_FONT_FAMILY,
    },
    svg: { fontCache: "global" },
    startup: {
      typeset: false,
      ready() {
        /** 在共同 TeX 入口修复显示文本，覆盖 Reader、板书、历史回放、字幕与追问。 */
        registerFormulaParts();
        MathJax.startup.defaultReady();
        for (const jax of Object.values(MathJax.startup.document.inputJax)) {
          if (jax.name === "TeX") jax.preFilters.add(({ math }) => {
            math.math = normalizeFormulaSource(math.math);
          });
        }
      },
    },
  };
})();
