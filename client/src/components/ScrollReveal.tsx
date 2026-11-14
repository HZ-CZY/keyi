import { useEffect, useRef, useState } from 'react';

type Variant = 'fade-up' | 'scale-in' | 'fade-left' | 'fade-right';

interface ScrollRevealProps {
  children: React.ReactNode;
  variant?: Variant;
  delay?: number;
  duration?: number;
  as?: keyof JSX.IntrinsicElements;
  once?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const variantClass: Record<Variant, string> = {
  'fade-up': 'reveal',
  'scale-in': 'reveal-scale',
  'fade-left': 'reveal-left',
  'fade-right': 'reveal-left',
};

/* ── Shared IntersectionObserver ──
   All ScrollReveal instances use a single observer + single root margin.
   Avoids N separate observer allocations per page.
   Ref-counting: the observer is alive while at least one element is observed. */
let sharedObserver: IntersectionObserver | null = null;
const observedElements = new Map<Element, (visible: boolean) => void>();
let observerRefCount = 0;

function ensureObserver() {
  if (sharedObserver) return;
  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cb = observedElements.get(entry.target);
        if (cb) cb(entry.isIntersecting);
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
}

function observe(el: Element, cb: (visible: boolean) => void) {
  observedElements.set(el, cb);
  observerRefCount++;
  ensureObserver();
  sharedObserver!.observe(el);
}

function unobserve(el: Element) {
  observedElements.delete(el);
  observerRefCount--;
  if (sharedObserver) {
    sharedObserver.unobserve(el);
    if (observerRefCount <= 0 && sharedObserver) {
      sharedObserver.disconnect();
      sharedObserver = null;
      observerRefCount = 0;
    }
  }
}

/**
 * ScrollReveal — lightweight IntersectionObserver wrapper.
 * Uses a SINGLE shared IntersectionObserver for all instances.
 * Only transform + opacity (GPU-friendly, no layout triggers).
 * Respects prefers-reduced-motion via global CSS.
 */
export default function ScrollReveal({
  children,
  variant = 'fade-up',
  delay = 0,
  duration = 600,
  as: Tag = 'div',
  once = true,
  className = '',
  style,
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handler = (isIntersecting: boolean) => {
      if (isIntersecting) {
        setVisible(true);
        if (once) unobserve(el);
      } else if (!once) {
        setVisible(false);
      }
    };

    observe(el, handler);
    return () => unobserve(el);
  }, [once]);

  const baseClass = variantClass[variant];
  const isFadeRight = variant === 'fade-right';

  const combinedClassName = [
    baseClass,
    visible ? 'reveal-visible' : '',
    isFadeRight ? '!-translate-x-8' : '',
    className,
  ].filter(Boolean).join(' ');

  const combinedStyle: React.CSSProperties = {
    ...style,
    '--reveal-delay': `${delay}ms`,
    transitionDuration: `${duration}ms`,
  } as React.CSSProperties;

  const TagComponent = Tag as any;

  return (
    <TagComponent
      ref={ref}
      className={combinedClassName}
      style={combinedStyle}
    >
      {children}
    </TagComponent>
  );
}
