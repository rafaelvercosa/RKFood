// Relatórios do dono: vendas por período, consumo de materiais pela ficha técnica,
// custo estimado e lista de compras. Só cálculo (sem tela), para dar para testar.

import { businessDateBR, today } from '../lib/dates'
import { brl } from '../lib/money'
import type { Database, Material, MaterialUnit, Order, Payment, PaymentMethod, User } from '../types'
import { kitchenSentAt, needsKitchen, orderTotal } from './selectors'

// ---------------------------------------------------------------- períodos

export type PeriodKey = 'hoje' | 'ontem' | 'semana' | 'semana-passada' | 'mes' | 'mes-passado'

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  semana: 'Esta semana',
  'semana-passada': 'Semana passada',
  mes: 'Este mês',
  'mes-passado': 'Mês passado',
}

/** Datas (AAAA-MM-DD) do período. Semana vai de segunda a domingo. */
export function periodDates(key: PeriodKey, ref: Date = new Date()): { from: string; to: string } {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const shift = (base: Date, days: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  const monday = shift(d, -((d.getDay() + 6) % 7))
  switch (key) {
    case 'hoje': return { from: today(d), to: today(d) }
    case 'ontem': return { from: today(shift(d, -1)), to: today(shift(d, -1)) }
    case 'semana': return { from: today(monday), to: today(shift(monday, 6)) }
    case 'semana-passada': return { from: today(shift(monday, -7)), to: today(shift(monday, -1)) }
    case 'mes': return { from: today(new Date(d.getFullYear(), d.getMonth(), 1)), to: today(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
    case 'mes-passado': return { from: today(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: today(new Date(d.getFullYear(), d.getMonth(), 0)) }
  }
}

export function periodText(from: string, to: string): string {
  return from === to ? businessDateBR(from) : `${businessDateBR(from)} a ${businessDateBR(to)}`
}

// ---------------------------------------------------------------- vendas

export interface SoldProduct {
  productId: string
  name: string
  category: string
  categorySort: number
  qty: number
  revenue: number
}

export interface PeriodReport {
  orderCount: number
  cancelledCount: number
  /** Soma dos pedidos não cancelados (cortesia entra, porque o item saiu). */
  sales: number
  averageTicket: number
  byMethod: Record<PaymentMethod, number>
  byDay: { date: string; orders: number; sales: number }[]
  /** Itens vendidos, por categoria (na ordem do cardápio) e do mais vendido para o menos. */
  products: SoldProduct[]
  categories: { name: string; qty: number; revenue: number }[]
}

export function periodReport(db: Pick<Database, 'products' | 'categories'>, orders: Order[], payments: Payment[], from: string, to: string): PeriodReport {
  const inPeriod = orders.filter((o) => o.businessDate >= from && o.businessDate <= to)
  const valid = inPeriod.filter((o) => o.status !== 'cancelado')
  const validIds = new Set(valid.map((o) => o.id))

  const byMethod: Record<PaymentMethod, number> = { pix: 0, credito: 0, debito: 0, dinheiro: 0, fiado: 0, cortesia: 0 }
  for (const p of payments) if (validIds.has(p.orderId)) byMethod[p.method] += p.amount

  const days = new Map<string, { date: string; orders: number; sales: number }>()
  const sold = new Map<string, SoldProduct>()
  for (const o of valid) {
    const day = days.get(o.businessDate) ?? { date: o.businessDate, orders: 0, sales: 0 }
    day.orders += 1
    day.sales += orderTotal(o)
    days.set(o.businessDate, day)
    for (const i of o.items) {
      let line = sold.get(i.productId)
      if (!line) {
        const product = db.products.find((p) => p.id === i.productId)
        const category = db.categories.find((c) => c.id === product?.categoryId)
        line = { productId: i.productId, name: product?.name ?? i.name, category: category?.name ?? 'Sem categoria', categorySort: category?.sort ?? 999, qty: 0, revenue: 0 }
        sold.set(i.productId, line)
      }
      line.qty += i.qty
      line.revenue += i.qty * i.unitPrice
    }
  }

  const products = [...sold.values()].sort((a, b) => a.categorySort - b.categorySort || b.qty - a.qty || a.name.localeCompare(b.name))
  const categories: PeriodReport['categories'] = []
  for (const p of products) {
    const c = categories.find((x) => x.name === p.category)
    if (c) { c.qty += p.qty; c.revenue += p.revenue } else categories.push({ name: p.category, qty: p.qty, revenue: p.revenue })
  }
  const sales = valid.reduce((s, o) => s + orderTotal(o), 0)
  return {
    orderCount: valid.length,
    cancelledCount: inPeriod.length - valid.length,
    sales,
    averageTicket: valid.length ? Math.round(sales / valid.length) : 0,
    byMethod,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    products,
    categories,
  }
}

// ---------------------------------------------------------------- ficha técnica e consumo

/** Custo estimado de uma unidade do item, pela ficha técnica (centavos). */
export function productCost(db: Pick<Database, 'materials' | 'recipes'>, productId: string): number {
  return Math.round(db.recipes
    .filter((r) => r.productId === productId)
    .reduce((s, r) => s + r.qty * (db.materials.find((m) => m.id === r.materialId)?.cost ?? 0), 0))
}

export function hasRecipe(db: Pick<Database, 'recipes'>, productId: string): boolean {
  return db.recipes.some((r) => r.productId === productId)
}

export interface ConsumptionLine {
  materialId: string
  name: string
  unit: MaterialUnit
  /** Quanto as vendas gastaram, na unidade do material. */
  qty: number
  /** Quanto comprar para repor (arredondado para cima: 0,1 kg/l ou 1 unidade). */
  buy: number
  /** Custo estimado do que foi gasto (centavos). */
  cost: number
}

export interface Consumption {
  lines: ConsumptionLine[]
  totalCost: number
  /** Itens vendidos sem ficha técnica: o consumo deles não entra na conta. */
  withoutRecipe: string[]
}

export function consumption(db: Pick<Database, 'materials' | 'recipes'>, sold: Pick<SoldProduct, 'productId' | 'name' | 'qty'>[]): Consumption {
  const lines = new Map<string, ConsumptionLine>()
  const withoutRecipe: string[] = []
  for (const s of sold) {
    const rows = db.recipes.filter((r) => r.productId === s.productId)
    if (rows.length === 0) { withoutRecipe.push(s.name); continue }
    for (const r of rows) {
      const m = db.materials.find((x) => x.id === r.materialId)
      if (!m) continue
      const line = lines.get(m.id) ?? { materialId: m.id, name: m.name, unit: m.unit, qty: 0, buy: 0, cost: 0 }
      line.qty += r.qty * s.qty
      lines.set(m.id, line)
    }
  }
  const out = [...lines.values()].map((l) => {
    const m = db.materials.find((x) => x.id === l.materialId) as Material
    return { ...l, qty: round4(l.qty), buy: roundUp(l.qty, l.unit), cost: Math.round(l.qty * m.cost) }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return { lines: out, totalCost: out.reduce((s, l) => s + l.cost, 0), withoutRecipe: withoutRecipe.sort() }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

function roundUp(qty: number, unit: MaterialUnit): number {
  if (unit === 'un') return Math.ceil(round4(qty))
  return Math.ceil(round4(qty) * 10) / 10
}

// ---------------------------------------------------------------- formatação

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export const UNIT_LABEL: Record<MaterialUnit, string> = { kg: 'quilo (kg)', l: 'litro (L)', un: 'unidade' }

/** 0,12 kg → "120 g"; 2,5 kg → "2,5 kg"; 0,5 l → "500 ml"; 3 un → "3 un". */
export function formatQty(qty: number, unit: MaterialUnit): string {
  if (unit === 'kg') return qty < 1 ? `${num.format(qty * 1000)} g` : `${num.format(qty)} kg`
  if (unit === 'l') return qty < 1 ? `${num.format(qty * 1000)} ml` : `${num.format(qty)} L`
  return `${num.format(qty)} un`
}

/** Texto da lista de compras para mandar no WhatsApp. */
export function purchaseListText(establishment: string, from: string, to: string, c: Consumption): string {
  const lines = c.lines.map((l) => `• ${l.name}: ${formatQty(l.buy, l.unit)}`)
  return [
    `*Lista de compras · ${establishment}*`,
    `Para repor o que foi vendido em ${periodText(from, to)}`,
    '',
    ...lines,
    '',
    c.totalCost ? `Custo estimado: ${brl(c.totalCost)}` : '',
    c.withoutRecipe.length ? `Sem ficha técnica (fora da conta): ${c.withoutRecipe.join(', ')}` : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim()
}

// ---------------------------------------------------------------- desempenho da equipe

export interface StaffLine {
  staffId: string
  name: string
  orders: number
  items: number
  sales: number
  averageTicket: number
}

/** Vendas por quem fez o pedido (atendente, caixa, gerente...), da que mais vendeu para a que menos. */
export function staffPerformance(users: User[], orders: Order[], from: string, to: string): StaffLine[] {
  const lines = new Map<string, StaffLine>()
  for (const o of orders) {
    if (o.status === 'cancelado' || o.businessDate < from || o.businessDate > to) continue
    const l = lines.get(o.createdBy) ?? {
      staffId: o.createdBy, name: users.find((u) => u.id === o.createdBy)?.name ?? 'Usuário removido', orders: 0, items: 0, sales: 0, averageTicket: 0,
    }
    l.orders += 1
    l.items += o.items.reduce((s, i) => s + i.qty, 0)
    l.sales += orderTotal(o)
    lines.set(o.createdBy, l)
  }
  return [...lines.values()]
    .map((l) => ({ ...l, averageTicket: Math.round(l.sales / l.orders) }))
    .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- tempo de saída dos pedidos

const at = (o: Order, status: Order['status'], after = '') => o.statusHistory.find((h) => h.status === status && h.at >= after)?.at ?? null
const secondsBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))

export interface TimeStats {
  /** Da chegada na cozinha até ficar pronto (só pedidos que passaram pela cozinha). */
  prep: { count: number; avg: number; max: number }
  /** Do pedido feito até ser entregue. */
  delivery: { count: number; avg: number }
  byDay: { date: string; prepCount: number; prepAvg: number; deliveryAvg: number }[]
}

/** Tempos em segundos; média 0 quando não há pedido no grupo. */
export function timeStats(orders: Order[], from: string, to: string): TimeStats {
  const days = new Map<string, { prep: number[]; delivery: number[] }>()
  const prep: number[] = []
  const delivery: number[] = []
  for (const o of orders) {
    if (o.status === 'cancelado' || o.businessDate < from || o.businessDate > to) continue
    const day = days.get(o.businessDate) ?? { prep: [], delivery: [] }
    days.set(o.businessDate, day)
    if (needsKitchen(o)) {
      const sent = kitchenSentAt(o)
      const ready = at(o, 'pronto', sent)
      if (ready) { const s = secondsBetween(sent, ready); prep.push(s); day.prep.push(s) }
    }
    const delivered = at(o, 'entregue')
    if (delivered) { const s = secondsBetween(o.createdAt, delivered); delivery.push(s); day.delivery.push(s) }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  return {
    prep: { count: prep.length, avg: avg(prep), max: prep.length ? Math.max(...prep) : 0 },
    delivery: { count: delivery.length, avg: avg(delivery) },
    byDay: [...days.entries()]
      .filter(([, d]) => d.prep.length || d.delivery.length)
      .map(([date, d]) => ({ date, prepCount: d.prep.length, prepAvg: avg(d.prep), deliveryAvg: avg(d.delivery) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/** 754 segundos → "12 min 34 s"; 45 → "45 s". */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s} s`
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} min`
  return s ? `${m} min ${s} s` : `${m} min`
}

// ---------------------------------------------------------------- horário de pico e comparação

/** Dias entre duas datas AAAA-MM-DD, contando as duas pontas. */
function daysInclusive(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`)
  const b = new Date(`${to}T12:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}

function shiftDate(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** O período de mesmo tamanho logo antes deste (para comparar: 7 dias contra os 7 anteriores). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const n = daysInclusive(from, to)
  return { from: shiftDate(from, -n), to: shiftDate(from, -1) }
}

/** Variação em % de `current` contra `previous`; null quando não há base para comparar. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export interface HourSales { hour: number; orders: number; sales: number }

/** Vendas por hora do dia (0 a 23), somando todos os dias do período. Pedidos cancelados não entram. */
export function hourlySales(orders: Order[], from: string, to: string): HourSales[] {
  const hours: HourSales[] = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0 }))
  for (const o of orders) {
    if (o.status === 'cancelado' || o.businessDate < from || o.businessDate > to) continue
    const h = new Date(o.createdAt).getHours()
    hours[h].orders += 1
    hours[h].sales += orderTotal(o)
  }
  return hours
}

/** A hora que mais vendeu (null se não houve venda). */
export function peakHour(hours: HourSales[]): HourSales | null {
  const top = [...hours].sort((a, b) => b.sales - a.sales || a.hour - b.hour)[0]
  return top && top.sales > 0 ? top : null
}
