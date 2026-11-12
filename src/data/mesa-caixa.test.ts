// Testes de mesas abertas, conta da mesa, caixa (abrir e fechar), "Na chapa" e observações rápidas.
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const { planTablePayments } = await import('./tablePay')

function setup() {
  resetDemo()
  const db = getDB()
  const owner = db.users.find((u) => u.roles.includes('dono'))!
  const carne = db.products.find((p) => p.name === 'Carne')!
  const frango = db.products.find((p) => p.name === 'Frango')!
  return { owner, carne, frango }
}
const line = (p: { id: string; name: string; price: number; sendToKitchen: boolean }, qty: number) =>
  ({ productId: p.id, name: p.name, unitPrice: p.price, qty, notes: '', sendToKitchen: p.sendToKitchen })

describe('mesas abertas e conta da mesa', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => { ctx = setup() })

  it('agrupa os pedidos não pagos da mesma mesa e ignora cancelados e pagos', () => {
    const { owner, carne, frango } = ctx
    const mk = (mesa: string, p: typeof carne, qty: number) => actions.createOrder(owner.id, { identType: 'mesa', identValue: mesa, mode: 'local', notes: '', items: [line(p, qty)] })
    mk('4', carne, 2); mk('4', frango, 1); mk(' 4 ', carne, 1); mk('9', carne, 1)
    mk('7', carne, 1)
    const o7 = getDB().orders.find((o) => o.identValue === '7')!
    actions.payOrder(owner.id, o7.id, [{ method: 'pix', amount: sel.orderTotal(o7), cashReceived: null, customerId: null }], '')
    const tables = sel.openTables(getDB())
    expect(tables.map((t) => t.table)).toEqual(['4', '9'])
    expect(tables[0].orders).toHaveLength(3)
    expect(tables[0].remaining).toBe(carne.price * 3 + frango.price)
  })

  it('divide em partes iguais, com as sobras nas primeiras pessoas', () => {
    expect(sel.splitEvenly(4500, 3)).toEqual([1500, 1500, 1500])
    expect(sel.splitEvenly(1000, 3)).toEqual([334, 333, 333])
    expect(sel.splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000)
    expect(sel.splitEvenly(500, 0)).toEqual([500])
  })

  it('reparte um pagamento entre os pedidos da mesa, do mais antigo ao mais novo', () => {
    const { owner, carne, frango } = ctx
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '4', mode: 'local', notes: '', items: [line(carne, 2)] }) // 2 × carne
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '4', mode: 'local', notes: '', items: [line(frango, 2)] })
    const t = sel.openTables(getDB())[0]
    const first = sel.orderTotal(t.orders[0])
    const plan = planTablePayments(getDB(), t.orders, [{ method: 'pix', amount: first + 300, cashReceived: null, customerId: null }])
    expect(plan.map((p) => p.payments[0].amount)).toEqual([first, 300])
    expect(() => planTablePayments(getDB(), t.orders, [{ method: 'pix', amount: t.remaining + 1, cashReceived: null, customerId: null }])).toThrow('passa do que falta')
  })

  it('o troco do dinheiro fica no primeiro pedaço e a mesa fecha quando tudo é pago', () => {
    const { owner, carne, frango } = ctx
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '4', mode: 'local', notes: '', items: [line(carne, 1)] })
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '4', mode: 'local', notes: '', items: [line(frango, 1)] })
    const t = sel.openTables(getDB())[0]
    const plan = planTablePayments(getDB(), t.orders, [{ method: 'dinheiro', amount: t.remaining, cashReceived: t.remaining + 500, customerId: null }])
    expect(plan[0].payments[0].cashReceived).toBe(plan[0].payments[0].amount + 500)
    expect(plan[1].payments[0].cashReceived).toBe(plan[1].payments[0].amount)
    for (const step of plan) actions.payOrder(owner.id, step.orderId, step.payments, '')
    expect(sel.openTables(getDB())).toHaveLength(0)
  })
})

describe('caixa: abrir e fechar', () => {
  it('esperado = troco + dinheiro recebido; guarda a diferença e não deixa abrir duas vezes', () => {
    const { owner, carne } = setup()
    expect(() => actions.closeCash(owner.id, 0, '')).toThrow('não está aberto')
    expect(() => actions.openCash(owner.id, -1)).toThrow('Informe o troco')
    actions.openCash(owner.id, 10000)
    expect(() => actions.openCash(owner.id, 500)).toThrow('já está aberto')
    expect(sel.openCashSession(getDB())).toBeTruthy()

    actions.createOrder(owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [line(carne, 2)] })
    const o = getDB().orders[0]
    actions.payOrder(owner.id, o.id, [{ method: 'dinheiro', amount: sel.orderTotal(o), cashReceived: sel.orderTotal(o) + 500, customerId: null }], '')
    const expected = 10000 + sel.orderTotal(o)
    expect(sel.expectedCash(getDB(), sel.openCashSession(getDB())!)).toBe(expected)

    const diff = actions.closeCash(owner.id, expected - 200, 'Troco a mais')
    expect(diff).toBe(-200)
    const s = getDB().cashSessions[0]
    expect(s).toMatchObject({ expectedCents: expected, countedCents: expected - 200, differenceCents: -200, note: 'Troco a mais' })
    expect(sel.openCashSession(getDB())).toBeUndefined()
    expect(getDB().audit.some((a) => a.action === 'caixa.fechar' && a.summary.replace(/\s/g, ' ').includes('diferença − R$ 2,00'))).toBe(true)

    actions.openCash(owner.id, 0) // depois de fechar, abre de novo
    expect(getDB().cashSessions).toHaveLength(2)
  })

  it('Pix e cartão não entram no dinheiro esperado', () => {
    const { owner, carne } = setup()
    actions.openCash(owner.id, 5000)
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [line(carne, 1)] })
    const o = getDB().orders[0]
    actions.payOrder(owner.id, o.id, [{ method: 'pix', amount: sel.orderTotal(o), cashReceived: null, customerId: null }], '')
    expect(sel.expectedCash(getDB(), sel.openCashSession(getDB())!)).toBe(5000)
  })
})

describe('na chapa', () => {
  it('soma o que está novo ou em preparo, só do que vai para a cozinha', () => {
    const { owner, carne, frango } = setup()
    const refri = getDB().products.find((p) => p.name === 'Refrigerante lata')!
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '1', mode: 'local', notes: '', items: [line(carne, 2), line(refri, 3)] })
    actions.createOrder(owner.id, { identType: 'mesa', identValue: '2', mode: 'local', notes: '', items: [line(carne, 1), line(frango, 4)] })
    expect(sel.grillTotals(getDB().orders)).toEqual([{ name: 'Frango', qty: 4 }, { name: 'Carne', qty: 3 }])
    const o2 = getDB().orders[1]
    actions.setOrderStatus(owner.id, o2.id, 'preparo')
    actions.setOrderStatus(owner.id, o2.id, 'pronto')
    expect(sel.grillTotals(getDB().orders)).toEqual([{ name: 'Carne', qty: 2 }])
  })
})

describe('observações rápidas', () => {
  it('limpa repetidas e vazias e valida o tamanho', () => {
    const { owner } = setup()
    actions.saveQuickNotes(owner.id, ['Sem pimenta', ' sem PIMENTA ', '', 'Bem passado'])
    expect(getDB().establishment.quickNotes).toEqual(['Sem pimenta', 'Bem passado'])
    expect(() => actions.saveQuickNotes(owner.id, ['a, b'])).toThrow('até 30 letras')
    expect(() => actions.saveQuickNotes(owner.id, Array.from({ length: 21 }, (_, i) => `n${i}`))).toThrow('No máximo 20')
    actions.saveQuickNotes(owner.id, [])
    expect(getDB().establishment.quickNotes).toEqual([])
  })
})
