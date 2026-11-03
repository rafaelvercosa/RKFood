import { useMemo, useState } from 'react'
import { attempt, Modal, Segmented, toast } from '../../components/ui'
import { saveMaterial, saveReadyMade, saveReadyMadeCategory, saveRecipe } from '../../data/api'
import { formatQty, hasRecipe, productCost } from '../../data/reports'
import { useDB } from '../../data/store'
import { brl, centsToInput, parseBRL } from '../../lib/money'
import type { Category, Database, Material, MaterialUnit, Product } from '../../types'

// Na ficha, quilo e litro são digitados em gramas e mililitros (é como se pensa um espetinho).
const INPUT_UNIT: Record<Material['unit'], string> = { kg: 'g', l: 'ml', un: 'un' }
const toInput = (m: Material, qty: number) => String(m.unit === 'un' ? qty : Math.round(qty * 1000 * 100) / 100).replace('.', ',')
const fromInput = (m: Material, text: string) => {
  const n = Number(text.replace(',', '.'))
  return Number.isFinite(n) ? (m.unit === 'un' ? n : n / 1000) : 0
}

/** Comprado pronto = a ficha é só "1 un" do material com o mesmo nome do item. */
function isReadyMade(db: Database, p: Product): boolean {
  const rows = db.recipes.filter((r) => r.productId === p.id)
  if (rows.length !== 1 || rows[0].qty !== 1) return false
  const m = db.materials.find((x) => x.id === rows[0].materialId)
  return !!m && m.unit === 'un' && m.name.trim().toLowerCase() === p.name.trim().toLowerCase()
}

export default function FichaTecnica() {
  const db = useDB()
  const [editing, setEditing] = useState<Product | null>(null)
  const [readyMade, setReadyMade] = useState<Product | null>(null)
  const [readyCat, setReadyCat] = useState<Category | null>(null)
  const categories = db.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sort - b.sort)
  const missing = db.products.filter((p) => !p.deletedAt && !hasRecipe(db, p.id)).length
  return (
    <div className="stack">
      <p className="muted small">
        Diga quanto cada item gasta de cada material. Com isso o app calcula o custo de cada item, o lucro estimado e a lista de compras.
        {missing > 0 && <> <b>{missing} {missing === 1 ? 'item ainda não tem' : 'itens ainda não têm'} ficha.</b></>}
      </p>
      <p className="muted small">
        Compra o item já pronto (bebida, espeto montado)? Toque em <b>Comprado pronto</b>: o app conta por unidade e a lista de
        compras mostra quantos repor de cada um. Dá para marcar a categoria inteira de uma vez.
      </p>
      {categories.map((c) => {
        const products = db.products.filter((p) => p.categoryId === c.id && !p.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
        if (products.length === 0) return null
        return (
          <div key={c.id} className="card">
            <div className="row between">
              <h3>{c.name}</h3>
              {products.some((p) => !isReadyMade(db, p)) && (
                <button className="btn-sm" onClick={() => setReadyCat(c)}>Todos como comprado pronto</button>
              )}
            </div>
            {products.map((p) => {
              const cost = productCost(db, p.id)
              const rows = db.recipes.filter((r) => r.productId === p.id)
              const margin = p.price ? Math.round(((p.price - cost) / p.price) * 100) : 0
              const ready = isReadyMade(db, p)
              return (
                <div key={p.id} className="list-item">
                  <div className="grow">
                    <strong>{p.name}</strong> <span className="muted small">{brl(p.price)}</span>
                    {rows.length === 0 ? (
                      <div><span className="badge devendo">Sem ficha técnica</span></div>
                    ) : ready ? (
                      <div className="muted small">
                        Comprado pronto{cost > 0 ? <> · custo <b>{brl(cost)}</b> · margem <b>{margin}%</b></> : ' · custo não informado'}
                      </div>
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
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {rows.length === 0 && <button className="btn-sm" onClick={() => setReadyMade(p)}>Comprado pronto</button>}
                    <button className="btn-sm" onClick={() => (ready ? setReadyMade(p) : setEditing(p))}>{rows.length ? 'Editar' : 'Montar ficha'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
      {editing && <RecipeForm product={editing} onClose={() => setEditing(null)} onReadyMade={() => { setReadyMade(editing); setEditing(null) }} />}
      {readyMade && <ReadyMadeForm product={readyMade} onClose={() => setReadyMade(null)} onDetailed={() => { setEditing(readyMade); setReadyMade(null) }} />}
      {readyCat && <CategoryReadyForm category={readyCat} onClose={() => setReadyCat(null)} />}
    </div>
  )
}

/** Item que a barraca compra pronto: o material tem o nome do item e a ficha é 1 unidade dele. */
function ReadyMadeForm({ product, onClose, onDetailed }: { product: Product; onClose: () => void; onDetailed: () => void }) {
  const db = useDB()
  const detailed = db.recipes.some((r) => r.productId === product.id) && !isReadyMade(db, product)
  const same = db.materials.find((m) => !m.deletedAt && m.name.trim().toLowerCase() === product.name.trim().toLowerCase())
  const [cost, setCost] = useState(same?.cost ? centsToInput(same.cost) : '')
  const cents = cost.trim() ? parseBRL(cost) : null
  return (
    <Modal title={`${product.name} · comprado pronto`} onClose={onClose}>
      <label className="field">Quanto você paga por um {product.name}? (R$, opcional)
        <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="3,50" autoFocus />
      </label>
      {cents !== null && cents > 0 && product.price > 0 && (
        <p className="small">Vende por <b>{brl(product.price)}</b> · lucro de <b>{brl(product.price - cents)}</b> por unidade
          ({Math.round(((product.price - cents) / product.price) * 100)}%)</p>
      )}
      <p className="muted small">
        {same ? <>Vai usar o material <b>{same.name}</b> que já existe.</> : <>O app cria o material <b>{product.name}</b> (por unidade).</>}
        {' '}Cada {product.name} vendido gasta 1 unidade, e a lista de compras mostra quantos comprar.
      </p>
      {detailed && <p className="small"><b>Atenção:</b> a ficha detalhada de {product.name} (com os materiais) será trocada por esta.</p>}
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveReadyMade(product.id, cents), 'Ficha técnica salva').then((ok) => ok && onClose())}>Salvar</button>
      {!detailed && <button className="btn-ghost" onClick={onDetailed}>Prefiro montar a ficha com os materiais</button>}
    </Modal>
  )
}

/** A categoria inteira como comprada pronta (os custos ficam como estão e podem ser postos depois). */
function CategoryReadyForm({ category, onClose }: { category: Category; onClose: () => void }) {
  const db = useDB()
  const products = db.products.filter((p) => p.categoryId === category.id && !p.deletedAt)
  const detailed = products.filter((p) => db.recipes.some((r) => r.productId === p.id) && !isReadyMade(db, p))
  async function save() {
    const skipped = await saveReadyMadeCategory(category.id)
    toast(skipped.length
      ? `Pronto. Ficaram de fora (já existe material em kg ou litro com o mesmo nome): ${skipped.join(', ')}`
      : `${category.name}: todos como comprado pronto`)
    onClose()
  }
  return (
    <Modal title={`${category.name} · comprado pronto`} onClose={onClose}>
      <p>Os <b>{products.length} itens</b> de {category.name} passam a ser contados por unidade. A lista de compras mostra quantos repor de cada um.</p>
      {detailed.length > 0 && (
        <p className="small"><b>Atenção:</b> a ficha detalhada destes itens será trocada: {detailed.map((p) => p.name).join(', ')}.</p>
      )}
      <p className="muted small">Para ver o lucro, depois toque em <b>Editar</b> em cada item e diga quanto paga por um.</p>
      <button className="btn-primary btn-lg" onClick={() => void attempt(save)}>Marcar todos</button>
    </Modal>
  )
}

const UNITS: { value: MaterialUnit; label: string }[] = [
  { value: 'kg', label: 'Quilo' },
  { value: 'l', label: 'Litro' },
  { value: 'un', label: 'Unidade' },
]
const PER: Record<MaterialUnit, string> = { kg: 'kg', l: 'litro', un: 'unidade' }

/** Cadastra um material sem sair da ficha técnica. */
function NewMaterial({ onCreated, onCancel }: { onCreated: (m: Material) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState<MaterialUnit>('kg')
  const [cost, setCost] = useState('')
  async function save() {
    const input = { name, unit, cost: parseBRL(cost) }
    const id = await saveMaterial(input)
    onCreated({ ...input, name: name.trim(), id, deletedAt: null })
  }
  return (
    <div className="card stack" style={{ background: 'var(--surface-2)' }}>
      <strong>Novo material</strong>
      <label className="field">Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alcatra" autoFocus /></label>
      <Segmented full value={unit} onChange={setUnit} options={UNITS} />
      <label className="field">Custo por {PER[unit]} (R$, opcional)
        <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="48,00" />
      </label>
      <div className="row">
        <button className="btn-ghost grow" onClick={onCancel}>Cancelar</button>
        <button className="btn-ok grow" onClick={() => void attempt(save, 'Material cadastrado')}>Cadastrar</button>
      </div>
    </div>
  )
}

interface Line { materialId: string; qty: string }

function RecipeForm({ product, onClose, onReadyMade }: { product: Product; onClose: () => void; onReadyMade: () => void }) {
  const db = useDB()
  // os criados aqui entram na hora, antes de a nuvem mandar a lista nova
  const [created, setCreated] = useState<Material[]>([])
  const [adding, setAdding] = useState(false)
  const materials = useMemo(() => {
    const list = db.materials.filter((m) => !m.deletedAt)
    return [...list, ...created.filter((c) => !list.some((m) => m.id === c.id))].sort((a, b) => a.name.localeCompare(b.name))
  }, [db.materials, created])
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
      {adding ? (
        <NewMaterial
          onCancel={() => setAdding(false)}
          onCreated={(m) => {
            setCreated((c) => [...c, m])
            setLines((ls) => [...ls.filter((l) => l.materialId), { materialId: m.id, qty: '' }])
            setAdding(false)
          }}
        />
      ) : (
        <div className="row">
          <button className="grow" onClick={() => setLines((ls) => [...ls, { materialId: '', qty: '' }])}>+ Material</button>
          <button className="grow" onClick={() => setAdding(true)}>+ Cadastrar material novo</button>
        </div>
      )}
      <div className="row between">
        <span>Custo de um {product.name}</span>
        <span className="money"><b>{brl(cost)}</b>{product.price ? <span className="muted small"> · margem {Math.round(((product.price - cost) / product.price) * 100)}%</span> : null}</span>
      </div>
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveRecipe(product.id, items), 'Ficha técnica salva').then((ok) => ok && onClose())}>Salvar</button>
      <button className="btn-ghost" onClick={onReadyMade}>Trocar para comprado pronto</button>
    </Modal>
  )
}
