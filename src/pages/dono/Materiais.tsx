import { useState } from 'react'
import { attempt, attemptUndo, Modal, Segmented } from '../../components/ui'
import { saveMaterial, setMaterialTrashed, type MaterialInput } from '../../data/api'
import { useDB } from '../../data/store'
import { brl, centsToInput, parseBRL } from '../../lib/money'
import type { Material, MaterialUnit } from '../../types'

const UNITS: { value: MaterialUnit; label: string }[] = [
  { value: 'kg', label: 'Quilo (kg)' },
  { value: 'l', label: 'Litro (L)' },
  { value: 'un', label: 'Unidade' },
]
const PER: Record<MaterialUnit, string> = { kg: 'kg', l: 'litro', un: 'unidade' }

/** O que a barraca compra. A ficha técnica de cada item diz quanto ele gasta de cada material. */
export default function Materiais() {
  const db = useDB()
  const [editing, setEditing] = useState<Material | 'novo' | null>(null)
  const active = db.materials.filter((m) => !m.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
  const trashed = db.materials.filter((m) => m.deletedAt)
  return (
    <div className="stack">
      <button className="btn-primary" style={{ justifySelf: 'start' }} onClick={() => setEditing('novo')}>+ Novo material</button>
      <div className="card">
        {active.length === 0 ? (
          <div className="empty">Cadastre o que você compra: carne, frango, palito, carvão, bebidas…</div>
        ) : active.map((m) => (
          <div key={m.id} className="list-item">
            <div className="grow">
              <strong>{m.name}</strong>
              <div className="muted small">Comprado por {PER[m.unit]} · {m.cost ? `${brl(m.cost)} por ${PER[m.unit]}` : 'custo não informado'}</div>
            </div>
            <button className="btn-sm" onClick={() => setEditing(m)}>Editar</button>
          </div>
        ))}
      </div>
      {trashed.length > 0 && (
        <details className="card">
          <summary className="muted">Na lixeira ({trashed.length})</summary>
          {trashed.map((m) => (
            <div key={m.id} className="list-item">
              <span className="grow">{m.name}</span>
              <button className="btn-sm" onClick={() => attempt(() => setMaterialTrashed(m.id, false), 'Material restaurado')}>Restaurar</button>
            </div>
          ))}
        </details>
      )}
      <p className="muted small">O custo é opcional, mas com ele a área do dono mostra o custo e o lucro estimados de cada item.</p>
      {editing && <MaterialForm material={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function MaterialForm({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const [name, setName] = useState(material?.name ?? '')
  const [unit, setUnit] = useState<MaterialUnit>(material?.unit ?? 'kg')
  const [cost, setCost] = useState(material?.cost ? centsToInput(material.cost) : '')
  const input: MaterialInput = { id: material?.id, name, unit, cost: parseBRL(cost) }
  return (
    <Modal title={material ? 'Editar material' : 'Novo material'} onClose={onClose}>
      <label className="field">Nome *<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alcatra" autoFocus /></label>
      <div className="stack">
        <span className="small" style={{ fontWeight: 700 }}>Como você compra</span>
        <Segmented full value={unit} onChange={setUnit} options={UNITS} />
      </div>
      <label className="field">Custo por {PER[unit]} (R$, opcional)
        <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="48,00" />
      </label>
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveMaterial(input), 'Material salvo').then((ok) => ok && onClose())}>Salvar</button>
      {material && (
        <button className="btn-danger" onClick={() => attemptUndo(() => setMaterialTrashed(material.id, true), 'Material movido para a lixeira', () => setMaterialTrashed(material.id, false)).then((ok) => ok && onClose())}>
          Excluir material
        </button>
      )}
    </Modal>
  )
}
