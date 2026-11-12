import { useState } from 'react'
import { Link } from 'react-router-dom'
import { attempt, attemptUndo, Modal, Photo } from '../../components/ui'
import { moveCategory, moveToTrash, restoreFromTrash, saveCategory, saveProduct, uploadImage, type ProductInput } from '../../data/api'
import { useDB } from '../../data/store'
import { resizeImage } from '../../lib/image'
import { brl, centsToInput, parseBRL } from '../../lib/money'
import type { Category, Product } from '../../types'

export default function Cardapio() {
  const db = useDB()
  const categories = db.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sort - b.sort)
  const [editing, setEditing] = useState<Product | 'novo' | null>(null)
  const [editingCat, setEditingCat] = useState<Category | 'nova' | null>(null)

  return (
    <div className="stack">
      <div className="row">
        <button className="btn-primary" onClick={() => setEditing('novo')} disabled={categories.length === 0}>+ Novo item</button>
        <button onClick={() => setEditingCat('nova')}>+ Nova categoria</button>
      </div>
      {categories.length === 0 && (
        <div className="card stack center">
          <p className="muted" style={{ fontWeight: 700 }}>Comece criando uma categoria (ex.: Espetinhos, Bebidas) ou use um cardápio modelo.</p>
          <Link to="/gerente/modelo" className="btn btn-primary">Usar um cardápio modelo</Link>
        </div>
      )}
      {categories.map((c, ci) => {
        const items = db.products.filter((p) => p.categoryId === c.id && !p.deletedAt)
        return (
          <section key={c.id} className="card stack">
            <div className="row between">
              <h3>{c.name} <span className="muted small">({items.length})</span></h3>
              <div className="row">
                <button className="btn-sm icon-btn" disabled={ci === 0} onClick={() => attempt(() => moveCategory(c.id, -1))} aria-label={`Subir ${c.name}`}>↑</button>
                <button className="btn-sm icon-btn" disabled={ci === categories.length - 1} onClick={() => attempt(() => moveCategory(c.id, 1))} aria-label={`Descer ${c.name}`}>↓</button>
                <button className="btn-sm" onClick={() => setEditingCat(c)}>Renomear</button>
                <button className="btn-sm btn-danger" onClick={() => {
                  if (items.length) return attempt(() => { throw new Error('Mova ou exclua os itens desta categoria antes') })
                  attemptUndo(() => moveToTrash('categories', c.id), 'Categoria movida para a lixeira', () => restoreFromTrash('categories', c.id))
                }}>Excluir</button>
              </div>
            </div>
            {items.length === 0 && <p className="muted small">Nenhum item nesta categoria.</p>}
            {items.map((p) => (
              <div key={p.id} className="list-item">
                <Photo src={p.photoUrl} name={p.name} style={{ width: 56, height: 56, borderRadius: 10, flex: 'none' }} />
                <div className="grow">
                  <strong>{p.name}</strong> {!p.active && <span className="badge">Indisponível</span>} {!p.sendToKitchen && <span className="badge">Não vai p/ cozinha</span>}
                  <div className="muted small">{p.description}</div>
                </div>
                <span className="money"><b>{brl(p.price)}</b></span>
                <button className="btn-sm" onClick={() => setEditing(p)}>Editar</button>
              </div>
            ))}
          </section>
        )
      })}
      {editing && <ProductForm product={editing === 'novo' ? null : editing} categories={categories} onClose={() => setEditing(null)} />}
      {editingCat && <CategoryForm category={editingCat === 'nova' ? null : editingCat} onClose={() => setEditingCat(null)} />}
    </div>
  )
}

function CategoryForm({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '')
  return (
    <Modal title={category ? 'Renomear categoria' : 'Nova categoria'} onClose={onClose}>
      <label className="field">Nome<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveCategory({ id: category?.id, name }), 'Categoria salva').then((ok) => ok && onClose())}>Salvar</button>
    </Modal>
  )
}

function ProductForm({ product, categories, onClose }: { product: Product | null; categories: Category[]; onClose: () => void }) {
  const [form, setForm] = useState<ProductInput>(() => product ?? {
    categoryId: categories[0]?.id ?? '', name: '', description: '', price: 0, photoUrl: null, active: true, sendToKitchen: true,
  })
  const [price, setPrice] = useState(product ? centsToInput(product.price) : '')
  const [loadingPhoto, setLoadingPhoto] = useState(false)
  const set = (patch: Partial<ProductInput>) => setForm((f) => ({ ...f, ...patch }))

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setLoadingPhoto(true)
    try {
      set({ photoUrl: await uploadImage(await resizeImage(file)) })
    } catch (e) {
      attempt(() => { throw e })
    } finally {
      setLoadingPhoto(false)
    }
  }

  function save() {
    void attempt(() => saveProduct({ ...form, price: parseBRL(price) }), 'Item salvo').then((ok) => ok && onClose())
  }

  return (
    <Modal title={product ? 'Editar item' : 'Novo item'} onClose={onClose}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Photo src={form.photoUrl} name={form.name || '?'} style={{ width: 110, height: 110, borderRadius: 14, flex: 'none' }} />
        <div className="stack grow">
          <label className="btn">
            {loadingPhoto ? 'Processando…' : form.photoUrl ? '📷 Trocar foto' : '📷 Adicionar foto'}
            <input type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
          {form.photoUrl && <button className="btn-sm btn-ghost" onClick={() => set({ photoUrl: null })}>Remover foto</button>}
        </div>
      </div>
      <label className="field">Nome *<input value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <div className="row">
        <label className="field grow">Preço (R$) *<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" /></label>
        <label className="field grow">Categoria
          <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field">Descrição<input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Opcional" /></label>
      <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> Disponível para venda (desmarque quando acabar)</label>
      <label className="check"><input type="checkbox" checked={form.sendToKitchen} onChange={(e) => set({ sendToKitchen: e.target.checked })} /> Passa pela cozinha (desmarque para bebidas prontas)</label>
      <button className="btn-primary btn-lg" onClick={save} disabled={loadingPhoto}>Salvar</button>
      {product && (
        <button className="btn-danger" onClick={() => attemptUndo(() => moveToTrash('products', product.id), 'Item movido para a lixeira', () => restoreFromTrash('products', product.id)).then((ok) => ok && onClose())}>
          Excluir item
        </button>
      )}
    </Modal>
  )
}
