import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Header } from '../components/Layout'
import { attempt, AuthPinField, Modal, OrderIdent, Segmented } from '../components/ui'
import { cancelOrder, payOrder, setOrderStatus } from '../data/api'
import { identLabel, modeLabel, openCashSession, openTables, orderPaid, orderPayments, orderRemaining, orderTotal } from '../data/selectors'
import { hasRole, useCurrentUser } from '../data/session'
import { useDB } from '../data/store'
import { businessDateBR, dateBR, hhmm, relativeAge, today } from '../lib/dates'
import { brl } from '../lib/money'
import { escapeHtml, printHtml } from '../lib/print'
import type { Database, Order } from '../types'
import { METHOD_LABEL, STATUS_LABEL } from '../types'
import { DailyReport } from './gerente/Relatorios'
import { CloseCashSheet, OpenCashSheet } from './caixa/CashSheets'
import { PaymentForm } from './caixa/PaymentForm'
import { TableBill } from './caixa/TableBill'

export default function Caixa() {
  const db = useDB()
  const user = useCurrentUser()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'receber' | 'mesas' | 'pagos' | 'fechamento'>(params.get('mesa') ? 'mesas' : 'receber')
  const [bill, setBill] = useState<string | null>(params.get('mesa'))
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)
  const session = openCashSession(db)
  const tables = openTables(db)
  const closeBill = () => { setBill(null); if (params.get('mesa')) setParams({}, { replace: true }) }
  return (
    <>
      <Header title="Caixa" right={<Link to="/fiado" className="btn btn-ghost btn-sm">📒<span className="header-label"> Fiado</span></Link>} />
      <main className="page">
        {db.cashEnabled === false ? null : session ? (
          <div className="row between hint ok" style={{ flexWrap: 'nowrap' }}>
            <span>Caixa aberto desde {hhmm(session.openedAt)} · troco {brl(session.openingCents)}</span>
            {hasRole(user, 'caixa') && <button className="btn-sm" onClick={() => setClosing(true)}>Fechar</button>}
          </div>
        ) : (
          <div className="card stack" style={{ background: 'var(--solid)', color: 'var(--on-solid)' }}>
            <div className="sign" style={{ fontSize: '1.5rem' }}>🔒 Caixa fechado</div>
            <p style={{ fontWeight: 700 }}>Abra o caixa com o troco da gaveta para conferir o dinheiro no fim do dia.</p>
            <button className="btn-primary" onClick={() => setOpening(true)}>Abrir o caixa</button>
          </div>
        )}
        <Segmented full value={view} onChange={setView} options={[
          { value: 'receber', label: 'Receber' },
          { value: 'mesas', label: `Mesas${tables.length ? ` (${tables.length})` : ''}` },
          { value: 'pagos', label: 'Pagos' },
          { value: 'fechamento', label: 'Fechamento' },
        ]} />
        {view === 'receber' && <OrderList paid={false} />}
        {view === 'mesas' && <TablesList onOpen={setBill} />}
        {view === 'pagos' && <OrderList paid />}
        {view === 'fechamento' && (
          <>
            {session && hasRole(user, 'caixa') && <button className="btn-ok btn-lg btn-block" onClick={() => setClosing(true)}>Fechar o caixa</button>}
            <DailyReport date={today()} />
          </>
        )}
      </main>
      {bill && <TableBill table={bill} onClose={closeBill} />}
      {opening && <OpenCashSheet onClose={() => setOpening(false)} />}
      {closing && <CloseCashSheet onClose={() => setClosing(false)} />}
    </>
  )
}

/** Mesas com conta aberta: toque para juntar os pedidos, dividir e receber. */
function TablesList({ onOpen }: { onOpen: (table: string) => void }) {
  const db = useDB()
  const tables = openTables(db)
  return (
    <>
      {tables.length === 0 && <div className="card empty">Nenhuma mesa com conta aberta. 👍</div>}
      <div className="stack">
        {tables.map((t) => (
          <button key={t.table} className="card" style={{ display: 'block', textAlign: 'left', fontWeight: 500 }} onClick={() => onOpen(t.table)}>
            <div className="row between" style={{ flexWrap: 'nowrap' }}>
              <div>
                <div className="ident-name">Mesa {t.table}</div>
                <div className="small muted" style={{ fontWeight: 700 }}>{t.orders.length} {t.orders.length === 1 ? 'pedido' : 'pedidos'} · {relativeAge(t.since)}</div>
              </div>
              <strong className="money" style={{ fontSize: '1.7rem' }}>{brl(t.remaining)}</strong>
            </div>
          </button>
        ))}
      </div>
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

function OrderModal({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const db = useDB()
  const total = orderTotal(o)
  const paid = orderPaid(db, o.id)
  const remaining = orderRemaining(db, o)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const staffName = (id: string | null) => db.users.find((u) => u.id === id)?.name ?? '?'

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
              <td>
                Pago · {METHOD_LABEL[p.method]}
                {p.method === 'fiado' && ` (${db.customers.find((c) => c.id === p.customerId)?.name ?? '?'})`}
                {p.method === 'cortesia' && ` (autorizada por ${staffName(p.authorizedBy)})`}
              </td>
              <td className="right money">− {brl(p.amount)}</td>
            </tr>
          ))}
          {paid > 0 && <tr><td><b>Falta</b></td><td className="right money"><b>{brl(remaining)}</b></td></tr>}
        </tbody>
      </table>

      {remaining > 0 && <PaymentForm remaining={remaining} submit={(input, pin) => payOrder(o.id, input, pin)} onDone={onClose} />}

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
          <AuthPinField label="PIN de um gerente para autorizar" value={managerPin} onChange={setManagerPin} />
          <div className="row">
            <button onClick={() => { setCancelling(false); setManagerPin('') }}>Voltar</button>
            <button
              className="btn-danger"
              onClick={() => attempt(() => cancelOrder(o.id, reason, managerPin), 'Pedido cancelado').then((ok) => (ok ? onClose() : setManagerPin('')))}
            >
              Confirmar cancelamento
            </button>
          </div>
        </div>
      )}
    </Modal>
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
