import { useUser, useUsers } from 'deepspace'
import { UsersTable } from '@/components/UsersTable'

export default function UsersPage() {
  const { user, isLoading } = useUser()
  const { users, usersLoaded, setRole } = useUsers()
  if (isLoading) return <section className="proof-page" aria-busy="true" role="status"><p>Loading…</p></section>
  // UX only: the server decides whether user.set_role is allowed.
  if (user?.role !== 'admin') return <section className="proof-page"><h1>Admins only</h1><p className="proof-muted">Managing roles is limited to engineers. <a className="proof-link" href="/drafts">Back to drafts →</a></p></section>
  return <section className="proof-page">
    <header><p className="proof-kicker">Ground truth</p><h1>Users</h1></header>
    {!usersLoaded && <p role="status" aria-live="polite" className="proof-muted">Loading users…</p>}
    <UsersTable
      ready={usersLoaded}
      currentUserId={user.id}
      // Strip email, imageUrl and timestamps here (AGENTS.md section 6).
      users={users.map(u => ({ id: u.id, name: u.name, role: u.role }))}
      onMakeEngineer={id => setRole(id, 'admin')} />
  </section>
}
