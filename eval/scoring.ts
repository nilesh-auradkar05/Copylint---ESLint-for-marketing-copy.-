/** Pure scoring for the golden-set eval (T-007): confusion matrix, contradicted P/R, miss diagnosis, report text. No I/O. */

export const LABELS = ['supported', 'contradicted', 'unsupported'] as const
export type Label = (typeof LABELS)[number]

/** PRD section 5 targets for the contradicted class. */
export const TARGETS = { recall: 0.85, precision: 0.8 } as const

export interface EvalRow {
  id: number | string
  /** Gold label (human-owned). */
  label: Label
  /** Judge verdict after validateJudge; null when the call threw. */
  predicted: Label | null
  expectedPage: string | null
  retrievedPages: string[]
  error?: string
  /** Only used for the report text. */
  claim?: string
}

export type Diagnosis = 'retrieval miss' | 'judge error' | 'run error'

export interface Miss {
  id: number | string
  gold: Label
  predicted: Label
  diagnosis: Exclude<Diagnosis, 'run error'>
  claim: string
}

export type Matrix = Record<Label, Record<Label, number>>

export interface Score {
  /** matrix[gold][predicted] */
  matrix: Matrix
  counted: number
  correct: number
  accuracy: number | null
  contradictedPrecision: number | null
  contradictedRecall: number | null
  misses: Miss[]
  runErrors: { id: number | string; error: string; claim: string }[]
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den
}

export function diagnose(row: EvalRow): Exclude<Diagnosis, 'run error'> {
  const needsPage = row.label === 'supported' || row.label === 'contradicted'
  if (needsPage && row.expectedPage !== null && !row.retrievedPages.includes(row.expectedPage)) return 'retrieval miss'
  return 'judge error'
}

export function score(rows: EvalRow[]): Score {
  const matrix = Object.fromEntries(
    LABELS.map((g) => [g, Object.fromEntries(LABELS.map((p) => [p, 0]))]),
  ) as Matrix
  const misses: Miss[] = []
  const runErrors: Score['runErrors'] = []
  let counted = 0
  let correct = 0
  for (const row of rows) {
    if (row.error !== undefined || row.predicted === null) {
      runErrors.push({ id: row.id, error: row.error ?? 'no verdict', claim: row.claim ?? '' })
      continue
    }
    matrix[row.label][row.predicted] += 1
    counted += 1
    if (row.label === row.predicted) correct += 1
    else misses.push({ id: row.id, gold: row.label, predicted: row.predicted, diagnosis: diagnose(row), claim: row.claim ?? '' })
  }
  const tp = matrix.contradicted.contradicted
  const predictedContradicted = LABELS.reduce((n, g) => n + matrix[g].contradicted, 0)
  const goldContradicted = LABELS.reduce((n, p) => n + matrix.contradicted[p], 0)
  return {
    matrix,
    counted,
    correct,
    accuracy: ratio(correct, counted),
    contradictedPrecision: ratio(tp, predictedContradicted),
    contradictedRecall: ratio(tp, goldContradicted),
    misses,
    runErrors,
  }
}

const pct = (v: number | null): string => (v === null ? 'n/a (0/0)' : v.toFixed(3))
const status = (v: number | null, target: number): string => (v === null ? 'N/A' : v >= target ? 'PASS' : 'BELOW')
const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function formatReport(s: Score, targets: { recall: number; precision: number } = TARGETS): string {
  const w = 13
  const lines: string[] = []
  lines.push('Confusion matrix (rows = gold, cols = predicted)')
  lines.push(['gold \\ pred'.padEnd(w), ...LABELS.map((l) => l.padStart(w))].join(' '))
  for (const g of LABELS) lines.push([g.padEnd(w), ...LABELS.map((p) => String(s.matrix[g][p]).padStart(w))].join(' '))
  lines.push('')
  lines.push(`Judged ${s.counted}, run errors ${s.runErrors.length}, accuracy ${pct(s.accuracy)}`)
  lines.push(
    `Contradicted recall    ${pct(s.contradictedRecall)}  target >= ${targets.recall}  ${status(s.contradictedRecall, targets.recall)}`,
  )
  lines.push(
    `Contradicted precision ${pct(s.contradictedPrecision)}  target >= ${targets.precision}  ${status(s.contradictedPrecision, targets.precision)}`,
  )
  lines.push('')
  lines.push(`Misses (${s.misses.length})`)
  for (const m of s.misses) lines.push(`#${m.id} ${m.gold}→${m.predicted} | ${m.diagnosis} | ${trunc(m.claim, 90)}`)
  if (s.runErrors.length > 0) {
    lines.push('')
    lines.push(`Run errors (${s.runErrors.length}, excluded from the matrix)`)
    for (const e of s.runErrors) lines.push(`#${e.id} run error | ${trunc(e.error, 60)} | ${trunc(e.claim, 90)}`)
  }
  return lines.join('\n')
}
