import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { haptic } from '../lib/feel';
import { useI18n } from '../lib/i18n';
import { useBarGesture } from '../lib/useBarGesture';

export type Page = 'times' | 'qibla' | 'quran' | 'month' | 'settings';

const TABS: { id: Page; label: string; labelAr: string; icon: ReactNode }[] = [
  {
    id: 'times',
    label: 'Times',
    labelAr: 'المواقيت',
    icon: (
      <>
        <circle cx="11" cy="11" r="7.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 6.6V11l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    id: 'qibla',
    label: 'Qibla',
    labelAr: 'القبلة',
    icon: (
      <>
        <circle cx="11" cy="11" r="7.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14.2 7.8l-2 4.4-4.4 2 2-4.4z" fill="currentColor" />
      </>
    ),
  },
  {
    id: 'quran',
    label: 'Qur’an',
    labelAr: 'القرآن',
    icon: (
      <>
        <path
          d="M4.4 5.2h11.2a2 2 0 012 2v10.2H6.4a2 2 0 01-2-2V5.2z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M6.8 5.2v12.2M4.4 16.4h13.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'month',
    label: 'Month',
    labelAr: 'الشهر',
    icon: (
      <>
        <rect x="3.4" y="4.6" width="15.2" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.4 9h15.2M7.6 2.8v3.4M14.4 2.8v3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    labelAr: 'الإعدادات',
    icon: (
      <>
        <path
          d="M8.95 3.2h4.1l.42 1.72c.46.14.9.35 1.3.61l1.62-.7 2.05 2.05-.7 1.62c.26.4.47.84.61 1.3l1.72.42v4.1l-1.72.42a5.7 5.7 0 01-.61 1.3l.7 1.62-2.05 2.05-1.62-.7a5.7 5.7 0 01-1.3.61l-.42 1.72h-4.1l-.42-1.72a5.7 5.7 0 01-1.3-.61l-1.62.7-2.05-2.05.7-1.62a5.7 5.7 0 01-.61-1.3L3.2 13.05v-4.1l1.72-.42c.14-.46.35-.9.61-1.3l-.7-1.62 2.05-2.05 1.62.7c.4-.26.84-.47 1.3-.61L8.95 3.2z"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinejoin="round"
        />
        <circle cx="11" cy="11" r="2.45" stroke="currentColor" strokeWidth="1.55" />
      </>
    ),
  },
];

/**
 * Bottom dock. On Times it folds with scroll: full at the top, short once you
 * leave the top. It unfolds again when the page returns to the top.
 */
const TOP = 24;
const NAV_ITEM_COUNT = TABS.length + 1;

export function TabBar({
  page,
  onChange,
  onIntent,
  onDevotionsIntent,
  onOpenDevotions,
}: {
  page: Page;
  onChange: (page: Page) => void;
  onIntent?: (page: Page) => void;
  onDevotionsIntent?: () => void;
  onOpenDevotions: () => void;
}) {
  const { isArabic, text } = useI18n();
  const rail = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<Page, HTMLButtonElement>());
  const pageRef = useRef(page);
  pageRef.current = page;
  const [lens, setLens] = useState<{ left: number; width: number } | null>(null);
  const [openW, setOpenW] = useState(0);
  const [innerW, setInnerW] = useState(0);
  const [shutW, setShutW] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (page !== 'times') {
      setCollapsed(false);
    }
  }, [page]);

  useEffect(() => {
    const apply = () => {
      if (pageRef.current !== 'times') return;
      if (document.body.classList.contains('reading-mushaf')) return;
      const atTop = window.scrollY <= TOP;
      if (atTop) {
        setCollapsed((c) => (c ? false : c));
      } else {
        setCollapsed((c) => (c ? c : true));
      }
    };
    apply();
    window.addEventListener('scroll', apply, { passive: true });
    return () => window.removeEventListener('scroll', apply);
  }, []);

  useLayoutEffect(() => {
    const railEl = rail.current;
    const barEl = bar.current;
    if (!railEl || !barEl) return;
    const measure = () => {
      const open = railEl.clientWidth;
      if (open <= 0) return;
      const pad =
        parseFloat(getComputedStyle(barEl).paddingLeft) +
        parseFloat(getComputedStyle(barEl).paddingRight);
      const inner = Math.max(0, open - pad);
      const firstItemWidth = items.current.get('times')?.offsetWidth ?? inner / NAV_ITEM_COUNT;
      setOpenW(open);
      setInnerW(inner);
      setShutW(pad + firstItemWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(railEl);
    const firstItem = items.current.get('times');
    if (firstItem) observer.observe(firstItem);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const active = items.current.get(page);
    const scrollEl = viewport.current;
    if (!active || !scrollEl) return;
    setLens({ left: active.offsetLeft, width: active.offsetWidth });
    const maxScroll = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
    const centered = active.offsetLeft - (scrollEl.clientWidth - active.offsetWidth) / 2;
    const target = page === 'times' ? 0 : Math.min(maxScroll, Math.max(0, centered));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollEl.scrollTo({ left: target, behavior: collapsed || reducedMotion ? 'auto' : 'smooth' });
  }, [page, innerW, collapsed]);

  const select = (id: Page) => {
    if (collapsed) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    haptic('tick');
    if (id === 'times' && page === 'times') {
      return;
    }
    onChange(id);
  };

  const openDevotions = () => {
    if (collapsed) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    haptic('tick');
    onOpenDevotions();
  };

  const width = collapsed ? shutW || undefined : openW || undefined;
  const gestures = useBarGesture(viewport, (node) => {
    if (node.dataset.action === 'devotions') openDevotions();
    else select(node.dataset.tab as Page);
  }, collapsed);

  return (
    <nav className="tabbar-dock" dir="ltr">
      <div ref={rail} className="tabbar-rail">
        <div
          ref={bar}
          className={`tabbar${collapsed ? ' is-collapsed' : ''}`}
          role="tablist"
          aria-label={text('Pages', 'الصفحات')}
          style={
            width
              ? ({
                  width,
                  maxWidth: width,
                } as CSSProperties)
              : undefined
          }
        >
          {collapsed && (
            <button
              type="button"
              className="tabbar-expand"
              aria-label={text('Open navigation', 'فتح شريط التنقل')}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
          <div ref={viewport} {...gestures} className="tabbar-scroll">
          <div className="tabbar-inner">
            {lens && (
              <span
                aria-hidden="true"
                className="segmented-lens"
                style={{ transform: `translateX(${lens.left}px)`, width: `${lens.width}px` }}
              />
            )}
            {TABS.map((tab, i) => (
              <Fragment key={tab.id}>
                <button
                ref={(node) => {
                  if (node) items.current.set(tab.id, node);
                  else items.current.delete(tab.id);
                }}
                data-tab={tab.id}
                role="tab"
                aria-selected={page === tab.id}
                aria-hidden={collapsed && tab.id !== 'times'}
                tabIndex={collapsed ? -1 : undefined}
                aria-label={
                  isArabic ? tab.labelAr : tab.label
                }
                onPointerDown={() => onIntent?.(tab.id)}
                onPointerEnter={() => onIntent?.(tab.id)}
                onFocus={() => onIntent?.(tab.id)}
                onClick={() => select(tab.id)}
                className={`tabbar-item ${page === tab.id ? 'text-[var(--ink)]' : 'text-[var(--ink-dim)]'}`}
                style={{ '--i': tab.id === 'times' ? 0 : i + 1 } as CSSProperties}
              >
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                  {tab.icon}
                </svg>
                <span className="text-[10px] font-medium tracking-wide">
                  {isArabic ? tab.labelAr : tab.label}
                </span>
                </button>
                {tab.id === 'times' && (
                  <button
                    type="button"
                    data-action="devotions"
                    aria-hidden={collapsed}
                    tabIndex={collapsed ? -1 : undefined}
                    aria-label={text('Open Istighfar and daily rituals', 'فتح الاستغفار والأذكار اليومية')}
                    onPointerDown={onDevotionsIntent}
                    onPointerEnter={onDevotionsIntent}
                    onFocus={onDevotionsIntent}
                    onClick={openDevotions}
                    className="tabbar-item tabbar-devotions"
                    style={{ '--i': 1 } as CSSProperties}
                  >
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.55" />
                      <circle cx="15" cy="7" r="2" stroke="currentColor" strokeWidth="1.55" />
                      <circle cx="11" cy="14.5" r="2" stroke="currentColor" strokeWidth="1.55" />
                      <path d="M8.7 8.1l1.4 4.2M13.3 8.1l-1.4 4.2M9.2 15.8l-2.4 1.5" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
                    </svg>
                    <span className="text-[10px] font-semibold tracking-wide">
                      {text('Istighfar', 'استغفار')}
                    </span>
                  </button>
                )}
              </Fragment>
            ))}
          </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
