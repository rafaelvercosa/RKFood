import { useEffect, useState } from 'react'
import { isCloud } from '../../data/backend'
import { ensureDate } from '../../data/cloud'
import { dailySummary } from '../../data/selectors'
import { useDB } from '../../data/store'
import { businessDateBR, dateTimeBR, nowIso, today } from '../../lib/dates'
import { brl } from '../../lib/money'
import { escapeHtml, printHtml } from '../../lib/print'
import { METHOD_LABEL, type PaymentMethod } from '../../types'

export default function Relatorios() {
  const [date, setDate] = useState(today())
  useEffect(() => {
    if (isCloud) void ensureDate(date)
  }, [date])
  return (
    <div className="stack">
      <label className="field" style={{ maxWidth: 240 }}>Dia
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
      </label>
      <DailyReport date={date} />
    </div>
  )
}

const METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito', 'fiado', 'cortesia']

/** Resumo do dia: usado no fechamento do caixa e nos relatórios da gerência. */
export function DailyReport({ date }: { date: string }) {
  const db = useDB()
  const s = dailySummary(db, date)
  const fiadoIn = s.fiadoReceived.pix + s.fiadoReceived.dinheiro + s.fiadoReceived.debito + s.fiadoReceived.credito

  function print() {
    printHtml(`Fechamento ${businessDateBR(date)}`, `
      <h1>${escapeHtml(db.establishment.name)}</h1>
      <div class="muted">Fechamento do dia ${businessDateBR(date)} · emitido em ${dateTimeBR(nowIso())}</div><hr>
      <div class="row"><span>Pedidos</span><b>${s.orderCount}</b></div>
      <div class="row"><span>Cancelados</span><span>${s.cancelledCount}</span></div>
      <div class="row"><span>Vendas</span><b>${brl(s.sales)}</b></div>
      <div class="row"><span>Ticket médio</span><span>${brl(s.averageTicket)}</span></div><hr>
      <b>Recebido nos pedidos do dia</b>
      ${METHODS.map((m) => `<div class="row"><span>${METHOD_LABEL[m]}</span><span>${brl(s.byMethod[m])}</span></div>`).join('')}
      <div class="row"><span>Ainda em aberto</span><span>${brl(s.openAmount)}</span></div><hr>
      <div class="row"><span>Fiado recebido hoje</span><span>${brl(fiadoIn)}</span></div>
      <div class="row"><b>ENTRADA NO CAIXA</b><b>${brl(s.cashIn)}</b></div>
      <div class="row muted"><span>Dinheiro em espécie</span><span>${brl(s.byMethod.dinheiro + s.fiadoReceived.dinheiro)}</span></div><hr>
      <b>Itens vendidos</b>
      ${s.topProducts.map((p) => `<div class="row"><span>${p.qty}× ${escapeHtml(p.name)}</span><span>${brl(p.total)}</span></div>`).join('') || '<div class="muted">Nenhum</div>'}
    `, { widthMm: 80 })
  }

  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat label="Vendas" value={brl(s.sales)} />
        <Stat label="Pedidos" value={String(s.orderCount)} />
        <Stat label="Ticket médio" value={brl(s.averageTicket)} />
        <Stat label="Entrada no caixa" value={brl(s.cashIn)} hint="Pagamentos recebidos + fiado recebido, sem contar o fiado concedido nem a cortesia" />
      </div>
      <div className="card">
        <h3>Formas de pagamento</h3>
        <table className="list">
          <tbody>
            {METHODS.map((m) => (
              <tr key={m}><td>{METHOD_LABEL[m]}{m === 'fiado' && <span className="muted small"> (vendido a prazo)</span>}{m === 'cortesia' && <span className="muted small"> (sem cobrança)</span>}</td><td className="right money">{brl(s.byMethod[m])}</td></tr>
            ))}
            <tr><td>Fiado recebido no dia</td><td className="right money">{brl(fiadoIn)}</td></tr>
            <tr><td>Ainda em aberto</td><td className={`right money ${s.openAmount ? 'neg' : ''}`}>{brl(s.openAmount)}</td></tr>
            <tr><td><b>Dinheiro em espécie na gaveta</b></td><td className="right money"><b>{brl(s.byMethod.dinheiro + s.fiadoReceived.dinheiro)}</b></td></tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Itens vendidos</h3>
        {s.topProducts.length === 0 ? <div className="empty">Nenhuma venda neste dia.</div> : (
          <table className="list">
            <thead><tr><th>Item</th><th className="right">Qtd.</th><th className="right">Total</th></tr></thead>
            <tbody>
              {s.topProducts.map((p) => (
                <tr key={p.name}><td>{p.name}</td><td className="right">{p.qty}</td><td className="right money">{brl(p.total)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {s.cancelledCount > 0 && <p className="muted small">{s.cancelledCount} pedido(s) cancelado(s) não entram na conta.</p>}
      </div>
      <button onClick={print}>🖨️ Imprimir fechamento</button>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}
