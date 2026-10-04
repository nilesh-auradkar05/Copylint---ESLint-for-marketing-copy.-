// Optional isolated tooling/reference keeps the missing T-001 runtime unmodified.
import { resolve } from 'node:path'
const tooling = process.env.T010_TEST_TOOLS
const reference = process.env.T010_SCAFFOLD_REFERENCE
export default {
  cacheDir: '/tmp/groundtruth-t010-vitest-cache',
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: {
    ...(reference ? { '@/components/ui': resolve(reference, 'src/components/ui'), '@/lib/utils': resolve(reference, 'src/lib/utils.ts') } : {}),
    '@': resolve('src'),
    ...(tooling ? Object.fromEntries(['react', 'react-dom', 'vitest', '@base-ui/react', 'class-variance-authority', 'clsx', 'tailwind-merge', 'lucide-react'].map(name => [name, resolve(tooling, 'node_modules', name)])) : {}),
  } },
  test: { include: ['tests/t010-ui.test.tsx'], environment: 'jsdom' },
}
