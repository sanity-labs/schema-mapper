import {useMemo} from 'react'
import type {SchemaPath} from '../../lib/complexity/walkSchema'
import {computeNormalization} from '../../lib/complexity/normalization'

interface NormalizationPanelProps {
  paths: SchemaPath[]
  onJumpToType?: (docType: string) => void
}

const COLLISION_LIMIT = 12

export function NormalizationPanel({paths, onJumpToType}: NormalizationPanelProps) {
  const result = useMemo(() => computeNormalization(paths), [paths])

  const hasFindings = result.collisions.length > 0 || result.nearDuplicates.length > 0

  return (
    <section>
      <h3 className="text-sm font-normal mb-1">Field name consistency</h3>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed max-w-3xl">
        Two ways your schema can drift over time. Naming inconsistency mostly hurts editors and code
        clarity — but type collisions (the same name with different primitive types) <em>can</em> nudge
        billing up: Sanity counts attributes by <code className="font-mono text-xs">(path, datatype)</code>,
        so each datatype variant of the same path counts separately.
      </p>

      {!hasFindings && (
        <p className="text-sm text-muted-foreground">
          No name collisions or obvious synonym drift detected. ✓
        </p>
      )}

      {result.collisions.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-normal mb-1">Type collisions</h4>
          <p className="text-xs text-muted-foreground mb-2 leading-relaxed max-w-3xl">
            The <em>same field name</em> is declared with <em>different primitive types</em> on at least two
            different document types. This is usually accidental — pick one type and refactor the others, or
            rename one so the names don't collide.
            <br />
            <span className="text-muted-foreground/80">
              (Polymorphic array members like a page builder's <code className="font-mono text-xs">content[]</code>{' '}
              with many block types are <em>not</em> shown here — those are valid array members, not collisions.)
            </span>
          </p>
          <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap sm:-mx-0">
            <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-normal text-muted-foreground border-b border-gray-950/10 dark:border-white/10">
                    <th className="whitespace-nowrap py-2 pr-3">Field name</th>
                    <th className="whitespace-nowrap py-2 px-3">Declared as</th>
                    <th className="whitespace-nowrap py-2 px-3 text-right">Total uses</th>
                    <th className="whitespace-nowrap py-2 pl-3">Where</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-950/5 dark:divide-white/5">
                  {result.collisions.slice(0, COLLISION_LIMIT).map((row) => (
                    <tr key={row.name} className="align-top">
                      <td className="py-2 pr-3 font-normal">
                        <code className="font-mono text-xs">{row.name}</code>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {row.datatypes.map((d) => (
                            <span
                              key={d}
                              className="rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 text-xs px-2 py-0.5"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{row.occurrences.length.toLocaleString()}</td>
                      <td className="py-2 pl-3">
                        <div className="flex flex-col gap-0.5 text-xs">
                          {row.occurrences.slice(0, 4).map((occ, i) => (
                            <button
                              key={`${occ.docType}::${occ.path}::${i}`}
                              type="button"
                              onClick={() => onJumpToType?.(occ.docType)}
                              className="text-left text-foreground/80 hover:underline focus:outline-none focus:underline"
                            >
                              <span className="text-muted-foreground">{occ.docType}</span>
                              <span className="mx-1 text-muted-foreground">·</span>
                              <code className="font-mono">{occ.path}</code>
                              <span className="mx-1 text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{occ.datatype}</span>
                            </button>
                          ))}
                          {row.occurrences.length > 4 && (
                            <span className="text-xs text-muted-foreground">+ {row.occurrences.length - 4} more</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {result.collisions.length > COLLISION_LIMIT && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing the top {COLLISION_LIMIT} of {result.collisions.length} collisions.
            </p>
          )}
        </div>
      )}

      {result.nearDuplicates.length > 0 && (
        <div>
          <h4 className="text-sm font-normal mb-1">Likely synonyms</h4>
          <p className="text-xs text-muted-foreground mb-2 leading-relaxed max-w-3xl">
            Two or more names that probably mean the same thing are used across the schema. Picking one and
            renaming the others reduces editor confusion. <em>Skip if the names mean genuinely different
            things in your domain</em> — this is a heuristic, not a rule.
          </p>
          <ul className="space-y-1 text-sm">
            {result.nearDuplicates.map((g) => (
              <li key={g.canonical} className="flex items-baseline gap-3">
                <span className="text-muted-foreground text-xs w-24 shrink-0">{g.canonical}</span>
                <div className="flex flex-wrap gap-1">
                  {g.variants.map((v) => (
                    <code
                      key={v}
                      className="font-mono text-xs rounded bg-gray-100 dark:bg-white/5 px-1.5 py-0.5"
                    >
                      {v}
                    </code>
                  ))}
                </div>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {g.totalOccurrences.toLocaleString()} uses
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
