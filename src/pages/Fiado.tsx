import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CustomerForm } from '../components/CustomerForm'
import { Header } from '../components/Layout'
import { attempt, Modal, Segmented } from '../components/ui'
import { moveToTrash, receiveFiado } from '../data/api'
import { customerBalance, customersWithBalance, customerStatement, type StatementLine } from '../data/selectors'
import { useDB } from '../data/store'
import { dateBR, dateTimeBR, hhmm, nowIso } from '../lib/dates'
import { brl, centsToInput, parseBRL } from '../lib/money'
import { escapeHtml, printHtml } from '../lib/print'
import type { Customer, Establishment, FiadoSettlement } from '../types'
import { METHOD_LABEL } from '../types'

export default function Fiado() {
  const db = useDB()
  const [q, setQ] = useState('')
  const [onlyDebt, setOnlyDebt] = useState<'devendo' | 'todos'>('devendo')
  const [creating, setCreating] = useState(false)
  const list = customersWithBalance(db)
    .filter((x) => onlyDebt === 'todos' || x.balance > 0)
    .filter((x) => !q || x.customer.name.toLowerCase().includes(q.toLowerCase()) || x.customer.phone.includes(q.replace(/\D/g, '') || '§'))
  const totalOwed = customersWithBalance(db).reduce((s, x) => s + Math.max(0, x.balance), 0)

  return (
    <>
      <Header title="Fiado" />
      <main className="page">
        <div className="stat-grid">
          <div className="stat"><div className="label">Total a receber</div><div className="value neg">{brl(totalOwed)}</div></div>
          <div className="stat"><div className="label">Clientes devendo</div><div className="value">{customersWithBalance(db).filter((x) => x.balance > 0).length}</div></div>
        </div>
        <div className="row">
          <input className="grow" style={{ width: 'auto' }} placeholder="Buscar cliente por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-primary" onClick={() => setCreating(true)}>+ Cliente</button>
        </div>
        <Segmented value={onlyDebt} onChange={setOnlyDebt} options={[{ value: 'devendo', label: 'Devendo' }, { value: 'todos', label: 'Todos' }]} />
        <div className="card">
          {list.length === 0 && <div className="empty">Nenhum cliente {onlyDebt === 'devendo' ? 'devendo' : 'cadastrado'}.</div>}
          {list.map(({ customer: c, balance }) => (
            <Link key={c.id} to={`/fiado/${c.id}`} className="list-item" style={{ textDecoration: 'none' }}>
              <div className="grow">
                <strong>{c.name}</strong>
                <div className="muted small">{c.phone ? formatPhone(c.phone) : 'sem telefone'}</div>
              </div>
              <span className={`money ${balance > 0 ? 'neg' : 'muted'}`}><b>{brl(balance)}</b></span>
              <span aria-hidden>›</span>
            </Link>
          ))}
        </div>
      </main>
      {creating && <CustomerForm onClose={() => setCreating(false)} />}
    </>
  )
}

export function ClienteFiado() {
  const { id } = useParams()
  const db = useDB()
  const customer = db.customers.find((c) => c.id === id)
  const [period, setPeriod] = useState<'aberto' | 'tudo'>('aberto')
  const [receiving, setReceiving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!customer) return (<><Header title="Fiado" /><main className="page"><div className="card empty">Cliente não encontrado. <Link to="/fiado">Voltar</Link></div></main></>)

  const balance = customerBalance(db, customer.id)
  const all = customerStatement(db, customer.id)
  const lines = period === 'aberto' ? openLines(all) : all

  return (
    <>
      <Header title={customer.name} right={<Link to="/fiado" className="btn btn-ghost btn-sm">‹ Clientes</Link>} />
      <main className="page">
        {customer.deletedAt && <div className="card error-text">Este cliente está na lixeira.</div>}
        <div className="card stack">
          <div className="row between">
            <div>
              <div className="muted small">Saldo devedor</div>
              <div className={`money ${balance > 0 ? 'neg' : 'pos'}`} style={{ fontSize: '2rem', fontWeight: 800 }}>{brl(balance)}</div>
              {customer.creditLimit > 0 && <div className="muted small">Limite: {brl(customer.creditLimit)}</div>}
            </div>
            <div className="stack" style={{ justifyItems: 'end' }}>
              {customer.phone && <span className="muted small">{formatPhone(customer.phone)}</span>}
              <button className="btn-sm" onClick={() => setEditing(true)}>Editar</button>
            </div>
          </div>
          {customer.notes && <p className="muted small">{customer.notes}</p>}
          <div className="row">
            <button className="btn-ok grow" disabled={balance <= 0} onClick={() => setReceiving(true)}>💰 Receber pagamento</button>
            <button className="grow" onClick={() => printStatement(db.establishment, customer, lines, balance, period)}>🖨️ Extrato / PDF</button>
            <a
              className={`btn grow ${customer.phone ? '' : 'disabled'}`}
              href={customer.phone ? whatsappLink(db.establishment, customer, lines, balance) : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!customer.phone}
              onClick={(e) => { if (!customer.phone) { e.preventDefault(); setEditing(true) } }}
            >
              📲 WhatsApp
            </a>
          </div>
        </div>

        <Segmented value={period} onChange={setPeriod} options={[{ value: 'aberto', label: 'Em aberto' }, { value: 'tudo', label: 'Histórico completo' }]} />

        <div className="card">
          {lines.length === 0 ? (
            <div className="empty">{period === 'aberto' ? 'Nada em aberto. ✅' : 'Sem movimentação.'}</div>
          ) : (
            <table className="list">
              <thead><tr><th>Data</th><th>Descrição</th><th className="right">Valor</th><th className="right">Saldo</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} onClick={() => l.items && setExpanded(expanded === l.at ? null : l.at)} style={l.items ? { cursor: 'pointer' } : undefined}>
                    <td className="nowrap small">{dateBR(l.at)}<div className="muted">{hhmm(l.at)}</div></td>
                    <td>
                      {l.description}{l.items && <span className="muted small"> {expanded === l.at ? '▾' : '▸'}</span>}
                      {expanded === l.at && l.items && (
                        <div className="muted small">{l.items.map((it) => `${it.qty}× ${it.name} (${brl(it.total)})`).join(', ')}</div>
                      )}
                    </td>
                    <td className={`right money ${l.amount > 0 ? 'neg' : 'pos'}`}>{l.amount > 0 ? '+' : '−'} {brl(Math.abs(l.amount))}</td>
                    <td className="right money"><b>{brl(l.balance)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {balance === 0 && !customer.deletedAt && (
          <button className="btn-danger btn-sm" style={{ justifySelf: 'start' }} onClick={() => attempt(() => moveToTrash('customers', customer.id), 'Cliente movido para a lixeira')}>
            Excluir cliente
          </button>
        )}
      </main>
      {receiving && <ReceiveModal customer={customer} balance={balance} onClose={() => setReceiving(false)} />}
      {editing && <CustomerForm customer={customer} onClose={() => setEditing(false)} />}
    </>
  )
}

/** Linhas desde a última vez que o saldo zerou (o que está "em aberto"). */
function openLines(all: StatementLine[]): StatementLine[] {
  let start = 0
  all.forEach((l, i) => { if (l.balance <= 0) start = i + 1 })
  return all.slice(start)
}

function ReceiveModal({ customer, balance, onClose }: { customer: Customer; balance: number; onClose: () => void }) {
  const [amount, setAmount] = useState(centsToInput(balance))
  const [method, setMethod] = useState<FiadoSettlement['method']>('pix')
  const [notes, setNotes] = useState('')
  const value = parseBRL(amount)
  return (
    <Modal title={`Receber de ${customer.name}`} onClose={onClose}>
      <p>Dívida atual: <b className="money neg">{brl(balance)}</b></p>
      <div className="tabs">
        {(['pix', 'dinheiro', 'debito', 'credito'] as const).map((m) => (
          <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>
        ))}
      </div>
      <label className="field">Valor recebido (R$)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field">Observação<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" /></label>
      {value > 0 && value < balance && <p className="muted">Pagamento parcial: continuará devendo <b className="money">{brl(balance - value)}</b>.</p>}
      <button className="btn-ok btn-lg" disabled={value <= 0} onClick={() => attempt(() => receiveFiado(customer.id, value, method, notes), 'Pagamento recebido').then((ok) => ok && onClose())}>
        Confirmar {brl(value)}
      </button>
    </Modal>
  )
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return p
}

function whatsappLink(est: Establishment, c: Customer, lines: StatementLine[], balance: number): string {
  const body = [
    `Olá, ${c.name}! Aqui é do *${est.name}*.`,
    '',
    '*Extrato do fiado*',
    ...lines.map((l) => `${dateBR(l.at)} — ${l.description}: ${l.amount > 0 ? '' : '−'}${brl(Math.abs(l.amount))}`),
    '',
    `*Saldo a pagar: ${brl(balance)}*`,
    est.pixKey ? `Pix: ${est.pixKey}` : '',
    '',
    'Obrigado pela preferência!',
  ].filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n')
  const digits = c.phone.replace(/\D/g, '')
  const phone = digits.length <= 11 ? `55${digits}` : digits
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`
}

function printStatement(est: Establishment, c: Customer, lines: StatementLine[], balance: number, period: 'aberto' | 'tudo'): void {
  const rows = lines.map((l) => `<tr>
      <td>${dateTimeBR(l.at)}</td>
      <td>${escapeHtml(l.description)}${l.items ? `<div class="muted">${l.items.map((i) => `${i.qty}× ${escapeHtml(i.name)}`).join(', ')}</div>` : ''}</td>
      <td class="right ${l.amount > 0 ? 'neg' : 'pos'}">${l.amount > 0 ? '+' : '−'} ${brl(Math.abs(l.amount))}</td>
      <td class="right"><b>${brl(l.balance)}</b></td></tr>`).join('')
  printHtml(`Extrato fiado - ${c.name}`, `
    <div class="row" style="align-items:center">
      <div>${est.logoUrl ? `<img class="logo" src="${est.logoUrl}">` : ''}<h1>${escapeHtml(est.name)}</h1>
        <div class="muted">${[est.address, est.phone].filter(Boolean).map(escapeHtml).join(' · ')}</div></div>
      <div class="right"><b>EXTRATO DE FIADO</b><div class="muted">Emitido em ${dateTimeBR(nowIso())}</div></div>
    </div><hr>
    <p><b>Cliente:</b> ${escapeHtml(c.name)}${c.phone ? ` · ${formatPhone(c.phone)}` : ''}</p>
    <p class="muted">${period === 'aberto' ? 'Lançamentos em aberto (desde a última quitação)' : 'Histórico completo'}</p>
    <table><thead><tr><th>Data</th><th>Descrição</th><th class="right">Valor</th><th class="right">Saldo</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Sem lançamentos</td></tr>'}</tbody></table>
    <h2 class="right">Saldo a pagar: ${brl(balance)}</h2>
    ${est.pixKey ? `<p class="right">Pague com Pix: <b>${escapeHtml(est.pixKey)}</b></p>` : ''}
  `)
}
