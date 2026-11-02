import { useMemo } from 'react'
import { toast } from '../../components/ui'
import { consumption, formatQty, periodReport, periodText, purchaseListText } from '../../data/reports'
import { useDB } from '../../data/store'
import { brl } from '../../lib/money'
import { escapeHtml, printHtml } from '../../lib/print'
import type { Period } from '../Dono'
import { PeriodPicker, usePeriodOrders } from './Periodo'

/** O que comprar para repor o que as vendas do período gastaram, pela ficha técnica. */
export default function Compras({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const db = useDB()
  const { from, to } = period
  const data = usePeriodOrders(from, to)
  const c = useMemo(() => consumption(db, periodReport(db, data.orders, data.payments, from, to).products), [db, data.orders, data.payments, from, to])
  const text = purchaseListText(db.establishment.name, from, to, c)

  function print() {
    const rows = c.lines.map((l) => `<tr><td>☐ ${escapeHtml(l.name)}</td><td class="right">${formatQty(l.buy, l.unit)}</td><td class="right">${formatQty(l.qty, l.unit)}</td><td class="right">${l.cost ? brl(l.cost) : '—'}</td></tr>`).join('')
    printHtml(`Lista de compras ${periodText(from, to)}`, `
      <h1>Lista de compras · ${escapeHtml(db.establishment.name)}</h1>
      <div class="muted">Para repor o que foi vendido em ${periodText(from, to)}</div><hr>
      <table><thead><tr><th>Material</th><th class="right">Comprar</th><th class="right">Gasto</th><th class="right">Custo</th></tr></thead><tbody>${rows}</tbody></table>
      <hr><div class="row"><b>Custo estimado</b><b>${brl(c.totalCost)}</b></div>
      ${c.withoutRecipe.length ? `<p class="muted">Sem ficha técnica (fora da conta): ${escapeHtml(c.withoutRecipe.join(', '))}</p>` : ''}
    `)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast('Lista copiada')
    } catch {
      toast('Não deu para copiar neste aparelho')
    }
  }

  return (
    <div className="stack">
      <PeriodPicker period={period} onPeriod={onPeriod} />
      {data.error && <div className="card error-text">Não foi possível carregar os pedidos: {data.error} <button className="btn-sm" onClick={data.refresh}>Tentar de novo</button></div>}
      {data.loading ? <div className="card empty">Carregando os pedidos do período…</div> : (
        <div className="card stack">
          <div className="row between">
            <h3>O que comprar</h3>
            <div className="row">
              <button className="btn-sm" onClick={print} disabled={c.lines.length === 0}>🖨️ Imprimir</button>
              <button className="btn-sm" onClick={copy} disabled={c.lines.length === 0}>Copiar</button>
              <a className="btn btn-sm" href={c.lines.length ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={c.lines.length === 0}>📲 WhatsApp</a>
            </div>
          </div>
          <p className="muted small">Repõe o que as vendas gastaram, pela ficha técnica de cada item. Quilo e litro arredondam para cima de 100 em 100 g/ml; unidade, para cima.</p>
          {c.lines.length === 0 ? (
            <div className="empty">{db.recipes.length === 0 ? 'Cadastre os materiais e a ficha técnica dos itens para ver a lista de compras.' : 'Nenhum consumo no período.'}</div>
          ) : (
            <table className="list">
              <thead><tr><th>Material</th><th className="right">Comprar</th><th className="right">Gasto</th><th className="right">Custo</th></tr></thead>
              <tbody>
                {c.lines.map((l) => (
                  <tr key={l.materialId}>
                    <td>{l.name}</td>
                    <td className="right"><b>{formatQty(l.buy, l.unit)}</b></td>
                    <td className="right muted">{formatQty(l.qty, l.unit)}</td>
                    <td className="right money">{l.cost ? brl(l.cost) : '—'}</td>
                  </tr>
                ))}
                <tr><td colSpan={3}><b>Custo estimado</b></td><td className="right money"><b>{brl(c.totalCost)}</b></td></tr>
              </tbody>
            </table>
          )}
          {c.withoutRecipe.length > 0 && (
            <p className="small">⚠ Vendidos sem ficha técnica (fora da conta): <b>{c.withoutRecipe.join(', ')}</b></p>
          )}
        </div>
      )}
    </div>
  )
}
