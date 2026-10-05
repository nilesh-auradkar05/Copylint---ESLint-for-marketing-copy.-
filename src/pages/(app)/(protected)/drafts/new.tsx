import { useMutations } from 'deepspace'
import { useNavigate } from 'react-router-dom'
import { DraftForm, type DraftInput } from '@/components/DraftForm'
import { useToast } from '@/components/ui/Toast'

export default function NewDraftPage() {
  const { ready, createConfirmed } = useMutations<DraftInput & { collaborators: string[] }>('drafts')
  const navigate = useNavigate()
  const { success } = useToast()
  return <DraftForm ready={ready} onCreate={async data => {
    await createConfirmed({ ...data, collaborators: [] })
    success('Draft created')
    navigate('/drafts')
  }} />
}
