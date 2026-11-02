// Ponto único de ESCRITA usado pelas telas.
// Modo demonstração → actions.ts (no navegador).
// Modo nuvem → funções (RPC) do Supabase, que validam, gravam e registram no histórico.
// Depois de gravar na nuvem, recarregamos os dados (o tempo real também avisa os outros aparelhos).

import { newId } from '../lib/id'
import type { Customer, Establishment, FiadoSettlement, OrderStatus, PaymentMethod, User } from '../types'
import * as demo from './actions'
import { isCloud, sb } from './backend'
import { establishmentId, friendly, scheduleReload, withTimeout } from './cloud'
import { clearOperator, currentUserId, operatorToken, setOperator } from './session'
import { getDB } from './store'

export type { CustomerInput, NewOrderInput, PaymentInput, ProductInput, Trashable, UserInput } from './actions'
import type { CustomerInput, NewOrderInput, PaymentInput, ProductInput, Trashable, UserInput } from './actions'

/** Erro de sessão do operador vencida: a tela volta para o PIN. */
export class SessionExpiredError extends Error {}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const token = operatorToken()
  if (!token) {
    clearOperator()
    throw new SessionExpiredError('Digite o PIN novamente.')
  }
  const { data, error } = await withTimeout(sb().rpc(fn, { p_token: token, ...args }))
  if (error) {
    if (error.hint === 'sessao_expirada') {
      clearOperator()
      throw new SessionExpiredError(error.message)
    }
    throw new Error(friendly(error.message))
  }
  scheduleReload(0)
  return data as T
}

const uid = () => currentUserId()

// ---------------------------------------------------------------- operador (PIN)

export async function loginPin(pin: string): Promise<User> {
  if (!isCloud) {
    const user = getDB().users.find((u) => !u.deletedAt && u.pin === pin)
    if (!user) {
      demo.logWrongPin()
      throw new Error('PIN não encontrado')
    }
    demo.logPinLogin(user)
    setOperator(user.id, null)
    return user
  }
  const { data, error } = await withTimeout(sb().rpc('operator_login', { p_establishment: establishmentId(), p_pin: pin }))
  if (error) throw new Error(friendly(error.message))
  // PIN errado: o banco registra no histórico e devolve nenhuma linha
  const row = (data as { token: string; staff_id: string; name: string; roles: User['roles'] }[])[0]
  if (!row) throw new Error('PIN não encontrado')
  setOperator(row.staff_id, row.token)
  return { id: row.staff_id, name: row.name, roles: row.roles, pin: '', deletedAt: null }
}

export async function logoutOperator(): Promise<void> {
  const token = operatorToken()
  if (!isCloud && token === null) {
    const id = uid()
    if (id !== 'desconhecido') demo.logPinLogout(id)
  }
  clearOperator()
  if (isCloud && token) await sb().rpc('operator_logout', { p_token: token })
}

// ---------------------------------------------------------------- pedidos e pagamentos

export async function createOrder(input: NewOrderInput): Promise<void> {
  if (!isCloud) return void demo.createOrder(uid(), input)
  await rpc('create_order', {
    p_ident_type: input.identType, p_ident_value: input.identValue, p_mode: input.mode, p_notes: input.notes,
    p_items: input.items.map((i) => ({ product_id: i.productId, qty: i.qty, notes: i.notes })),
  })
}

export async function setOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  if (!isCloud) return demo.setOrderStatus(uid(), orderId, status)
  await rpc('set_order_status', { p_order: orderId, p_status: status })
}

/** Exige o PIN de um gerente (ou dono). PIN recusado fica no histórico. */
export async function cancelOrder(orderId: string, reason: string, authPin: string): Promise<void> {
  if (!isCloud) return demo.cancelOrder(uid(), orderId, reason, authPin)
  // o banco devolve a mensagem (em vez de erro) quando o PIN não autoriza, para o registro ficar
  const refused = await rpc<string | null>('cancel_order', { p_order: orderId, p_reason: reason, p_auth_pin: authPin })
  if (refused) throw new Error(refused)
}

/** Só gerente. Adiantar exige motivo; fica no histórico. */
export async function setOrderPriority(orderId: string, priority: boolean, reason = ''): Promise<void> {
  if (!isCloud) return demo.setOrderPriority(uid(), orderId, priority, reason)
  await rpc('set_order_priority', { p_order: orderId, p_priority: priority, p_reason: reason })
}

/** Com cortesia, authPin precisa ser o PIN do dono. */
export async function payOrder(orderId: string, payments: PaymentInput[], authPin = ''): Promise<void> {
  if (!isCloud) return demo.payOrder(uid(), orderId, payments, authPin)
  const refused = await rpc<string | null>('pay_order', {
    p_order: orderId,
    p_payments: payments.map((p) => ({
      method: p.method, amount_cents: p.amount, cash_received_cents: p.cashReceived ?? null, customer_id: p.customerId ?? null,
    })),
    p_auth_pin: authPin || null,
  })
  if (refused) throw new Error(refused)
}

// ---------------------------------------------------------------- fiado

export async function saveCustomer(c: CustomerInput): Promise<Customer> {
  if (!isCloud) return demo.saveCustomer(uid(), c)
  const row = await rpc<{ id: string; name: string; phone: string; notes: string; credit_limit_cents: number }>('save_customer', {
    p_id: c.id ?? null, p_name: c.name, p_phone: c.phone, p_notes: c.notes, p_credit_limit_cents: c.creditLimit,
  })
  return { id: row.id, name: row.name, phone: row.phone, notes: row.notes, creditLimit: row.credit_limit_cents, deletedAt: null }
}

export async function receiveFiado(customerId: string, amount: number, method: FiadoSettlement['method'], notes: string): Promise<void> {
  if (!isCloud) return demo.receiveFiado(uid(), customerId, amount, method, notes)
  await rpc('receive_fiado', { p_customer: customerId, p_amount_cents: amount, p_method: method, p_notes: notes })
}

// ---------------------------------------------------------------- cardápio, lixeira, estabelecimento, equipe

export async function saveCategory(c: { id?: string; name: string }): Promise<void> {
  if (!isCloud) return demo.saveCategory(uid(), c)
  await rpc('save_category', { p_id: c.id ?? null, p_name: c.name })
}

export async function moveCategory(id: string, dir: -1 | 1): Promise<void> {
  if (!isCloud) return demo.moveCategory(uid(), id, dir)
  await rpc('move_category', { p_id: id, p_dir: dir })
}

export async function saveProduct(p: ProductInput): Promise<void> {
  if (!isCloud) return demo.saveProduct(uid(), p)
  await rpc('save_product', {
    p_id: p.id ?? null, p_category: p.categoryId, p_name: p.name, p_description: p.description, p_price_cents: p.price,
    p_photo_url: p.photoUrl, p_active: p.active, p_send_to_kitchen: p.sendToKitchen,
  })
}

export async function moveToTrash(kind: Trashable, id: string): Promise<void> {
  if (!isCloud) return demo.moveToTrash(uid(), kind, id)
  await rpc('set_trashed', { p_kind: kind, p_id: id, p_trashed: true })
}

export async function restoreFromTrash(kind: Trashable, id: string): Promise<void> {
  if (!isCloud) return demo.restoreFromTrash(uid(), kind, id)
  await rpc('set_trashed', { p_kind: kind, p_id: id, p_trashed: false })
}

export async function saveEstablishment(e: Establishment): Promise<void> {
  if (!isCloud) return demo.saveEstablishment(uid(), e)
  await rpc('save_establishment', {
    p_name: e.name, p_slogan: e.slogan, p_logo_url: e.logoUrl, p_cover_url: e.coverUrl, p_brand_color: e.brandColor,
    p_payment_timing: e.paymentTiming, p_phone: e.phone, p_address: e.address, p_pix_key: e.pixKey,
    p_kitchen_target_min: e.kitchenTargetMin, p_table_count: e.tableCount,
  })
}

/** No modo nuvem, PIN em branco ao editar mantém o PIN atual. */
export async function saveUser(u: UserInput): Promise<void> {
  if (!isCloud) return demo.saveUser(uid(), u)
  await rpc('save_staff', { p_id: u.id ?? null, p_name: u.name, p_pin: u.pin ? u.pin : null, p_roles: u.roles })
}

// ---------------------------------------------------------------- fotos

/**
 * Recebe a foto já reduzida (data URL). Na demonstração ela fica guardada como
 * está; na nuvem vai para o Storage e devolvemos o endereço público.
 */
export async function uploadImage(dataUrl: string): Promise<string> {
  if (!isCloud) return dataUrl
  const blob = await (await fetch(dataUrl)).blob()
  const path = `${establishmentId()}/${newId()}.jpg`
  const { error } = await withTimeout(sb().storage.from('midia').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }), 60000)
  if (error) throw new Error(`Falha ao enviar a foto: ${error.message}`)
  return sb().storage.from('midia').getPublicUrl(path).data.publicUrl
}

export type { PaymentMethod }
