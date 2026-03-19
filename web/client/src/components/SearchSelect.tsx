import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchSelectOption = {
  value: string;
  label: string;
};

import { createPortal } from 'react-dom';

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = '(none)',
  className = 'hk-input',
  menuClassName = '',
  disabled,
  portal
}: {
  value: string;
  onChange: (next: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const current = useMemo(() => options.find((o) => o.value === value) || null, [options, value]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => o.label.toLowerCase().includes(qq) || o.value.toLowerCase().includes(qq));
  }, [options, q]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const t = e.target as any;
      if (ref.current && ref.current.contains(t)) return;
      if (menuRef.current && menuRef.current.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  useEffect(() => {
    // When opening, start with empty query so the full list is visible.
    // Typing refines; current selection is still shown in the input.
    if (open) {
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 0);

      // Default active option = current selection, else first item (or placeholder).
      const curIdx = options.findIndex((o) => o.value === value);
      setActiveIdx(curIdx >= 0 ? curIdx : (placeholder ? -1 : (options.length ? 0 : -1)));

      const updateRect = () => {
        const el = ref.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        setRect({ left: box.left, top: box.bottom, width: box.width });
      };
      updateRect();
      window.addEventListener('scroll', updateRect, true);
      window.addEventListener('resize', updateRect);
      return () => {
        window.removeEventListener('scroll', updateRect, true);
        window.removeEventListener('resize', updateRect);
      };
    } else {
      setQ('');
      setRect(null);
      setActiveIdx(-1);
    }
  }, [open, current, options, placeholder, value]);

  const displayValue = open ? (q !== '' ? q : (current ? current.label : '')) : (current ? current.label : '');

  useEffect(() => {
    if (!open) return;
    // Keep active option visible when navigating by keyboard.
    const el = menuRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  return (
    <div ref={ref} className="relative">
      {/* Combobox-style input: you can type directly into the main field (no extra search box). */}
      <div className="relative">
        <input
          ref={inputRef}
          disabled={disabled}
          className={`w-full pr-8 ${className} ${disabled ? 'opacity-60' : ''}`}
          value={displayValue}
          placeholder={current ? undefined : placeholder}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQ('');
              return;
            }

            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActiveIdx((i) => {
                const next = i < 0 ? 0 : Math.min(filtered.length - 1, i + 1);
                return next;
              });
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActiveIdx((i) => Math.max(0, i - 1));
              return;
            }
            if (e.key === 'Enter') {
              if (!open) return;
              e.preventDefault();
              const opt = filtered[activeIdx];
              if (opt) {
                onChange(opt.value);
                setOpen(false);
                setQ('');
              }
              return;
            }
          }}
        />
        <button
          type="button"
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--hk-muted)]"
          onClick={() => { if (!disabled) setOpen((o) => !o); }}
          aria-label="Toggle"
        >
          ▾
        </button>
      </div>

      {open
        ? (() => {
            const menu = (
              <div
                ref={menuRef}
                className={`${portal ? 'fixed' : 'absolute'} z-[1000] mt-1 rounded border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden text-sm ${menuClassName}`}
                style={
                  portal && rect
                    ? { left: rect.left, top: rect.top, width: rect.width }
                    : undefined
                }
                onWheel={(e) => {
                  // Prevent parent scroll containers from hijacking wheel events.
                  e.stopPropagation();
                }}
              >
                <div className="max-h-[420px] overflow-y-auto overflow-x-hidden overscroll-contain">
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2 hover:bg-white/5 truncate ${value === '' ? 'bg-white/10' : ''} ${!placeholder ? 'hidden' : ''}`}
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    {placeholder}
                  </button>
                  {filtered.map((o, idx) => (
                    <button
                      key={o.value}
                      type="button"
                      data-idx={idx}
                      className={`w-full text-left px-3 py-2 hover:bg-white/5 truncate ${o.value === value ? 'bg-white/10' : ''} ${idx === activeIdx ? 'outline outline-1 outline-white/25' : ''}`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setQ('');
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                  {!filtered.length ? <div className="px-3 py-2 text-sm text-[color:var(--hk-muted)]">No matches</div> : null}
                </div>
              </div>
            );

            if (portal) {
              return rect ? createPortal(menu, document.body) : null;
            }
            return menu;
          })()
        : null}
    </div>
  );
}
