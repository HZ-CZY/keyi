import re

with open('dict.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the stroke count regex patterns and add cnNumToStr function
old_strokes = """    let strokesTotal = '';
    const stMatch = html.match(
      /总笔画[：:]<\\/div>\\s*<span\\s+class="spwid80">([^<]+)</
    );
    if (stMatch) strokesTotal = stMatch[1].replace(/[^0-9]/g, '');
    
    let strokesOuter = '';
    const soMatch = html.match(
      /部外笔画[：:]<\\/div>\\s*<span\\s+class="spwid80">([^<]+)</
    );
    if (soMatch) strokesOuter = soMatch[1].replace(/[^0-9]/g, '');"""

new_strokes = """    // Helper: convert Chinese numeral to Arabic digit
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
    
    let strokesTotal = '';
    const stMatch = html.match(
      /总笔画[^<]*<\\/div>\\s*<span\\s+class="spwid80">([^<]+)</
    );
    if (stMatch) strokesTotal = cnNumToStr(stMatch[1]);
    
    let strokesOuter = '';
    const soMatch = html.match(
      /部外笔画[^<]*<\\/div>\\s*<span\\s+class="spwid80">([^<]+)</
    );
    if (soMatch) strokesOuter = cnNumToStr(soMatch[1]);"""

content = content.replace(old_strokes, new_strokes)

with open('dict.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
