// Conta da mesa: um pagamento pode cobrir mais de um pedido da mesma mesa.
// O valor é repartido do pedido mais antigo para o mais novo; cada pedido recebe a sua parte.

import type { Database, Order } from '../types'
import { orderRemaining } from './selectors'
import type { PaymentInput } from './actions'

export interface OrderPayments { orderId: string; payments: PaymentInput[] }

/**
 * Reparte os pagamentos entre os pedidos (do mais antigo ao mais novo).
 * No dinheiro, o troco fica no primeiro pedaço: o valor entregue = pedaço + troco.
 * Dá erro se o total passa do que falta receber.
 */
export function planTablePayments(db: Database, orders: Order[], input: PaymentInput[]): OrderPayments[] {
  const left = new Map(orders.map((o) => [o.id, orderRemaining(db, o)]))
  const out = new Map<string, PaymentInput[]>()
  for (const p of input) {
    let rest = p.amount
    let first = true
    const change = p.method === 'dinheiro' && p.cashReceived ? Math.max(0, p.cashReceived - p.amount) : 0
    for (const o of orders) {
      if (rest <= 0) break
      const take = Math.min(rest, left.get(o.id) ?? 0)
      if (take <= 0) continue
      left.set(o.id, (left.get(o.id) ?? 0) - take)
      rest -= take
      const piece: PaymentInput = {
        ...p,
        amount: take,
        cashReceived: p.method === 'dinheiro' && p.cashReceived ? take + (first ? change : 0) : null,
      }
      first = false
      out.set(o.id, [...(out.get(o.id) ?? []), piece])
    }
    if (rest > 0) throw new Error('O valor passa do que falta receber na mesa')
  }
  return [...out].map(([orderId, payments]) => ({ orderId, payments }))
}
