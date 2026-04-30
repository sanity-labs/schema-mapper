import type {ChangeEvent} from 'react'

interface CheckboxProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Accessible label when no visible <label> is associated. */
  ariaLabel?: string
  /** Optional id, used to associate with an external <label>. */
  id?: string
  /** Brand accent for checked state. Defaults to emerald to match the rest of Analyze mode. */
  tone?: 'emerald' | 'neutral'
  className?: string
}

const TONE_CLASSES: Record<NonNullable<CheckboxProps['tone']>, string> = {
  emerald:
    'checked:border-emerald-600 checked:bg-emerald-600 focus-visible:outline-emerald-600 dark:checked:border-emerald-500 dark:checked:bg-emerald-500 dark:focus-visible:outline-emerald-500',
  neutral:
    'checked:border-gray-900 checked:bg-gray-900 focus-visible:outline-gray-900 dark:checked:border-white dark:checked:bg-white dark:focus-visible:outline-white',
}

/**
 * Native checkbox styled per the ui.sh form-controls guidelines: real
 * `<input type="checkbox">` (no JS state-class toggling), CSS-driven check
 * mark via `:checked`, focus-visible outline. Larger touch target on mobile.
 */
export function Checkbox({checked, onChange, ariaLabel, id, tone = 'emerald', className}: CheckboxProps) {
  const onInput = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)
  return (
    <span className={`group inline-grid size-5 shrink-0 grid-cols-1 sm:size-4 ${className ?? ''}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onInput}
        aria-label={ariaLabel}
        className={`col-start-1 row-start-1 appearance-none rounded-sm border border-gray-300 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:border-gray-300 disabled:bg-gray-100 disabled:checked:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:disabled:border-white/5 dark:disabled:bg-white/10 forced-colors:appearance-auto ${TONE_CLASSES[tone]}`}
      />
      <svg
        viewBox="0 0 14 14"
        fill="none"
        className="pointer-events-none col-start-1 row-start-1 size-7/8 self-center justify-self-center stroke-white group-has-disabled:stroke-gray-950/25 dark:group-has-disabled:stroke-white/25"
        aria-hidden="true"
      >
        <path
          d="M3 8L6 11L11 3.5"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="group-not-has-checked:opacity-0"
        />
      </svg>
    </span>
  )
}
