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
const { brl, parseBRL } = await import('../lib/money')

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
    expect(() => actions.saveUser(ctx.owner.id, { name: 'Novo', phone: '', pin: '123456', roles: ['caixa'] })).toThrow('PIN')
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
    expect(() => actions.saveUser(ger.id, { name: 'Outro', phone: '', pin: '8888', roles: ['dono'] })).toThrow('só cria perfil de atendente')
    expect(() => actions.saveUser(ger.id, { ...owner, roles: ['gerente'] })).toThrow('Só o dono pode alterar um perfil')
    expect(() => actions.moveToTrash(ger.id, 'users', owner.id)).toThrow('perfil não permite')
    actions.saveUser(owner.id, { name: 'Sócio', phone: '', pin: '8888', roles: ['dono'] })
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

describe('configuração do estabelecimento', () => {
  it('gerente muda as mesas; aparência só o dono', () => {
    const { owner } = setup()
    const ger = getDB().users.find((u) => u.name === 'Gerente')!
    const est = getDB().establishment
    actions.saveEstablishment(ger.id, { ...est, tableCount: 25 })
    expect(getDB().establishment.tableCount).toBe(25)
    expect(getDB().audit[0].summary).toContain('mesas: 10 → 25')
    expect(() => actions.saveEstablishment(ger.id, { ...getDB().establishment, brandColor: '#000000' })).toThrow('Só o dono')
    expect(() => actions.saveEstablishment(owner.id, { ...getDB().establishment, tableCount: 201 })).toThrow('0 a 200')
    actions.saveEstablishment(owner.id, { ...getDB().establishment, brandColor: '#000000', slogan: 'Novo' })
    expect(getDB().establishment).toMatchObject({ brandColor: '#000000', slogan: 'Novo' })
  })
})

const rep = await import('./reports')

describe('área do dono: vendas, ficha técnica e compras', () => {

  it('períodos: semana de segunda a domingo e meses', () => {
    const qua = new Date(2026, 10, 4) // quarta, 04/11/2026
    expect(rep.periodDates('semana', qua)).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(rep.periodDates('semana-passada', qua)).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(rep.periodDates('mes', qua)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(rep.periodDates('mes-passado', qua)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(rep.periodDates('ontem', qua)).toEqual({ from: '2026-11-03', to: '2026-11-03' })
  })

  it('soma itens vendidos, consumo de materiais, custo e lista de compras', () => {
    const { owner, carne, refri } = setup()
    const a = actions.createOrder(owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [item(carne, 3), item(refri, 2)] })
    actions.payOrder(owner.id, a.id, [{ method: 'pix', amount: 4200 }])
    const b = actions.createOrder(owner.id, { identType: 'mesa', identValue: '2', mode: 'local', notes: '', items: [item(carne, 1)] })
    actions.cancelOrder(owner.id, b.id, 'desistiu', '1234')
    const db = getDB()
    const r = rep.periodReport(db, db.orders, db.payments, today(), today())
    expect(r.orderCount).toBe(1)
    expect(r.cancelledCount).toBe(1)
    expect(r.products.find((p) => p.name === 'Carne')).toMatchObject({ qty: 3, revenue: 3000, category: 'Espetinhos' })
    expect(r.categories.map((c) => c.name)).toEqual(['Espetinhos', 'Bebidas'])

    const c = rep.consumption(db, r.products)
    const linha = (n: string) => c.lines.find((l) => l.name === n)!
    // Carne = 120 g de alcatra + 1 palito + 50 g de carvão; 3 espetos
    expect(linha('Alcatra')).toMatchObject({ qty: 0.36, buy: 0.4 })
    expect(linha('Palito de churrasco')).toMatchObject({ qty: 3, buy: 3 })
    expect(linha('Refrigerante lata')).toMatchObject({ qty: 2, buy: 2, cost: 560 })
    expect(linha('Alcatra').cost).toBe(Math.round(0.36 * 4800))
    expect(c.withoutRecipe).toEqual([])
    expect(rep.formatQty(0.36, 'kg')).toBe('360 g')
    expect(rep.formatQty(2.5, 'kg')).toBe('2,5 kg')
    expect(rep.purchaseListText('Espetinho', today(), today(), c)).toContain('• Alcatra: 400 g')
    expect(rep.productCost(db, carne.id)).toBe(Math.round(0.12 * 4800 + 5 + 0.05 * 600))
  })

  it('só o dono mexe em material e ficha; material em uso não vai para a lixeira', () => {
    const { owner, carne } = setup()
    const ger = getDB().users.find((u) => u.name === 'Gerente')!
    expect(() => actions.saveMaterial(ger.id, { name: 'Sal', unit: 'kg', cost: 300 })).toThrow('perfil')
    const sal = actions.saveMaterial(owner.id, { name: 'Sal grosso', unit: 'kg', cost: 300 })
    expect(() => actions.saveMaterial(owner.id, { name: 'sal grosso', unit: 'kg', cost: 0 })).toThrow('com esse nome')
    const atual = getDB().recipes.filter((r) => r.productId === carne.id).map((r) => ({ materialId: r.materialId, qty: r.qty }))
    expect(() => actions.saveRecipe(ger.id, carne.id, atual)).toThrow('perfil')
    actions.saveRecipe(owner.id, carne.id, [...atual, { materialId: sal.id, qty: 0.005 }])
    expect(getDB().audit[0].summary).toContain('0,005 kg de Sal grosso')
    expect(() => actions.setMaterialTrashed(owner.id, sal.id, true)).toThrow('ficha técnica de: Carne')
    expect(() => actions.saveRecipe(owner.id, carne.id, [{ materialId: sal.id, qty: 0 }])).toThrow('Quantidade inválida')
  })

  it('comprado pronto: material com o nome do item e ficha de 1 un, num passo só', () => {
    const { owner, carne } = setup()
    const ger = getDB().users.find((u) => u.name === 'Gerente')!
    actions.saveProduct(owner.id, { categoryId: carne.categoryId, name: 'Limoneto', description: '', price: 800, photoUrl: null, active: true, sendToKitchen: false })
    const refri = getDB().products.find((p) => p.name === 'Limoneto')!
    expect(() => actions.saveReadyMade(ger.id, refri.id, 350)).toThrow('perfil')
    actions.saveReadyMade(owner.id, refri.id, 350)
    const m = getDB().materials.find((x) => x.name === 'Limoneto')!
    expect(m).toMatchObject({ unit: 'un', cost: 350 })
    expect(getDB().recipes.filter((r) => r.productId === refri.id)).toEqual([{ productId: refri.id, materialId: m.id, qty: 1 }])
    expect(getDB().audit[0].summary).toBe(`Limoneto marcado como comprado pronto: 1 un de Limoneto (custo ${brl(350)})`)
    actions.saveReadyMade(owner.id, refri.id, null)
    expect(getDB().materials.filter((x) => x.name === 'Limoneto')).toHaveLength(1)
    expect(getDB().materials.find((x) => x.name === 'Limoneto')!.cost).toBe(350)
  })

  it('comprado pronto na categoria inteira: troca as fichas e deixa de fora o material em kg', () => {
    const { owner, carne } = setup()
    const ger = getDB().users.find((u) => u.name === 'Gerente')!
    expect(() => actions.saveReadyMadeCategory(ger.id, carne.categoryId)).toThrow('perfil')
    // no exemplo, "Queijo coalho" é item e também material comprado por kg
    expect(actions.saveReadyMadeCategory(owner.id, carne.categoryId)).toEqual(['Queijo coalho'])
    const db = getDB()
    const m = db.materials.find((x) => x.name === 'Carne')!
    expect(m.unit).toBe('un')
    expect(db.recipes.filter((r) => r.productId === carne.id)).toEqual([{ productId: carne.id, materialId: m.id, qty: 1 }])
    expect(db.audit[0].summary).toMatch(/^Categoria Espetinhos marcada como comprada pronta: Carne, .* \(ficaram de fora: Queijo coalho\)$/)
  })
})

describe('desempenho: vendas por pessoa e tempo de saída', () => {
  it('soma pedidos, itens, vendas e ticket médio por quem fez o pedido', () => {
    const { owner, carne } = setup()
    const ana = getDB().users.find((u) => u.name.startsWith('Ana'))!
    actions.createOrder(ana.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [item(carne, 3)] })
    actions.createOrder(ana.id, { identType: 'mesa', identValue: '2', mode: 'local', notes: '', items: [item(carne, 1)] })
    const c = actions.createOrder(owner.id, { identType: 'mesa', identValue: '3', mode: 'local', notes: '', items: [item(carne, 1)] })
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '4', mode: 'local', notes: '', items: [item(carne, 5)] })
    actions.cancelOrder(owner.id, c.id, 'teste', '1234')
    const lines = rep.staffPerformance(getDB().users, getDB().orders, today(), today())
    expect(lines.map((l) => l.name)).toEqual(['Dono', 'Ana (atendente)'])
    expect(lines[1]).toMatchObject({ orders: 2, items: 4, sales: 4000, averageTicket: 2000 })
    expect(lines[0]).toMatchObject({ orders: 1, items: 5, sales: 5000 })
  })

  it('tempo de preparo (cozinha até pronto) e até entregar', () => {
    const t = (min: number) => new Date(Date.parse('2026-11-03T20:00:00.000Z') + min * 60000).toISOString()
    const o = (id: string, hist: [string, number][]) => ({
      id, businessDate: '2026-11-03', status: hist[hist.length - 1][0], createdAt: t(0), createdBy: 'u',
      items: [{ sendToKitchen: true, qty: 1, unitPrice: 100 }],
      statusHistory: hist.map(([status, min]) => ({ status, at: t(min), by: 'u' })),
    }) as unknown as Parameters<typeof rep.timeStats>[0][number]
    const s = rep.timeStats([
      o('a', [['novo', 0], ['preparo', 2], ['pronto', 10], ['entregue', 12]]),
      o('b', [['aguardando_pagamento', 0], ['novo', 5], ['pronto', 25], ['entregue', 30]]),
      o('c', [['novo', 0], ['preparo', 1]]),
    ], '2026-11-03', '2026-11-03')
    expect(s.prep).toEqual({ count: 2, avg: 15 * 60, max: 20 * 60 })
    expect(s.delivery).toEqual({ count: 2, avg: 21 * 60 })
    expect(rep.formatDuration(754)).toBe('12 min 34 s')
    expect(rep.formatDuration(45)).toBe('45 s')
  })
})

describe('perfis da equipe', () => {
  it('gerente só cria atendente; dono edita e bloqueia; bloqueado não autoriza', () => {
    const { owner, carne } = setup()
    const ger = getDB().users.find((u) => u.name === 'Gerente')!
    actions.saveUser(ger.id, { name: 'Bia', phone: '(81) 98888-7777', pin: '7777', roles: ['atendente'] })
    const bia = getDB().users.find((u) => u.name === 'Bia')!
    expect(bia).toMatchObject({ phone: '81988887777', createdBy: ger.id, blockedAt: null })
    expect(getDB().audit[0].summary).toBe('Usuário Bia (atendente) criado por Gerente')
    expect(() => actions.saveUser(ger.id, { name: 'Caio', phone: '', pin: '7878', roles: ['caixa'] })).toThrow('só cria perfil de atendente')
    expect(() => actions.saveUser(ger.id, { ...bia, name: 'Bia 2' })).toThrow('Só o dono pode alterar')
    expect(() => actions.saveUser(owner.id, { name: 'Zé', phone: '123', pin: '7979', roles: ['atendente'] })).toThrow('Telefone inválido')
    expect(() => actions.setUserBlocked(ger.id, bia.id, true)).toThrow('perfil não permite')
    expect(() => actions.setUserBlocked(owner.id, owner.id, true)).toThrow('próprio perfil')
    actions.setUserBlocked(owner.id, ger.id, true)
    const o = actions.createOrder(owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [item(carne, 1)] })
    expect(() => actions.cancelOrder(owner.id, o.id, 'teste', '5555')).toThrow('PIN de gerente incorreto')
    expect(getDB().audit[0].summary).toContain('PIN de Gerente, que está bloqueado')
  })
})
