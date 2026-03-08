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
    // When opening, seed query from current label so typing refines.
    if (open) {
      setQ(current ? current.label : '');
      setTimeout(() => inputRef.current?.select(), 0);
    } else {
      setQ('');
    }
  }, [open]);

  const displayValue = open ? q : (current ? current.label : '');

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
            }
            if (e.key === 'ArrowDown') {
              setOpen(true);
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

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden text-sm">
          <div className="max-h-[420px] overflow-y-scroll overflow-x-hidden">
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
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`w-full text-left px-3 py-2 hover:bg-white/5 truncate ${o.value === value ? 'bg-white/10' : ''}`}
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
      ) : null}
    </div>
  );
}
