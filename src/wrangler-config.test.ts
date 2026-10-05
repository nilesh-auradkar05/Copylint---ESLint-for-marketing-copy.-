import { describe, expect, it } from 'vitest'
import raw from '../wrangler.toml?raw'

// T-004.1 unit-level proxy: the real "binding deploys" check is done by the human on deploy.
const live = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n')

describe('wrangler.toml knowledge binding', () => {
  it('[T-004.1] declares an uncommented [[ai_search]] table', () => {
    expect(live).toMatch(/^\[\[ai_search\]\]\s*$/m)
  })

  it('[T-004.1] the ai_search table binds KNOWLEDGE to an auto-provisioned instance', () => {
    const table = /^\[\[ai_search\]\]\s*\n([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(live)
    expect(table, 'no [[ai_search]] table found').not.toBeNull()
    const body = table?.[1] ?? ''
    expect(body).toMatch(/^\s*binding\s*=\s*"KNOWLEDGE"\s*$/m)
    expect(body).toMatch(/^\s*instance_name\s*=\s*"auto"\s*$/m)
  })
})
