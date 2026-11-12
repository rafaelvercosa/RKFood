import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isCloud } from '../data/backend'
import { identLabel } from '../data/selectors'
import type { Order } from '../types'

// ---------------------------------------------------------------- Aviso rápido (toast)

type ToastMsg = { text: string; error: boolean; id: number; undo?: () => void; ms?: number }
let pushToast: ((t: ToastMsg) => void) | null = null
let seq = 0

/** Quanto tempo o aviso de "Desfazer" fica na tela. */
export const UNDO_MS = 8000

export function toast(text: string): void {
  pushToast?.({ text, error: false, id: ++seq })
}

/** Aviso com botão "Desfazer" e contagem. A ação já valeu; desfazer a reverte dentro de 8 segundos. */
export function toastUndo(text: string, undo: () => void): void {
  pushToast?.({ text, error: false, id: ++seq, undo, ms: UNDO_MS })
}

export function toastError(e: unknown): void {
  const text = e instanceof Error ? e.message : String(e)
  pushToast?.({ text, error: true, id: ++seq })
}

let busy = false

/**
 * Executa uma ação (pode ser assíncrona, ex.: gravar na nuvem), mostra o erro
 * num aviso se houver, e devolve true se deu certo. Ignora toques repetidos
 * enquanto a ação anterior ainda está em andamento (evita pedido duplicado).
 */
export async function attempt(fn: () => unknown, okText?: string): Promise<boolean> {
  if (busy) return false
  if (isCloud && typeof navigator !== 'undefined' && navigator.onLine === false) {
    toastError(new Error('Sem internet. Tente de novo quando a conexão voltar.'))
    return false
  }
  busy = true
  try {
    await fn()
    if (okText) toast(okText)
    return true
  } catch (e) {
    toastError(e)
    return false
  } finally {
    busy = false
  }
}

/** Como `attempt`, mas o aviso de sucesso traz "Desfazer" (8 segundos). */
export async function attemptUndo(fn: () => unknown, okText: string, undo: () => unknown): Promise<boolean> {
  const ok = await attempt(fn)
  if (ok) toastUndo(okText, () => { void attempt(undo, 'Desfeito') })
  return ok
}

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  const [left, setLeft] = useState(0)
  useEffect(() => {
    pushToast = setMsg
    return () => {
      pushToast = null
    }
  }, [])
  useEffect(() => {
    if (!msg) return
    const ms = msg.ms ?? (msg.error ? 4500 : 2500)
    setLeft(Math.ceil(ms / 1000))
    const tick = msg.undo ? setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000) : null
    const t = setTimeout(() => setMsg(null), ms)
    return () => {
      clearTimeout(t)
      if (tick) clearInterval(tick)
    }
  }, [msg])
  if (!msg) return null
  const secs = Math.ceil((msg.ms ?? 0) / 1000)
  return (
    <div className={`toast ${msg.error ? 'error' : ''}`} role="status" key={msg.id}>
      <span>{msg.text}</span>
      {msg.undo && (
        <>
          <span className="count" aria-hidden>
            <svg width="34" height="34" viewBox="0 0 34 34">
              <circle cx="17" cy="17" r="14" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="3" />
              <circle cx="17" cy="17" r="14" fill="none" stroke="#ffc53d" strokeWidth="3" strokeLinecap="round" strokeDasharray="88"
                style={{ animation: `undo-ring ${msg.ms}ms linear forwards` }} />
            </svg>
            <b>{left}</b>
          </span>
          <button className="undo" onClick={() => { const u = msg.undo; setMsg(null); u?.() }} aria-label={`Desfazer (${left || secs} segundos)`}>Desfazer</button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Modal

// Janelas abertas ao mesmo tempo (uma pode abrir outra): a tela de trás só destrava quando fecha a última.
let openModals = 0
let savedScrollY = 0

/** Trava a rolagem da tela de trás (no iPhone, overflow: hidden não basta: é preciso fixar o body). */
function lockPageScroll(): () => void {
  if (openModals++ === 0) {
    savedScrollY = window.scrollY
    Object.assign(document.body.style, { position: 'fixed', top: `-${savedScrollY}px`, left: '0', right: '0' })
  }
  return () => {
    if (--openModals === 0) {
      Object.assign(document.body.style, { position: '', top: '', left: '', right: '' })
      window.scrollTo(0, savedScrollY)
    }
  }
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const backdrop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    const unlock = lockPageScroll()
    // com o teclado aberto, a janela fica na parte visível da tela (acima do teclado),
    // para o botão Salvar não mudar de lugar e pegar já no primeiro toque
    const vv = window.visualViewport
    const fit = () => {
      if (!vv || !backdrop.current) return
      backdrop.current.style.top = `${vv.offsetTop}px`
      backdrop.current.style.height = `${vv.height}px`
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => {
      vv?.removeEventListener('resize', fit)
      vv?.removeEventListener('scroll', fit)
      unlock()
    }
  }, [])
  return (
    <div ref={backdrop} className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="btn-ghost icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Foto com espaço reservado

export function Photo({ src, name, className = '', style }: { src: string | null; name: string; className?: string; style?: React.CSSProperties }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
  return (
    <div className={`photo ${className}`} style={style}>
      {src ? <img src={src} alt={name} loading="lazy" /> : <span aria-hidden>{initials || '🍢'}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- Seletor segmentado

export function Segmented<T extends string>({ value, options, onChange, full }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  full?: boolean
}) {
  return (
    <div className={`segmented ${full ? 'full' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Atualiza a cada `ms` milissegundos (para contadores de tempo). */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

// ---------------------------------------------------------------- Identificação do pedido

/** Mesa ou nome do cliente em destaque; o nº do pedido fica pequeno, só como referência. */
export function OrderIdent({ order }: { order: Pick<Order, 'identType' | 'identValue' | 'number'> }) {
  return (
    <div className="ident">
      <span className="ident-name">{identLabel(order)}</span>
      <span className="ident-num">pedido nº {order.number}</span>
    </div>
  )
}

// ---------------------------------------------------------------- PIN de autorização

/** Campo para o gerente ou o dono digitar o PIN na hora de autorizar (cancelamento, cortesia). */
export function AuthPinField({ label, value, onChange }: { label: string; value: string; onChange: (pin: string) => void }) {
  return (
    <label className="field auth-pin">{label}
      <input
        type="password" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="••••"
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  )
}

// ---------------------------------------------------------------- Sem internet

/** true enquanto o aparelho está com internet. */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

/** Faixa no alto da tela quando a internet cai (só no modo nuvem). Nada é guardado para depois. */
export function OfflineBar() {
  const online = useOnline()
  if (!isCloud || online) return null
  return <div className="offline-bar" role="status">Sem internet. Não faça pedidos agora.</div>
}
