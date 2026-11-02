import { useState } from 'react'
import { saveCustomer } from '../data/api'
import { centsToInput, parseBRL } from '../lib/money'
import type { Customer } from '../types'
import { attempt, Modal } from './ui'

export function CustomerForm({ customer, initialName = '', onClose, onSaved }: {
  customer?: Customer
  initialName?: string
  onClose: () => void
  onSaved?: (c: Customer) => void
}) {
  const [name, setName] = useState(customer?.name ?? initialName)
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [limit, setLimit] = useState(customer?.creditLimit ? centsToInput(customer.creditLimit) : '')

  async function save() {
    let saved: Customer | null = null
    const ok = await attempt(async () => {
      saved = await saveCustomer({ id: customer?.id, name, phone, notes, creditLimit: parseBRL(limit) })
    }, 'Cliente salvo')
    if (ok && saved) {
      onSaved?.(saved)
      onClose()
    }
  }

  return (
    <Modal title={customer ? 'Editar cliente' : 'Novo cliente'} onClose={onClose}>
      <label className="field">Nome *<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field">WhatsApp (com DDD)<input inputMode="tel" placeholder="81 99999-0000" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label className="field">Limite de fiado (R$)
        <input inputMode="decimal" placeholder="Em branco = sem limite" value={limit} onChange={(e) => setLimit(e.target.value)} />
      </label>
      <label className="field">Observações<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="btn-primary btn-lg" onClick={save}>Salvar</button>
    </Modal>
  )
}
