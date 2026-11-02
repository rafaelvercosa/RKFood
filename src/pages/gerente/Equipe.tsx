import { useState } from 'react'
import { attempt, Modal, toast } from '../../components/ui'
import { createInvite, moveToTrash, saveUser, setUserBlocked, type UserInput } from '../../data/api'
import { isCloud } from '../../data/backend'
import { hasRole, useCurrentUser } from '../../data/session'
import { useDB } from '../../data/store'
import { ROLE_LABEL, type Role, type User } from '../../types'

const ROLES: { role: Role; desc: string }[] = [
  { role: 'atendente', desc: 'Faz pedidos e entrega' },
  { role: 'cozinha', desc: 'Vê a fila e marca pronto' },
  { role: 'caixa', desc: 'Recebe pagamentos e fiado' },
  { role: 'gerente', desc: 'Cardápio, relatórios, adianta pedido e autoriza cancelamento. Cria atendentes' },
  { role: 'dono', desc: 'Tudo, e é o único que altera, bloqueia e exclui perfis e autoriza cortesia' },
]

/** "81988887777" → "(81) 98888-7777" */
export function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '')
  const local = d.length > 11 ? d.slice(-11) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return digits
}

/** Link do WhatsApp para o número (com 55 do Brasil quando vier só DDD + número). */
function whatsappTo(phone: string, text: string): string {
  const d = phone.replace(/\D/g, '')
  const full = d.length <= 11 ? `55${d}` : d
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`
}

/** Gera o link de convite e abre o WhatsApp da pessoa com a mensagem pronta. */
async function sendAccess(u: User, establishment: string) {
  if (!isCloud) {
    toast('O link de acesso funciona na versão publicada (nuvem). No modo demonstração, todos usam este aparelho.')
    return
  }
  // a janela abre já no toque (o navegador bloqueia janela aberta depois de esperar a internet)
  const win = window.open('', '_blank')
  try {
    const link = await createInvite(u.id)
    const text = `Olá, ${u.name}! Este é o seu acesso ao ${establishment} no RKFood.\n\n` +
      `Abra no seu celular (vale uma vez só, por 24 horas):\n${link}\n\nDepois, entre com o seu PIN.`
    const url = whatsappTo(u.phone, text)
    if (win) win.location.href = url
    else location.href = url
    toast(`Link de acesso de ${u.name} gerado`)
  } catch (e) {
    win?.close()
    void attempt(() => { throw e })
  }
}

export default function Equipe() {
  const db = useDB()
  const me = useCurrentUser()
  const isOwner = hasRole(me, 'dono')
  const [editing, setEditing] = useState<User | 'novo' | null>(null)
  const users = db.users.filter((u) => !u.deletedAt)
  const nameOf = (id: string | null) => db.users.find((u) => u.id === id)?.name
  return (
    <div className="stack">
      <button className="btn-primary" style={{ justifySelf: 'start' }} onClick={() => setEditing('novo')}>
        {isOwner ? '+ Novo usuário' : '+ Novo atendente'}
      </button>
      <div className="card">
        {users.map((u) => (
          <div key={u.id} className="list-item">
            <div className="grow">
              <strong>{u.name}</strong> {u.blockedAt && <span className="badge atrasado">Bloqueado</span>}
              <div className="muted small">{u.roles.map((r) => ROLE_LABEL[r]).join(', ')}</div>
              <div className="muted small">
                {u.phone ? `📱 ${formatPhone(u.phone)}` : 'sem telefone'}
                {nameOf(u.createdBy) && ` · criado por ${nameOf(u.createdBy)}`}
              </div>
            </div>
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              {u.phone && !u.blockedAt && u.id !== me?.id && (isOwner || (u.roles.length === 1 && u.roles[0] === 'atendente')) && (
                <button className="btn-sm" onClick={() => void sendAccess(u, db.establishment.name)} title="Manda pelo WhatsApp um link que libera o celular da pessoa">📲 Enviar acesso</button>
              )}
              {isOwner && <button className="btn-sm" onClick={() => setEditing(u)}>Editar</button>}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">
        Cada pessoa entra com o próprio PIN. Assim o histórico mostra quem fez cada pedido, pagamento ou alteração.
        Com o WhatsApp cadastrado, "Enviar acesso" manda um link que libera o celular da pessoa (só o PIN dela funciona nele).
        {!isOwner && ' O gerente cria perfis de atendente; alterar, bloquear ou excluir é só com o dono.'}
      </p>
      {editing && <UserForm user={editing === 'novo' ? null : editing} isOwner={isOwner} onClose={() => setEditing(null)} />}
    </div>
  )
}

function UserForm({ user, isOwner, onClose }: { user: User | null; isOwner: boolean; onClose: () => void }) {
  const me = useCurrentUser()
  const [form, setForm] = useState<UserInput>(() =>
    user ? { id: user.id, name: user.name, phone: user.phone, pin: user.pin, roles: user.roles } : { name: '', phone: '', pin: '', roles: ['atendente'] },
  )
  const toggle = (r: Role) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }))
  const blocked = !!user?.blockedAt
  return (
    <Modal title={user ? 'Editar usuário' : isOwner ? 'Novo usuário' : 'Novo atendente'} onClose={onClose}>
      <label className="field">Nome *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">WhatsApp (com DDD)
        <input inputMode="tel" placeholder="81 99999-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </label>
      <label className="field">PIN (4 a 6 números){user && isCloud ? '' : ' *'}
        <input inputMode="numeric" maxLength={6} value={form.pin} placeholder={user && isCloud ? 'Deixe em branco para manter o PIN atual' : ''}
          onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
      </label>
      {isOwner ? (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Perfis</legend>
          {ROLES.map(({ role, desc }) => (
            <label key={role} className="check">
              <input type="checkbox" checked={form.roles.includes(role)} onChange={() => toggle(role)} />
              <span><b>{ROLE_LABEL[role]}</b> <span className="muted small">— {desc}</span></span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="muted small">Perfil: <b>Atendente</b>. Para dar outras permissões, fale com o dono.</p>
      )}
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveUser(form), 'Usuário salvo').then((ok) => ok && onClose())}>Salvar</button>
      {user && isOwner && user.id !== me?.id && (
        <div className="row">
          <button className="grow" onClick={() => attempt(() => setUserBlocked(user.id, !blocked), blocked ? 'Usuário desbloqueado' : 'Usuário bloqueado').then((ok) => ok && onClose())}>
            {blocked ? '🔓 Desbloquear' : '🔒 Bloquear acesso'}
          </button>
          <button className="btn-danger grow" onClick={() => attempt(() => moveToTrash('users', user.id), 'Usuário movido para a lixeira').then((ok) => ok && onClose())}>
            Excluir usuário
          </button>
        </div>
      )}
      {user && isOwner && <p className="muted small">Bloqueado não entra com o PIN, sai na hora de qualquer aparelho e não autoriza cancelamento nem cortesia.</p>}
    </Modal>
  )
}
