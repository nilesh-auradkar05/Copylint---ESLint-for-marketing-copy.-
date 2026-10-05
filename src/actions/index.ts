import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { publishDraft } from './publish-draft'

export const actions: Record<string, ActionHandler<Env>> = { publishDraft }
