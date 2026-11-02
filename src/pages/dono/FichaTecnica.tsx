import { useMemo, useState } from 'react'
import { attempt, Modal } from '../../components/ui'
import { saveRecipe } from '../../data/api'
import { formatQty, hasRecipe, productCost } from '../../data/reports'
import { useDB } from '../../data/store'
import { brl } from '../../lib/money'
import type { Material, Product } from '../../types'

// Na ficha, quilo e litro são digitados em gramas e mililitros (é como se pensa um espetinho).
const INPUT_UNIT: Record<Material['unit'], string> = { kg: 'g', l: 'ml', un: 'un' }
const toInput = (m: Material, qty: number) => String(m.unit === 'un' ? qty : Math.round(qty * 1000 * 100) / 100).replace('.', ',')
const fromInput = (m: Material, text: string) => {
  const n = Number(text.replace(',', '.'))
  return Number.isFinite(n) ? (m.unit === 'un' ? n : n / 1000) : 0
}

export default function FichaTecnica() {
  const db = useDB()
  const [editing, setEditing] = useState<Product | null>(null)
  const categories = db.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sort - b.sort)
  const missing = db.products.filter((p) => !p.deletedAt && !hasRecipe(db, p.id)).length
  return (
    <div className="stack">
      <p className="muted small">
        Diga quanto cada item gasta de cada material. Com isso o app calcula o custo de cada item, o lucro estimado e a lista de compras.
        {missing > 0 && <> <b>{missing} {missing === 1 ? 'item ainda não tem' : 'itens ainda não têm'} ficha.</b></>}
      </p>
      {db.materials.filter((m) => !m.deletedAt).length === 0 && (
        <div className="card">Primeiro cadastre os materiais na aba <b>Materiais</b>.</div>
      )}
      {categories.map((c) => {
        const products = db.products.filter((p) => p.categoryId === c.id && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
        if (products.length === 0) return null
        return (
          <div key={c.id} className="card">
            <h3>{c.name}</h3>
            {products.map((p) => {
              const cost = productCost(db, p.id)
              const rows = db.recipes.filter((r) => r.productId === p.id)
              const margin = p.price ? Math.round(((p.price - cost) / p.price) * 100) : 0
              return (
                <div key={p.id} className="list-item">
                  <div className="grow">
                    <strong>{p.name}</strong> <span className="muted small">{brl(p.price)}</span>
                    {rows.length === 0 ? (
                      <div><span className="badge devendo">Sem ficha técnica</span></div>
                    ) : (
                      <div className="muted small">
                        {rows.map((r) => {
                          const m = db.materials.find((x) => x.id === r.materialId)
                          return m ? `${formatQty(r.qty, m.unit)} ${m.name}` : ''
                        }).join(' + ')}
                        {cost > 0 && <> · custo <b>{brl(cost)}</b> · margem <b>{margin}%</b></>}
                      </div>
                    )}
                  </div>
                  <button className="btn-sm" onClick={() => setEditing(p)}>{rows.length ? 'Editar' : 'Montar ficha'}</button>
                </div>
              )
            })}
          </div>
        )
      })}
      {editing && <RecipeForm product={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

interface Line { materialId: string; qty: string }

function RecipeForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const db = useDB()
  const materials = useMemo(() => db.materials.filter((m) => !m.deletedAt).sort((a, b) => a.name.localeCompare(b.name)), [db.materials])
  const [lines, setLines] = useState<Line[]>(() =>
    db.recipes.filter((r) => r.productId === product.id).map((r) => {
      const m = db.materials.find((x) => x.id === r.materialId)!
      return { materialId: r.materialId, qty: toInput(m, r.qty) }
    }),
  )
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const items = lines
    .map((l) => ({ l, m: materials.find((x) => x.id === l.materialId) }))
    .filter((x): x is { l: Line; m: Material } => !!x.m)
    .map(({ l, m }) => ({ materialId: m.id, qty: fromInput(m, l.qty) }))
  const cost = Math.round(items.reduce((s, i) => s + i.qty * (materials.find((m) => m.id === i.materialId)?.cost ?? 0), 0))

  return (
    <Modal title={`Ficha técnica · ${product.name}`} onClose={onClose}>
      <p className="muted small">Quanto <b>um</b> {product.name} gasta de cada material.</p>
      {lines.map((l, i) => {
        const m = materials.find((x) => x.id === l.materialId)
        return (
          <div key={i} className="row">
            <select className="grow" style={{ width: 'auto' }} value={l.materialId} onChange={(e) => set(i, { materialId: e.target.value })} aria-label="Material">
              <option value="">Escolha o material…</option>
              {materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input style={{ width: 110 }} inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label="Quantidade" placeholder="120" />
            <span className="muted" style={{ minWidth: 26 }}>{m ? INPUT_UNIT[m.unit] : ''}</span>
            <button className="btn-sm btn-ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Tirar material">✕</button>
          </div>
        )
      })}
      <button onClick={() => setLines((ls) => [...ls, { materialId: '', qty: '' }])}>+ Material</button>
      <div className="row between">
        <span>Custo de um {product.name}</span>
        <span className="money"><b>{brl(cost)}</b>{product.price ? <span className="muted small"> · margem {Math.round(((product.price - cost) / product.price) * 100)}%</span> : null}</span>
      </div>
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveRecipe(product.id, items), 'Ficha técnica salva').then((ok) => ok && onClose())}>Salvar</button>
    </Modal>
  )
}
