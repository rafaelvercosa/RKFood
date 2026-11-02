import { useEffect, useState } from 'react'
import { loadPeriod } from '../../data/api'
import { isCloud } from '../../data/backend'
import { PERIOD_LABEL, periodDates, periodText, type PeriodKey } from '../../data/reports'
import { useDB } from '../../data/store'
import type { Order, Payment } from '../../types'
import type { Period } from '../Dono'

const KEYS = Object.keys(PERIOD_LABEL) as PeriodKey[]

/** Botões de período (hoje, semana, mês...) ou duas datas escolhidas. */
export function PeriodPicker({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  return (
    <div className="card stack">
      <div className="tabs" style={{ flexWrap: 'wrap' }} role="group" aria-label="Período">
        {KEYS.map((k) => (
          <button key={k} className={period.key === k ? 'on' : ''} onClick={() => onPeriod({ key: k, ...periodDates(k) })}>{PERIOD_LABEL[k]}</button>
        ))}
        <button className={period.key === 'datas' ? 'on' : ''} onClick={() => onPeriod({ ...period, key: 'datas' })}>Escolher datas</button>
      </div>
      {period.key === 'datas' && (
        <div className="row">
          <label className="field">De<input type="date" value={period.from} onChange={(e) => e.target.value && onPeriod({ ...period, from: e.target.value })} /></label>
          <label className="field">Até<input type="date" value={period.to} onChange={(e) => e.target.value && onPeriod({ ...period, to: e.target.value })} /></label>
        </div>
      )}
      <p className="muted small">Período: <b>{periodText(period.from, period.to)}</b></p>
    </div>
  )
}

/**
 * Pedidos do período. No modo nuvem busca no banco (o app só guarda os pedidos
 * recentes); no modo demonstração lê direto do aparelho.
 */
export function usePeriodOrders(from: string, to: string): { orders: Order[]; payments: Payment[]; loading: boolean; error: string | null; refresh: () => void } {
  const db = useDB()
  const [state, setState] = useState<{ orders: Order[]; payments: Payment[]; loading: boolean; error: string | null }>({ orders: [], payments: [], loading: true, error: null })
  const [tick, setTick] = useState(0)
  const demoKey = isCloud ? 0 : db.orders.length + db.payments.length
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    loadPeriod(from <= to ? from : to, from <= to ? to : from)
      .then((r) => alive && setState({ ...r, loading: false, error: null }))
      .catch((e) => alive && setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) })))
    return () => { alive = false }
  }, [from, to, tick, demoKey])
  return { ...state, refresh: () => setTick((t) => t + 1) }
}
