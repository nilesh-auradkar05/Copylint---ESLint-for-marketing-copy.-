import { useState } from 'react'

type Row = { id: string; name: string; role: string }

export function UsersTable({ users, currentUserId, ready, onMakeEngineer, onMakeWriter }: {
  users: Row[]; currentUserId?: string; ready: boolean
  onMakeEngineer: (userId: string) => void | Promise<void>; onMakeWriter?: (userId: string) => void | Promise<void>
}) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const change = async (id: string, apply: (userId: string) => void | Promise<void>) => {
    setBusyId(id); setError('')
    try { await apply(id) } catch (e) { setError(e instanceof Error ? e.message : 'Could not change that role. Try again.') } finally { setBusyId('') }
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
          <td>
            {u.role !== 'admin' && <button type="button" aria-label={`Make engineer: ${name}`} disabled={!ready || busyId === u.id} onClick={() => change(u.id, onMakeEngineer)}>Make engineer</button>}
            {/* Never on the current user's own row: stops an admin locking themselves out. */}
            {u.role === 'admin' && currentUserId !== undefined && u.id !== currentUserId && onMakeWriter && <button type="button" aria-label={`Make writer: ${name}`} disabled={!ready || busyId === u.id} onClick={() => change(u.id, onMakeWriter)}>Make writer</button>}
          </td>
        </tr>
      })}</tbody></table>
  </>
}
