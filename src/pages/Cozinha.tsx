import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Layout'
import { PriorityButton } from '../components/Priority'
import { attempt, AuthPinField, Modal, OrderIdent, Segmented, useNow } from '../components/ui'
import { cancelOrder, setOrderStatus } from '../data/api'
import { compareKitchenQueue, identLabel, isKitchenLate, KITCHEN_STATUSES, kitchenReadyAt, kitchenSeconds, kitchenSentAt, modeLabel, needsKitchen } from '../data/selectors'
import { useDB } from '../data/store'
import { beep } from '../lib/beep'
import { hhmm } from '../lib/dates'
import { escapeHtml, printHtml } from '../lib/print'
import type { Establishment, Order } from '../types'

// Preferências deste aparelho (cada tablet/TV da cozinha pode ser diferente).
interface KitchenPrefs {
  tv: boolean
  sound: boolean
  autoPrint: boolean
  paperMm: 58 | 80
}
const PREFS_KEY = 'rkfood:cozinha'
const DEFAULT_PREFS: KitchenPrefs = { tv: false, sound: true, autoPrint: false, paperMm: 80 }

function loadPrefs(): KitchenPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

export default function Cozinha() {
  const db = useDB()
  const now = useNow(1000)
  const targetMin = db.establishment.kitchenTargetMin
  const [prefs, setPrefsState] = useState<KitchenPrefs>(loadPrefs)
  const [showSettings, setShowSettings] = useState(false)
  const [filter, setFilter] = useState<'fila' | 'prontos'>('fila')
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const setPrefs = (p: Partial<KitchenPrefs>) => {
    const next = { ...prefs, ...p }
    setPrefsState(next)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* ignora */ }
  }

  const active = db.orders
    .filter((o) => KITCHEN_STATUSES.includes(o.status) && needsKitchen(o))
    .sort(compareKitchenQueue)
  // fila: adiantados pelo gerente primeiro, depois na ordem em que chegou na cozinha; prontos do mais recente para o mais antigo
  const queue = active.filter((o) => o.status !== 'pronto')
  const ready = active.filter((o) => o.status === 'pronto').sort((a, b) => (kitchenReadyAt(b) ?? '').localeCompare(kitchenReadyAt(a) ?? ''))
  const late = queue.filter((o) => isKitchenLate(o, targetMin, now))

  useNewOrderAlert(queue, prefs, db.establishment)
  useLateAlert(late, prefs)

  const shown = filter === 'fila' ? queue : ready

  return (
    <div className={prefs.tv ? 'tv' : ''}>
      <Header
        title={`Cozinha · ${queue.length} na fila`}
        right={<button className="btn-ghost btn-sm" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings} aria-label="Ajustes">⚙︎<span className="header-label"> Ajustes</span></button>}
      />
      <main className="page" style={{ maxWidth: prefs.tv ? 'none' : undefined }}>
        {showSettings && (
          <div className="card stack">
            <h3>Ajustes deste aparelho</h3>
            <label className="check"><input type="checkbox" checked={prefs.tv} onChange={(e) => setPrefs({ tv: e.target.checked })} /> Modo TV (fundo escuro, letras grandes)</label>
            <label className="check"><input type="checkbox" checked={prefs.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} /> Aviso sonoro de pedido novo</label>
            <label className="check"><input type="checkbox" checked={prefs.autoPrint} onChange={(e) => setPrefs({ autoPrint: e.target.checked })} /> Imprimir comanda automaticamente</label>
            <div className="row">
              <span>Papel da impressora:</span>
              <Segmented value={String(prefs.paperMm) as '58' | '80'} onChange={(v) => setPrefs({ paperMm: Number(v) as 58 | 80 })} options={[{ value: '58', label: '58 mm' }, { value: '80', label: '80 mm' }]} />
            </div>
            <p className="muted small">Tempo estimado de preparo: <b>{targetMin} min</b>. Quem muda é o gerente, em Gerência → Estabelecimento.</p>
            <p className="muted small">Dica: para o som e a impressão automática funcionarem, toque uma vez na tela depois de abrir. Em TV, use o navegador em tela cheia.</p>
            <button onClick={() => document.documentElement.requestFullscreen?.()}>Tela cheia</button>
          </div>
        )}

        {late.length > 0 && (
          <div className="late-banner" role="alert">
            ⚠ {late.length === 1 ? '1 pedido atrasado' : `${late.length} pedidos atrasados`}: {late.map((o) => identLabel(o)).join(', ')}
          </div>
        )}

        <Segmented value={filter} onChange={setFilter} options={[{ value: 'fila', label: `Fila (${queue.length})` }, { value: 'prontos', label: `Prontos (${ready.length})` }]} />

        {shown.length === 0 ? (
          <div className="card empty">{filter === 'fila' ? 'Nenhum pedido na fila. 🔥' : 'Nenhum pedido aguardando entrega.'}</div>
        ) : (
          <div className="kds">
            {shown.map((o, idx) => {
              const isLate = isKitchenLate(o, targetMin, now)
              return (
                <article key={o.id} className={`card comanda ticket ${o.status} ${isLate ? 'late' : ''} ${o.priorityAt ? 'priority' : ''}`}>
                  {o.priorityAt && (
                    <div className="priority-flag">⬆ Prioridade<span>{o.priorityReason}</span></div>
                  )}
                  <div className="row between">
                    <OrderIdent order={o} />
                    <span className="row" style={{ gap: 6 }}>
                      {filter === 'fila' && <span className="queue-pos" title="Posição na fila">{idx + 1}º</span>}
                      <span className={`badge mode ${o.mode}`}>{modeLabel(o)}</span>
                    </span>
                  </div>
                  <div className="row between">
                    <span className="muted small">chegou {hhmm(kitchenSentAt(o))}</span>
                    <PriorityButton order={o} />
                  </div>
                  <KitchenTimer order={o} targetMin={targetMin} now={now} />
                  <ul>
                    {o.items.filter((i) => i.sendToKitchen).map((i) => (
                      <li key={i.id}>
                        <b>{i.qty}×</b> {i.name}
                        {i.notes && <div className="obs">↳ {i.notes}</div>}
                      </li>
                    ))}
                  </ul>
                  {o.notes && <div className="obs">Obs.: {o.notes}</div>}
                  <div className="row" style={{ marginTop: 10 }}>
                    {o.status === 'novo' && (
                      <button className="btn-primary btn-lg grow" onClick={() => attempt(() => setOrderStatus(o.id, 'preparo'))}>Iniciar preparo</button>
                    )}
                    {o.status === 'preparo' && (
                      <button className="btn-ok btn-lg grow" onClick={() => attempt(() => setOrderStatus(o.id, 'pronto'))}>✓ Pronto</button>
                    )}
                    {o.status === 'pronto' && (
                      <button className="grow" onClick={() => attempt(() => setOrderStatus(o.id, 'preparo'))}>↺ Voltar para preparo</button>
                    )}
                    <button className="icon-btn" title="Imprimir comanda" aria-label="Imprimir comanda" onClick={() => printTicket(o, db.establishment, prefs.paperMm)}>🖨️</button>
                    <button className="icon-btn" title="Cancelar pedido" aria-label="Cancelar pedido" onClick={() => setCancelling(o)}>✕</button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>
      {cancelling && <CancelModal order={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  )
}

/** Cancelar pela cozinha: motivo e PIN de um gerente, digitado na hora (fica no histórico). */
function CancelModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const motivos = ['Pedido feito errado', 'Cliente desistiu', 'Pedido repetido', 'Acabou o item']
  return (
    <Modal title={`Cancelar ${identLabel(order)} · pedido nº ${order.number}`} onClose={onClose}>
      <p className="muted">O pedido sai da cozinha e do caixa e fica no histórico como cancelado. Pedido já pago não pode ser cancelado.</p>
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {motivos.map((m) => <button key={m} className={reason === m ? 'on' : ''} onClick={() => setReason(m)}>{m}</button>)}
      </div>
      <label className="field">Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pedido feito errado" /></label>
      <AuthPinField label="PIN de um gerente para autorizar" value={pin} onChange={setPin} />
      <div className="row">
        <button className="grow" onClick={onClose}>Voltar</button>
        <button
          className="btn-danger grow"
          onClick={() => attempt(() => cancelOrder(order.id, reason, pin), 'Pedido cancelado').then((ok) => (ok ? onClose() : setPin('')))}
        >
          Cancelar pedido
        </button>
      </div>
    </Modal>
  )
}

/** Cronômetro da comanda: tempo desde que chegou na cozinha, contra o tempo estimado. */
function KitchenTimer({ order, targetMin, now }: { order: Order; targetMin: number; now: number }) {
  const secs = kitchenSeconds(order, now)
  const target = targetMin * 60
  if (order.status === 'pronto') {
    return <div className={`timer ${secs > target ? 'atrasado' : 'ok'}`}><span className="timer-text">Pronto em {clock(secs)}</span></div>
  }
  const state = secs >= target ? 'atrasado' : secs >= target * 0.75 ? 'quase' : 'ok'
  return (
    <div className={`timer ${state}`}>
      <div className="row between">
        <span className="timer-clock" aria-label={`${Math.floor(secs / 60)} minutos na cozinha`}>{clock(secs)}</span>
        <span className="timer-text">
          {state === 'atrasado' ? `Atrasado +${Math.floor((secs - target) / 60)} min` : `de ${targetMin} min`}
        </span>
      </div>
      <div className="timer-bar" aria-hidden><span style={{ width: `${Math.min(100, (secs / target) * 100)}%` }} /></div>
    </div>
  )
}

/** 75 segundos -> "1:15"; 3725 -> "62:05". */
function clock(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

/** Toca um aviso quando um pedido passa do tempo estimado (uma vez por pedido). */
function useLateAlert(late: Order[], prefs: KitchenPrefs): void {
  const warned = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = late.map((o) => o.id)
    // ao abrir a tela, os já atrasados não tocam: só os que atrasarem daqui em diante
    if (warned.current && prefs.sound && ids.some((id) => !warned.current!.has(id))) beep(3)
    warned.current = new Set([...(warned.current ?? []), ...ids])
  }, [late, prefs.sound])
}

/** Aviso sonoro e impressão automática quando chega pedido novo na fila. */
function useNewOrderAlert(queue: Order[], prefs: KitchenPrefs, est: Establishment): void {
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(queue.map((o) => o.id))
    if (seen.current) {
      const fresh = queue.filter((o) => o.status === 'novo' && !seen.current!.has(o.id))
      if (fresh.length) {
        if (prefs.sound) beep(2)
        if (prefs.autoPrint) fresh.forEach((o, i) => setTimeout(() => printTicket(o, est, prefs.paperMm), i * 1500))
      }
    }
    seen.current = ids
  }, [queue, prefs, est])
}

export function printTicket(o: Order, est: Establishment, paperMm: number): void {
  const items = o.items
    .filter((i) => i.sendToKitchen)
    .map((i) => `<div style="font-size:1.25em;margin:3px 0"><b>${i.qty}×</b> ${escapeHtml(i.name)}${i.notes ? `<div>↳ <b>${escapeHtml(i.notes)}</b></div>` : ''}</div>`)
    .join('')
  printHtml(
    `Comanda ${o.number}`,
    `<div class="row"><span class="big">${escapeHtml(identLabel(o))}</span><b style="font-size:1.3em">${modeLabel(o)}</b></div>
     <div style="font-size:1.1em">pedido nº ${o.number}</div>
     <div class="muted">${escapeHtml(est.name)} · ${hhmm(o.createdAt)}</div><hr>${items}
     ${o.notes ? `<hr><b>Obs.: ${escapeHtml(o.notes)}</b>` : ''}<hr>`,
    { widthMm: paperMm },
  )
}
