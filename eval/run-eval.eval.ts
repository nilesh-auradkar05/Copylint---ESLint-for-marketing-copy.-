// Launcher only: vitest resolves the engine's extensionless imports. Skipped unless RUN_EVAL=1 (use `npm run eval`).
import { test } from 'vitest'
import { optionsFromEnv, runEval } from './run-eval'

test.skipIf(process.env.RUN_EVAL !== '1')('golden-set eval', async () => {
  await runEval(optionsFromEnv())
})
