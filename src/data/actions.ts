// Todas as operações que ALTERAM dados passam por aqui.
// Regras importantes:
//  - nada é apagado de verdade: "excluir" marca deletedAt e dá para restaurar;
//  - pedido nunca é apagado, só cancelado (com motivo);
//  - toda alteração fica registrada no histórico com quem fez.

import { newId } from '../lib/id'
import { brl } from '../lib/money'
import { nowIso, today } from '../lib/dates'
import type {
  Category, Customer, Database, Establishment, FiadoSettlement, IdentType, Material, Order, OrderItem,
  OrderStatus, PaymentMethod, Product, ServiceMode, User,
} from '../types'
import { METHOD_LABEL, STATUS_LABEL } from '../types'
import { commit, getDB } from './store'
import { customerBalance, expectedCash, identLabel, needsKitchen, orderRemaining, orderTotal } from './selectors'

function findOrder(d: Database, id: string): Order {
  const o = d.orders.find((x) => x.id === id)
  if (!o) throw new Error('Pedido não encontrado')
  return o
}

const userName = (d: Database, id: string) => d.users.find((u) => u.id === id)?.name ?? 'desconhecido'

/**
 * Autorização por PIN (cancelamento: gerente ou dono; cortesia: só dono).
 * A recusa fica no histórico antes do erro, igual a private.authorize no banco.
 */
function authorize(userId: string, pin: string, role: 'gerente' | 'dono', what: string): User {
  const u = getDB().users.find((x) => !x.deletedAt && pin !== '' && x.pin === pin)
  if (u && !u.blockedAt && (u.roles.includes('dono') || (role === 'gerente' && u.roles.includes('gerente')))) return u
  commit(userId, 'autorizacao.negada', () => `Autorização negada (${what}): ${!u ? 'PIN errado' : u.blockedAt ? `PIN de ${u.name}, que está bloqueado` : `PIN de ${u.name}, que não é ${role}`}`)
  throw new Error(role === 'dono'
    ? 'PIN do dono incorreto. Cortesia só com o PIN do dono.'
    : 'PIN de gerente incorreto. O cancelamento precisa do PIN de um gerente.')
}

// ---------------------------------------------------------------- Entrada e saída por PIN

export function logPinLogin(user: User): void {
  commit(user.id, 'pin.entrar', () => `Entrou com o PIN: ${user.name}`)
}

export function logPinLogout(userId: string): void {
  commit(userId, 'pin.sair', (d) => `Saiu: ${userName(d, userId)}`)
}

export function logWrongPin(): void {
  commit('', 'pin.errado', () => 'PIN errado ao entrar')
}

export function logBlockedPin(user: User): void {
  commit(user.id, 'pin.bloqueado', () => `Tentou entrar com perfil bloqueado: ${user.name}`)
}

function pushStatus(o: Order, status: OrderStatus, userId: string): void {
  o.status = status
  o.statusHistory.push({ status, at: nowIso(), by: userId })
}

// ---------------------------------------------------------------- Pedidos

export interface NewOrderInput {
  identType: IdentType
  identValue: string
  mode: ServiceMode
  notes: string
  items: Omit<OrderItem, 'id'>[]
}

export function createOrder(userId: string, input: NewOrderInput): Order {
  if (!input.identValue.trim()) throw new Error(input.identType === 'mesa' ? 'Informe a mesa' : 'Informe o nome do cliente')
  if (input.items.length === 0) throw new Error('Adicione pelo menos um item')
  let created!: Order
  commit(userId, 'pedido.criar', (d) => {
    const businessDate = today()
    const number = d.orders.filter((o) => o.businessDate === businessDate).reduce((m, o) => Math.max(m, o.number), 0) + 1
    const at = nowIso()
    const initial: OrderStatus = d.establishment.paymentTiming === 'antes' ? 'aguardando_pagamento' : 'novo'
    created = {
      id: newId(),
      number,
      businessDate,
      createdAt: at,
      createdBy: userId,
      identType: input.identType,
      identValue: input.identValue.trim(),
      mode: input.mode,
      notes: input.notes.trim(),
      status: initial,
      items: input.items.map((i) => ({ ...i, id: newId() })),
      statusHistory: [{ status: initial, at, by: userId }],
      cancelReason: null,
      cancelAuthorizedBy: null,
      priorityAt: null,
      priorityReason: null,
    }
    // Pedido só com itens que não passam pela cozinha (ex.: bebidas) já nasce pronto.
    if (initial === 'novo' && !needsKitchen(created)) pushStatus(created, 'pronto', userId)
    d.orders.push(created)
    return `Pedido nº ${created.number} — ${identLabel(created)} — ${brl(orderTotal(created))}`
  })
  return created
}

export function setOrderStatus(userId: string, orderId: string, status: OrderStatus): void {
  commit(userId, 'pedido.status', (d) => {
    const o = findOrder(d, orderId)
    if (o.status === 'cancelado') throw new Error('Pedido cancelado')
    pushStatus(o, status, userId)
    return `Pedido nº ${o.number} → ${STATUS_LABEL[status]}`
  })
}

/** Cancelar exige o PIN de um gerente (ou dono), digitado na hora. */
export function cancelOrder(userId: string, orderId: string, reason: string, authPin: string): void {
  if (!reason.trim()) throw new Error('Informe o motivo do cancelamento')
  const db = getDB()
  const cur = findOrder(db, orderId)
  if (cur.status === 'cancelado') throw new Error('Pedido já está cancelado')
  if (db.payments.some((p) => p.orderId === orderId)) throw new Error('Pedido já tem pagamento registrado e não pode ser cancelado')
  const approver = authorize(userId, authPin, 'gerente', `cancelar pedido nº ${cur.number}, ${identLabel(cur)}`)
  commit(userId, 'pedido.cancelar', (d) => {
    const o = findOrder(d, orderId)
    o.cancelReason = reason.trim()
    o.cancelAuthorizedBy = approver.id
    pushStatus(o, 'cancelado', userId)
    return `Pedido nº ${o.number} (${identLabel(o)}) cancelado por ${userName(d, userId)}, autorizado por ${approver.name}: ${reason.trim()}`
  })
}

/** Gerente puxa o pedido para o topo da fila da cozinha (com motivo) ou devolve à ordem normal. */
export function setOrderPriority(userId: string, orderId: string, priority: boolean, reason: string): void {
  commit(userId, 'pedido.adiantar', (d) => {
    const o = findOrder(d, orderId)
    if (priority) {
      if (o.status !== 'novo' && o.status !== 'preparo') throw new Error('Só dá para adiantar pedido que está na fila da cozinha')
      if (!reason.trim()) throw new Error('Informe o motivo')
      o.priorityAt = nowIso()
      o.priorityReason = reason.trim()
      return `Pedido nº ${o.number} (${identLabel(o)}) adiantado na fila: ${reason.trim()}`
    }
    o.priorityAt = null
    o.priorityReason = null
    return `Pedido nº ${o.number} (${identLabel(o)}) voltou à ordem normal da fila`
  })
}

// ---------------------------------------------------------------- Pagamentos

export interface PaymentInput {
  method: PaymentMethod
  amount: number
  cashReceived?: number | null
  customerId?: string | null
}

/** Com cortesia em alguma parte, authPin precisa ser o PIN do dono. */
export function payOrder(userId: string, orderId: string, payments: PaymentInput[], authPin = ''): void {
  const parts = payments.filter((p) => p.amount > 0)
  if (parts.length === 0) throw new Error('Informe o valor recebido')
  const approver = parts.some((p) => p.method === 'cortesia')
    ? (() => {
        const o = findOrder(getDB(), orderId)
        return authorize(userId, authPin, 'dono', `cortesia no pedido nº ${o.number}, ${identLabel(o)}`)
      })()
    : null
  commit(userId, 'pedido.pagar', (d) => {
    const o = findOrder(d, orderId)
    if (o.status === 'cancelado') throw new Error('Pedido cancelado')
    const remaining = orderRemaining(d, o)
    const total = parts.reduce((s, p) => s + p.amount, 0)
    if (total > remaining) throw new Error(`Valor maior que o restante (${brl(remaining)})`)
    for (const p of parts) {
      if (p.method === 'fiado') {
        if (!p.customerId) throw new Error('Escolha o cliente do fiado')
        const c = d.customers.find((x) => x.id === p.customerId && !x.deletedAt)
        if (!c) throw new Error('Cliente não encontrado')
        if (c.creditLimit > 0 && customerBalance(d, c.id) + p.amount > c.creditLimit)
          throw new Error(`${c.name} passaria do limite de fiado (${brl(c.creditLimit)})`)
      }
      if (p.method === 'dinheiro' && p.cashReceived != null && p.cashReceived < p.amount)
        throw new Error('Dinheiro entregue é menor que o valor')
      d.payments.push({
        id: newId(),
        orderId,
        method: p.method,
        amount: p.amount,
        cashReceived: p.method === 'dinheiro' ? (p.cashReceived ?? null) : null,
        customerId: p.method === 'fiado' ? (p.customerId ?? null) : null,
        createdAt: nowIso(),
        createdBy: userId,
        authorizedBy: p.method === 'cortesia' ? approver!.id : null,
      })
    }
    // Se a casa cobra antes, o pedido só vai para a cozinha quando estiver pago.
    if (o.status === 'aguardando_pagamento' && orderRemaining(d, o) === 0) {
      pushStatus(o, needsKitchen(o) ? 'novo' : 'pronto', userId)
    }
    return `Pedido nº ${o.number} (${identLabel(o)}): ${parts.map((p) => `${METHOD_LABEL[p.method]} ${brl(p.amount)}`).join(' + ')}` +
      (approver ? ` (cortesia autorizada por ${approver.name})` : '')
  })
}

// ---------------------------------------------------------------- Fiado

export type CustomerInput = Omit<Customer, 'id' | 'deletedAt'> & { id?: string }

export function saveCustomer(userId: string, c: CustomerInput): Customer {
  if (!c.name.trim()) throw new Error('Informe o nome do cliente')
  let saved!: Customer
  commit(userId, c.id ? 'cliente.editar' : 'cliente.criar', (d) => {
    const data = { ...c, name: c.name.trim(), phone: c.phone.replace(/\D/g, '') }
    if (c.id) {
      const cur = d.customers.find((x) => x.id === c.id)
      if (!cur) throw new Error('Cliente não encontrado')
      Object.assign(cur, data)
      saved = cur
    } else {
      saved = { ...data, id: newId(), deletedAt: null }
      d.customers.push(saved)
    }
    return `Cliente ${saved.name}`
  })
  return saved
}

export function receiveFiado(
  userId: string, customerId: string, amount: number, method: FiadoSettlement['method'], notes: string,
): void {
  if (amount <= 0) throw new Error('Informe o valor')
  commit(userId, 'fiado.receber', (d) => {
    const balance = customerBalance(d, customerId)
    if (amount > balance) throw new Error(`Valor maior que a dívida (${brl(balance)})`)
    d.settlements.push({ id: newId(), customerId, amount, method, notes: notes.trim(), createdAt: nowIso(), createdBy: userId })
    const c = d.customers.find((x) => x.id === customerId)
    return `Fiado recebido de ${c?.name ?? '?'}: ${brl(amount)} (${METHOD_LABEL[method]})`
  })
}

// ---------------------------------------------------------------- Cardápio

export function saveCategory(userId: string, c: { id?: string; name: string }): void {
  const name = c.name.trim()
  if (!name) throw new Error('Informe o nome da categoria')
  commit(userId, c.id ? 'categoria.editar' : 'categoria.criar', (d) => {
    if (c.id) {
      const cur = d.categories.find((x) => x.id === c.id)
      if (cur) cur.name = name
    } else {
      const sort = d.categories.reduce((m, x) => Math.max(m, x.sort), 0) + 1
      d.categories.push({ id: newId(), name, sort, deletedAt: null })
    }
    return `Categoria ${name}`
  })
}

export function moveCategory(userId: string, id: string, dir: -1 | 1): void {
  commit(userId, 'categoria.ordenar', (d) => {
    const list = d.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sort - b.sort)
    const i = list.findIndex((c) => c.id === id)
    const j = i + dir
    if (i >= 0 && j >= 0 && j < list.length) [list[i].sort, list[j].sort] = [list[j].sort, list[i].sort]
    return 'Ordem das categorias alterada'
  })
}

export type ProductInput = Omit<Product, 'id' | 'deletedAt'> & { id?: string }

export function saveProduct(userId: string, p: ProductInput): void {
  const name = p.name.trim()
  if (!name) throw new Error('Informe o nome do item')
  if (p.price <= 0) throw new Error('Informe o preço')
  if (!p.categoryId) throw new Error('Escolha a categoria')
  commit(userId, p.id ? 'item.editar' : 'item.criar', (d) => {
    if (p.id) {
      const cur = d.products.find((x) => x.id === p.id)
      if (!cur) throw new Error('Item não encontrado')
      Object.assign(cur, { ...p, name })
    } else {
      d.products.push({ ...p, name, id: newId(), deletedAt: null })
    }
    return `Item ${name} — ${brl(p.price)}`
  })
}

// ---------------------------------------------------------------- Lixeira (exclusão reversível)

export type Trashable = 'categories' | 'products' | 'customers' | 'users'
const TRASH_LABEL: Record<Trashable, string> = { categories: 'Categoria', products: 'Item', customers: 'Cliente', users: 'Usuário' }

function trashList(d: Database, kind: Trashable): (Category | Product | Customer | User)[] {
  return d[kind]
}

function ownerCount(d: Database): number {
  return d.users.filter((u) => !u.deletedAt && u.roles.includes('dono')).length
}

const isOwner = (d: Database, userId: string) => !!d.users.find((u) => u.id === userId)?.roles.includes('dono')

export function moveToTrash(userId: string, kind: Trashable, id: string): void {
  commit(userId, `${kind}.excluir`, (d) => {
    const cur = trashList(d, kind).find((x) => x.id === id)
    if (!cur) throw new Error('Registro não encontrado')
    if (kind === 'users') {
      if (!isOwner(d, userId)) throw new Error('Seu perfil não permite esta ação.')
      if (id === userId) throw new Error('Você não pode excluir o próprio usuário')
      if ((cur as User).roles.includes('dono') && ownerCount(d) === 1) throw new Error('É preciso ter pelo menos um dono')
    }
    cur.deletedAt = nowIso()
    return `${TRASH_LABEL[kind]} "${cur.name}" movido para a lixeira`
  })
}

export function restoreFromTrash(userId: string, kind: Trashable, id: string): void {
  commit(userId, `${kind}.restaurar`, (d) => {
    const cur = trashList(d, kind).find((x) => x.id === id)
    if (!cur) throw new Error('Registro não encontrado')
    if (kind === 'users' && !isOwner(d, userId)) throw new Error('Seu perfil não permite esta ação.')
    if (kind === 'users' && d.users.some((u) => !u.deletedAt && u.pin === (cur as User).pin))
      throw new Error('Outro usuário já usa o mesmo PIN. Altere o PIN antes de restaurar.')
    cur.deletedAt = null
    return `${TRASH_LABEL[kind]} "${cur.name}" restaurado`
  })
}

// ---------------------------------------------------------------- Estabelecimento e usuários

export function saveEstablishment(userId: string, e: Establishment): void {
  if (!e.name.trim()) throw new Error('Informe o nome do estabelecimento')
  if (!Number.isInteger(e.kitchenTargetMin) || e.kitchenTargetMin < 1 || e.kitchenTargetMin > 180) {
    throw new Error('O tempo estimado deve ser de 1 a 180 minutos')
  }
  if (!Number.isInteger(e.tableCount) || e.tableCount < 0 || e.tableCount > 200) {
    throw new Error('A quantidade de mesas deve ser de 0 a 200')
  }
  commit(userId, 'estabelecimento.editar', (d) => {
    const cur = d.establishment
    // aparência é do dono; o gerente muda funcionamento e contato (igual ao banco)
    const look = (x: Establishment) => [x.name.trim(), x.slogan, x.logoUrl, x.coverUrl, x.brandColor].join('\u0000')
    if (look(e) !== look(cur) && !isOwner(d, userId)) {
      throw new Error('Só o dono pode mudar o nome, a frase, a cor, a logomarca e a foto')
    }
    const changes = [
      cur.kitchenTargetMin !== e.kitchenTargetMin && `tempo estimado: ${cur.kitchenTargetMin} → ${e.kitchenTargetMin} min`,
      cur.tableCount !== e.tableCount && `mesas: ${cur.tableCount} → ${e.tableCount}`,
      cur.brandColor !== e.brandColor && `cor: ${cur.brandColor} → ${e.brandColor}`,
    ].filter(Boolean)
    d.establishment = { ...e, name: e.name.trim() }
    return `Dados do estabelecimento atualizados${changes.length ? ` (${changes.join('; ')})` : ''}`
  })
}

export type UserInput = Omit<User, 'id' | 'deletedAt' | 'createdBy' | 'blockedAt'> & { id?: string }

export function saveUser(userId: string, u: UserInput): void {
  const name = u.name.trim()
  if (!name) throw new Error('Informe o nome')
  if (!/^\d{4,6}$/.test(u.pin)) throw new Error('O PIN deve ter de 4 a 6 números')
  if (u.roles.length === 0) throw new Error('Escolha pelo menos um perfil')
  const phone = u.phone.replace(/\D/g, '')
  if (phone && (phone.length < 10 || phone.length > 13)) throw new Error('Telefone inválido. Use DDD + número, ex.: 81 99999-0000')
  commit(userId, u.id ? 'usuario.editar' : 'usuario.criar', (d) => {
    // o gerente só cria atendente; editar qualquer perfil é só do dono (igual ao banco)
    if (!isOwner(d, userId)) {
      if (u.id) throw new Error('Só o dono pode alterar um perfil')
      if (u.roles.length !== 1 || u.roles[0] !== 'atendente') throw new Error('O gerente só cria perfil de atendente')
    }
    // Um PIN não pode começar com outro (ex.: 1234 e 123456), senão o login entraria no usuário errado.
    if (d.users.some((x) => !x.deletedAt && x.id !== u.id && (x.pin.startsWith(u.pin) || u.pin.startsWith(x.pin))))
      throw new Error('Esse PIN já está em uso (ou começa igual ao de outro usuário)')
    if (u.id) {
      const cur = d.users.find((x) => x.id === u.id)
      if (!cur) throw new Error('Usuário não encontrado')
      if (cur.roles.includes('dono') && !u.roles.includes('dono') && ownerCount(d) === 1)
        throw new Error('É preciso ter pelo menos um dono')
      Object.assign(cur, { ...u, name, phone })
    } else {
      d.users.push({ ...u, name, phone, id: newId(), deletedAt: null, createdBy: userId, blockedAt: null })
    }
    return `Usuário ${name} (${u.roles.join(', ')}) ${u.id ? 'alterado' : 'criado'} por ${userName(d, userId)}`
  })
}

/** Só o dono. Bloqueado não entra com o PIN nem autoriza nada. */
export function setUserBlocked(userId: string, id: string, blocked: boolean): void {
  commit(userId, blocked ? 'usuario.bloquear' : 'usuario.desbloquear', (d) => {
    if (!isOwner(d, userId)) throw new Error('Seu perfil não permite esta ação.')
    const u = d.users.find((x) => x.id === id)
    if (!u) throw new Error('Usuário não encontrado')
    if (blocked && id === userId) throw new Error('Você não pode bloquear o próprio perfil')
    u.blockedAt = blocked ? nowIso() : null
    return `Usuário ${u.name} ${blocked ? 'bloqueado' : 'desbloqueado'} por ${userName(d, userId)}`
  })
}

// ---------------------------------------------------------------- Materiais e ficha técnica (só o dono)

function requireOwner(d: Database, userId: string): void {
  if (!isOwner(d, userId)) throw new Error('Seu perfil não permite esta ação.')
}

const qtyLabel = (qty: number, unit: Material['unit']) => `${String(Math.round(qty * 10000) / 10000).replace('.', ',')} ${unit}`

export type MaterialInput = Omit<Material, 'id' | 'deletedAt'> & { id?: string }

export function saveMaterial(userId: string, m: MaterialInput): Material {
  const name = m.name.trim()
  if (!name) throw new Error('Informe o nome do material')
  if (!['kg', 'l', 'un'].includes(m.unit)) throw new Error('Unidade inválida')
  if (!Number.isInteger(m.cost) || m.cost < 0) throw new Error('Custo inválido')
  let saved!: Material
  commit(userId, m.id ? 'material.editar' : 'material.criar', (d) => {
    requireOwner(d, userId)
    if (d.materials.some((x) => !x.deletedAt && x.id !== m.id && x.name.trim().toLowerCase() === name.toLowerCase()))
      throw new Error('Já existe um material com esse nome')
    if (m.id) {
      const cur = d.materials.find((x) => x.id === m.id)
      if (!cur) throw new Error('Material não encontrado')
      Object.assign(cur, { name, unit: m.unit, cost: m.cost })
      saved = { ...cur }
    } else {
      saved = { id: newId(), name, unit: m.unit, cost: m.cost, deletedAt: null }
      d.materials.push(saved)
    }
    return `Material ${name} (${m.unit}, custo ${brl(m.cost)} por ${m.unit})`
  })
  return saved
}

export function setMaterialTrashed(userId: string, id: string, trashed: boolean): void {
  commit(userId, trashed ? 'material.excluir' : 'material.restaurar', (d) => {
    requireOwner(d, userId)
    const m = d.materials.find((x) => x.id === id)
    if (!m) throw new Error('Material não encontrado')
    if (trashed) {
      const used = d.recipes
        .filter((r) => r.materialId === id)
        .map((r) => d.products.find((p) => p.id === r.productId && !p.deletedAt)?.name)
        .filter(Boolean)
        .sort()
      if (used.length) throw new Error(`Esse material está na ficha técnica de: ${used.join(', ')}. Tire de lá antes.`)
    }
    m.deletedAt = trashed ? nowIso() : null
    return `Material "${m.name}" ${trashed ? 'movido para a lixeira' : 'restaurado'}`
  })
}

/** Troca a ficha do item por "1 un" do material com o mesmo nome (cria ou reaproveita). */
function applyReadyMade(d: Database, product: Product, cost: number | null): Material {
  const name = product.name.trim()
  let m = d.materials.find((x) => !x.deletedAt && x.name.trim().toLowerCase() === name.toLowerCase())
  if (m && m.unit !== 'un') throw new Error(`Já existe o material ${m.name} comprado por ${m.unit}. Use "Montar ficha".`)
  if (!m) {
    m = { id: newId(), name, unit: 'un', cost: cost ?? 0, deletedAt: null }
    d.materials.push(m)
  } else if (cost !== null) {
    m.cost = cost
  }
  d.recipes = [...d.recipes.filter((r) => r.productId !== product.id), { productId: product.id, materialId: m.id, qty: 1 }]
  return m
}

/**
 * Item comprado pronto (refrigerante, limoneto, espeto já montado): a ficha vira "1 un" do
 * material com o nome do item. cost null mantém o custo de um material que já existe.
 */
export function saveReadyMade(userId: string, productId: string, cost: number | null): void {
  if (cost !== null && (!Number.isInteger(cost) || cost < 0)) throw new Error('Custo inválido')
  commit(userId, 'ficha.editar', (d) => {
    requireOwner(d, userId)
    const product = d.products.find((p) => p.id === productId && !p.deletedAt)
    if (!product) throw new Error('Item do cardápio não encontrado')
    const m = applyReadyMade(d, product, cost)
    return `${product.name} marcado como comprado pronto: 1 un de ${m.name} (custo ${m.cost > 0 ? brl(m.cost) : 'não informado'})`
  })
}

/** A categoria inteira como comprada pronta. Devolve os itens que ficaram de fora (material em kg ou litro). */
export function saveReadyMadeCategory(userId: string, categoryId: string): string[] {
  const skipped: string[] = []
  commit(userId, 'ficha.editar', (d) => {
    requireOwner(d, userId)
    const cat = d.categories.find((c) => c.id === categoryId && !c.deletedAt)
    if (!cat) throw new Error('Categoria não encontrada')
    const products = d.products.filter((p) => p.categoryId === cat.id && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
    if (products.length === 0) throw new Error('Essa categoria não tem itens')
    const done: string[] = []
    for (const p of products) {
      try {
        applyReadyMade(d, p, null)
        done.push(p.name)
      } catch {
        skipped.push(p.name)
      }
    }
    return `Categoria ${cat.name} marcada como comprada pronta: ${done.length ? done.join(', ') : 'nenhum item'}` +
      (skipped.length ? ` (ficaram de fora: ${skipped.join(', ')})` : '')
  })
  return skipped
}

/** Substitui a ficha técnica inteira de um item do cardápio. qty na unidade do material. */
export function saveRecipe(userId: string, productId: string, items: { materialId: string; qty: number }[]): void {
  commit(userId, 'ficha.editar', (d) => {
    requireOwner(d, userId)
    const product = d.products.find((p) => p.id === productId)
    if (!product) throw new Error('Item do cardápio não encontrado')
    const parts: string[] = []
    const seen = new Set<string>()
    for (const it of items) {
      const m = d.materials.find((x) => x.id === it.materialId && !x.deletedAt)
      if (!m) throw new Error('Material não encontrado')
      if (!(it.qty > 0)) throw new Error(`Quantidade inválida para ${m.name}`)
      if (seen.has(m.id)) throw new Error(`${m.name} aparece duas vezes na ficha`)
      seen.add(m.id)
      parts.push(`${qtyLabel(it.qty, m.unit)} de ${m.name}`)
    }
    d.recipes = [
      ...d.recipes.filter((r) => r.productId !== productId),
      ...items.map((it) => ({ productId, materialId: it.materialId, qty: Math.round(it.qty * 10000) / 10000 })),
    ]
    return `Ficha técnica de ${product.name}: ${parts.length ? parts.join(' + ') : 'sem materiais'}`
  })
}

// ---------------------------------------------------------------- Caixa (abrir e fechar)


export function openCash(userId: string, openingCents: number): void {
  if (!Number.isInteger(openingCents) || openingCents < 0) throw new Error('Informe o troco da gaveta')
  commit(userId, 'caixa.abrir', (d) => {
    if (d.cashSessions.some((s) => !s.closedAt)) throw new Error('O caixa já está aberto')
    d.cashSessions.unshift({
      id: newId(), businessDate: today(), openedAt: nowIso(), openedBy: userId, openingCents,
      closedAt: null, closedBy: null, expectedCents: null, countedCents: null, differenceCents: null, note: '',
    })
    return `Caixa aberto com troco de ${brl(openingCents)}`
  })
}

/** Devolve a diferença (contado − esperado). */
export function closeCash(userId: string, countedCents: number, note: string): number {
  if (!Number.isInteger(countedCents) || countedCents < 0) throw new Error('Informe o dinheiro contado na gaveta')
  let diff = 0
  commit(userId, 'caixa.fechar', (d) => {
    const s = d.cashSessions.find((x) => !x.closedAt)
    if (!s) throw new Error('O caixa não está aberto')
    const expected = expectedCash(d, s)
    diff = countedCents - expected
    Object.assign(s, { closedAt: nowIso(), closedBy: userId, expectedCents: expected, countedCents, differenceCents: diff, note: note.trim() })
    return `Caixa fechado: esperado ${brl(expected)}, contado ${brl(countedCents)}, diferença ${diff < 0 ? '− ' : ''}${brl(Math.abs(diff))}${note.trim() ? ` (${note.trim()})` : ''}`
  })
  return diff
}

// ---------------------------------------------------------------- Observações rápidas

export function saveQuickNotes(userId: string, notes: string[]): void {
  const clean: string[] = []
  for (const n of notes.map((x) => x.trim()).filter(Boolean)) {
    if (!clean.some((c) => c.toLowerCase() === n.toLowerCase())) clean.push(n)
  }
  if (clean.length > 20) throw new Error('No máximo 20 observações rápidas')
  if (clean.some((c) => c.length > 30 || c.includes(','))) throw new Error('Cada observação deve ter até 30 letras e não pode ter vírgula')
  commit(userId, 'estabelecimento.editar', (d) => {
    d.establishment.quickNotes = clean
    return `Observações rápidas: ${clean.length ? clean.join(', ') : 'padrão'}`
  })
}
