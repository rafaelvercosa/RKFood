import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CustomerForm } from '../components/CustomerForm'
import { Header } from '../components/Layout'
import { attempt, Modal, OrderIdent, Segmented } from '../components/ui'
import { cancelOrder, payOrder, setOrderStatus, type PaymentInput } from '../data/api'
import { customerBalance, identLabel, modeLabel, orderPaid, orderPayments, orderRemaining, orderTotal } from '../data/selectors'
import { useDB } from '../data/store'
import { businessDateBR, dateBR, hhmm, today } from '../lib/dates'
import { brl, centsToInput, parseBRL } from '../lib/money'
import { escapeHtml, printHtml } from '../lib/print'
import type { Database, Order, PaymentMethod } from '../types'
import { METHOD_LABEL, STATUS_LABEL } from '../types'
import { DailyReport } from './gerente/Relatorios'

export default function Caixa() {
  const [view, setView] = useState<'receber' | 'pagos' | 'fechamento'>('receber')
  return (
    <>
      <Header title="Caixa" right={<Link to="/fiado" className="btn btn-ghost btn-sm">📒 Fiado</Link>} />
      <main className="page">
        <Segmented full value={view} onChange={setView} options={[
          { value: 'receber', label: 'A receber' },
          { value: 'pagos', label: 'Pagos hoje' },
          { value: 'fechamento', label: 'Fechamento' },
        ]} />
        {view === 'receber' && <OrderList paid={false} />}
        {view === 'pagos' && <OrderList paid />}
        {view === 'fechamento' && <DailyReport date={today()} />}
      </main>
    </>
  )
}

function OrderList({ paid }: { paid: boolean }) {
  const db = useDB()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const orders = db.orders
    .filter((o) => o.status !== 'cancelado')
    .filter((o) => (paid ? orderRemaining(db, o) === 0 && o.businessDate === today() : orderRemaining(db, o) > 0))
    .filter((o) => !q || identLabel(o).toLowerCase().includes(q.toLowerCase()) || String(o.number) === q.trim())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const sel = db.orders.find((o) => o.id === selected)

  return (
    <>
      <input placeholder="Buscar por mesa, nome ou nº do pedido" value={q} onChange={(e) => setQ(e.target.value)} />
      {orders.length === 0 && <div className="card empty">{paid ? 'Nenhum pedido pago hoje.' : 'Nenhum pedido aguardando pagamento. 👍'}</div>}
      <div className="stack">
        {orders.map((o) => (
          <button key={o.id} className={`card comanda ${o.status}`} style={{ display: 'block', textAlign: 'left', fontWeight: 400 }} onClick={() => setSelected(o.id)}>
            <div className="row between">
              <OrderIdent order={o} />
              <span className="money"><b>{brl(paid ? orderTotal(o) : orderRemaining(db, o))}</b></span>
            </div>
            <div className="row between small muted">
              <span>{o.businessDate !== today() ? `${businessDateBR(o.businessDate)} ` : ''}{hhmm(o.createdAt)} · {itemCount(o)} {itemCount(o) === 1 ? 'item' : 'itens'}</span>
              <span className="row" style={{ gap: 4 }}>
                <span className={`badge mode ${o.mode}`}>{modeLabel(o)}</span>
                <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
              </span>
            </div>
          </button>
        ))}
      </div>
      {sel && <OrderModal order={sel} onClose={() => setSelected(null)} />}
    </>
  )
}

const METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito', 'fiado']

function OrderModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const db = useDB()
  const total = orderTotal(o)
  const paid = orderPaid(db, o.id)
  const remaining = orderRemaining(db, o)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <Modal title={`${identLabel(o)} · pedido nº ${o.number}`} onClose={onClose}>
      <table className="list small">
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}>
              <td>{i.qty}× {i.name}{i.notes && <div className="muted">↳ {i.notes}</div>}</td>
              <td className="right money">{brl(i.qty * i.unitPrice)}</td>
            </tr>
          ))}
          <tr><td><b>Total</b></td><td className="right money"><b>{brl(total)}</b></td></tr>
          {orderPayments(db, o.id).map((p) => (
            <tr key={p.id} className="muted">
              <td>Pago · {METHOD_LABEL[p.method]}{p.method === 'fiado' && ` (${db.customers.find((c) => c.id === p.customerId)?.name ?? '?'})`}</td>
              <td className="right money">− {brl(p.amount)}</td>
            </tr>
          ))}
          {paid > 0 && <tr><td><b>Falta</b></td><td className="right money"><b>{brl(remaining)}</b></td></tr>}
        </tbody>
      </table>

      {remaining > 0 && <PaymentForm order={o} remaining={remaining} onDone={onClose} />}

      <div className="row">
        <button className="btn-sm" onClick={() => printReceipt(db, o)}>🖨️ Comprovante</button>
        {o.status === 'pronto' && (
          <button className="btn-sm" onClick={() => attempt(() => setOrderStatus(o.id, 'entregue'), 'Marcado como entregue')}>✓ Marcar entregue</button>
        )}
        {paid === 0 && !cancelling && <button className="btn-sm btn-danger" onClick={() => setCancelling(true)}>Cancelar pedido</button>}
      </div>
      {cancelling && (
        <div className="card flat stack">
          <label className="field">Motivo do cancelamento<input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
          <div className="row">
            <button onClick={() => setCancelling(false)}>Voltar</button>
            <button className="btn-danger" onClick={() => attempt(() => cancelOrder(o.id, reason), 'Pedido cancelado').then((ok) => ok && onClose())}>Confirmar cancelamento</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

interface Part { method: PaymentMethod; amount: string; cash: string; customerId: string }

function PaymentForm({ order: o, remaining, onDone }: { order: Order; remaining: number; onDone: () => void }) {
  const db = useDB()
  const [parts, setParts] = useState<Part[]>([{ method: 'pix', amount: centsToInput(remaining), cash: '', customerId: '' }])
  const [newCustomerFor, setNewCustomerFor] = useState<number | null>(null)
  const customers = useMemo(() => db.customers.filter((c) => !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [db.customers])

  const sum = parts.reduce((s, p) => s + parseBRL(p.amount), 0)
  const diff = remaining - sum
  const set = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  function confirm() {
    const input: PaymentInput[] = parts.map((p) => ({
      method: p.method,
      amount: parseBRL(p.amount),
      cashReceived: p.method === 'dinheiro' && p.cash ? parseBRL(p.cash) : null,
      customerId: p.method === 'fiado' ? p.customerId || null : null,
    }))
    void attempt(() => payOrder(o.id, input), 'Pagamento registrado').then((ok) => ok && onDone())
  }

  return (
    <div className="stack">
      {parts.map((p, i) => {
        const amount = parseBRL(p.amount)
        const change = p.method === 'dinheiro' && p.cash ? parseBRL(p.cash) - amount : 0
        return (
          <div key={i} className="card flat stack">
            <div className="tabs">
              {METHODS.map((m) => (
                <button key={m} className={p.method === m ? 'on' : ''} onClick={() => set(i, { method: m })}>{METHOD_LABEL[m]}</button>
              ))}
            </div>
            <div className="row">
              <label className="field grow">Valor (R$)
                <input inputMode="decimal" value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} />
              </label>
              {p.method === 'dinheiro' && (
                <label className="field grow">Cliente entregou (R$)
                  <input inputMode="decimal" placeholder="Para calcular o troco" value={p.cash} onChange={(e) => set(i, { cash: e.target.value })} />
                </label>
              )}
            </div>
            {p.method === 'dinheiro' && p.cash && (
              <div className={change < 0 ? 'error-text' : ''}><b>{change < 0 ? 'Falta: ' : 'Troco: '}</b><span className="money" style={{ fontSize: '1.3rem' }}>{brl(Math.abs(change))}</span></div>
            )}
            {p.method === 'fiado' && (
              <div className="stack">
                <div className="row">
                  <select className="grow" style={{ width: 'auto' }} value={p.customerId} onChange={(e) => set(i, { customerId: e.target.value })} aria-label="Cliente do fiado">
                    <option value="">Escolha o cliente…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => setNewCustomerFor(i)}>+ Novo</button>
                </div>
                {p.customerId && (() => {
                  const c = customers.find((x) => x.id === p.customerId)
                  const bal = customerBalance(db, p.customerId)
                  return <p className="small muted">Já deve: <b className="money">{brl(bal)}</b>{c?.creditLimit ? ` · limite ${brl(c.creditLimit)}` : ''}</p>
                })()}
              </div>
            )}
            {parts.length > 1 && <button className="btn-sm btn-ghost" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>Remover esta forma</button>}
          </div>
        )
      })}
      {diff > 0 && (
        <button onClick={() => setParts((ps) => [...ps, { method: 'dinheiro', amount: centsToInput(diff), cash: '', customerId: '' }])}>
          + Dividir: pagar os {brl(diff)} restantes de outra forma
        </button>
      )}
      {diff < 0 && <p className="error-text">A soma passa do valor em {brl(-diff)}.</p>}
      <button className="btn-ok btn-lg" disabled={sum <= 0 || diff < 0} onClick={confirm}>
        Confirmar {brl(sum)}{diff > 0 ? ` (fica faltando ${brl(diff)})` : ''}
      </button>
      {newCustomerFor !== null && (
        <CustomerForm onClose={() => setNewCustomerFor(null)} onSaved={(c) => set(newCustomerFor, { customerId: c.id })} />
      )}
    </div>
  )
}

function printReceipt(db: Database, o: Order): void {
  const est = db.establishment
  const rows = o.items.map((i) => `<div class="row"><span>${i.qty}× ${escapeHtml(i.name)}</span><span>${brl(i.qty * i.unitPrice)}</span></div>`).join('')
  const pays = orderPayments(db, o.id).map((p) => `<div class="row"><span>${METHOD_LABEL[p.method]}</span><span>${brl(p.amount)}</span></div>${p.cashReceived ? `<div class="row muted"><span>Recebido / troco</span><span>${brl(p.cashReceived)} / ${brl(p.cashReceived - p.amount)}</span></div>` : ''}`).join('')
  const remaining = orderRemaining(db, o)
  printHtml(`Pedido ${o.number}`, `
    <div style="text-align:center"><b style="font-size:1.2em">${escapeHtml(est.name)}</b>${est.address ? `<div class="muted">${escapeHtml(est.address)}</div>` : ''}</div><hr>
    <div class="row"><b>Pedido nº ${o.number}</b><span>${dateBR(o.createdAt)} ${hhmm(o.createdAt)}</span></div>
    <div>${escapeHtml(identLabel(o))} · ${o.mode === 'local' ? 'Comer aqui' : 'Para viagem'}</div><hr>
    ${rows}<hr><div class="row"><b>TOTAL</b><b>${brl(orderTotal(o))}</b></div>
    ${pays ? `<hr>${pays}` : ''}${remaining > 0 ? `<div class="row"><b>A PAGAR</b><b>${brl(remaining)}</b></div>` : ''}
    <hr><div style="text-align:center" class="muted">Não é documento fiscal · Obrigado!</div>`, { widthMm: 80 })
}

function itemCount(o: Order): number {
  return o.items.reduce((s, i) => s + i.qty, 0)
}
