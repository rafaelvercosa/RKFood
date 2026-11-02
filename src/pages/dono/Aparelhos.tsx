import { attempt } from '../../components/ui'
import { setDeviceBlocked } from '../../data/api'
import { isCloud } from '../../data/backend'
import { useDB } from '../../data/store'
import { dateTimeBR } from '../../lib/dates'

/** Todos os aparelhos que entraram no sistema; o dono pode bloquear qualquer um. */
export default function Aparelhos() {
  const db = useDB()
  const name = (id: string | null) => db.users.find((u) => u.id === id)?.name ?? '—'
  if (!isCloud) {
    return <div className="card empty">Os aparelhos aparecem na versão publicada (nuvem). No modo demonstração, tudo acontece só neste aparelho.</div>
  }
  const devices = [...db.devices].sort((a, b) => Number(!!a.blockedAt) - Number(!!b.blockedAt) || b.lastSeenAt.localeCompare(a.lastSeenAt))
  return (
    <div className="stack">
      <p className="muted small">
        Celulares liberados por link (só a pessoa do convite entra neles) e aparelhos conectados com o e-mail do estabelecimento.
        Bloqueado não entra mais; o celular de link deixa de ver qualquer dado.
      </p>
      <div className="card">
        {devices.length === 0 ? <div className="empty">Nenhum aparelho registrado ainda.</div> : devices.map((d) => (
          <div key={d.id} className="list-item">
            <div className="grow">
              <strong>{d.kind === 'convite' ? `📱 Celular de ${name(d.staffId)}` : '🖥️ Aparelho do estabelecimento'}</strong>{' '}
              {d.blockedAt && <span className="badge atrasado">Bloqueado</span>}
              <div className="muted small">{d.info || 'sem detalhes'}{d.kind === 'convite' ? ' · entrou pelo link' : ''}</div>
              <div className="muted small">
                Primeiro acesso {dateTimeBR(d.firstSeenAt)} · último {dateTimeBR(d.lastSeenAt)}
                {d.lastStaffId && ` por ${name(d.lastStaffId)}`}
              </div>
            </div>
            <button
              className={`btn-sm ${d.blockedAt ? '' : 'btn-danger'}`}
              onClick={() => attempt(() => setDeviceBlocked(d.id, !d.blockedAt), d.blockedAt ? 'Aparelho desbloqueado' : 'Aparelho bloqueado')}
            >
              {d.blockedAt ? 'Desbloquear' : 'Bloquear'}
            </button>
          </div>
        ))}
      </div>
      <p className="muted small">Para cortar de uma vez todos os aparelhos da conta do estabelecimento, troque a senha dessa conta no Supabase.</p>
    </div>
  )
}
