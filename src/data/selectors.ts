// Cálculos puros sobre os dados. Não alteram nada: só leem e somam.
// Por serem puros, são cobertos por testes automatizados (selectors.test.ts).

import { METHOD_LABEL } from '../types'
import type { CashMethod, Customer, Database, Order, OrderStatus, Payment, PaymentMethod } from '../types'

export function orderTotal(order: Pick<Order, 'items'>): number {
  return order.items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0)
}

export function orderPayments(db: Database, orderId: string): Payment[] {
  return db.payments.filter((p) => p.orderId === orderId)
}

export function orderPaid(db: Database, orderId: string): number {
  return orderPayments(db, orderId).reduce((s, p) => s + p.amount, 0)
}

export function orderRemaining(db: Database, order: Order): number {
  return Math.max(0, orderTotal(order) - orderPaid(db, order.id))
}

export function isOrderPaid(db: Database, order: Order): boolean {
  return orderRemaining(db, order) === 0
}

/** Pedido tem pelo menos um item que passa pela cozinha? */
export function needsKitchen(order: Order): boolean {
  return order.items.some((i) => i.sendToKitchen)
}

export const KITCHEN_STATUSES: OrderStatus[] = ['novo', 'preparo', 'pronto']

/**
 * Quando o pedido chegou na cozinha: a primeira vez que ficou "novo".
 * Com cobrança antes, isso é quando foi pago, não quando foi criado.
 */
export function kitchenSentAt(order: Order): string {
  return order.statusHistory.find((h) => h.status === 'novo')?.at ?? order.createdAt
}

/** Ordem da fila da cozinha: adiantados pelo gerente primeiro (na ordem em que foram adiantados), depois por chegada. */
export function compareKitchenQueue(a: Order, b: Order): number {
  const pa = a.priorityAt ?? null
  const pb = b.priorityAt ?? null
  if (pa && pb) return pa.localeCompare(pb)
  if (pa) return -1
  if (pb) return 1
  return kitchenSentAt(a).localeCompare(kitchenSentAt(b))
}

/** Quando ficou pronto pela última vez (ou null se ainda não ficou). */
export function kitchenReadyAt(order: Order): string | null {
  return [...order.statusHistory].reverse().find((h) => h.status === 'pronto')?.at ?? null
}

/** Segundos na cozinha: até agora, ou até ficar pronto. */
export function kitchenSeconds(order: Order, now: number): number {
  const end = order.status === 'pronto' ? new Date(kitchenReadyAt(order) ?? now).getTime() : now
  return Math.max(0, Math.floor((end - new Date(kitchenSentAt(order)).getTime()) / 1000))
}

/** Pedido ainda na fila (novo ou em preparo) que passou do tempo estimado. */
export function isKitchenLate(order: Order, targetMin: number, now: number): boolean {
  return (order.status === 'novo' || order.status === 'preparo') && kitchenSeconds(order, now) >= targetMin * 60
}

// ---------------------------------------------------------------- Fiado

/** Saldo devedor do cliente em centavos (positivo = cliente deve). */
export function customerBalance(db: Database, customerId: string): number {
  const owed = db.payments
    .filter((p) => p.method === 'fiado' && p.customerId === customerId && !isPaymentOfCancelledOrder(db, p))
    .reduce((s, p) => s + p.amount, 0)
  const paid = db.settlements
    .filter((s) => s.customerId === customerId)
    .reduce((s, p) => s + p.amount, 0)
  return owed - paid
}

function isPaymentOfCancelledOrder(db: Database, p: Payment): boolean {
  return db.orders.find((o) => o.id === p.orderId)?.status === 'cancelado'
}

export interface StatementLine {
  at: string
  kind: 'compra' | 'pagamento'
  description: string
  /** Valor positivo aumenta a dívida, negativo diminui. */
  amount: number
  balance: number
  orderId?: string
  items?: { name: string; qty: number; total: number }[]
}

/** Extrato do fiado de um cliente, em ordem cronológica, com saldo acumulado. */
export function customerStatement(db: Database, customerId: string): StatementLine[] {
  const lines: Omit<StatementLine, 'balance'>[] = []
  for (const p of db.payments) {
    if (p.method !== 'fiado' || p.customerId !== customerId) continue
    const order = db.orders.find((o) => o.id === p.orderId)
    if (!order || order.status === 'cancelado') continue
    lines.push({
      at: p.createdAt,
      kind: 'compra',
      description: `Pedido nº ${order.number}`,
      amount: p.amount,
      orderId: order.id,
      items: order.items.map((i) => ({ name: i.name, qty: i.qty, total: i.qty * i.unitPrice })),
    })
  }
  for (const s of db.settlements) {
    if (s.customerId !== customerId) continue
    lines.push({
      at: s.createdAt,
      kind: 'pagamento',
      description: `Pagamento (${METHOD_LABEL[s.method]})${s.notes ? ` — ${s.notes}` : ''}`,
      amount: -s.amount,
    })
  }
  lines.sort((a, b) => a.at.localeCompare(b.at))
  let balance = 0
  return lines.map((l) => {
    balance += l.amount
    return { ...l, balance }
  })
}

export function customersWithBalance(db: Database): { customer: Customer; balance: number }[] {
  return db.customers
    .filter((c) => !c.deletedAt)
    .map((customer) => ({ customer, balance: customerBalance(db, customer.id) }))
    .sort((a, b) => b.balance - a.balance || a.customer.name.localeCompare(b.customer.name))
}

// ---------------------------------------------------------------- Relatórios

export interface DailySummary {
  date: string
  orderCount: number
  cancelledCount: number
  /** Soma dos pedidos não cancelados do dia. */
  sales: number
  averageTicket: number
  /** Recebido em pedidos do dia, por forma de pagamento (fiado = vendido a prazo; cortesia = sem cobrança). */
  byMethod: Record<PaymentMethod, number>
  /** Pedidos do dia ainda sem pagamento completo. */
  openAmount: number
  /** Dívidas de fiado recebidas neste dia (de qualquer data). */
  fiadoReceived: Record<CashMethod, number>
  /** Total que entrou de fato no caixa no dia (sem contar fiado concedido nem cortesia). */
  cashIn: number
  topProducts: { name: string; qty: number; total: number }[]
}

export function dailySummary(db: Database, date: string): DailySummary {
  const orders = db.orders.filter((o) => o.businessDate === date)
  const valid = orders.filter((o) => o.status !== 'cancelado')
  const validIds = new Set(valid.map((o) => o.id))
  const byMethod: DailySummary['byMethod'] = { pix: 0, credito: 0, debito: 0, dinheiro: 0, fiado: 0, cortesia: 0 }
  for (const p of db.payments) if (validIds.has(p.orderId)) byMethod[p.method] += p.amount

  const fiadoReceived: DailySummary['fiadoReceived'] = { pix: 0, credito: 0, debito: 0, dinheiro: 0 }
  for (const s of db.settlements) if (localDate(s.createdAt) === date) fiadoReceived[s.method] += s.amount

  const sales = valid.reduce((s, o) => s + orderTotal(o), 0)
  const openAmount = valid.reduce((s, o) => s + orderRemaining(db, o), 0)

  const products = new Map<string, { name: string; qty: number; total: number }>()
  for (const o of valid)
    for (const it of o.items) {
      const cur = products.get(it.productId) ?? { name: it.name, qty: 0, total: 0 }
      cur.qty += it.qty
      cur.total += it.qty * it.unitPrice
      products.set(it.productId, cur)
    }

  const cashIn =
    byMethod.pix + byMethod.credito + byMethod.debito + byMethod.dinheiro +
    fiadoReceived.pix + fiadoReceived.credito + fiadoReceived.debito + fiadoReceived.dinheiro

  return {
    date,
    orderCount: valid.length,
    cancelledCount: orders.length - valid.length,
    sales,
    averageTicket: valid.length ? Math.round(sales / valid.length) : 0,
    byMethod,
    openAmount,
    fiadoReceived,
    cashIn,
    topProducts: [...products.values()].sort((a, b) => b.qty - a.qty),
  }
}

function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function identLabel(o: Pick<Order, 'identType' | 'identValue'>): string {
  return o.identType === 'mesa' ? `Mesa ${o.identValue}` : o.identValue
}

/** Mesmo texto dos botões do atendente, em todas as telas. */
export function modeLabel(o: Pick<Order, 'mode'>): string {
  return o.mode === 'viagem' ? 'Para viagem' : 'Comer aqui'
}

// ---------------------------------------------------------------- Mesas abertas (conta da mesa)

export interface OpenTable {
  /** Número ou nome da mesa, como o atendente digitou. */
  table: string
  /** Pedidos da mesa que ainda têm valor a receber, do mais antigo para o mais novo. */
  orders: Order[]
  /** Soma dos pedidos (pagos ou não) que ainda têm saldo. */
  total: number
  /** Quanto falta receber. */
  remaining: number
  /** Quando o primeiro pedido foi feito. */
  since: string
}

const tableKey = (v: string) => v.trim().toLowerCase()

/** Mesas com conta aberta: pedidos de mesa não cancelados que ainda não foram pagos por inteiro. */
export function openTables(db: Database): OpenTable[] {
  const map = new Map<string, OpenTable>()
  const orders = db.orders
    .filter((o) => o.identType === 'mesa' && o.status !== 'cancelado' && orderRemaining(db, o) > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const o of orders) {
    const k = tableKey(o.identValue)
    const cur = map.get(k) ?? { table: o.identValue.trim(), orders: [], total: 0, remaining: 0, since: o.createdAt }
    cur.orders.push(o)
    cur.total += orderTotal(o)
    cur.remaining += orderRemaining(db, o)
    map.set(k, cur)
  }
  return [...map.values()].sort((a, b) => a.since.localeCompare(b.since))
}

/** Pedidos em aberto de uma mesa (mesma regra de openTables). */
export function tableOrders(db: Database, table: string): OpenTable | undefined {
  return openTables(db).find((t) => tableKey(t.table) === tableKey(table))
}

/**
 * Reparte um valor pago entre os pedidos da mesa, do mais antigo para o mais novo.
 * Dá erro se o valor passa do que falta receber.
 */
export function allocateToOrders(db: Database, orders: Order[], amount: number): { orderId: string; amount: number }[] {
  let left = amount
  const out: { orderId: string; amount: number }[] = []
  for (const o of orders) {
    if (left <= 0) break
    const take = Math.min(left, orderRemaining(db, o))
    if (take > 0) {
      out.push({ orderId: o.id, amount: take })
      left -= take
    }
  }
  if (left > 0) throw new Error('O valor passa do que falta receber na mesa')
  return out
}

/** Divide um valor em partes iguais em centavos; as sobras vão para as primeiras pessoas. */
export function splitEvenly(total: number, people: number): number[] {
  const n = Math.max(1, Math.floor(people))
  const base = Math.floor(total / n)
  const extra = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}
