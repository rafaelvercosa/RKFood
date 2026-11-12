import { useMemo, useState } from 'react'
import { CustomerForm } from '../../components/CustomerForm'
import { attempt, AuthPinField } from '../../components/ui'
import type { PaymentInput } from '../../data/api'
import { customerBalance } from '../../data/selectors'
import { useDB } from '../../data/store'
import { brl, centsToInput, parseBRL } from '../../lib/money'
import type { PaymentMethod } from '../../types'
import { METHOD_LABEL } from '../../types'
import { PixSheet } from './PixSheet'

const METHODS: PaymentMethod[] = ['pix', 'dinheiro', 'debito', 'credito', 'fiado', 'cortesia']

interface Part { method: PaymentMethod; amount: string; cash: string; customerId: string; pixOk?: boolean }

/** Formas de pagamento de um valor. `submit` grava (um pedido ou uma conta de mesa inteira). */
export function PaymentForm({ remaining, submit, onDone }: { remaining: number; submit: (input: PaymentInput[], ownerPin: string) => Promise<unknown> | unknown; onDone: () => void }) {
  const db = useDB()
  const [parts, setParts] = useState<Part[]>([{ method: 'pix', amount: centsToInput(remaining), cash: '', customerId: '' }])
  const [newCustomerFor, setNewCustomerFor] = useState<number | null>(null)
  const [ownerPin, setOwnerPin] = useState('')
  const [pixFor, setPixFor] = useState<number | null>(null)
  const customers = useMemo(() => db.customers.filter((c) => !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [db.customers])

  const sum = parts.reduce((s, p) => s + parseBRL(p.amount), 0)
  const diff = remaining - sum
  const set = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  function confirm() {
    const input: PaymentInput[] = parts.map((p) => ({
      method: p.method,
      amount: parseBRL(p.amount),
      cashReceived: p.method === 'dinheiro' && p.cash ? parseBRL(p.cash) : null,
      customerId: p.method === 'fiado' ? p.customerId || null : null,
    }))
    void attempt(() => submit(input, ownerPin), 'Pagamento registrado').then((ok) => (ok ? onDone() : setOwnerPin('')))
  }

  return (
    <div className="stack">
      {parts.map((p, i) => {
        const amount = parseBRL(p.amount)
        const change = p.method === 'dinheiro' && p.cash ? parseBRL(p.cash) - amount : 0
        return (
          <div key={i} className="card flat stack">
            <div className="tabs">
              {METHODS.map((m) => (
                <button key={m} className={p.method === m ? 'on' : ''} onClick={() => set(i, { method: m })}>{METHOD_LABEL[m]}</button>
              ))}
            </div>
            <div className="row">
              <label className="field grow">Valor (R$)
                <input inputMode="decimal" value={p.amount} onChange={(e) => set(i, { amount: e.target.value })} />
              </label>
              {p.method === 'dinheiro' && (
                <label className="field grow">Cliente entregou (R$)
                  <input inputMode="decimal" placeholder="Para calcular o troco" value={p.cash} onChange={(e) => set(i, { cash: e.target.value })} />
                </label>
              )}
            </div>
            {p.method === 'dinheiro' && p.cash && (
              <div className={change < 0 ? 'error-text' : ''}><b>{change < 0 ? 'Falta: ' : 'Troco: '}</b><span className="money" style={{ fontSize: '1.3rem' }}>{brl(Math.abs(change))}</span></div>
            )}
            {p.method === 'pix' && (
              <div className="row">
                <button className="btn-sm" onClick={() => setPixFor(i)} disabled={amount <= 0}>{p.pixOk ? '✓ Pix conferido' : 'Mostrar QR Code Pix'}</button>
                {p.pixOk && <span className="small muted">Recebimento confirmado por você.</span>}
              </div>
            )}
            {p.method === 'fiado' && (
              <div className="stack">
                <div className="row">
                  <select className="grow" style={{ width: 'auto' }} value={p.customerId} onChange={(e) => set(i, { customerId: e.target.value })} aria-label="Cliente do fiado">
                    <option value="">Escolha o cliente…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => setNewCustomerFor(i)}>+ Novo</button>
                </div>
                {p.customerId && (() => {
                  const c = customers.find((x) => x.id === p.customerId)
                  const bal = customerBalance(db, p.customerId)
                  return <p className="small muted">Já deve: <b className="money">{brl(bal)}</b>{c?.creditLimit ? ` · limite ${brl(c.creditLimit)}` : ''}</p>
                })()}
              </div>
            )}
            {parts.length > 1 && <button className="btn-sm btn-ghost" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>Remover esta forma</button>}
          </div>
        )
      })}
      {diff > 0 && (
        <button onClick={() => setParts((ps) => [...ps, { method: 'dinheiro', amount: centsToInput(diff), cash: '', customerId: '' }])}>
          + Dividir: pagar os {brl(diff)} restantes de outra forma
        </button>
      )}
      {diff < 0 && <p className="error-text">A soma passa do valor em {brl(-diff)}.</p>}
      {parts.some((p) => p.method === 'cortesia') && (
        <AuthPinField label="Cortesia: PIN do dono para autorizar" value={ownerPin} onChange={setOwnerPin} />
      )}
      <button className="btn-ok btn-lg" disabled={sum <= 0 || diff < 0} onClick={confirm}>
        Confirmar {brl(sum)}{diff > 0 ? ` (fica faltando ${brl(diff)})` : ''}
      </button>
      {pixFor !== null && (
        <PixSheet
          amount={parseBRL(parts[pixFor]?.amount ?? '0')}
          onClose={() => setPixFor(null)}
          onConfirm={() => { set(pixFor, { pixOk: true }); setPixFor(null) }}
        />
      )}
      {newCustomerFor !== null && (
        <CustomerForm onClose={() => setNewCustomerFor(null)} onSaved={(c) => set(newCustomerFor, { customerId: c.id })} />
      )}
    </div>
  )
}

