type Option<T extends string | number> = { value: T; label: string };

type Props<T extends string | number> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Read by screen readers, e.g. "Status filter". */
  label: string;
  /** Stretch to the full width of its container (phones). */
  fullWidth?: boolean;
};

/** A row of joined buttons; the selected one is solid orange with dark text. */
export default function SegmentedControl<T extends string | number>({ options, value, onChange, label, fullWidth }: Props<T>) {
  return (
    <div role="group" aria-label={label} className={`fo-seg${fullWidth ? ' is-full' : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`fo-seg-btn${o.value === value ? ' is-active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
