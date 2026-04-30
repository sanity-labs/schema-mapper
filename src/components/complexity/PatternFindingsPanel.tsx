import type {PatternFinding, PatternKind} from '../../lib/complexity/patterns'

interface PatternFindingsPanelProps {
  findings: PatternFinding[]
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

const KIND_LABEL: Record<PatternKind, string> = {
  i18n: 'Field-level i18n',
  presentational: 'Presentational fields',
  block: 'Portable Text',
  polymorphic: 'Polymorphic arrays',
}

// Light mode keeps a soft tint to differentiate kinds at a glance. Dark mode
// drops the tinted bg per the design rules ("never keep large branded/colored
// panels in dark mode") and uses a colored left accent instead.
const KIND_TONE: Record<PatternKind, string> = {
  i18n: 'bg-sky-50/60 border-sky-300 dark:bg-transparent dark:border-white/10 dark:border-l-2 dark:border-l-sky-500',
  presentational:
    'bg-violet-50/60 border-violet-300 dark:bg-transparent dark:border-white/10 dark:border-l-2 dark:border-l-violet-500',
  block: 'bg-teal-50/60 border-teal-300 dark:bg-transparent dark:border-white/10 dark:border-l-2 dark:border-l-teal-500',
  polymorphic:
    'bg-amber-50/60 border-amber-300 dark:bg-transparent dark:border-white/10 dark:border-l-2 dark:border-l-amber-500',
}

export function PatternFindingsPanel({findings}: PatternFindingsPanelProps) {
  if (findings.length === 0) return null
  return (
    <section>
      <h3 className="text-sm font-normal mb-1">Structural suggestions</h3>
      <p className="text-xs text-muted-foreground text-pretty mb-3 leading-relaxed max-w-3xl">
        Heuristic patterns the analyzer noticed across schema and data. These are <em>suggestions</em>,
        not findings: review each before acting. Skip ones that don't apply to your domain.
      </p>
      <div className="space-y-3">
        {findings.map((f, i) => (
          <article
            key={`${f.kind}-${i}`}
            className={`rounded-lg border ${KIND_TONE[f.kind]} p-4`}
          >
            <header className="flex items-baseline gap-2 flex-wrap mb-1">
              <h4 className="text-sm font-normal">{f.title}</h4>
              <span className="text-xs text-muted-foreground">{KIND_LABEL[f.kind]}</span>
              <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                ~{formatNumber(f.attributableAttributes)} attribute{f.attributableAttributes === 1 ? '' : 's'}
              </span>
            </header>
            <p className="text-xs leading-relaxed text-foreground/90 mb-2 max-w-2xl">{f.detail}</p>
            <p className="text-xs leading-relaxed text-foreground/80 max-w-2xl">
              <strong className="font-normal">Suggestion.</strong> {f.suggestion}
            </p>
            {f.examples.length > 0 && (
              <details className="mt-2 group">
                <summary className="text-xs cursor-pointer text-muted-foreground hover:underline select-none">
                  Examples ({f.examples.length})
                </summary>
                <ul role="list" className="mt-1 flex flex-wrap gap-1.5">
                  {f.examples.map((ex) => (
                    <li
                      key={ex}
                      className="font-mono text-xs rounded bg-white/60 dark:bg-white/5 px-1.5 py-0.5"
                    >
                      {ex}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
