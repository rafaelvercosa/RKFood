// Modelo de dados do RKFood.
// Os mesmos conceitos existem no banco (supabase/migrations). Valores em dinheiro
// são sempre guardados em CENTAVOS (inteiros) para evitar erro de arredondamento.

export type Role = 'atendente' | 'cozinha' | 'caixa' | 'gerente'

export const ROLE_LABEL: Record<Role, string> = {
  atendente: 'Atendente',
  cozinha: 'Cozinha',
  caixa: 'Caixa',
  gerente: 'Gerente',
}

/** Quando o cliente paga: antes do pedido ir para a cozinha ou depois de consumir. */
export type PaymentTiming = 'antes' | 'depois'

export interface Establishment {
  id: string
  name: string
  slogan: string
  logoUrl: string | null
  coverUrl: string | null
  brandColor: string
  paymentTiming: PaymentTiming
  phone: string
  address: string
  /** Pix copia-e-cola ou chave Pix, exibida no extrato do fiado. */
  pixKey: string
}

export interface User {
  id: string
  name: string
  pin: string
  roles: Role[]
  deletedAt: string | null
}

export interface Category {
  id: string
  name: string
  sort: number
  deletedAt: string | null
}

export interface Product {
  id: string
  categoryId: string
  name: string
  description: string
  price: number // centavos
  photoUrl: string | null
  active: boolean
  /** Bebida em lata, por exemplo, não precisa passar pela cozinha. */
  sendToKitchen: boolean
  deletedAt: string | null
}

export type OrderStatus =
  | 'aguardando_pagamento'
  | 'novo'
  | 'preparo'
  | 'pronto'
  | 'entregue'
  | 'cancelado'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  aguardando_pagamento: 'Aguardando pagamento',
  novo: 'Novo',
  preparo: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
}

export type IdentType = 'mesa' | 'nome'
export type ServiceMode = 'local' | 'viagem'

export interface OrderItem {
  id: string
  productId: string
  name: string
  unitPrice: number // centavos, congelado no momento do pedido
  qty: number
  notes: string
  sendToKitchen: boolean
}

export interface Order {
  id: string
  number: number // sequencial do dia
  businessDate: string // AAAA-MM-DD
  createdAt: string
  createdBy: string
  identType: IdentType
  identValue: string
  mode: ServiceMode
  notes: string
  status: OrderStatus
  items: OrderItem[]
  statusHistory: { status: OrderStatus; at: string; by: string }[]
  cancelReason: string | null
}

export type PaymentMethod = 'pix' | 'credito' | 'debito' | 'dinheiro' | 'fiado'

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  credito: 'Crédito',
  debito: 'Débito',
  dinheiro: 'Dinheiro',
  fiado: 'Fiado',
}

/** Pagamento de um pedido. Quando method = 'fiado', o valor vira dívida do cliente. */
export interface Payment {
  id: string
  orderId: string
  method: PaymentMethod
  amount: number // centavos
  cashReceived: number | null // só para dinheiro: quanto o cliente entregou
  customerId: string | null // obrigatório quando fiado
  createdAt: string
  createdBy: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  notes: string
  /** Limite de fiado em centavos (0 = sem limite). */
  creditLimit: number
  deletedAt: string | null
}

/** Pagamento de uma dívida de fiado (quitação total ou parcial). */
export interface FiadoSettlement {
  id: string
  customerId: string
  amount: number
  method: Exclude<PaymentMethod, 'fiado'>
  notes: string
  createdAt: string
  createdBy: string
}

export interface AuditEntry {
  id: string
  at: string
  userId: string
  action: string
  summary: string
}

export interface Database {
  version: number
  establishment: Establishment
  users: User[]
  categories: Category[]
  products: Product[]
  orders: Order[]
  payments: Payment[]
  customers: Customer[]
  settlements: FiadoSettlement[]
  audit: AuditEntry[]
}
