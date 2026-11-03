// MODO NUVEM: conexão do aparelho, carregamento dos dados e tempo real.
//
// 1. O aparelho entra com o e-mail e a senha do estabelecimento (Supabase Auth).
// 2. Escolhe o estabelecimento (se a conta tiver mais de um).
// 3. Os dados de trabalho são carregados e montados no mesmo formato do modo
//    demonstração (types.ts), então as telas não mudam.
// 4. Qualquer mudança no banco (de qualquer aparelho) chega pelo Realtime e
//    recarrega a foto dos dados.

import { useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { today } from '../lib/dates'
import { deviceInfo, deviceKey } from '../lib/device'
import type { AuditEntry, Category, Customer, Database, Device, Establishment, FiadoSettlement, Material, Order, Payment, Product, RecipeItem, User } from '../types'
import { sb } from './backend'
import { clearOperator } from './session'
import { DB_VERSION } from './seed'
import { getDB, setSnapshot } from './store'

export type CloudPhase = 'iniciando' | 'desconectado' | 'escolher' | 'carregando' | 'pronto' | 'erro' | 'nova-senha'

interface CloudState {
  phase: CloudPhase
  establishments: { establishment_id: string; name: string }[]
  error: string | null
}

const EST_KEY = 'rkfood:estabelecimento'

// Link de "trocar senha" do e-mail do Supabase: chega com #...type=recovery (ou com o erro, se venceu).
// Lido antes de o Supabase limpar o endereço.
const urlHash = new URLSearchParams(location.hash.slice(1))
const arrivedForRecovery = urlHash.get('type') === 'recovery'
const linkError = urlHash.get('error_code')
let state: CloudState = { phase: 'iniciando', establishments: [], error: null }
const listeners = new Set<() => void>()
let channel: RealtimeChannel | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let started = false
/** Dias extras carregados sob demanda (relatórios de datas antigas). */
const extraDates = new Set<string>()

function set(patch: Partial<CloudState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function establishmentId(): string {
  return getDB().establishment.id
}

// ---------------------------------------------------------------- ciclo de vida

/** Traduz erros técnicos de rede para uma mensagem que o usuário entende. */
export function friendly(message: string): string {
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.'
  if (message === 'Invalid login credentials') return 'E-mail ou senha incorretos'
  return message
}

/** Evita tela travada quando a internet está ruim. */
export function withTimeout<T>(promise: PromiseLike<T>, ms = 15000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sem resposta do servidor. Verifique a internet e tente de novo.')), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e instanceof Error ? new Error(friendly(e.message)) : e) },
    )
  })
}

export function startCloud(): void {
  if (started) return
  started = true
  sb().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') set({ phase: 'nova-senha' })
    if (event === 'SIGNED_OUT') {
      stopRealtime()
      clearOperator()
      set({ phase: 'desconectado', establishments: [] })
    }
  })
  void boot()
  // rede de segurança: recarrega ao voltar para o app e a cada minuto
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleReload(0))
  setInterval(() => state.phase === 'pronto' && scheduleReload(0), 60_000)
}

async function boot(): Promise<void> {
  const { data } = await sb().auth.getSession()
  if (linkError) {
    history.replaceState(null, '', '/')
    return set({
      phase: data.session ? 'pronto' : 'erro',
      error: linkError === 'otp_expired'
        ? 'Esse link de troca de senha venceu ou já foi usado. Peça um novo.'
        : 'Esse link não funcionou. Peça um novo.',
    })
  }
  if (!data.session) return set({ phase: 'desconectado' })
  if (arrivedForRecovery) return set({ phase: 'nova-senha' })
  await afterSignIn()
}

/** Grava a senha nova da conta do estabelecimento (depois do link do e-mail) e segue para o app. */
export async function setNewPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres')
  const { error } = await withTimeout(sb().auth.updateUser({ password }))
  if (error) throw new Error(friendly(error.message))
  history.replaceState(null, '', '/')
  await afterSignIn()
}

export async function signInDevice(email: string, password: string): Promise<void> {
  const { error } = await withTimeout(sb().auth.signInWithPassword({ email: email.trim(), password }))
  if (error) throw new Error(friendly(error.message))
  await logDeviceEvent('conectar')
  await afterSignIn()
}

/**
 * Celular que abriu o link de convite: entra com um login anônimo e o banco liga
 * o aparelho ao estabelecimento, só para a pessoa do convite.
 */
/** O PIN é o que a pessoa escolheu na página do link (só ela fica sabendo). */
export async function acceptInvite(code: string, pin: string): Promise<void> {
  const auth = sb().auth
  const { data } = await auth.getSession()
  if (data.session) {
    try { localStorage.removeItem(EST_KEY) } catch { /* ignora */ }
    await auth.signOut()
  }
  const { error } = await withTimeout(auth.signInAnonymously())
  if (error) {
    throw new Error(/anonymous|signups not allowed/i.test(error.message)
      ? 'O acesso por link ainda não está ligado neste estabelecimento. Avise o dono.'
      : friendly(error.message))
  }
  const res = await withTimeout(sb().rpc('redeem_invite', { p_code: code, p_pin: pin, p_info: deviceInfo(), p_device_key: deviceKey() }))
  if (res.error) {
    await auth.signOut()
    throw new Error(friendly(res.error.message))
  }
  await afterSignIn()
}

export async function signOutDevice(): Promise<void> {
  try { localStorage.removeItem(EST_KEY) } catch { /* ignora */ }
  await logDeviceEvent('desconectar')
  await sb().auth.signOut()
}

/** Conexão e desconexão do aparelho ficam no histórico. Falha aqui não impede entrar ou sair. */
async function logDeviceEvent(event: 'conectar' | 'desconectar'): Promise<void> {
  try {
    await withTimeout(sb().rpc('log_device_event', { p_event: event, p_info: deviceInfo(), p_device_key: deviceKey() }), 5000)
  } catch {
    // sem internet ou banco antigo: segue sem registrar
  }
}

async function afterSignIn(): Promise<void> {
  let res
  try {
    res = await withTimeout(sb().rpc('my_context'))
  } catch (e) {
    return set({ phase: 'erro', error: e instanceof Error ? e.message : String(e) })
  }
  const { data, error } = res
  if (error) return set({ phase: 'erro', error: friendly(error.message) })
  const list = (data ?? []) as CloudState['establishments']
  if (list.length === 0) {
    return set({ phase: 'erro', error: 'Esta conta ainda não está ligada a nenhum estabelecimento. Fale com o suporte do RKFood.' })
  }
  let saved: string | null = null
  try { saved = localStorage.getItem(EST_KEY) } catch { /* ignora */ }
  const chosen = list.find((e) => e.establishment_id === saved) ?? (list.length === 1 ? list[0] : null)
  set({ establishments: list })
  if (!chosen) return set({ phase: 'escolher' })
  await chooseEstablishment(chosen.establishment_id)
}

export async function chooseEstablishment(id: string): Promise<void> {
  try { localStorage.setItem(EST_KEY, id) } catch { /* ignora */ }
  set({ phase: 'carregando', error: null })
  try {
    await withTimeout(reload(id), 30000)
    startRealtime(id)
    set({ phase: 'pronto' })
  } catch (e) {
    set({ phase: 'erro', error: e instanceof Error ? e.message : String(e) })
  }
}

// ---------------------------------------------------------------- tempo real

function startRealtime(eid: string): void {
  stopRealtime()
  const tables = ['orders', 'order_items', 'payments', 'fiado_settlements', 'products', 'categories', 'customers', 'materials', 'recipe_items', 'devices']
  let ch = sb().channel(`rkfood:${eid}`)
  for (const table of tables) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `establishment_id=eq.${eid}` }, () => scheduleReload())
  }
  ch = ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'establishments', filter: `id=eq.${eid}` }, () => scheduleReload())
  channel = ch.subscribe()
}

function stopRealtime(): void {
  if (channel) void sb().removeChannel(channel)
  channel = null
}

/** Junta várias mudanças seguidas numa única recarga. */
export function scheduleReload(delay = 250): void {
  const eid = getDB().establishment.id
  if (!eid) return
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reload(eid).catch((e) => console.error('Falha ao atualizar dados', e))
  }, delay)
}

/** Garante que os pedidos de um dia antigo estejam carregados (relatórios). */
export async function ensureDate(date: string): Promise<void> {
  if (extraDates.has(date)) return
  extraDates.add(date)
  await reload(getDB().establishment.id)
}

// ---------------------------------------------------------------- carregamento

const PAGE = 1000

/** Busca todas as linhas, de 1000 em 1000 (limite padrão da API). */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return today(d)
}

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const ORDER_SELECT = '*, order_items(*), payments(*)'

async function reload(eid: string): Promise<void> {
  const db = sb()
  const E = 'establishment_id'

  const [est, staff, categories, products, customers, settlements, fiadoPays, audit, materials, recipes, devices] = await Promise.all([
    db.from('establishments').select('*').eq('id', eid).single(),
    all<Row>((a, b) => db.from('staff').select('id, name, roles, deleted_at, phone, created_by, blocked_at, has_pin').eq(E, eid).range(a, b)),
    all<Row>((a, b) => db.from('categories').select('*').eq(E, eid).order('sort').range(a, b)),
    all<Row>((a, b) => db.from('products').select('*').eq(E, eid).order('name').range(a, b)),
    all<Row>((a, b) => db.from('customers').select('*').eq(E, eid).order('name').range(a, b)),
    all<Row>((a, b) => db.from('fiado_settlements').select('*').eq(E, eid).order('created_at').range(a, b)),
    all<Row>((a, b) => db.from('payments').select('order_id').eq(E, eid).eq('method', 'fiado').range(a, b)),
    db.from('audit_log').select('*').eq('establishment_id', eid).order('at', { ascending: false }).limit(300),
    all<Row>((a, b) => db.from('materials').select('*').eq(E, eid).order('name').range(a, b)),
    all<Row>((a, b) => db.from('recipe_items').select('*').eq(E, eid).range(a, b)),
    all<Row>((a, b) => db.from('devices').select('*').eq(E, eid).order('last_seen_at', { ascending: false }).range(a, b)),
  ])
  if (est.error) throw new Error(est.error.message)
  if (audit.error) throw new Error(audit.error.message)

  // Pedidos de trabalho: de ontem para cá, os ainda em aberto, os não pagos e os dias pedidos nos relatórios.
  const dates = [...extraDates].map((d) => `business_date.eq.${d}`).join(',')
  const orders = await all<Row>((a, b) =>
    db.from('orders').select(ORDER_SELECT).eq(E, eid)
      .or(`business_date.gte.${daysAgo(1)},and(settled.is.false,status.neq.cancelado),status.in.(aguardando_pagamento,novo,preparo,pronto)${dates ? ',' + dates : ''}`)
      .order('created_at')
      .range(a, b),
  )
  // Pedidos antigos pagos no fiado (para o extrato do cliente).
  const loaded = new Set(orders.map((o) => o.id as string))
  const missing = [...new Set(fiadoPays.map((p) => p.order_id as string))].filter((id) => !loaded.has(id))
  for (let i = 0; i < missing.length; i += 150) {
    const chunk = missing.slice(i, i + 150)
    const { data, error } = await db.from('orders').select(ORDER_SELECT).eq(E, eid).in('id', chunk)
    if (error) throw new Error(error.message)
    orders.push(...(data ?? []))
  }

  setSnapshot(toDatabase({
    est: est.data as Row, staff, categories, products, customers, settlements, orders, audit: (audit.data ?? []) as Row[],
    materials, recipes, devices,
  }))
}

/** Pedidos de um período (relatórios do dono). Não entram no snapshot de trabalho. */
export async function fetchOrdersBetween(from: string, to: string): Promise<{ orders: Order[]; payments: Payment[] }> {
  const eid = getDB().establishment.id
  const rows = await all<Row>((a, b) =>
    sb().from('orders').select(ORDER_SELECT).eq('establishment_id', eid)
      .gte('business_date', from).lte('business_date', to)
      .order('created_at')
      .range(a, b),
  )
  return toOrders(rows)
}

// ---------------------------------------------------------------- conversão (banco → formato do app)

function toDatabase(r: {
  est: Row; staff: Row[]; categories: Row[]; products: Row[]; customers: Row[]; settlements: Row[]; orders: Row[]; audit: Row[]
  materials: Row[]; recipes: Row[]; devices: Row[]
}): Database {
  const establishment: Establishment = {
    id: r.est.id, name: r.est.name, slogan: r.est.slogan, logoUrl: r.est.logo_url, coverUrl: r.est.cover_url,
    brandColor: r.est.brand_color, paymentTiming: r.est.payment_timing, phone: r.est.phone, address: r.est.address, pixKey: r.est.pix_key,
    kitchenTargetMin: r.est.kitchen_target_min, tableCount: r.est.table_count,
  }
  const users: User[] = r.staff.map((s) => ({
    id: s.id, name: s.name, pin: '', roles: s.roles, deletedAt: s.deleted_at, phone: s.phone ?? '', createdBy: s.created_by, blockedAt: s.blocked_at,
    pinPending: s.has_pin === false,
  }))
  const categories: Category[] = r.categories.map((c) => ({ id: c.id, name: c.name, sort: c.sort, deletedAt: c.deleted_at }))
  const products: Product[] = r.products.map((p) => ({
    id: p.id, categoryId: p.category_id, name: p.name, description: p.description, price: p.price_cents,
    photoUrl: p.photo_url, active: p.active, sendToKitchen: p.send_to_kitchen, deletedAt: p.deleted_at,
  }))
  const customers: Customer[] = r.customers.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, notes: c.notes, creditLimit: c.credit_limit_cents, deletedAt: c.deleted_at,
  }))
  const settlements: FiadoSettlement[] = r.settlements.map((s) => ({
    id: s.id, customerId: s.customer_id, amount: s.amount_cents, method: s.method, notes: s.notes, createdAt: s.created_at, createdBy: s.created_by,
  }))
  const { orders, payments } = toOrders(r.orders)
  const audit: AuditEntry[] = r.audit.map((a) => ({ id: String(a.id), at: a.at, userId: a.staff_id ?? '', action: a.action, summary: a.summary }))
  const materials: Material[] = r.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit, cost: m.cost_cents, deletedAt: m.deleted_at }))
  // numeric vem como texto da API
  const recipes: RecipeItem[] = r.recipes.map((x) => ({ productId: x.product_id, materialId: x.material_id, qty: Number(x.qty) }))
  const devices: Device[] = r.devices.map((d) => ({
    id: d.id, kind: d.kind, staffId: d.staff_id, info: d.info, firstSeenAt: d.first_seen_at, lastSeenAt: d.last_seen_at,
    lastStaffId: d.last_staff_id, blockedAt: d.blocked_at,
  }))
  return { version: DB_VERSION, establishment, users, categories, products, orders, payments, customers, settlements, audit, materials, recipes, devices }
}

function toOrders(rows: Row[]): { orders: Order[]; payments: Payment[] } {
  const payments: Payment[] = []
  const orders: Order[] = rows.map((o) => {
    for (const p of o.payments as Row[]) {
      payments.push({
        id: p.id, orderId: p.order_id, method: p.method, amount: p.amount_cents, cashReceived: p.cash_received_cents,
        customerId: p.customer_id, createdAt: p.created_at, createdBy: p.created_by, authorizedBy: p.authorized_by,
      })
    }
    return {
      id: o.id, number: o.number, businessDate: o.business_date, createdAt: o.created_at, createdBy: o.created_by,
      identType: o.ident_type, identValue: o.ident_value, mode: o.mode, notes: o.notes, status: o.status,
      cancelReason: o.cancel_reason, cancelAuthorizedBy: o.cancel_authorized_by,
      priorityAt: o.priority_at, priorityReason: o.priority_reason,
      statusHistory: (o.status_history as Row[]).map((h) => ({ status: h.status, at: h.at, by: h.by })),
      items: (o.order_items as Row[]).map((i) => ({
        id: i.id, productId: i.product_id, name: i.name, unitPrice: i.unit_price_cents, qty: i.qty, notes: i.notes, sendToKitchen: i.send_to_kitchen,
      })),
    }
  })
  return { orders, payments }
}
