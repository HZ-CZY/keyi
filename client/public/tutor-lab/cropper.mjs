/* 从 host.mjs 抽出的独立裁剪器：框选 / 旋转 / 重置 / 原图，输出 JPEG File */
let cropBusy = false;
const CROP_CSS = `
.tc-mask{position:fixed;inset:0;z-index:99999;background:rgba(20,24,40,.72);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
.tc-panel{width:min(960px,100%);height:min(780px,100%);background:#ffffff;border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}
.tc-head{padding:14px 18px;border-bottom:1px solid #e9eaee;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0}
.tc-title{font-size:17px;font-weight:700;color:#17181c}
.tc-hint{font-size:13px;color:#8d9198;margin-top:4px;line-height:1.5}
.tc-x{width:40px;height:40px;border:0;border-radius:10px;background:#f4f5f7;color:#6b7079;font-size:20px;cursor:pointer;flex-shrink:0}
.tc-stage{position:relative;flex:1;min-height:0;background:#17191e;overflow:hidden;touch-action:none}
.tc-stage img{position:absolute;user-select:none;-webkit-user-drag:none;pointer-events:none}
.tc-box{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.58);box-sizing:border-box;touch-action:none;cursor:move}
.tc-grid{position:absolute;inset:0;pointer-events:none}
.tc-grid i{position:absolute;background:rgba(255,255,255,.32)}
.tc-grid i.v{top:0;bottom:0;width:1px}
.tc-grid i.h{left:0;right:0;height:1px}
.tc-h{position:absolute;width:18px;height:18px;background:#fff;border:2px solid #2f7bff;border-radius:5px;box-sizing:border-box}
.tc-h[data-h=nw]{left:-10px;top:-10px;cursor:nwse-resize}.tc-h[data-h=n]{left:calc(50% - 9px);top:-10px;cursor:ns-resize}
.tc-h[data-h=ne]{right:-10px;top:-10px;cursor:nesw-resize}.tc-h[data-h=e]{right:-10px;top:calc(50% - 9px);cursor:ew-resize}
.tc-h[data-h=se]{right:-10px;bottom:-10px;cursor:nwse-resize}.tc-h[data-h=s]{left:calc(50% - 9px);bottom:-10px;cursor:ns-resize}
.tc-h[data-h=sw]{left:-10px;bottom:-10px;cursor:nesw-resize}.tc-h[data-h=w]{left:-10px;top:calc(50% - 9px);cursor:ew-resize}
.tc-foot{display:flex;gap:10px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #e9eaee;flex-wrap:wrap;flex-shrink:0}
.tc-btn{min-height:46px;padding:0 18px;border-radius:12px;border:1px solid #e9eaee;background:#fff;color:#17181c;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}
.tc-btn.primary{background:#2f7bff;border-color:#2f7bff;color:#fff}
.tc-btn:active{transform:scale(.97)}
@media (max-width:680px){.tc-panel{height:100%}.tc-foot{justify-content:stretch}.tc-btn{flex:1;padding:0 8px;font-size:14px}.tc-hint{font-size:12px}}
`;

function openCropper(file) {
  return new Promise((resolve) => {
    if (cropBusy || !file) { resolve(null); return; }
    cropBusy = true;
    const urls = [];
    const u0 = URL.createObjectURL(file);
    urls.push(u0);

    if (!document.getElementById('tc-style')) {
      const st = document.createElement('style');
      st.id = 'tc-style';
      st.textContent = CROP_CSS;
      document.head.appendChild(st);
    }
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const mask = document.createElement('div');
    mask.className = 'tc-mask';
    mask.innerHTML = `
      <div class="tc-panel">
        <div class="tc-head">
          <div><div class="tc-title">框选题目区域</div>
            <div class="tc-hint">拖动白框或四角，只保留这一道题；确认后会作为消息发给刻忆</div></div>
          <button class="tc-x" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="tc-stage" id="tc-stage">
          <img id="tc-img" alt="待裁切的照片" />
          <div class="tc-box" id="tc-box">
            <div class="tc-grid"><i class="v" style="left:33.33%"></i><i class="v" style="left:66.66%"></i><i class="h" style="top:33.33%"></i><i class="h" style="top:66.66%"></i></div>
            <div class="tc-h" data-h="nw"></div><div class="tc-h" data-h="n"></div><div class="tc-h" data-h="ne"></div><div class="tc-h" data-h="e"></div>
            <div class="tc-h" data-h="se"></div><div class="tc-h" data-h="s"></div><div class="tc-h" data-h="sw"></div><div class="tc-h" data-h="w"></div>
          </div>
        </div>
        <div class="tc-foot">
          <button class="tc-btn" type="button" data-act="cancel">取消</button>
          <button class="tc-btn" type="button" data-act="rotate">旋转 90°</button>
          <button class="tc-btn" type="button" data-act="reset">重置</button>
          <button class="tc-btn" type="button" data-act="raw">使用原图</button>
          <button class="tc-btn primary" type="button" data-act="ok">确认框选并发送</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const stage = mask.querySelector('#tc-stage');
    const img = mask.querySelector('#tc-img');
    const box = mask.querySelector('#tc-box');
    let geom = null;
    let bx = 0, by = 0, bw = 0, bh = 0;
    let drag = null;
    const MIN = 64;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

    function measure() {
      const vw = stage.clientWidth, vh = stage.clientHeight;
      const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      const scale = Math.min(vw / iw, vh / ih);
      const dw = iw * scale, dh = ih * scale;
      const ox = (vw - dw) / 2, oy = (vh - dh) / 2;
      img.style.width = dw + 'px';
      img.style.height = dh + 'px';
      img.style.left = ox + 'px';
      img.style.top = oy + 'px';
      geom = { scale, ox, oy, dw, dh };
    }
    function applyBox() {
      box.style.left = bx + 'px';
      box.style.top = by + 'px';
      box.style.width = bw + 'px';
      box.style.height = bh + 'px';
    }
    function resetBox() {
      measure();
      const g = geom;
      bx = g.ox + g.dw * 0.06; by = g.oy + g.dh * 0.05;
      bw = g.dw * 0.88; bh = g.dh * 0.78;
      applyBox();
    }
    function onResize() {
      if (!geom || drag) return;
      const old = geom;
      const sx = (bx - old.ox) / old.scale, sy = (by - old.oy) / old.scale;
      const sw = bw / old.scale, sh = bh / old.scale;
      measure();
      const g = geom;
      bx = g.ox + sx * g.scale; by = g.oy + sy * g.scale;
      bw = sw * g.scale; bh = sh * g.scale;
      bx = clamp(bx, g.ox, g.ox + g.dw - bw);
      by = clamp(by, g.oy, g.oy + g.dh - bh);
      applyBox();
    }
    function onDown(e) {
      const h = e.target?.dataset?.h || '';
      drag = { x: e.clientX, y: e.clientY, bx, by, bw, bh, h };
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag || !geom) return;
      const g = geom, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.h) {
        bx = clamp(drag.bx + dx, g.ox, g.ox + g.dw - drag.bw);
        by = clamp(drag.by + dy, g.oy, g.oy + g.dh - drag.bh);
        bw = drag.bw; bh = drag.bh;
      } else {
        let l = drag.bx, t = drag.by, r = drag.bx + drag.bw, b = drag.by + drag.bh;
        if (drag.h.includes('w')) l = clamp(drag.bx + dx, g.ox, r - MIN);
        if (drag.h.includes('e')) r = clamp(drag.bx + drag.bw + dx, l + MIN, g.ox + g.dw);
        if (drag.h.includes('n')) t = clamp(drag.by + dy, g.oy, b - MIN);
        if (drag.h.includes('s')) b = clamp(drag.by + drag.bh + dy, t + MIN, g.oy + g.dh);
        bx = l; by = t; bw = r - l; bh = b - t;
      }
      applyBox();
      e.preventDefault();
    }
    function onUp() { drag = null; }
    function onKey(e) { if (e.key === 'Escape') finish(null); }

    box.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);

    function finish(result) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = oldOverflow;
      mask.remove();
      urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* 忽略 */ } });
      cropBusy = false;
      resolve(result);
    }

    function canvasBlob(cv) {
      return new Promise((res) => {
        if (cv.toBlob) { cv.toBlob((b) => res(b), 'image/jpeg', 0.9); return; }
        try {
          const d = cv.toDataURL('image/jpeg', 0.9);
          const bin = atob(d.split(',')[1]);
          const a = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          res(new Blob([a], { type: 'image/jpeg' }));
        } catch { res(null); }
      });
    }
    async function doRotate() {
      const c = document.createElement('canvas');
      c.width = img.naturalHeight; c.height = img.naturalWidth;
      const cx = c.getContext('2d');
      cx.translate(c.width, 0); cx.rotate(Math.PI / 2);
      cx.drawImage(img, 0, 0);
      const blob = await canvasBlob(c);
      if (!blob) { console.warn('[cropper] 旋转失败'); return; }
      const u = URL.createObjectURL(blob);
      urls.push(u);
      img.onload = () => resetBox();
      img.src = u;
    }
    async function doCrop() {
      if (!geom) { finish(file); return; }
      const g = geom;
      const sx = clamp((bx - g.ox) / g.scale, 0, img.naturalWidth);
      const sy = clamp((by - g.oy) / g.scale, 0, img.naturalHeight);
      const sw = clamp(bw / g.scale, 1, img.naturalWidth - sx);
      const sh = clamp(bh / g.scale, 1, img.naturalHeight - sy);
      const k = Math.min(1, 2200 / Math.max(sw, sh));
      const cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch);
      try { cx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch); }
      catch { console.warn('[cropper] 裁切失败'); finish(file); return; }
      const blob = await canvasBlob(cv);
      finish(blob ? new File([blob], 'photo-crop.jpg', { type: 'image/jpeg' }) : file);
    }

    mask.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (e.target?.classList?.contains('tc-x')) { finish(null); return; }
      if (act === 'cancel') finish(null);
      else if (act === 'raw') finish(file);
      else if (act === 'reset') resetBox();
      else if (act === 'rotate') doRotate();
      else if (act === 'ok') doCrop();
    });

    img.onload = () => resetBox();
    img.onerror = () => {
      // HEIC 等浏览器打不开的格式：不阻断流程，退回原图
      console.warn('[cropper] 预览失败，改用原图');
      finish(file);
    };
    img.src = u0;
  });
}

export { openCropper };
export default openCropper;
