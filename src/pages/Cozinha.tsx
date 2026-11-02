import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Layout'
import { attempt, Segmented, useNow } from '../components/ui'
import { setOrderStatus } from '../data/actions'
import { identLabel, KITCHEN_STATUSES, needsKitchen } from '../data/selectors'
import { currentUserId } from '../data/session'
import { useDB } from '../data/store'
import { beep } from '../lib/beep'
import { hhmm, minutesSince } from '../lib/dates'
import { escapeHtml, printHtml } from '../lib/print'
import type { Establishment, Order } from '../types'

// Preferências deste aparelho (cada tablet/TV da cozinha pode ser diferente).
interface KitchenPrefs {
  tv: boolean
  sound: boolean
  autoPrint: boolean
  paperMm: 58 | 80
  lateMin: number
}
const PREFS_KEY = 'rkfood:cozinha'
const DEFAULT_PREFS: KitchenPrefs = { tv: false, sound: true, autoPrint: false, paperMm: 80, lateMin: 15 }

function loadPrefs(): KitchenPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

export default function Cozinha() {
  const db = useDB()
  const now = useNow(15000)
  const [prefs, setPrefsState] = useState<KitchenPrefs>(loadPrefs)
  const [showSettings, setShowSettings] = useState(false)
  const [filter, setFilter] = useState<'fila' | 'prontos'>('fila')
  const setPrefs = (p: Partial<KitchenPrefs>) => {
    const next = { ...prefs, ...p }
    setPrefsState(next)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* ignora */ }
  }

  const active = db.orders
    .filter((o) => KITCHEN_STATUSES.includes(o.status) && needsKitchen(o))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const queue = active.filter((o) => o.status !== 'pronto')
  const ready = active.filter((o) => o.status === 'pronto')

  useNewOrderAlert(queue, prefs, db.establishment)

  const shown = filter === 'fila' ? queue : ready

  return (
    <div className={prefs.tv ? 'tv' : ''}>
      <Header
        title={`Cozinha · ${queue.length} na fila`}
        right={<button className="btn-ghost btn-sm" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>⚙︎ Ajustes</button>}
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
            <label className="field" style={{ maxWidth: 260 }}>Destacar pedido atrasado após (min)
              <input type="number" min={1} value={prefs.lateMin} onChange={(e) => setPrefs({ lateMin: Math.max(1, Number(e.target.value) || 15) })} />
            </label>
            <p className="muted small">Dica: para o som e a impressão automática funcionarem, toque uma vez na tela depois de abrir. Em TV, use o navegador em tela cheia.</p>
            <button onClick={() => document.documentElement.requestFullscreen?.()}>Tela cheia</button>
          </div>
        )}

        <Segmented value={filter} onChange={setFilter} options={[{ value: 'fila', label: `Fila (${queue.length})` }, { value: 'prontos', label: `Prontos (${ready.length})` }]} />

        {shown.length === 0 ? (
          <div className="card empty">{filter === 'fila' ? 'Nenhum pedido na fila. 🔥' : 'Nenhum pedido aguardando entrega.'}</div>
        ) : (
          <div className="kds">
            {shown.map((o) => {
              const mins = minutesSince(o.createdAt, now)
              const late = o.status !== 'pronto' && mins >= prefs.lateMin
              return (
                <article key={o.id} className={`card ticket ${o.status} ${late ? 'late' : ''}`}>
                  <div className="row between">
                    <span className="num">nº {o.number}</span>
                    <span className={`badge ${o.mode === 'viagem' ? 'preparo' : ''}`}>{o.mode === 'viagem' ? 'VIAGEM' : 'AQUI'}</span>
                  </div>
                  <div className="row between">
                    <strong>{identLabel(o)}</strong>
                    <span className={late ? 'error-text' : 'muted'}>{hhmm(o.createdAt)} · {mins} min</span>
                  </div>
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
                      <button className="btn-primary btn-lg grow" onClick={() => attempt(() => setOrderStatus(currentUserId(), o.id, 'preparo'))}>Iniciar preparo</button>
                    )}
                    {o.status === 'preparo' && (
                      <button className="btn-ok btn-lg grow" onClick={() => attempt(() => setOrderStatus(currentUserId(), o.id, 'pronto'))}>✓ Pronto</button>
                    )}
                    {o.status === 'pronto' && (
                      <button className="grow" onClick={() => attempt(() => setOrderStatus(currentUserId(), o.id, 'preparo'))}>↺ Voltar para preparo</button>
                    )}
                    <button className="icon-btn" title="Imprimir comanda" aria-label="Imprimir comanda" onClick={() => printTicket(o, db.establishment, prefs.paperMm)}>🖨️</button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
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
    `<div class="row"><span class="big">nº ${o.number}</span><b style="font-size:1.3em">${o.mode === 'viagem' ? 'VIAGEM' : 'AQUI'}</b></div>
     <div style="font-size:1.2em"><b>${escapeHtml(identLabel(o))}</b></div>
     <div class="muted">${escapeHtml(est.name)} · ${hhmm(o.createdAt)}</div><hr>${items}
     ${o.notes ? `<hr><b>Obs.: ${escapeHtml(o.notes)}</b>` : ''}<hr>`,
    { widthMm: paperMm },
  )
}
