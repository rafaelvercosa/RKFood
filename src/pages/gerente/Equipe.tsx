import { useState } from 'react'
import { attempt, Modal } from '../../components/ui'
import { moveToTrash, saveUser, type UserInput } from '../../data/api'
import { isCloud } from '../../data/backend'
import { useDB } from '../../data/store'
import { ROLE_LABEL, type Role, type User } from '../../types'

const ROLES: { role: Role; desc: string }[] = [
  { role: 'atendente', desc: 'Faz pedidos e entrega' },
  { role: 'cozinha', desc: 'Vê a fila e marca pronto' },
  { role: 'caixa', desc: 'Recebe pagamentos e fiado' },
  { role: 'gerente', desc: 'Acesso total: cardápio, equipe, relatórios' },
]

export default function Equipe() {
  const db = useDB()
  const [editing, setEditing] = useState<User | 'novo' | null>(null)
  const users = db.users.filter((u) => !u.deletedAt)
  return (
    <div className="stack">
      <button className="btn-primary" style={{ justifySelf: 'start' }} onClick={() => setEditing('novo')}>+ Novo usuário</button>
      <div className="card">
        {users.map((u) => (
          <div key={u.id} className="list-item">
            <div className="grow">
              <strong>{u.name}</strong>
              <div className="muted small">{u.roles.map((r) => ROLE_LABEL[r]).join(', ')}</div>
            </div>
            <button className="btn-sm" onClick={() => setEditing(u)}>Editar</button>
          </div>
        ))}
      </div>
      <p className="muted small">Cada pessoa entra com o próprio PIN. Assim o histórico mostra quem fez cada pedido, pagamento ou alteração.</p>
      {editing && <UserForm user={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [form, setForm] = useState<UserInput>(() => user ?? { name: '', pin: '', roles: ['atendente'] })
  const toggle = (r: Role) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }))
  return (
    <Modal title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}>
      <label className="field">Nome *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">PIN (4 a 6 números){user && isCloud ? '' : ' *'}
        <input inputMode="numeric" maxLength={6} value={form.pin} placeholder={user && isCloud ? 'Deixe em branco para manter o PIN atual' : ''}
          onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
      </label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Perfis</legend>
        {ROLES.map(({ role, desc }) => (
          <label key={role} className="check">
            <input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggle(role)} />
            <span><b>{ROLE_LABEL[role]}</b> <span className="muted small">— {desc}</span></span>
          </label>
        ))}
      </fieldset>
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveUser(form), 'Usuário salvo').then((ok) => ok && onClose())}>Salvar</button>
      {user && (
        <button className="btn-danger" onClick={() => attempt(() => moveToTrash('users', user.id), 'Usuário movido para a lixeira').then((ok) => ok && onClose())}>
          Excluir usuário
        </button>
      )}
    </Modal>
  )
}
