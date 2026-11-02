import { useState } from 'react'
import { attempt } from '../../components/ui'
import { restoreFromTrash, type Trashable } from '../../data/actions'
import { currentUserId } from '../../data/session'
import { resetDemo, useDB } from '../../data/store'
import { dateTimeBR } from '../../lib/dates'

const KIND_LABEL: Record<Trashable, string> = { products: 'Item', categories: 'Categoria', customers: 'Cliente', users: 'Usuário' }

/** Lixeira (restaurar o que foi excluído) e histórico de alterações. */
export default function Seguranca() {
  const db = useDB()
  const [limit, setLimit] = useState(50)
  const userName = (id: string) => db.users.find((u) => u.id === id)?.name ?? '—'

  const trash = (['products', 'categories', 'customers', 'users'] as Trashable[]).flatMap((kind) =>
    db[kind].filter((x) => x.deletedAt).map((x) => ({ kind, id: x.id, name: x.name, deletedAt: x.deletedAt! })),
  ).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))

  return (
    <div className="stack">
      <section className="card stack">
        <h3>🗑️ Lixeira</h3>
        <p className="muted small">Nada é apagado de verdade. O que for excluído fica aqui e pode ser restaurado.</p>
        {trash.length === 0 ? <div className="empty">Lixeira vazia.</div> : trash.map((t) => (
          <div key={t.kind + t.id} className="list-item">
            <div className="grow">
              <strong>{t.name}</strong> <span className="badge">{KIND_LABEL[t.kind]}</span>
              <div className="muted small">Excluído em {dateTimeBR(t.deletedAt)}</div>
            </div>
            <button className="btn-sm" onClick={() => attempt(() => restoreFromTrash(currentUserId(), t.kind, t.id), 'Restaurado')}>Restaurar</button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>📜 Histórico de alterações</h3>
        {db.audit.length === 0 ? <div className="empty">Sem registros.</div> : (
          <table className="list small">
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead>
            <tbody>
              {db.audit.slice(0, limit).map((a) => (
                <tr key={a.id}><td className="nowrap">{dateTimeBR(a.at)}</td><td>{userName(a.userId)}</td><td>{a.summary}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {db.audit.length > limit && <button onClick={() => setLimit((l) => l + 100)}>Ver mais</button>}
      </section>

      <section className="card stack">
        <h3>Modo demonstração</h3>
        <p className="muted small">Os dados estão salvos apenas neste navegador. Quando o banco na nuvem for conectado, eles passam a ficar no servidor com backup automático.</p>
        <button className="btn-danger" style={{ justifySelf: 'start' }} onClick={() => {
          if (confirm('Apagar todos os dados de demonstração e começar de novo?')) resetDemo()
        }}>Recomeçar demonstração</button>
      </section>
    </div>
  )
}
