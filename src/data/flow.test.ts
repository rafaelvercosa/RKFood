// Testes do fluxo principal: pedido → cozinha → pagamento → fiado → relatório.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// localStorage em memória para rodar fora do navegador
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
})
vi.stubGlobal('alert', () => {})

const { getDB, resetDemo } = await import('./store')
const actions = await import('./actions')
const sel = await import('./selectors')
const { today } = await import('../lib/dates')
const { parseBRL } = await import('../lib/money')

function setup() {
  resetDemo()
  const db = getDB()
  const owner = db.users.find((u) => u.roles.includes('gerente'))!
  const carne = db.products.find((p) => p.name === 'Carne')!
  const refri = db.products.find((p) => p.name === 'Refrigerante lata')!
  const joao = db.customers[0]
  return { owner, carne, refri, joao }
}

function item(p: { id: string; name: string; price: number; sendToKitchen: boolean }, qty: number) {
  return { productId: p.id, name: p.name, unitPrice: p.price, qty, notes: '', sendToKitchen: p.sendToKitchen }
}

describe('dinheiro', () => {
  it('converte texto em centavos', () => {
    expect(parseBRL('12,50')).toBe(1250)
    expect(parseBRL('R$ 1.234,56')).toBe(123456)
    expect(parseBRL('7.5')).toBe(750)
    expect(parseBRL('')).toBe(0)
  })
})

describe('pedidos', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('numera pedidos do dia em sequência e calcula total', () => {
    const a = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '3', mode: 'local', notes: '', items: [item(ctx.carne, 2)] })
    const b = actions.createOrder(ctx.owner.id, { identType: 'nome', identValue: 'Maria', mode: 'viagem', notes: '', items: [item(ctx.carne, 1)] })
    expect(a.number).toBe(1)
    expect(b.number).toBe(2)
    expect(sel.orderTotal(a)).toBe(2000)
    expect(a.status).toBe('novo')
  })

  it('pedido só de bebida não passa pela cozinha', () => {
    const o = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [item(ctx.refri, 1)] })
    expect(o.status).toBe('pronto')
  })

  it('exige identificação e itens', () => {
    expect(() => actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: ' ', mode: 'local', notes: '', items: [item(ctx.carne, 1)] })).toThrow()
    expect(() => actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '2', mode: 'local', notes: '', items: [] })).toThrow()
  })

  it('cobrança antes: só vai para a cozinha depois de pago', () => {
    actions.saveEstablishment(ctx.owner.id, { ...getDB().establishment, paymentTiming: 'antes' })
    const o = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [item(ctx.carne, 1)] })
    expect(o.status).toBe('aguardando_pagamento')
    actions.payOrder(ctx.owner.id, o.id, [{ method: 'pix', amount: 1000 }])
    expect(getDB().orders.find((x) => x.id === o.id)!.status).toBe('novo')
  })
})

describe('pagamentos', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('aceita pagamento dividido e não deixa pagar a mais', () => {
    const o = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '5', mode: 'local', notes: '', items: [item(ctx.carne, 3)] })
    actions.payOrder(ctx.owner.id, o.id, [{ method: 'pix', amount: 1000 }, { method: 'dinheiro', amount: 1000, cashReceived: 5000 }])
    expect(sel.orderRemaining(getDB(), o)).toBe(1000)
    expect(() => actions.payOrder(ctx.owner.id, o.id, [{ method: 'debito', amount: 1500 }])).toThrow()
    actions.payOrder(ctx.owner.id, o.id, [{ method: 'debito', amount: 1000 }])
    expect(sel.isOrderPaid(getDB(), getDB().orders.find((x) => x.id === o.id)!)).toBe(true)
  })

  it('erro no meio não salva nada (atomicidade)', () => {
    const o = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '5', mode: 'local', notes: '', items: [item(ctx.carne, 1)] })
    const before = getDB().payments.length
    expect(() => actions.payOrder(ctx.owner.id, o.id, [{ method: 'pix', amount: 500 }, { method: 'fiado', amount: 500 }])).toThrow('cliente')
    expect(getDB().payments.length).toBe(before)
  })
})

describe('fiado', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('acumula dívida, recebe parcial e gera extrato com saldo', () => {
    const o1 = actions.createOrder(ctx.owner.id, { identType: 'nome', identValue: 'João', mode: 'local', notes: '', items: [item(ctx.carne, 3)] })
    actions.payOrder(ctx.owner.id, o1.id, [{ method: 'fiado', amount: 3000, customerId: ctx.joao.id }])
    const o2 = actions.createOrder(ctx.owner.id, { identType: 'nome', identValue: 'João', mode: 'local', notes: '', items: [item(ctx.carne, 2)] })
    actions.payOrder(ctx.owner.id, o2.id, [{ method: 'fiado', amount: 2000, customerId: ctx.joao.id }])
    expect(sel.customerBalance(getDB(), ctx.joao.id)).toBe(5000)

    actions.receiveFiado(ctx.owner.id, ctx.joao.id, 2000, 'pix', '')
    expect(sel.customerBalance(getDB(), ctx.joao.id)).toBe(3000)
    expect(() => actions.receiveFiado(ctx.owner.id, ctx.joao.id, 9999, 'pix', '')).toThrow()

    const st = sel.customerStatement(getDB(), ctx.joao.id)
    expect(st.map((l) => l.balance)).toEqual([3000, 5000, 3000])
  })

  it('respeita o limite de fiado', () => {
    // Seu João tem limite de R$ 100,00
    const o = actions.createOrder(ctx.owner.id, { identType: 'nome', identValue: 'João', mode: 'local', notes: '', items: [item(ctx.carne, 11)] })
    expect(() => actions.payOrder(ctx.owner.id, o.id, [{ method: 'fiado', amount: 11000, customerId: ctx.joao.id }])).toThrow('limite')
  })
})

describe('relatório do dia', () => {
  it('soma vendas, formas de pagamento e ignora cancelados', () => {
    const ctx = setup()
    const a = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [item(ctx.carne, 2)] })
    actions.payOrder(ctx.owner.id, a.id, [{ method: 'pix', amount: 2000 }])
    const b = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '2', mode: 'local', notes: '', items: [item(ctx.refri, 1)] })
    actions.payOrder(ctx.owner.id, b.id, [{ method: 'fiado', amount: 600, customerId: ctx.joao.id }])
    const c = actions.createOrder(ctx.owner.id, { identType: 'mesa', identValue: '3', mode: 'local', notes: '', items: [item(ctx.carne, 5)] })
    actions.cancelOrder(ctx.owner.id, c.id, 'cliente desistiu', '1234')

    const s = sel.dailySummary(getDB(), today())
    expect(s.orderCount).toBe(2)
    expect(s.cancelledCount).toBe(1)
    expect(s.sales).toBe(2600)
    expect(s.byMethod.pix).toBe(2000)
    expect(s.byMethod.fiado).toBe(600)
    expect(s.cashIn).toBe(2000)
    expect(s.topProducts[0]).toMatchObject({ name: 'Carne', qty: 2 })
  })
})

describe('lixeira e histórico', () => {
  it('exclui e restaura item, registrando quem fez', () => {
    const ctx = setup()
    actions.moveToTrash(ctx.owner.id, 'products', ctx.carne.id)
    expect(getDB().products.find((p) => p.id === ctx.carne.id)!.deletedAt).not.toBeNull()
    actions.restoreFromTrash(ctx.owner.id, 'products', ctx.carne.id)
    expect(getDB().products.find((p) => p.id === ctx.carne.id)!.deletedAt).toBeNull()
    expect(getDB().audit[0]).toMatchObject({ userId: ctx.owner.id, action: 'products.restaurar' })
  })

  it('não deixa ficar sem dono nem PIN ambíguo', () => {
    const ctx = setup()
    expect(() => actions.saveUser(ctx.owner.id, { ...ctx.owner, roles: ['gerente'] })).toThrow('pelo menos um dono')
    expect(() => actions.saveUser(ctx.owner.id, { name: 'Novo', pin: '123456', roles: ['caixa'] })).toThrow('PIN')
  })
})

describe('tempo de preparo', () => {
  const base = { id: 'x', items: [], createdAt: '2026-11-03T12:00:00.000Z' }
  const at = (min: number) => new Date(Date.parse('2026-11-03T12:00:00.000Z') + min * 60000).toISOString()
  const ms = (min: number) => Date.parse(at(min))

  it('conta a partir da chegada na cozinha, não da criação (cobrança antes)', () => {
    const o = {
      ...base, status: 'preparo',
      statusHistory: [
        { status: 'aguardando_pagamento', at: at(0), by: 'u' },
        { status: 'novo', at: at(10), by: 'u' },
        { status: 'preparo', at: at(12), by: 'u' },
      ],
    } as unknown as Parameters<typeof sel.kitchenSentAt>[0]
    expect(sel.kitchenSentAt(o)).toBe(at(10))
    expect(sel.kitchenSeconds(o, ms(25))).toBe(15 * 60)
    expect(sel.isKitchenLate(o, 15, ms(24))).toBe(false)
    expect(sel.isKitchenLate(o, 15, ms(25))).toBe(true)
  })

  it('pedido pronto para o cronômetro e não conta como atrasado', () => {
    const o = {
      ...base, status: 'pronto',
      statusHistory: [{ status: 'novo', at: at(0), by: 'u' }, { status: 'pronto', at: at(20), by: 'u' }],
    } as unknown as Parameters<typeof sel.kitchenSentAt>[0]
    expect(sel.kitchenSeconds(o, ms(90))).toBe(20 * 60)
    expect(sel.isKitchenLate(o, 15, ms(90))).toBe(false)
  })

  it('o gerente não salva tempo estimado inválido', () => {
    const { owner } = setup()
    const est = getDB().establishment
    expect(() => actions.saveEstablishment(owner.id, { ...est, kitchenTargetMin: 0 })).toThrow('1 a 180')
    actions.saveEstablishment(owner.id, { ...est, kitchenTargetMin: 20 })
    expect(getDB().establishment.kitchenTargetMin).toBe(20)
  })
})

describe('adiantar pedido na fila', () => {
  it('adiantados vão para o topo, na ordem em que foram adiantados', () => {
    const o = (id: string, sent: string, priorityAt: string | null) =>
      ({ id, createdAt: sent, priorityAt, statusHistory: [{ status: 'novo', at: sent, by: 'u' }] }) as unknown as Parameters<typeof sel.compareKitchenQueue>[0]
    const fila = [
      o('a', '2026-11-03T12:00:00Z', null),
      o('b', '2026-11-03T12:05:00Z', '2026-11-03T12:20:00Z'),
      o('c', '2026-11-03T12:10:00Z', null),
      o('d', '2026-11-03T12:15:00Z', '2026-11-03T12:18:00Z'),
    ].sort(sel.compareKitchenQueue)
    expect(fila.map((x) => x.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('exige motivo, só vale na fila e fica no histórico', () => {
    const { owner, carne, refri } = setup()
    const p = actions.createOrder(owner.id, { identType: 'mesa', identValue: '4', mode: 'local', notes: '', items: [item(carne, 1)] })
    expect(() => actions.setOrderPriority(owner.id, p.id, true, ' ')).toThrow('motivo')
    actions.setOrderPriority(owner.id, p.id, true, 'Cliente esperou demais')
    const salvo = getDB().orders.find((x) => x.id === p.id)!
    expect(salvo.priorityAt).not.toBeNull()
    expect(getDB().audit[0].summary).toContain('adiantado na fila: Cliente esperou demais')
    actions.setOrderPriority(owner.id, p.id, false, '')
    expect(getDB().orders.find((x) => x.id === p.id)!.priorityAt).toBeNull()
    // pedido só de bebida já nasce pronto: não está na fila
    const bebida = actions.createOrder(owner.id, { identType: 'mesa', identValue: '5', mode: 'local', notes: '', items: [item(refri, 1)] })
    expect(() => actions.setOrderPriority(owner.id, bebida.id, true, 'teste')).toThrow('fila da cozinha')
  })
})

describe('dono, autorização por PIN e histórico', () => {
  const byName = (n: string) => getDB().users.find((u) => u.name.startsWith(n))!

  it('só o dono dá, tira ou mexe no perfil de dono', () => {
    const { owner } = setup()
    const ger = byName('Gerente')
    expect(owner.roles).toContain('dono')
    expect(() => actions.saveUser(ger.id, { name: 'Outro', pin: '8888', roles: ['dono'] })).toThrow('Só o dono pode dar')
    expect(() => actions.saveUser(ger.id, { ...owner, roles: ['gerente'] })).toThrow('Só o dono pode alterar')
    expect(() => actions.moveToTrash(ger.id, 'users', owner.id)).toThrow('Só o dono pode excluir')
    actions.saveUser(owner.id, { name: 'Sócio', pin: '8888', roles: ['dono'] })
    expect(byName('Sócio').roles).toContain('dono')
  })

  it('cancelar exige PIN de gerente; a recusa fica no histórico', () => {
    const { owner, carne } = setup()
    const caixa = byName('Caixa')
    const o = actions.createOrder(owner.id, { identType: 'mesa', identValue: '7', mode: 'local', notes: '', items: [item(carne, 1)] })
    expect(() => actions.cancelOrder(caixa.id, o.id, 'foi embora', '3333')).toThrow('PIN de gerente incorreto')
    expect(getDB().audit[0]).toMatchObject({ action: 'autorizacao.negada' })
    expect(getDB().audit[0].summary).toContain('PIN de Caixa, que não é gerente')
    expect(getDB().orders.find((x) => x.id === o.id)!.status).toBe('novo')
    actions.cancelOrder(caixa.id, o.id, 'foi embora', '5555')
    const salvo = getDB().orders.find((x) => x.id === o.id)!
    expect(salvo.status).toBe('cancelado')
    expect(salvo.cancelAuthorizedBy).toBe(byName('Gerente').id)
    expect(getDB().audit[0].summary).toBe('Pedido nº 1 (Mesa 7) cancelado por Caixa, autorizado por Gerente: foi embora')
  })

  it('cortesia só com PIN do dono e fica fora da entrada no caixa', () => {
    const { owner, carne } = setup()
    const caixa = byName('Caixa')
    const o = actions.createOrder(owner.id, { identType: 'nome', identValue: 'Seu Zé', mode: 'local', notes: '', items: [item(carne, 2)] })
    const parts = [{ method: 'pix' as const, amount: 1000 }, { method: 'cortesia' as const, amount: 1000 }]
    expect(() => actions.payOrder(caixa.id, o.id, parts, '5555')).toThrow('PIN do dono incorreto')
    expect(getDB().payments.filter((p) => p.orderId === o.id)).toHaveLength(0)
    actions.payOrder(caixa.id, o.id, parts, '1234')
    expect(getDB().payments.find((p) => p.method === 'cortesia')!.authorizedBy).toBe(owner.id)
    expect(getDB().audit[0].summary).toContain('(cortesia autorizada por Dono)')
    const s = sel.dailySummary(getDB(), today())
    expect(s.byMethod.cortesia).toBe(1000)
    expect(s.cashIn).toBe(1000)
    expect(s.openAmount).toBe(0)
  })
})
