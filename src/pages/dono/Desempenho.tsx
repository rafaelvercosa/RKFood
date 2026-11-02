import { useMemo } from 'react'
import { formatDuration, periodReport, periodText, staffPerformance, timeStats } from '../../data/reports'
import { useDB } from '../../data/store'
import { businessDateBR } from '../../lib/dates'
import { brl } from '../../lib/money'
import { escapeHtml, printHtml } from '../../lib/print'
import type { Period } from '../Dono'
import { Stat } from '../gerente/Relatorios'
import { PeriodPicker, usePeriodOrders } from './Periodo'

const pedidos = (n: number) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`

/** Quem vendeu mais, ticket médio por pessoa e por dia, e quanto tempo os pedidos levam para sair. */
export default function Desempenho({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const db = useDB()
  const { from, to } = period
  const data = usePeriodOrders(from, to)
  const staff = useMemo(() => staffPerformance(db.users, data.orders, from, to), [db.users, data.orders, from, to])
  const times = useMemo(() => timeStats(data.orders, from, to), [data.orders, from, to])
  const report = useMemo(() => periodReport(db, data.orders, data.payments, from, to), [db, data.orders, data.payments, from, to])
  const target = db.establishment.kitchenTargetMin * 60
  const best = staff[0]

  function print() {
    const rows = staff.map((l) => `<tr><td>${escapeHtml(l.name)}</td><td class="right">${l.orders}</td><td class="right">${l.items}</td><td class="right">${brl(l.sales)}</td><td class="right">${brl(l.averageTicket)}</td></tr>`).join('')
    printHtml(`Desempenho ${periodText(from, to)}`, `
      <h1>${escapeHtml(db.establishment.name)}</h1>
      <div class="muted">Desempenho de ${periodText(from, to)}</div><hr>
      <h2>Vendas por pessoa</h2>
      <table><thead><tr><th>Quem vendeu</th><th class="right">Pedidos</th><th class="right">Itens</th><th class="right">Vendas</th><th class="right">Ticket médio</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Tempo de saída</h2>
      <div class="row"><span>Preparo médio (cozinha até pronto)</span><b>${formatDuration(times.prep.avg)}</b></div>
      <div class="row"><span>Preparo mais demorado</span><span>${formatDuration(times.prep.max)}</span></div>
      <div class="row"><span>Do pedido até entregar</span><b>${formatDuration(times.delivery.avg)}</b></div>
    `)
  }

  return (
    <div className="stack">
      <PeriodPicker period={period} onPeriod={onPeriod} />
      {data.error && <div className="card error-text">Não foi possível carregar os pedidos: {data.error} <button className="btn-sm" onClick={data.refresh}>Tentar de novo</button></div>}
      {data.loading ? <div className="card empty">Carregando os pedidos do período…</div> : (
        <>
          <div className="stat-grid">
            <Stat label="Ticket médio" value={brl(report.averageTicket)} hint="Valor médio de cada pedido no período" />
            <Stat label="Quem mais vendeu" value={best ? best.name : '—'} hint={best ? `${brl(best.sales)} em ${best.orders} pedidos` : undefined} />
            <Stat label="Preparo médio" value={times.prep.count ? formatDuration(times.prep.avg) : '—'} hint="Da chegada na cozinha até ficar pronto" />
            <Stat label="Até entregar" value={times.delivery.count ? formatDuration(times.delivery.avg) : '—'} hint="Do pedido feito até ser entregue" />
          </div>

          <div className="card">
            <div className="row between"><h3>Vendas por pessoa</h3><button className="btn-sm" onClick={print}>🖨️ Imprimir</button></div>
            {staff.length === 0 ? <div className="empty">Nenhuma venda no período.</div> : (
              <table className="list">
                <thead><tr><th>Quem vendeu</th><th className="right">Pedidos</th><th className="right">Itens</th><th className="right">Vendas</th><th className="right">Ticket médio</th></tr></thead>
                <tbody>
                  {staff.map((l, i) => (
                    <tr key={l.staffId}>
                      <td>{i === 0 && staff.length > 1 ? '🏆 ' : ''}{l.name}</td>
                      <td className="right">{l.orders}</td>
                      <td className="right">{l.items}</td>
                      <td className="right money">{brl(l.sales)}</td>
                      <td className="right money">{brl(l.averageTicket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">Conta para quem fez o pedido. Pedidos cancelados ficam de fora.</p>
          </div>

          <div className="card">
            <h3>Tempo de saída dos pedidos</h3>
            {times.prep.count === 0 && times.delivery.count === 0 ? <div className="empty">Nenhum pedido pronto ou entregue no período.</div> : (
              <>
                <table className="list">
                  <tbody>
                    <tr><td>Preparo médio <span className="muted small">(chegou na cozinha até ficar pronto, {pedidos(times.prep.count)})</span></td>
                      <td className={`right ${times.prep.avg > target ? 'neg' : ''}`}><b>{formatDuration(times.prep.avg)}</b></td></tr>
                    <tr><td>Preparo mais demorado</td><td className="right">{formatDuration(times.prep.max)}</td></tr>
                    <tr><td>Tempo estimado (Gerência → Estabelecimento)</td><td className="right">{formatDuration(target)}</td></tr>
                    <tr><td>Do pedido feito até entregar <span className="muted small">({pedidos(times.delivery.count)})</span></td><td className="right"><b>{formatDuration(times.delivery.avg)}</b></td></tr>
                  </tbody>
                </table>
                {times.byDay.length > 1 && (
                  <table className="list" style={{ marginTop: 12 }}>
                    <thead><tr><th>Dia</th><th className="right">Preparo médio</th><th className="right">Até entregar</th></tr></thead>
                    <tbody>
                      {times.byDay.map((d) => (
                        <tr key={d.date}>
                          <td>{businessDateBR(d.date)}</td>
                          <td className={`right ${d.prepAvg > target ? 'neg' : ''}`}>{d.prepCount ? formatDuration(d.prepAvg) : '—'}</td>
                          <td className="right">{d.deliveryAvg ? formatDuration(d.deliveryAvg) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
            <p className="muted small">Em vermelho, quando a média passa do tempo estimado de preparo.</p>
          </div>

          {report.byDay.length > 1 && (
            <div className="card">
              <h3>Ticket médio por dia</h3>
              <table className="list">
                <thead><tr><th>Dia</th><th className="right">Pedidos</th><th className="right">Vendas</th><th className="right">Ticket médio</th></tr></thead>
                <tbody>
                  {report.byDay.map((d) => (
                    <tr key={d.date}>
                      <td>{businessDateBR(d.date)}</td>
                      <td className="right">{d.orders}</td>
                      <td className="right money">{brl(d.sales)}</td>
                      <td className="right money">{brl(Math.round(d.sales / d.orders))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
