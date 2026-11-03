import { useEffect, useMemo, useRef, useState } from 'react'
import { PriorityButton } from '../components/Priority'
import { Header } from '../components/Layout'
import { attempt, Modal, OrderIdent, Photo, Segmented, useNow } from '../components/ui'
import { createOrder, setOrderStatus } from '../data/api'
import { identLabel, isKitchenLate, isOrderPaid, modeLabel, orderTotal } from '../data/selectors'
import { useDB } from '../data/store'
import { alarm } from '../lib/beep'
import { hhmm, minutesSince, today } from '../lib/dates'
import { brl } from '../lib/money'
import type { IdentType, Order, Product, ServiceMode } from '../types'
import { STATUS_LABEL } from '../types'

interface CartLine {
  key: string
  product: Product
  qty: number
  notes: string
}

export default function Atendente() {
  const [view, setView] = useState<'novo' | 'pedidos'>('novo')
  const { readyCount, alert, dismiss } = useReadyWatcher()
  return (
    <>
      {alert.length > 0 && (
        <ReadyAlert orders={alert} onClose={dismiss} onShow={() => { dismiss(); setView('pedidos') }} />
      )}
      <Header title="Atendimento" />
      <div className="page" style={{ paddingBottom: 0 }}>
        <Segmented
          full
          value={view}
          onChange={setView}
          options={[
            { value: 'novo', label: 'Novo pedido' },
            { value: 'pedidos', label: `Pedidos do dia${readyCount ? ` (${readyCount} pronto${readyCount > 1 ? 's' : ''})` : ''}` },
          ]}
        />
      </div>
      {view === 'novo' ? <NewOrder onSent={() => setView('pedidos')} /> : <OrdersToday />}
    </>
  )
}

const ALARM_EVERY_MS = 8000
const ALARM_TIMES = 4

/**
 * Quando um pedido fica pronto: aviso de tela cheia e alarme que repete (até 4 vezes)
 * enquanto ninguém tocar em "Entendi". Devolve também quantos estão prontos para entregar.
 */
function useReadyWatcher(): { readyCount: number; alert: Order[]; dismiss: () => void } {
  const db = useDB()
  const ready = db.orders.filter((o) => o.businessDate === today() && o.status === 'pronto')
  const seen = useRef<Set<string> | null>(null)
  const [alert, setAlert] = useState<Order[]>([])
  useEffect(() => {
    const ids = new Set(ready.map((o) => o.id))
    if (seen.current) {
      const fresh = ready.filter((o) => !seen.current!.has(o.id))
      if (fresh.length) setAlert((a) => [...a, ...fresh.filter((f) => !a.some((x) => x.id === f.id))])
    }
    seen.current = ids
  }, [ready])

  // pedido entregue por outro aparelho sai do aviso sozinho
  const stillReady = alert.filter((o) => ready.some((r) => r.id === o.id))

  // alarme: toca na hora e repete enquanto o aviso estiver na tela
  const alerting = stillReady.length > 0
  useEffect(() => {
    if (!alerting) return
    alarm()
    let times = 1
    const t = setInterval(() => {
      if (++times > ALARM_TIMES) return clearInterval(t)
      alarm()
    }, ALARM_EVERY_MS)
    return () => clearInterval(t)
  }, [alerting, stillReady.length])

  return { readyCount: ready.length, alert: stillReady, dismiss: () => setAlert([]) }
}

/** Aviso de tela cheia, com letra grande, para ver de longe e na correria. */
function ReadyAlert({ orders, onClose, onShow }: { orders: Order[]; onClose: () => void; onShow: () => void }) {
  return (
    <div className="ready-alert" role="alertdialog" aria-modal="true" aria-labelledby="ready-alert-title">
      <div className="ready-alert-box">
        <div id="ready-alert-title" className="ready-alert-title">🔔 Pronto!</div>
        <ul>
          {orders.map((o) => (
            <li key={o.id}>
              <span className="ready-alert-name">{identLabel(o)}</span>
              <span className="ready-alert-meta">pedido nº {o.number} · {modeLabel(o)}</span>
            </li>
          ))}
        </ul>
        <p>{orders.length === 1 ? 'Pode buscar na cozinha e levar para o cliente.' : 'Pode buscar na cozinha e levar para os clientes.'}</p>
        <div className="ready-alert-actions">
          <button className="btn-lg" onClick={onShow}>Ver pedidos</button>
          <button className="btn-lg btn-ok" onClick={onClose} autoFocus>Entendi</button>
        </div>
      </div>
    </div>
  )
}


function NewOrder({ onSent }: { onSent: () => void }) {
  const db = useDB()
  const categories = useMemo(() => db.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sort - b.sort), [db.categories])
  const products = db.products.filter((p) => !p.deletedAt && p.active)
  const [catId, setCatId] = useState<string>('todos')
  const [identType, setIdentType] = useState<IdentType>('mesa')
  const [identValue, setIdentValue] = useState('')
  const [mode, setMode] = useState<ServiceMode>('local')
  const [notes, setNotes] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [reviewing, setReviewing] = useState(false)
  // botões das mesas 1..N (o gerente escolhe N); mesa fora disso continua pelo campo de texto
  const tableCount = db.establishment.tableCount
  const mesas = useMemo(() => Array.from({ length: tableCount }, (_, i) => String(i + 1)), [tableCount])

  const visible = products.filter((p) => catId === 'todos' || p.categoryId === catId)
  const qtyOf = (id: string) => cart.filter((l) => l.product.id === id).reduce((s, l) => s + l.qty, 0)
  const total = cart.reduce((s, l) => s + l.qty * l.product.price, 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)

  function add(p: Product) {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id && !l.notes)
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { key: crypto.randomUUID(), product: p, qty: 1, notes: '' }]
    })
  }
  const update = (key: string, patch: Partial<CartLine>) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.qty > 0))

  async function send() {
    const ok = await attempt(() =>
      createOrder({
        identType, identValue, mode, notes,
        items: cart.map((l) => ({
          productId: l.product.id, name: l.product.name, unitPrice: l.product.price,
          qty: l.qty, notes: l.notes.trim(), sendToKitchen: l.product.sendToKitchen,
        })),
      }), db.establishment.paymentTiming === 'antes' ? 'Pedido registrado. Aguardando pagamento no caixa.' : 'Pedido enviado para a cozinha!')
    if (ok) {
      setCart([]); setNotes(''); setIdentValue(''); setReviewing(false)
      onSent()
    }
  }

  return (
    <>
      <main className="page">
        <div className="card stack">
          <div className="row">
            <Segmented value={identType} onChange={setIdentType} options={[{ value: 'mesa', label: 'Mesa' }, { value: 'nome', label: 'Nome' }]} />
            <input
              className="grow"
              style={{ width: 'auto' }}
              inputMode={identType === 'mesa' ? 'numeric' : 'text'}
              placeholder={identType === 'mesa' ? 'Nº da mesa' : 'Nome do cliente'}
              value={identValue}
              onChange={(e) => setIdentValue(e.target.value)}
              aria-label={identType === 'mesa' ? 'Número da mesa' : 'Nome do cliente'}
            />
          </div>
          {identType === 'mesa' && mesas.length > 0 && (
            <div className="table-grid" role="group" aria-label="Escolher mesa">
              {mesas.map((n) => (
                <button key={n} type="button" className={identValue === n ? 'on' : ''} aria-pressed={identValue === n} onClick={() => setIdentValue(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}
          <Segmented full value={mode} onChange={setMode} options={[{ value: 'local', label: '🍽️ Comer aqui' }, { value: 'viagem', label: '🛍️ Para viagem' }]} />
        </div>

        <nav className="tabs" aria-label="Categorias">
          <button className={catId === 'todos' ? 'on' : ''} onClick={() => setCatId('todos')}>Todos</button>
          {categories.map((c) => (
            <button key={c.id} className={catId === c.id ? 'on' : ''} onClick={() => setCatId(c.id)}>{c.name}</button>
          ))}
        </nav>

        {visible.length === 0 ? (
          <div className="card empty">Nenhum item no cardápio. Peça ao gerente para cadastrar.</div>
        ) : (
          <div className="menu-grid">
            {visible.map((p) => (
              <button key={p.id} className="menu-item card" onClick={() => add(p)}>
                <Photo src={p.photoUrl} name={p.name} />
                <div className="info">
                  <strong>{p.name}</strong>
                  <span className="money muted">{brl(p.price)}</span>
                </div>
                {qtyOf(p.id) > 0 && <span className="qty-badge">{qtyOf(p.id)}</span>}
              </button>
            ))}
          </div>
        )}
      </main>

      {count > 0 && (
        <div className="cart-bar">
          <div className="row" style={{ maxWidth: 1200, margin: '0 auto' }}>
            <div className="grow">
              <div className="small muted">{count} {count === 1 ? 'item' : 'itens'}</div>
              <strong className="money">{brl(total)}</strong>
            </div>
            <button className="btn-primary btn-lg" onClick={() => setReviewing(true)}>Revisar e enviar</button>
          </div>
        </div>
      )}

      {reviewing && (
        <Modal title={`Pedido — ${identValue ? (identType === 'mesa' ? `Mesa ${identValue}` : identValue) : 'sem identificação'}`} onClose={() => setReviewing(false)}>
          <div>
            {cart.map((l) => (
              <div key={l.key} className="cart-line">
                <div>
                  <strong>{l.product.name}</strong>
                  <div className="muted small money">{brl(l.product.price)} cada</div>
                </div>
                <div className="qty">
                  <button onClick={() => update(l.key, { qty: l.qty - 1 })} aria-label="Diminuir">−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => update(l.key, { qty: l.qty + 1 })} aria-label="Aumentar">+</button>
                </div>
                <input
                  style={{ gridColumn: '1 / -1', minHeight: 38 }}
                  placeholder="Observação (ex.: sem cebola, bem passado)"
                  value={l.notes}
                  onChange={(e) => update(l.key, { notes: e.target.value })}
                />
              </div>
            ))}
          </div>
          <label className="field">Observação geral
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </label>
          <div className="row between">
            <span className="muted">{mode === 'local' ? 'Comer aqui' : 'Para viagem'}</span>
            <strong className="money" style={{ fontSize: '1.3rem' }}>{brl(total)}</strong>
          </div>
          {!identValue.trim() && <p className="error-text">Informe {identType === 'mesa' ? 'a mesa' : 'o nome do cliente'} antes de enviar.</p>}
          <button className="btn-primary btn-lg btn-block" disabled={!identValue.trim()} onClick={send}>Enviar pedido</button>
        </Modal>
      )}
    </>
  )
}

function OrdersToday() {
  const db = useDB()
  const now = useNow()
  const [filter, setFilter] = useState<'abertos' | 'todos'>('abertos')
  const orders = db.orders
    .filter((o) => o.businessDate === today())
    .filter((o) => filter === 'todos' || !['entregue', 'cancelado'].includes(o.status))
    .sort((a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt))

  return (
    <main className="page">
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'abertos', label: 'Em aberto' }, { value: 'todos', label: 'Todos de hoje' }]} />
      {orders.length === 0 && <div className="card empty">Nenhum pedido {filter === 'abertos' ? 'em aberto' : 'hoje'}.</div>}
      <div className="stack">
        {orders.map((o) => (
          <div key={o.id} className={`card comanda stack ${o.status}`}>
            <div className="row between">
              <div>
                <OrderIdent order={o} />
                <div className="muted small">{hhmm(o.createdAt)} · há {minutesSince(o.createdAt, now)} min</div>
              </div>
              <div className="stack" style={{ justifyItems: 'end', gap: 4 }}>
                <span className={`badge mode ${o.mode}`}>{modeLabel(o)}</span>
                <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                {o.priorityAt && (o.status === 'novo' || o.status === 'preparo') && <span className="badge prioridade" title={o.priorityReason ?? ''}>⬆ Prioridade</span>}
                {isKitchenLate(o, db.establishment.kitchenTargetMin, now) && <span className="badge atrasado">Atrasado</span>}
                {o.status !== 'cancelado' && <PaidBadge order={o} />}
              </div>
            </div>
            <div className="small">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
            <div className="row between">
              <span className="money"><b>{brl(orderTotal(o))}</b></span>
              <PriorityButton order={o} />
              {o.status === 'pronto' && (
                <button className="btn-ok" onClick={() => attempt(() => setOrderStatus(o.id, 'entregue'), 'Marcado como entregue')}>
                  ✓ Entregue
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

function PaidBadge({ order: o }: { order: Order }) {
  const db = useDB()
  return isOrderPaid(db, o) ? <span className="badge pago">Pago</span> : <span className="badge devendo">A pagar</span>
}

/** Ordem de exibição: prontos primeiro (precisam ser entregues). */
function order(o: Order): number {
  return { pronto: 0, aguardando_pagamento: 1, novo: 2, preparo: 2, entregue: 3, cancelado: 4 }[o.status]
}
