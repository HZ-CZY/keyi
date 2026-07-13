import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// Helper: extract content between <dd class="con_dd"> and </dd> for a given <dt> label
function extractCYField(html: string, label: string): string {
  const escaped = label.replace(/[\[\]]/g, '\\$&');
  const regex = new RegExp(
    `<dt\\s+class="con_dt\\s+blue">\\s*${escaped}\\s*</dt>\\s*<dd\\s+class="con_dd">(.*?)</dd>`
  );
  const match = html.match(regex);
  if (match) {
    return match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

// 新华字典
router.get('/zd', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const word = String(req.query.wd || '').trim();
    if (!word) { res.status(400).json({ error: '请输入要查的字' }); return; }
    const r = await fetch(`https://zd.hwxnet.com/search.do?keyword=${encodeURIComponent(word)}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    const html = await r.text();

    // Helper: convert Chinese numeral to Arabic digit
    function cnNumToStr(s: string): string {
      const map: Record<string, string> = {
        '零': '0', '一': '1', '二': '2', '三': '3', '四': '4',
        '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10'
      };
      for (const [cn, digit] of Object.entries(map)) {
        if (s.startsWith(cn)) return digit;
      }
      return s.replace(/[^0-9]/g, '');
    }

    // 提取拼音 - multiple <span class="pinyin"> in the 拼音 label section
    let pinyin = '';
    const pySection = html.match(
      /<div>拼音[：:]<\/div>\s*([\s\S]*?)(?=<div\s+class="label">|<div>部首)/
    );
    if (pySection) {
      const pinyins: string[] = [];
      const pyRegex = /<span\s+class="pinyin">([^<]+)/g;
      let m;
      while ((m = pyRegex.exec(pySection[1])) !== null) {
        pinyins.push(m[1].trim());
      }
      pinyin = pinyins.filter(Boolean).join('；');
    }

    // 提取部首
    let radical = '';
    const rdMatch = html.match(
      /<div>部首[：:]<\/div>\s*<span\s+class="spwid80">([^<]+)</
    );
    if (rdMatch) radical = rdMatch[1].trim();

    // 提取笔画信息
    let strokesTotal = '';
    const stMatch = html.match(
      /总笔画[^<]*<\/div>\s*<span\s+class="spwid80">([^<]+)</
    );
    if (stMatch) strokesTotal = cnNumToStr(stMatch[1]);

    let strokesOuter = '';
    const soMatch = html.match(
      /部外笔画[^<]*<\/div>\s*<span\s+class="spwid80">([^<]+)</
    );
    if (soMatch) strokesOuter = cnNumToStr(soMatch[1]);

    // 提取基本字义解释（◎ 开头的条目）
    const meanings: string[] = [];
    const basicSection = html.match(
      /<h1>基本字义解释<\/h1>[\s\S]*?<div\s+class="view_con\s+con_basic\s+clearfix">([\s\S]*?)<\/div>/
    );
    if (basicSection) {
      const basicHtml = basicSection[1];
      const itemRegex = /◎\s*([^◎]+?)(?=◎|<p>\s*●|$)/g;
      let m;
      while ((m = itemRegex.exec(basicHtml)) !== null) {
        const item = m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (item) meanings.push(item);
      }
    }

    // 提取常用词组 - find words in the 常用词组 section
    const words: string[] = [];
    const wordSection = html.match(
      /<h1>常用词组<\/h1>[\s\S]*?<div\s+class="view_con\s+clearfix">([\s\S]*?)<\/div>/
    );
    if (wordSection) {
      const wordHtml = wordSection[1];
      const wordRegex = /<strong>([\u4e00-\u9fff]{2,10})<\/strong>/g;
      let m;
      while ((m = wordRegex.exec(wordHtml)) !== null) {
        const w = m[1].trim();
        if (w && w !== word && !words.includes(w)) {
          words.push(w);
        }
      }
    }

    // 同音字
    const sameSoundChars: string[] = [];
    const ssSection = html.match(
      /<h1>同音字<\/h1>[\s\S]*?<div\s+class="view_con\s+clearfix"[\s\S]*?>([\s\S]*?)<\/div>/
    );
    if (ssSection) {
      const ssHtml = ssSection[1];
      const charMatch = ssHtml.match(/[^a-zA-Z>]([\u4e00-\u9fff])[^<]/g);
      if (charMatch) {
        for (const cm of charMatch) {
          const ch = cm.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '').trim();
          if (ch && ch !== word && !sameSoundChars.includes(ch)) {
            sameSoundChars.push(ch);
          }
        }
      }
    }

    res.json({
      word,
      pinyin,
      radical,
      strokeCount: strokesTotal || undefined,
      strokesOuter: strokesOuter || undefined,
      meanings,
      words,
      sameSoundChars,
      idioms: []
    });
  } catch(e: any) {
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

// 汉语词典
router.get('/cd', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const word = String(req.query.wd || '').trim();
    if (!word) { res.status(400).json({ error: '请输入要查的词' }); return; }
    const r = await fetch(`https://cd.hwxnet.com/search.do?wd=${encodeURIComponent(word)}`, {
      redirect: 'follow', signal: AbortSignal.timeout(10000)
    });
    const html = await r.text();

    const entries: { word: string; pinyin: string; }[] = [];
    const entryRegex = /<a[^>]*href="[^"]*"[^>]*>([^<]+)<\/a>\s*<span[^>]*class="pinyin"[^>]*>([^<]+)<\/span>/g;
    let m;
    while ((m = entryRegex.exec(html)) !== null) {
      const entryWord = m[1].trim();
      const pinyin = m[2].trim();
      if (entryWord && pinyin) {
        entries.push({ word: entryWord, pinyin });
      }
    }

    if (entries.length === 0) {
      const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const pattern = /([\u4e00-\u9fff]{2,8})\s*\[([^\]]+)\]/g;
      while ((m = pattern.exec(text)) !== null) {
        const ew = m[1].trim();
        const ep = m[2].trim();
        if (ew && ep && !entries.some(e => e.word === ew)) {
          entries.push({ word: ew, pinyin: ep });
        }
      }
    }

    res.json({ word, entries });
  } catch(e: any) {
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

// 成语词典
router.get('/cy', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const word = String(req.query.wd || '').trim();
    if (!word) { res.status(400).json({ error: '请输入成语' }); return; }
    const r = await fetch(`https://cy.hwxnet.com/search.do?wd=${encodeURIComponent(word)}&qt=1`, {
      redirect: 'follow', signal: AbortSignal.timeout(10000)
    });
    const html = await r.text();

    // Extract pinyin from: <span class="pinyin f20">yī xīn yī yì</span>
    let pinyin = '';
    const pyMatch = html.match(/<span\s+class="pinyin\s+f20">([^<]+)<\/span>/);
    if (pyMatch) {
      pinyin = pyMatch[1].trim();
    }

    // Extract all fields from structured <dt>/<dd> pairs
    const meaning = extractCYField(html, '[成语解释]');
    const source = extractCYField(html, '[典故出处]');
    const example = extractCYField(html, '[成语举例]');
    let synonyms = extractCYField(html, '[ 近义词 ]');
    let antonyms = extractCYField(html, '[ 反义词 ]');

    // Clean up synonyms/antonyms
    synonyms = synonyms.replace(/、/g, '、').replace(/\s*,\s*/g, '、');
    antonyms = antonyms.replace(/、/g, '、').replace(/\s*,\s*/g, '、');

    res.json({ idiom: word, pinyin, meaning, source, example, synonyms, antonyms });
  } catch(e: any) {
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

// 文言文字典
router.get('/wyw', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const word = String(req.query.wd || '').trim();
    if (!word) { res.status(400).json({ error: '请输入要查的字' }); return; }
    const r = await fetch(`https://wyw.hwxnet.com/search.do?wd=${encodeURIComponent(word)}`, {
      redirect: 'follow', signal: AbortSignal.timeout(10000)
    });
    const html = await r.text();
    let pinyin = '', radical = '', strokeCount = '';
    const meanings: { meaning: string; example: string }[] = [];

    const py = html.match(/拼音[：:]\s*([^<&]+)/); if (py) pinyin = py[1].trim();
    const rd = html.match(/部首[：:]\s*([^<&]+)/); if (rd) radical = rd[1].trim();
    const sc = html.match(/总笔画[：:]\s*(\d+)/); if (sc) strokeCount = sc[1];
    const rdc = html.match(/部首笔画[：:]\s*(\d+)/);
    const radicalStrokeCount = rdc ? rdc[1] : '';

    // Extract detailed meanings from the structured HTML
    const detailSection = html.match(/详细释义[\s\S]*?<div\s+class="view_con\s+clearfix">([\s\S]*?)<\/div>/);
    if (detailSection) {
      const detailHtml = detailSection[1];
      const sections = detailHtml.split(/<br\s*\/?>\s*(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/);
      for (const section of sections) {
        if (!section.trim()) continue;
        const numMatch = section.match(/^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/);
        if (!numMatch) continue;
        const content = section.substring(numMatch[0].length).trim();
        const cleanText = content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

        let meaningPart = cleanText;
        let examplePart = '';

        const bookMatch = cleanText.match(/^([^。]*?)。?《([^》]+)》[：:]?[""「]([^""」]+)[""」]/);
        if (bookMatch) {
          meaningPart = (bookMatch[1] || '').trim();
          examplePart = `《${bookMatch[2]}》「${bookMatch[3]}」`;
        } else {
          const simpleBookMatch = cleanText.match(/^([^。]*?)。?《([^》]+)》/);
          if (simpleBookMatch) {
            const restAfterBook = cleanText.substring(cleanText.indexOf('》') + 1).trim();
            const quoteMatch = restAfterBook.match(/^[：:]?[""「]([^""」]+)[""」]/);
            meaningPart = (simpleBookMatch[1] || '').trim();
            if (quoteMatch) {
              examplePart = `《${simpleBookMatch[2]}》「${quoteMatch[1]}」`;
            } else {
              examplePart = `《${simpleBookMatch[2]}》`;
            }
          }
        }

        meaningPart = meaningPart.replace(/<[^>]+>/g, '').trim();
        meaningPart = meaningPart.replace(/^[<>\/a-z]+/, '').trim();

        if (meaningPart && !meanings.some(m => m.meaning === meaningPart)) {
          meanings.push({ meaning: meaningPart, example: examplePart });
        }
      }
    }

    if (meanings.length === 0) {
      const detail = html.match(/详细释义([\s\S]*?)(?:试试手机|$)/);
      if (detail) {
        const text = detail[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        const pattern = /[①②③④⑤⑥⑦⑧⑨⑩]+([^。]*?)\.《([^》]+)》[：:]([^①②③④⑤⑥⑦⑧⑨⑩]*?)(?=[①②③④⑤⑥⑦⑧⑨⑩]|$)/g;
        let m;
        while ((m = pattern.exec(text)) !== null) {
          const meaningText = m[1].trim();
          const exampleText = `《${m[2]}》${m[3].trim()}`;
          if (meaningText && !meanings.some(x => x.meaning === meaningText)) {
            meanings.push({ meaning: meaningText, example: exampleText });
          }
        }
      }
    }

    res.json({ character: word, pinyin, radical, strokeCount, radicalStrokeCount, meanings });
  } catch(e: any) {
    res.status(500).json({ error: e.message || '查询失败' });
  }
});

export default router;
