/** Judging one claim against its retrieved chunks (SPEC §4.5). Citations are validated, never trusted. */

import { CONFIG } from './config'
import { JudgeOut } from './contracts'
import { validateJudge } from './citations'
import { JUDGE_SYSTEM, generateValidated, judgeUserPrompt } from './prompts'
import type { RetrievedChunk } from './retrieve'
import type { GenerateFn } from './verify'

export async function judgeClaim(
  deps: { generate: GenerateFn; signal?: AbortSignal },
  text: string,
  chunks: RetrievedChunk[],
): Promise<JudgeOut> {
  const out = await generateValidated(deps, {
    model: CONFIG.models.judge,
    system: JUDGE_SYSTEM,
    prompt: judgeUserPrompt(text, chunks),
    schema: JudgeOut,
    maxOutputTokens: CONFIG.limits.judgeMaxOutputTokens,
  })
  return validateJudge(out, chunks.map((c) => c.chunkId))
}
