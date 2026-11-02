import { useEffect, useState, type ReactNode } from 'react'
import { identLabel } from '../data/selectors'
import type { Order } from '../types'

// ---------------------------------------------------------------- Aviso rápido (toast)

type ToastMsg = { text: string; error: boolean; id: number }
let pushToast: ((t: ToastMsg) => void) | null = null
let seq = 0

export function toast(text: string): void {
  pushToast?.({ text, error: false, id: ++seq })
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

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  useEffect(() => {
    pushToast = setMsg
    return () => {
      pushToast = null
    }
  }, [])
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), msg.error ? 4500 : 2500)
    return () => clearTimeout(t)
  }, [msg])
  if (!msg) return null
  return (
    <div className={`toast ${msg.error ? 'error' : ''}`} role="status" key={msg.id}>
      {msg.text}
    </div>
  )
}

// ---------------------------------------------------------------- Modal

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
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
