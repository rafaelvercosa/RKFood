import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PriorityButton } from '../components/Priority'
import { Header } from '../components/Layout'
import { attempt, Modal, OrderIdent, Photo, Segmented, toastUndo, useNow } from '../components/ui'
import { createOrder, setOrderStatus } from '../data/api'
import { identLabel, isKitchenLate, isOrderPaid, modeLabel, openTables, orderTotal } from '../data/selectors'
import { hasRole, useCurrentUser } from '../data/session'
import { useDB } from '../data/store'
import { alarm } from '../lib/beep'
import { hhmm, minutesSince, today } from '../lib/dates'
import { DEFAULT_QUICK_NOTES, splitNotes, toggleNote } from '../lib/quickNotes'
import { brl } from '../lib/money'
import { relativeAge } from '../lib/dates'
import type { IdentType, Order, Product, ServiceMode } from '../types'
import { STATUS_LABEL } from '../types'

interface CartLine {
  key: string
  product: Product
  qty: number
  notes: string
}

type Tab = 'novo' | 'pedidos' | 'mesas'

/** Mesa ou nome já escolhido (vindo de "Adicionar itens" numa mesa aberta). */
interface Preset { identType: IdentType; identValue: string; mode: ServiceMode }

export default function Atendente() {
  const [params, setParams] = useSearchParams()
  const initial = params.get('aba')
  const [view, setView] = useState<Tab>(initial === 'pedidos' || initial === 'mesas' ? initial : 'novo')
  const [preset, setPreset] = useState<Preset | null>(null)
  const { readyCount, alert, dismiss } = useReadyWatcher()
  const db = useDB()
  const tables = openTables(db).length
  const go = (v: Tab) => { setView(v); if (params.get('aba')) setParams({}, { replace: true }) }
  return (
    <>
      {alert.length > 0 && (
        <ReadyAlert orders={alert} onClose={dismiss} onShow={() => { dismiss(); go('pedidos') }} />
      )}
      <Header title="Atendimento" />
      <div className="page" style={{ paddingBottom: 0 }}>
        <Segmented
          full
          value={view}
          onChange={go}
          options={[
            { value: 'novo', label: 'Novo' },
            { value: 'pedidos', label: `Pedidos${readyCount ? ` (${readyCount})` : ''}` },
            { value: 'mesas', label: `Mesas${tables ? ` (${tables})` : ''}` },
          ]}
        />
      </div>
      {view === 'novo' && <NewOrder preset={preset} onUsedPreset={() => setPreset(null)} onSent={() => go('pedidos')} />}
      {view === 'pedidos' && <OrdersToday />}
      {view === 'mesas' && <OpenTables onAdd={(p) => { setPreset(p); go('novo') }} />}
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


function NewOrder({ preset, onUsedPreset, onSent }: { preset: Preset | null; onUsedPreset: () => void; onSent: () => void }) {
  const db = useDB()
  const categories = useMemo(() => db.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sort - b.sort), [db.categories])
  const products = db.products.filter((p) => !p.deletedAt && p.active)
  const quick = db.establishment.quickNotes.length ? db.establishment.quickNotes : DEFAULT_QUICK_NOTES
  const [step, setStep] = useState<1 | 2>(preset ? 2 : 1)
  const [catId, setCatId] = useState<string>('todos')
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [identType, setIdentType] = useState<IdentType>(preset?.identType ?? 'mesa')
  const [identValue, setIdentValue] = useState(preset?.identValue ?? '')
  const [mode, setMode] = useState<ServiceMode>(preset?.mode ?? 'local')
  const [other, setOther] = useState(false)
  const [notes, setNotes] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => { if (preset) onUsedPreset() }, [preset, onUsedPreset])
  // botões das mesas (o gerente escolhe quantas); as primeiras 10 aparecem, as demais pelo "Outra"
  const tableCount = db.establishment.tableCount
  const mesas = useMemo(() => Array.from({ length: Math.min(tableCount, 10) }, (_, i) => String(i + 1)), [tableCount])
  const showOther = other || tableCount === 0 || tableCount > 10 || (identValue !== '' && !mesas.includes(identValue))

  const visible = products
    .filter((p) => catId === 'todos' || p.categoryId === catId)
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
  const qtyOf = (id: string) => cart.filter((l) => l.product.id === id).reduce((s, l) => s + l.qty, 0)
  const total = cart.reduce((s, l) => s + l.qty * l.product.price, 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)
  const who = identType === 'mesa' ? `Mesa ${identValue}` : identValue
  const ready = identValue.trim() !== ''

  function add(p: Product) {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id && !l.notes)
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { key: crypto.randomUUID(), product: p, qty: 1, notes: '' }]
    })
  }
  /** Tira um da quantidade do item (no cardápio). */
  function remove(p: Product) {
    setCart((c) => {
      const i = [...c].reverse().findIndex((l) => l.product.id === p.id)
      if (i < 0) return c
      const idx = c.length - 1 - i
      return c.map((l, j) => (j === idx ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0)
    })
  }
  const update = (key: string, patch: Partial<CartLine>) => {
    const line = cart.find((l) => l.key === key)
    setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.qty > 0))
    // item tirado do pedido: dá 8 segundos para desfazer
    if (line && patch.qty !== undefined && patch.qty <= 0) {
      toastUndo(`${line.product.name} tirado do pedido`, () => setCart((c) => (c.some((l) => l.key === key) ? c : [...c, line])))
    }
  }

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
      setCart([]); setNotes(''); setIdentValue(''); setReviewing(false); setStep(1); setOther(false)
      onSent()
    }
  }

  if (step === 1) {
    return (
      <main className="page">
        <div className="card stack">
          <div className="row between">
            <h2>Para quem é o pedido?</h2>
            <span className="steps-dots" aria-label="Passo 1 de 2"><i className="on" /><i /></span>
          </div>
          <Segmented full value={identType} onChange={(v) => { setIdentType(v); setIdentValue(''); setOther(false) }} options={[{ value: 'mesa', label: 'Mesa' }, { value: 'nome', label: 'Nome' }]} />
          {identType === 'mesa' && mesas.length > 0 && (
            <div className="table-circles" role="group" aria-label="Escolher mesa">
              {mesas.map((n) => (
                <button key={n} type="button" className={identValue === n ? 'on' : ''} aria-pressed={identValue === n} onClick={() => { setIdentValue(n); setOther(false) }}>{n}</button>
              ))}
              {tableCount <= 10 && tableCount > 0 && (
                <button type="button" className={showOther ? 'on' : ''} aria-pressed={showOther} style={{ fontSize: '0.9rem' }} onClick={() => { setOther(true); setIdentValue('') }}>Outra</button>
              )}
            </div>
          )}
          {(identType === 'nome' || showOther) && (
            <input
              inputMode={identType === 'mesa' ? 'numeric' : 'text'}
              placeholder={identType === 'mesa' ? 'Nº ou nome da mesa' : 'Nome do cliente'}
              value={identValue}
              onChange={(e) => setIdentValue(e.target.value)}
              aria-label={identType === 'mesa' ? 'Número da mesa' : 'Nome do cliente'}
              autoFocus
            />
          )}
          <Segmented full value={mode} onChange={setMode} options={[{ value: 'local', label: '🍽️ Comer aqui' }, { value: 'viagem', label: '🛍️ Para viagem' }]} />
          <button className="btn-primary btn-lg btn-block" disabled={!ready} onClick={() => setStep(2)}>Continuar</button>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="page">
        <div className="ident-pill">
          <span className="circle" aria-hidden>{identType === 'mesa' ? identValue.slice(0, 3) : identValue.slice(0, 1).toUpperCase()}</span>
          <span className="grow"><b>{who}</b> <span className="muted small">· {mode === 'local' ? 'Comer aqui' : 'Para viagem'}</span></span>
          <button className="btn-sm" onClick={() => setStep(1)}>Alterar</button>
        </div>

        <nav className="tabs" aria-label="Categorias">
          <button className="icon-btn" aria-label="Buscar item" aria-pressed={searching} onClick={() => { setSearching((v) => !v); setQ('') }}>🔍</button>
          <button className={catId === 'todos' ? 'on' : ''} onClick={() => setCatId('todos')}>Todos</button>
          {categories.map((c) => (
            <button key={c.id} className={catId === c.id ? 'on' : ''} onClick={() => setCatId(c.id)}>{c.name}</button>
          ))}
        </nav>
        {searching && <input type="search" placeholder="Buscar item do cardápio" aria-label="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}

        {visible.length === 0 ? (
          <div className="card empty">{products.length === 0 ? 'Nenhum item no cardápio. Peça ao gerente para cadastrar.' : 'Nenhum item encontrado.'}</div>
        ) : (
          <div className="menu-grid">
            {visible.map((p) => {
              const n = qtyOf(p.id)
              return (
                <div key={p.id} className={`menu-item card ${n > 0 ? 'in-cart' : ''}`}>
                  <button type="button" className="menu-main" onClick={() => add(p)} aria-label={`Adicionar ${p.name}, ${brl(p.price)}`}>
                    <Photo src={p.photoUrl} name={p.name} />
                    <span className="info" style={{ display: "grid" }}>
                      <strong>{p.name}</strong>
                      <span className="money muted">{brl(p.price)}</span>
                    </span>
                  </button>
                  {n === 0 ? (
                    <span className="add" aria-hidden>+</span>
                  ) : (
                    <span className="stepper">
                      <button type="button" aria-label={`Tirar um ${p.name}`} onClick={() => remove(p)}>−</button>
                      <b>{n}</b>
                      <button type="button" aria-label={`Mais um ${p.name}`} onClick={() => add(p)}>+</button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {count > 0 && (
        <div className="cart-bar">
          <div className="cart-pill">
            <div className="grow">
              <div className="small">{count} {count === 1 ? 'item' : 'itens'} · {who}</div>
              <strong className="money">{brl(total)}</strong>
            </div>
            <button className="btn-primary btn-lg" onClick={() => setReviewing(true)}>Revisar →</button>
          </div>
        </div>
      )}

      {reviewing && (
        <Modal title={`Revisar · ${who}`} onClose={() => setReviewing(false)}>
          <div>
            {cart.map((l) => (
              <CartLineRow key={l.key} line={l} quick={quick} onChange={(patch) => update(l.key, patch)} />
            ))}
          </div>
          <label className="field">Observação geral
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </label>
          <div className="row between">
            <span className="muted">{mode === 'local' ? 'Comer aqui' : 'Para viagem'}</span>
            <strong className="money" style={{ fontSize: '1.3rem' }}>{brl(total)}</strong>
          </div>
          <button className="btn-primary btn-lg btn-block" onClick={send}>Enviar pedido</button>
          <p className="muted small center">{db.establishment.paymentTiming === 'antes' ? 'O pedido vai para a cozinha depois de pago no caixa.' : 'Vai direto para a cozinha.'}</p>
        </Modal>
      )}
    </>
  )
}

/** Linha do pedido na revisão: quantidade, observações rápidas em botões e uma observação livre. */
function CartLineRow({ line: l, quick, onChange }: { line: CartLine; quick: string[]; onChange: (patch: Partial<CartLine>) => void }) {
  const chosen = splitNotes(l.notes)
  const custom = chosen.filter((n) => !quick.some((qn) => qn.toLowerCase() === n.toLowerCase()))
  const [free, setFree] = useState(custom.join(', '))
  const [showFree, setShowFree] = useState(custom.length > 0)
  const setFreeText = (text: string) => {
    setFree(text)
    const base = chosen.filter((n) => quick.some((qn) => qn.toLowerCase() === n.toLowerCase()))
    onChange({ notes: [...base, ...splitNotes(text)].join(', ') })
  }
  return (
    <div className="cart-line">
      <div>
        <strong>{l.product.name}</strong>
        <div className="muted small money">{brl(l.product.price)} cada</div>
      </div>
      <div className="qty">
        <button onClick={() => onChange({ qty: l.qty - 1 })} aria-label="Diminuir">−</button>
        <span>{l.qty}</span>
        <button onClick={() => onChange({ qty: l.qty + 1 })} aria-label="Aumentar">+</button>
      </div>
      <div className="note-chips">
        {quick.map((n) => {
          const on = chosen.some((c) => c.toLowerCase() === n.toLowerCase())
          return <button key={n} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => onChange({ notes: toggleNote(l.notes, n) })}>{on ? '✓ ' : ''}{n}</button>
        })}
        <button type="button" className={showFree ? 'on' : ''} aria-pressed={showFree} onClick={() => setShowFree((v) => !v)}>✎ Outra</button>
      </div>
      {showFree && (
        <input style={{ gridColumn: '1 / -1', minHeight: 44 }} placeholder="Outra observação (ex.: sem farofa)" aria-label={`Outra observação para ${l.product.name}`} value={free} onChange={(e) => setFreeText(e.target.value)} autoFocus />
      )}
    </div>
  )
}

/** Mesas com conta aberta: total, tempo, adicionar itens e fechar a conta no caixa. */
function OpenTables({ onAdd }: { onAdd: (p: Preset) => void }) {
  const db = useDB()
  const user = useCurrentUser()
  const now = useNow()
  const tables = openTables(db)
  const mesas = Array.from({ length: db.establishment.tableCount }, (_, i) => String(i + 1))
  const busy = new Set(tables.map((t) => t.table.toLowerCase()))
  const free = mesas.filter((m) => !busy.has(m))
  const [showFree, setShowFree] = useState(false)
  return (
    <main className="page">
      <Segmented value={showFree ? 'livres' : 'abertas'} onChange={(v) => setShowFree(v === 'livres')} options={[
        { value: 'abertas', label: `Abertas (${tables.length})` },
        { value: 'livres', label: `Livres (${free.length})` },
      ]} />
      {!showFree && tables.length === 0 && <div className="card empty">Nenhuma mesa com conta aberta.</div>}
      {!showFree && tables.map((t) => (
        <section key={t.table} className="card stack">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="ident-pill" style={{ padding: 0, boxShadow: 'none', background: 'none' }}><span className="circle" aria-hidden>{t.table.slice(0, 3)}</span></span>
            <div className="grow">
              <div className="ident-name">Mesa {t.table}</div>
              <div className="small muted" style={{ fontWeight: 700 }}>{t.orders.length} {t.orders.length === 1 ? 'pedido' : 'pedidos'} · aberta há {relativeAge(t.since, now)}</div>
            </div>
            <strong className="money" style={{ fontSize: '1.6rem' }}>{brl(t.remaining)}</strong>
          </div>
          <div className="stack" style={{ gap: 6, padding: '8px 12px', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
            {t.orders.map((o) => (
              <div key={o.id} className="row between" style={{ flexWrap: 'nowrap' }}>
                <span className="small" style={{ fontWeight: 700 }}>nº {o.number} · {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span>
                <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn-primary grow" onClick={() => onAdd({ identType: 'mesa', identValue: t.table, mode: t.orders[0].mode })}>+ Adicionar itens</button>
            {hasRole(user, 'caixa') && <Link to={`/caixa?mesa=${encodeURIComponent(t.table)}`} className="btn grow" style={{ background: 'var(--solid)', color: 'var(--on-solid)' }}>Fechar conta</Link>}
          </div>
        </section>
      ))}
      {showFree && (
        <div className="table-circles">
          {free.map((m) => <button key={m} onClick={() => onAdd({ identType: 'mesa', identValue: m, mode: 'local' })} aria-label={`Abrir mesa ${m}`}>{m}</button>)}
          {free.length === 0 && <div className="card empty" style={{ gridColumn: '1 / -1' }}>Todas as mesas estão com conta aberta.</div>}
        </div>
      )}
    </main>
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
