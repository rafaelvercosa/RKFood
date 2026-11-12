import { useState } from 'react'
import { attempt, Modal } from '../../components/ui'
import { closeCash, openCash } from '../../data/api'
import { dailySummary, expectedCash, openCashSession } from '../../data/selectors'
import { useDB } from '../../data/store'
import { dateBR, hhmm, today } from '../../lib/dates'
import { brl, centsToInput, parseBRL } from '../../lib/money'
import { shareText } from '../../lib/share'
import type { Database } from '../../types'

/** Abrir o caixa com o dinheiro de troco que está na gaveta. */
export function OpenCashSheet({ onClose }: { onClose: () => void }) {
  const db = useDB()
  const last = db.cashSessions.find((s) => s.closedAt)
  const [value, setValue] = useState(last ? centsToInput(last.openingCents) : '100,00')
  const who = (id: string) => db.users.find((u) => u.id === id)?.name ?? '?'
  const quick = [5000, 10000, 20000, 0]
  const cents = parseBRL(value)
  return (
    <Modal title="Abrir o caixa" onClose={onClose}>
      <label className="field">Dinheiro para troco na gaveta (R$)
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ fontFamily: 'var(--font-sign)', fontSize: '2rem', minHeight: 64 }} autoFocus />
      </label>
      <div className="row">
        {quick.map((q) => (
          <button key={q} type="button" className={`btn-sm ${cents === q ? 'on' : ''}`} style={cents === q ? { background: 'var(--brand-soft)', color: 'var(--brand-text)', boxShadow: 'inset 0 0 0 2px var(--brand)' } : undefined} onClick={() => setValue(centsToInput(q))}>
            {q === 0 ? 'Sem troco' : `R$ ${q / 100}`}
          </button>
        ))}
      </div>
      {last && (
        <p className="hint" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
          Última vez: {dateBR(last.closedAt!)}, troco de {brl(last.openingCents)}{last.differenceCents ? ` e diferença de ${last.differenceCents < 0 ? '− ' : '+ '}${brl(Math.abs(last.differenceCents))}` : ' e caixa certinho'}.
        </p>
      )}
      <button className="btn-ok btn-lg btn-block" onClick={() => attempt(() => openCash(cents), 'Caixa aberto').then((ok) => ok && onClose())}>Abrir o caixa</button>
      <p className="muted small center">Quem abre fica registrado{last ? ` (a última abertura foi de ${who(last.openedBy)})` : ''}.</p>
    </Modal>
  )
}

/** Texto do resumo do dia que vai para o WhatsApp do dono ao fechar o caixa. */
export function closingSummary(db: Database, counted: number, diff: number): string {
  const d = dailySummary(db, today())
  const diffText = diff === 0 ? 'certinho' : `${diff < 0 ? '− ' : '+ '}${brl(Math.abs(diff))}`
  return [
    `*${db.establishment.name} · ${dateBR(new Date().toISOString())}*`,
    `Vendas: ${brl(d.sales)} (${d.orderCount} ${d.orderCount === 1 ? 'pedido' : 'pedidos'})`,
    `Entrou no caixa: ${brl(d.cashIn)}`,
    `Gaveta: contado ${brl(counted)} (${diffText})`,
    `Fiado novo: ${brl(d.byMethod.fiado)} · Ainda a receber: ${brl(d.openAmount)}`,
    `Cancelados: ${d.cancelledCount}`,
  ].join('\n')
}

/** Fechar o caixa: conta o dinheiro, vê a diferença e manda o resumo do dia. */
export function CloseCashSheet({ onClose }: { onClose: () => void }) {
  const db = useDB()
  const session = openCashSession(db)
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  if (!session) return null
  const expected = expectedCash(db, session)
  const has = counted.trim() !== ''
  const cents = parseBRL(counted)
  const diff = cents - expected
  const preview = closingSummary(db, cents, diff)

  async function finish(send: boolean) {
    const ok = await attempt(() => closeCash(cents, note), 'Caixa fechado')
    if (ok) {
      if (send) await shareText(preview).catch(() => undefined)
      onClose()
    }
  }

  return (
    <Modal title="Fechar o caixa" onClose={onClose}>
      <section className="card flat stack" style={{ gap: 6 }}>
        <div className="small muted" style={{ fontWeight: 800 }}>1. O que deveria ter na gaveta</div>
        <div className="row between"><span>Troco do início</span><b className="money">{brl(session.openingCents)}</b></div>
        <div className="row between"><span>Dinheiro recebido</span><b className="money">{brl(expected - session.openingCents)}</b></div>
        <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <b>Esperado</b><strong className="money" style={{ fontSize: '1.7rem' }}>{brl(expected)}</strong>
        </div>
        <div className="small muted">Aberto às {hhmm(session.openedAt)}.</div>
      </section>
      <section className="stack" style={{ gap: 8 }}>
        <div className="small muted" style={{ fontWeight: 800 }}>2. Conte o dinheiro e digite</div>
        <input inputMode="decimal" aria-label="Dinheiro contado (R$)" placeholder="0,00" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ fontFamily: 'var(--font-sign)', fontSize: '2rem', minHeight: 64 }} autoFocus />
        {has && (
          <div className={`hint ${diff === 0 ? 'ok' : ''}`} role="status" style={diff < 0 ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}>
            <div className="row between"><b>Diferença</b><strong className="money" style={{ fontSize: '1.6rem' }}>{diff === 0 ? 'Certinho' : `${diff < 0 ? '− ' : '+ '}${brl(Math.abs(diff))}`}</strong></div>
          </div>
        )}
        <input placeholder="Motivo da diferença (opcional)" aria-label="Motivo da diferença" value={note} onChange={(e) => setNote(e.target.value)} />
      </section>
      <section className="hint ok" style={{ whiteSpace: 'pre-line', fontWeight: 700 }}>
        <div className="small" style={{ fontWeight: 800, marginBottom: 4 }}>3. Resumo que vai para o WhatsApp</div>
        {has ? preview : 'Digite o dinheiro contado para ver o resumo.'}
      </section>
      <button className="btn-ok btn-lg btn-block" disabled={!has} onClick={() => void finish(true)}>Enviar resumo e fechar</button>
      <button className="btn-block" disabled={!has} onClick={() => void finish(false)}>Só fechar o caixa</button>
    </Modal>
  )
}
