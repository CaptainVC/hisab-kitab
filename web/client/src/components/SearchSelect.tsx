import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchSelectOption = {
  value: string;
  label: string;
};

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = '(none)',
  className = 'hk-input',
  disabled
}: {
  value: string;
  onChange: (next: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = useMemo(() => options.find((o) => o.value === value) || null, [options, value]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => o.label.toLowerCase().includes(qq) || o.value.toLowerCase().includes(qq));
  }, [options, q]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as any)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  useEffect(() => {
    if (!open) setQ('');
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        className={`w-full ${className} flex items-center justify-between gap-2 ${disabled ? 'opacity-60' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`truncate ${current ? '' : 'text-[color:var(--hk-muted)]'}`}>{current ? current.label : placeholder}</span>
        <span className="text-[color:var(--hk-muted)]">▾</span>
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
          <div className="p-2 border-b border-zinc-800">
            <input
              ref={inputRef}
              className="w-full hk-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type to search…"
            />
          </div>
          <div className="max-h-72 overflow-auto">
            <button
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-white/5 text-[color:var(--hk-muted)]"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {placeholder}
            </button>
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`w-full text-left px-3 py-2 hover:bg-white/5 ${o.value === value ? 'bg-white/10' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
            {!filtered.length ? <div className="px-3 py-2 text-sm text-[color:var(--hk-muted)]">No matches</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
