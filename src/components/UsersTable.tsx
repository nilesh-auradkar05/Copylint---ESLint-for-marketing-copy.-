import { useState } from 'react'

type Row = { id: string; name: string; role: string }

export function UsersTable({ users, currentUserId, ready, onMakeEngineer }: {
  users: Row[]; currentUserId?: string; ready: boolean; onMakeEngineer: (userId: string) => void | Promise<void>
}) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const promote = async (id: string) => {
    setBusyId(id); setError('')
    try { await onMakeEngineer(id) } catch (e) { setError(e instanceof Error ? e.message : 'Could not change that role. Try again.') } finally { setBusyId('') }
  }
  // Render only id/name/role, so an email passed in by mistake is never shown.
  return <>
    {error && <p role="alert" className="proof-error">{error}</p>}
    <table><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
      <tbody>{users.map(u => {
        const name = u.name.trim() || 'Unnamed user'
        return <tr key={u.id}>
          <td>{name}{u.id === currentUserId && ' (you)'}</td>
          <td>{u.role === 'admin' ? 'Engineer' : 'Writer'}</td>
          <td>{u.role !== 'admin' && <button type="button" aria-label={`Make engineer: ${name}`} disabled={!ready || busyId === u.id} onClick={() => promote(u.id)}>Make engineer</button>}</td>
        </tr>
      })}</tbody></table>
  </>
}
