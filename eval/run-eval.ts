/**
 * Golden-set eval runner (T-007). Judge-only: for each golden claim, `retrieve` then `judgeClaim`
 * (which applies `validateJudge`), the same path the verify-draft job uses. No extraction step.
 *
 * Launched through vitest (see run-eval.eval.ts) because the engine files use extensionless relative
 * imports and there is no tsx. Every judge call spends real credits: the --max-claims cap is hard.
 *
 * Secrets: the platform env is built from the untracked `.dev.vars` and `wrangler.toml` at runtime.
 * Token values are never printed, logged or written to results.
 */

import { Output, NoObjectGeneratedError, generateText } from 'ai'
import { createDeepSpaceAI, knowledge } from 'deepspace/worker'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG } from '../src/engine/config'
import { judgeClaim } from '../src/engine/judge'
import { PROMPT_VERSION } from '../src/engine/prompts'
import { retrieve } from '../src/engine/retrieve'
import type { GenerateFn } from '../src/engine/verify'
import { diagnose, formatReport, score } from './scoring'
import type { EvalRow, Label } from './scoring'

export interface EvalOptions {
  file: string
  suite?: 'core' | 'edge'
  limit?: number
  maxClaims: number
  dry: boolean
}

interface GoldenRow {
  id: number | string
  claim: string
  label: Label
  page: string | null
  suite?: string
}

const ENV_KEYS = ['API_WORKER_URL', 'PLATFORM_WORKER_URL', 'AUTH_WORKER_URL', 'APP_OWNER_JWT', 'APP_IDENTITY_TOKEN', 'OWNER_USER_ID']

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): EvalOptions {
  const suite = env.EVAL_SUITE
  if (suite !== undefined && suite !== '' && suite !== 'core' && suite !== 'edge') throw new Error(`EVAL_SUITE must be core or edge, got "${suite}"`)
  const num = (v: string | undefined): number | undefined => (v === undefined || v === '' ? undefined : Number(v))
  return {
    file: env.EVAL_FILE || 'eval/golden-claims.jsonl',
    suite: suite === 'core' || suite === 'edge' ? suite : undefined,
    limit: num(env.EVAL_LIMIT),
    maxClaims: num(env.EVAL_MAX_CLAIMS) ?? 30,
    dry: env.EVAL_DRY === '1',
  }
}

/** Minimal dotenv reader: KEY=VALUE and KEY="VALUE" (quoted values may span lines). Keeps only the wanted keys. */
function parseDotenv(text: string, wanted: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(lines[i])
    if (!m) continue
    let value = m[2]
    if (value.startsWith('"')) {
      while (!(value.length > 1 && value.endsWith('"')) && i + 1 < lines.length) value += `\n${lines[++i]}`
      value = value.slice(1, -1)
    }
    if (wanted.includes(m[1])) out[m[1]] = value
  }
  return out
}

function loadPlatformEnv(): Record<string, string> {
  const vars = parseDotenv(readFileSync('.dev.vars', 'utf8'), ENV_KEYS)
  const toml = readFileSync('wrangler.toml', 'utf8')
  const appId = /^DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/m.exec(toml)?.[1]
  const appName = /^APP_NAME\s*=\s*"([^"]+)"/m.exec(toml)?.[1]
  if (!appId) throw new Error('DEEPSPACE_APP_ID not found in wrangler.toml [vars]')
  for (const k of ['API_WORKER_URL', 'APP_OWNER_JWT', 'APP_IDENTITY_TOKEN']) {
    if (!vars[k]) throw new Error(`${k} missing from .dev.vars (run \`npx deepspace dev start\` once to generate it)`)
  }
  return { ...vars, DEEPSPACE_APP_ID: appId, ...(appName ? { APP_NAME: appName } : {}) }
}

function loadRows(opts: EvalOptions): GoldenRow[] {
  const rows = readFileSync(opts.file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as GoldenRow)
  const filtered = opts.suite === undefined ? rows : rows.filter((r) => r.suite === undefined || r.suite === opts.suite)
  return opts.limit === undefined ? filtered : filtered.slice(0, opts.limit)
}

/**
 * Copy of `makeGenerate` in src/jobs.ts (same shape, owner-pays, same NoObjectGeneratedError handling);
 * jobs.ts is not imported because it pulls worker-only code. Wrapped to count model calls.
 */
function makeGenerate(env: Parameters<typeof createDeepSpaceAI>[0], counter: { calls: number }): GenerateFn {
  const anthropic = createDeepSpaceAI(env, 'anthropic')
  return async ({ model, system, prompt, schema, maxOutputTokens, abortSignal }) => {
    counter.calls += 1
    try {
      const result = await generateText({
        model: anthropic(model),
        system,
        prompt,
        output: Output.object({ schema }),
        maxOutputTokens,
        abortSignal,
      })
      return result.output
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err
      try {
        return JSON.parse(err.text ?? '') as unknown
      } catch {
        return err.text
      }
    }
  }
}

export async function runEval(opts: EvalOptions): Promise<void> {
  const rows = loadRows(opts)
  if (rows.length > opts.maxClaims && !opts.dry) {
    const msg = `REFUSING to run: ${rows.length} claims selected, cap is ${opts.maxClaims} (EVAL_MAX_CLAIMS). No paid call was made.`
    console.error(msg)
    throw new Error(msg)
  }
  if (rows.length === 0) throw new Error('No claims selected')

  const env = loadPlatformEnv() as unknown as Parameters<typeof createDeepSpaceAI>[0]
  const kb = knowledge(env as Parameters<typeof knowledge>[0])

  if (opts.dry) {
    const { chunks } = await retrieve(kb, rows[0].claim)
    console.log(`DRY RUN: ${rows.length} claims selected from ${opts.file}; no model call made.`)
    console.log(`Claim #${rows[0].id}: ${rows[0].claim}`)
    console.log(`Expected page: ${rows[0].page}`)
    console.log(`Retrieved ${chunks.length} chunks, pages: ${chunks.map((c) => c.page).join(', ')}`)
    return
  }

  const counter = { calls: 0 }
  const generate = makeGenerate(env, counter)
  const started = Date.now()
  const results: (EvalRow & { citedPages: string[]; reason: string; diagnosis: string | null })[] = new Array(rows.length)
  let done = 0

  async function one(i: number): Promise<void> {
    const r = rows[i]
    try {
      const { chunks } = await retrieve(kb, r.claim)
      const out = await judgeClaim({ generate }, r.claim, chunks)
      const byId = new Map(chunks.map((c) => [c.chunkId, c.page]))
      const row: EvalRow = {
        id: r.id,
        label: r.label,
        predicted: out.verdict,
        expectedPage: r.page ?? null,
        retrievedPages: [...new Set(chunks.map((c) => c.page))],
        claim: r.claim,
      }
      results[i] = {
        ...row,
        citedPages: [...new Set(out.citedChunkIds.map((id) => byId.get(id)).filter((p): p is string => p !== undefined))],
        reason: out.reason,
        diagnosis: out.verdict === r.label ? null : diagnose(row),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results[i] = {
        id: r.id,
        label: r.label,
        predicted: null,
        expectedPage: r.page ?? null,
        retrievedPages: [],
        claim: r.claim,
        error: message,
        citedPages: [],
        reason: '',
        diagnosis: 'run error',
      }
    }
    done += 1
    const x = results[i]
    console.error(`[${done}/${rows.length}] #${x.id} gold=${x.label} predicted=${x.predicted ?? 'ERROR'}${x.error ? ` (${x.error.slice(0, 80)})` : ''}`)
  }

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < rows.length) await one(cursor++)
  }
  await Promise.all(Array.from({ length: Math.min(CONFIG.limits.judgeConcurrency, rows.length) }, worker))

  const wallMs = Date.now() - started
  const s = score(results)
  const report = formatReport(s)
  console.log(report)
  console.log('')
  console.log(`Wall time: ${(wallMs / 1000).toFixed(1)}s | PROMPT_VERSION: ${PROMPT_VERSION} | judge model: ${CONFIG.models.judge} | model calls: ${counter.calls}`)

  mkdirSync('eval/results', { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const path = join('eval/results', `${stamp}-${PROMPT_VERSION}.json`)
  writeFileSync(
    path,
    JSON.stringify(
      {
        promptVersion: PROMPT_VERSION,
        judgeModel: CONFIG.models.judge,
        file: opts.file,
        suite: opts.suite ?? null,
        modelCalls: counter.calls,
        wallMs,
        summary: {
          counted: s.counted,
          accuracy: s.accuracy,
          contradictedPrecision: s.contradictedPrecision,
          contradictedRecall: s.contradictedRecall,
          runErrors: s.runErrors.length,
          matrix: s.matrix,
        },
        claims: results.map((x) => ({
          id: x.id,
          gold: x.label,
          predicted: x.predicted,
          citedPages: x.citedPages,
          retrievedPages: x.retrievedPages,
          reason: x.reason,
          diagnosis: x.diagnosis,
          ...(x.error ? { error: x.error } : {}),
        })),
      },
      null,
      2,
    ),
  )
  console.log(`Results written to ${path}`)
}
