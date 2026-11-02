import { useState } from 'react'
import { setOrderPriority } from '../data/api'
import { identLabel } from '../data/selectors'
import { useCurrentUser } from '../data/session'
import type { Order } from '../types'
import { attempt, Modal } from './ui'

const MOTIVOS = ['Cliente esperou demais', 'Pedido saiu errado', 'Item faltou no pedido', 'Cliente com pressa']

/** Botão do gerente para puxar o pedido para o topo da fila da cozinha (ou devolver à ordem normal). */
export function PriorityButton({ order }: { order: Order }) {
  const user = useCurrentUser()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  if (!user?.roles.includes('gerente')) return null
  if (order.status !== 'novo' && order.status !== 'preparo') return null

  if (order.priorityAt) {
    return (
      <button className="btn-sm" onClick={() => attempt(() => setOrderPriority(order.id, false), 'Pedido voltou à ordem normal')}>
        Tirar prioridade
      </button>
    )
  }
  return (
    <>
      <button className="btn-sm btn-priority" onClick={() => setAsking(true)}>⬆ Adiantar</button>
      {asking && (
        <Modal title={`Adiantar ${identLabel(order)}`} onClose={() => setAsking(false)}>
          <p className="muted">O pedido vai para o topo da fila da cozinha. O motivo fica no histórico.</p>
          <div className="tabs" style={{ flexWrap: 'wrap' }}>
            {MOTIVOS.map((m) => (
              <button key={m} className={reason === m ? 'on' : ''} onClick={() => setReason(m)}>{m}</button>
            ))}
          </div>
          <label className="field">Motivo
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente esperou demais" />
          </label>
          <button
            className="btn-primary btn-lg"
            onClick={() => attempt(() => setOrderPriority(order.id, true, reason), 'Pedido adiantado na fila').then((ok) => ok && setAsking(false))}
          >
            Adiantar pedido
          </button>
        </Modal>
      )}
    </>
  )
}
