import { useMemo } from 'react'
import { consumption, periodReport, periodText, productCost } from '../../data/reports'
import { useDB } from '../../data/store'
import { businessDateBR } from '../../lib/dates'
import { brl } from '../../lib/money'
import { escapeHtml, printHtml } from '../../lib/print'
import { METHOD_LABEL, type PaymentMethod } from '../../types'
import type { Period } from '../Dono'
import { Stat } from '../gerente/Relatorios'
import { PeriodPicker, usePeriodOrders } from './Periodo'

const METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito', 'fiado', 'cortesia']

export default function Vendas({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const db = useDB()
  const { from, to } = period
  const data = usePeriodOrders(from, to)
  const r = useMemo(() => periodReport(db, data.orders, data.payments, from, to), [db, data.orders, data.payments, from, to])
  const c = useMemo(() => consumption(db, r.products), [db, r.products])
  // lucro estimado: o que entrou (sem cortesia) menos o custo dos materiais pela ficha técnica
  const revenue = r.sales - r.byMethod.cortesia
  const profit = revenue - c.totalCost
  const categories = [...new Set(r.products.map((p) => p.category))]

  function print() {
    const rows = r.products.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category)}</td><td class="right">${p.qty}</td><td class="right">${brl(p.revenue)}</td></tr>`).join('')
    printHtml(`Vendas ${periodText(from, to)}`, `
      <h1>${escapeHtml(db.establishment.name)}</h1>
      <div class="muted">Vendas de ${periodText(from, to)}</div><hr>
      <div class="row"><span>Pedidos</span><b>${r.orderCount}</b></div>
      <div class="row"><span>Vendas</span><b>${brl(r.sales)}</b></div>
      <div class="row"><span>Cortesia</span><span>${brl(r.byMethod.cortesia)}</span></div>
      <div class="row"><span>Custo estimado dos materiais</span><span>${brl(c.totalCost)}</span></div>
      <div class="row"><span>Lucro estimado</span><b>${brl(profit)}</b></div><hr>
      <h2>Itens vendidos</h2>
      <table><thead><tr><th>Item</th><th>Categoria</th><th class="right">Qtd.</th><th class="right">Valor</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Formas de pagamento</h2>
      ${METHODS.map((m) => `<div class="row"><span>${METHOD_LABEL[m]}</span><span>${brl(r.byMethod[m])}</span></div>`).join('')}
    `)
  }

  return (
    <div className="stack">
      <PeriodPicker period={period} onPeriod={onPeriod} />
      {data.error && <div className="card error-text">Não foi possível carregar os pedidos: {data.error} <button className="btn-sm" onClick={data.refresh}>Tentar de novo</button></div>}
      {data.loading ? <div className="card empty">Carregando os pedidos do período…</div> : (
        <>
          <div className="stat-grid">
            <Stat label="Vendas" value={brl(r.sales)} hint="Soma dos pedidos não cancelados" />
            <Stat label="Pedidos" value={String(r.orderCount)} />
            <Stat label="Ticket médio" value={brl(r.averageTicket)} />
            <Stat label="Custo estimado" value={brl(c.totalCost)} hint="Materiais gastos, pela ficha técnica" />
            <Stat label="Lucro estimado" value={brl(profit)} hint="Vendas, menos cortesia, menos o custo dos materiais" />
          </div>
          {c.withoutRecipe.length > 0 && (
            <p className="card small">
              ⚠ Sem ficha técnica, fora do custo: <b>{c.withoutRecipe.join(', ')}</b>. Cadastre na aba Ficha técnica para o custo e o lucro ficarem certos.
            </p>
          )}

          <div className="card">
            <div className="row between"><h3>Itens vendidos</h3><button className="btn-sm" onClick={print}>🖨️ Imprimir</button></div>
            {r.products.length === 0 ? <div className="empty">Nenhuma venda no período.</div> : (
              <table className="list">
                <thead><tr><th>Item</th><th className="right">Qtd.</th><th className="right">Valor</th><th className="right">Custo</th></tr></thead>
                <tbody>
                  {categories.map((cat) => {
                    const total = r.categories.find((x) => x.name === cat)!
                    return [
                      <tr key={cat} className="group-row"><td><b>{cat}</b></td><td className="right"><b>{total.qty}</b></td><td className="right money"><b>{brl(total.revenue)}</b></td><td /></tr>,
                      ...r.products.filter((p) => p.category === cat).map((p) => (
                        <tr key={p.productId}>
                          <td>{p.name}</td>
                          <td className="right">{p.qty}</td>
                          <td className="right money">{brl(p.revenue)}</td>
                          <td className="right money muted">{brl(productCost(db, p.productId) * p.qty)}</td>
                        </tr>
                      )),
                    ]
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="two-col">
            <div className="card">
              <h3>Formas de pagamento</h3>
              <table className="list">
                <tbody>
                  {METHODS.map((m) => <tr key={m}><td>{METHOD_LABEL[m]}</td><td className="right money">{brl(r.byMethod[m])}</td></tr>)}
                  <tr><td>Pedidos cancelados</td><td className="right">{r.cancelledCount}</td></tr>
                </tbody>
              </table>
            </div>
            {r.byDay.length > 1 && (
              <div className="card">
                <h3>Por dia</h3>
                <table className="list">
                  <thead><tr><th>Dia</th><th className="right">Pedidos</th><th className="right">Vendas</th></tr></thead>
                  <tbody>
                    {r.byDay.map((d) => <tr key={d.date}><td>{businessDateBR(d.date)}</td><td className="right">{d.orders}</td><td className="right money">{brl(d.sales)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
