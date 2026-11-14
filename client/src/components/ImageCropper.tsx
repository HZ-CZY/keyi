import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X, Crop, Maximize2, Loader2 } from 'lucide-react';

/**
 * 图片裁切（拍照后只识别框内区域）
 * ─────────────────────────────────────────────────────────
 * - 指针事件统一处理鼠标与触摸，手机可拖动、可四角缩放
 * - 归一化坐标（0~1），最后按原图尺寸裁，不受显示缩放影响
 * - 输出长边 ≤ 2000 的 JPEG，避免上传过大
 */

type Crop = { x: number; y: number; w: number; h: number };

export default function ImageCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (out: File, previewUrl: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState<Crop>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: string; sx: number; sy: number; start: Crop } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const measure = useCallback(() => {
    const el = imgRef.current;
    const box = boxRef.current;
    if (!el || !box || !el.naturalWidth) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const scale = Math.min(bw / el.naturalWidth, bh / el.naturalHeight);
    const w = el.naturalWidth * scale;
    const h = el.naturalHeight * scale;
    setRect({ left: (bw - w) / 2, top: (bh - h) / 2, width: w, height: h });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  /* 指针交互 */
  const onDown = (e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;

    const near = 0.055;
    const inL = Math.abs(px - crop.x) < near;
    const inR = Math.abs(px - (crop.x + crop.w)) < near;
    const inT = Math.abs(py - crop.y) < near;
    const inB = Math.abs(py - (crop.y + crop.h)) < near;
    const inside =
      px > crop.x && px < crop.x + crop.w && py > crop.y && py < crop.y + crop.h;

    let mode = '';
    if (inL && inT) mode = 'nw';
    else if (inR && inT) mode = 'ne';
    else if (inL && inB) mode = 'sw';
    else if (inR && inB) mode = 'se';
    else if (inL) mode = 'w';
    else if (inR) mode = 'e';
    else if (inT) mode = 'n';
    else if (inB) mode = 's';
    else if (inside) mode = 'move';
    if (!mode) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, sx: px, sy: py, start: { ...crop } };
    e.preventDefault();
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;
    const dx = px - d.sx;
    const dy = py - d.sy;
    const s = d.start;
    const min = 0.08;

    let { x, y, w, h } = s;

    if (d.mode === 'move') {
      x = Math.min(1 - s.w, Math.max(0, s.x + dx));
      y = Math.min(1 - s.h, Math.max(0, s.y + dy));
    } else {
      if (d.mode.includes('w')) {
        const nx = Math.min(s.x + s.w - min, Math.max(0, s.x + dx));
        w = s.x + s.w - nx;
        x = nx;
      }
      if (d.mode.includes('e')) w = Math.min(1 - s.x, Math.max(min, s.w + dx));
      if (d.mode.includes('n')) {
        const ny = Math.min(s.y + s.h - min, Math.max(0, s.y + dy));
        h = s.y + s.h - ny;
        y = ny;
      }
      if (d.mode.includes('s')) h = Math.min(1 - s.y, Math.max(min, s.h + dy));
    }

    setCrop({ x, y, w, h });
  };

  const onUp = () => {
    dragRef.current = null;
  };

  /* 裁切输出 */
  const doCrop = async (useFull = false) => {
    setBusy(true);
    try {
      const img = imgRef.current!;
      const c = useFull ? { x: 0, y: 0, w: 1, h: 1 } : crop;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;

      const sx = Math.round(c.x * nw);
      const sy = Math.round(c.y * nh);
      const sw = Math.max(1, Math.round(c.w * nw));
      const sh = Math.max(1, Math.round(c.h * nh));

      const maxSide = 2000;
      const scale = Math.min(1, maxSide / Math.max(sw, sh));
      const cw = Math.round(sw * scale);
      const ch = Math.round(sh * scale);

      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('裁切失败');
      const out = new File([blob], 'cropped.jpg', { type: 'image/jpeg' });
      onDone(out, URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between text-white mb-3">
          <div className="flex items-center gap-2">
            <Crop className="w-4 h-4" />
            <span className="text-sm font-medium">框选题目区域</span>
            <span className="text-[11px] text-white/50">拖动方框、拖四角缩放，只识别框内内容</span>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-full hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          ref={boxRef}
          className="relative w-full bg-black rounded-xl overflow-hidden select-none touch-none"
          style={{ height: 'min(62vh, 560px)' }}
        >
          {url && (
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={measure}
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}

          {/* 遮罩 + 选框 */}
          <div
            className="absolute"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <defs>
                <mask id="cutmask">
                  <rect width="100%" height="100%" fill="white" />
                  <rect
                    x={`${crop.x * 100}%`} y={`${crop.y * 100}%`}
                    width={`${crop.w * 100}%`} height={`${crop.h * 100}%`}
                    fill="black"
                  />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#cutmask)" />
            </svg>

            <div
              className="absolute border-2 border-white/90 rounded-sm"
              style={{
                left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
              }}
            >
              {/* 三分线 */}
              <div className="absolute inset-0 pointer-events-none opacity-25">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white" />
              </div>
              {/* 四角把手 */}
              {[
                ['left-0 top-0 -translate-x-1/2 -translate-y-1/2', 'cursor-nwse-resize'],
                ['right-0 top-0 translate-x-1/2 -translate-y-1/2', 'cursor-nesw-resize'],
                ['left-0 bottom-0 -translate-x-1/2 translate-y-1/2', 'cursor-nesw-resize'],
                ['right-0 bottom-0 translate-x-1/2 translate-y-1/2', 'cursor-nwse-resize'],
              ].map(([cls, cur], i) => (
                <div
                  key={i}
                  className={`absolute w-5 h-5 bg-white rounded-full border border-black/20 shadow ${cls} ${cur}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => setCrop({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })}
            className="px-3 py-2 rounded-full text-white/80 text-xs hover:bg-white/10 inline-flex items-center gap-1.5"
          >
            <Maximize2 className="w-3.5 h-3.5" />重置
          </button>
          <button
            onClick={() => doCrop(true)}
            disabled={busy}
            className="px-3 py-2 rounded-full text-white/80 text-xs hover:bg-white/10 disabled:opacity-50"
          >
            用整张图
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-full text-white/80 text-sm hover:bg-white/10"
          >
            取消
          </button>
          <button
            onClick={() => doCrop(false)}
            disabled={busy}
            className="px-5 py-2 rounded-full bg-white text-gray-900 text-sm font-medium hover:bg-gray-100 disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            用框内区域
          </button>
        </div>
      </div>
    </div>
  );
}
