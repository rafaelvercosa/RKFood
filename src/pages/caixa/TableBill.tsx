import { useState } from 'react'
import { Modal } from '../../components/ui'
import { payTable } from '../../data/api'
import { splitEvenly, tableOrders } from '../../data/selectors'
import { useDB } from '../../data/store'
import { relativeAge } from '../../lib/dates'
import { brl } from '../../lib/money'
import type { Order } from '../../types'
import { STATUS_LABEL } from '../../types'
import { PaymentForm } from './PaymentForm'

/** Conta da mesa: junta os pedidos da mesa, divide por pessoa e recebe cada parte do jeito que a pessoa quiser. */
export function TableBill({ table, onClose }: { table: string; onClose: () => void }) {
  const db = useDB()
  const t = tableOrders(db, table)
  const [people, setPeople] = useState(1)
  const [paid, setPaid] = useState<Set<number>>(new Set())
  const [receiving, setReceiving] = useState<{ amount: number; index: number | null } | null>(null)

  // total da conta no início da divisão: as partes não mudam enquanto as pessoas vão pagando
  const [planTotal, setPlanTotal] = useState<number | null>(null)
  if (!t) {
    return (
      <Modal title={`Mesa ${table}`} onClose={onClose}>
        <div className="hint ok" role="status">Conta fechada. Nada mais a receber nesta mesa.</div>
        <button className="btn-ok btn-lg" onClick={onClose}>Fechar</button>
      </Modal>
    )
  }
  const base = planTotal ?? t.remaining
  const shares = splitEvenly(base, people)
  const toPay = shares.map((v, i) => (paid.has(i) ? 0 : v)).reduce((a, b) => a + b, 0)
  const stale = (o: Order) => o.status !== 'entregue' && o.status !== 'pronto' ? STATUS_LABEL[o.status] : null
  const preparing = t.orders.filter((o) => stale(o))

  function setCount(n: number) {
    const next = Math.min(20, Math.max(1, n))
    if (paid.size > 0) return
    setPeople(next)
    setPlanTotal(t!.remaining)
  }

  return (
    <Modal title={`Conta da Mesa ${t.table}`} onClose={onClose}>
      {preparing.length > 0 && (
        <div className="hint">O pedido nº {preparing.map((o) => o.number).join(', ')} ainda está na cozinha. Dá para fechar assim mesmo.</div>
      )}
      <section className="stack" style={{ gap: 4 }}>
        {t.orders.map((o) => (
          <div key={o.id} className="row between" style={{ flexWrap: 'nowrap', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
            <div>
              <b>Pedido nº {o.number}</b>
              <div className="small muted">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
            </div>
            <b className="money">{brl(o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0))}</b>
          </div>
        ))}
        <div className="row between">
          <b>Falta receber</b>
          <strong className="money" style={{ fontSize: '2.2rem', fontFamily: 'var(--font-sign)' }}>{brl(t.remaining)}</strong>
        </div>
        <div className="small muted">Aberta há {relativeAge(t.since)}.</div>
      </section>

      <section className="card flat stack">
        <div className="row between" style={{ flexWrap: 'nowrap' }}>
          <div><div className="sign nowrap" style={{ fontSize: '1.2rem' }}>Dividir a conta</div><div className="small muted">em partes iguais</div></div>
          <div className="qty" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            <button onClick={() => setCount(people - 1)} aria-label="Menos pessoas" disabled={paid.size > 0} style={{ background: 'rgb(255 255 255 / 0.22)', color: 'inherit' }}>−</button>
            <span style={{ minWidth: 76 }}>{people} {people === 1 ? 'pessoa' : 'pessoas'}</span>
            <button onClick={() => setCount(people + 1)} aria-label="Mais pessoas" disabled={paid.size > 0} style={{ background: 'rgb(255 255 255 / 0.22)', color: 'inherit' }}>+</button>
          </div>
        </div>
        {people > 1 && shares.map((v, i) => (
          <div key={i} className="row between" style={{ flexWrap: 'nowrap', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '8px 8px 8px 14px' }}>
            <b>Pessoa {i + 1}</b>
            <strong className="money" style={{ fontSize: '1.6rem', fontFamily: 'var(--font-sign)' }}>{brl(v)}</strong>
            {paid.has(i) ? <span className="badge pago">✓ Pago</span> : <button className="btn-ok btn-sm" onClick={() => setReceiving({ amount: v, index: i })}>Receber</button>}
          </div>
        ))}
        {people > 1 && <p className="small muted">Cada parte pode ser paga de um jeito: Pix, dinheiro, cartão ou fiado.</p>}
      </section>

      <button className="btn-primary btn-lg btn-block" disabled={toPay <= 0} onClick={() => setReceiving({ amount: toPay, index: null })}>
        {people > 1 && paid.size > 0 ? `Receber o que falta: ${brl(toPay)}` : `Receber tudo: ${brl(toPay)}`}
      </button>

      {receiving && (
        <Modal title={receiving.index === null ? `Mesa ${t.table} · receber ${brl(receiving.amount)}` : `Pessoa ${receiving.index + 1} · ${brl(receiving.amount)}`} onClose={() => setReceiving(null)}>
          <PaymentForm
            remaining={receiving.amount}
            submit={(input, pin) => payTable(t.orders, input, pin)}
            onDone={() => {
              if (receiving.index === null) setPaid(new Set(shares.map((_, i) => i)))
              else setPaid((s) => new Set(s).add(receiving.index!))
              setReceiving(null)
            }}
          />
        </Modal>
      )}
    </Modal>
  )
}
