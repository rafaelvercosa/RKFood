// Modelo de dados do RKFood.
// Os mesmos conceitos existem no banco (supabase/migrations). Valores em dinheiro
// são sempre guardados em CENTAVOS (inteiros) para evitar erro de arredondamento.

/** Gerente pode tudo; dono pode tudo e é o único que autoriza cortesia e mexe em outro dono. */
export type Role = 'atendente' | 'cozinha' | 'caixa' | 'gerente' | 'dono'

export const ROLE_LABEL: Record<Role, string> = {
  atendente: 'Atendente',
  cozinha: 'Cozinha',
  caixa: 'Caixa',
  gerente: 'Gerente',
  dono: 'Dono',
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
  /** Em quantos minutos um pedido deve ficar pronto (cronômetro e alerta da cozinha). */
  kitchenTargetMin: number
  /** Quantos botões de mesa o atendente vê (0 = só o campo de texto). */
  tableCount: number
}

export interface User {
  id: string
  name: string
  pin: string
  roles: Role[]
  deletedAt: string | null
  /** Telefone com WhatsApp, só números (para mandar o link de acesso). */
  phone: string
  /** Quem criou o perfil. */
  createdBy: string | null
  /** Bloqueado pelo dono: não entra com o PIN nem autoriza nada. */
  blockedAt: string | null
  /** Só na nuvem: perfil criado sem PIN, esperando a pessoa criar o dela pelo link. */
  pinPending?: boolean
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
  /** Gerente que autorizou o cancelamento com o PIN. */
  cancelAuthorizedBy: string | null
  /** Quando o gerente adiantou o pedido na fila da cozinha (null = ordem normal). */
  priorityAt: string | null
  priorityReason: string | null
}

/** Cortesia: o pedido sai sem cobrança, só com o PIN do dono. */
export type PaymentMethod = 'pix' | 'credito' | 'debito' | 'dinheiro' | 'fiado' | 'cortesia'

/** Formas que entram no caixa (fiado é dívida; cortesia não é cobrada). */
export type CashMethod = Exclude<PaymentMethod, 'fiado' | 'cortesia'>

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  credito: 'Crédito',
  debito: 'Débito',
  dinheiro: 'Dinheiro',
  fiado: 'Fiado',
  cortesia: 'Cortesia',
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
  /** Cortesia: o dono que autorizou com o PIN. */
  authorizedBy: string | null
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
  method: CashMethod
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

/** Unidade de compra do material: quilo, litro ou unidade. */
export type MaterialUnit = 'kg' | 'l' | 'un'

/** O que a barraca compra (carne, palito, carvão, refrigerante...). */
export interface Material {
  id: string
  name: string
  unit: MaterialUnit
  /** Custo em centavos por kg, por litro ou por unidade (0 = não informado). */
  cost: number
  deletedAt: string | null
}

/** Uma linha da ficha técnica: quanto de um material um item do cardápio gasta, na unidade do material. */
export interface RecipeItem {
  productId: string
  materialId: string
  qty: number
}

/** Aparelho que entrou no sistema (conta do estabelecimento ou link de convite). */
export interface Device {
  id: string
  kind: 'estabelecimento' | 'convite'
  /** Convite: de quem é o celular. */
  staffId: string | null
  info: string
  firstSeenAt: string
  lastSeenAt: string
  lastStaffId: string | null
  blockedAt: string | null
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
  materials: Material[]
  recipes: RecipeItem[]
  devices: Device[]
}
