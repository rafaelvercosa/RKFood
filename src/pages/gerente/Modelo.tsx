import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { attempt } from '../../components/ui'
import { installMenuModel } from '../../data/api'
import { useDB } from '../../data/store'
import { MENU_MODELS } from '../../lib/menuModels'
import { brl } from '../../lib/money'

/** Cardápio modelo: o dono escolhe um ponto de partida e depois ajusta nomes, preços e fotos. */
export default function Modelo() {
  const db = useDB()
  const nav = useNavigate()
  const [id, setId] = useState(MENU_MODELS[0].id)
  const [busy, setBusy] = useState(false)
  const model = MENU_MODELS.find((m) => m.id === id)!
  const hasMenu = db.products.some((p) => !p.deletedAt)

  async function use() {
    setBusy(true)
    const ok = await attempt(() => installMenuModel(model), 'Cardápio criado! Ajuste preços e fotos quando quiser.')
    setBusy(false)
    if (ok) nav('/gerente/cardapio')
  }

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <p className="muted" style={{ fontWeight: 700 }}>Escolha um modelo. Depois você muda nomes, preços e fotos como quiser.</p>
      {hasMenu && <p className="hint">Você já tem itens no cardápio. O modelo só acrescenta o que ainda não existe, sem repetir nem apagar nada.</p>}
      {MENU_MODELS.map((m) => (
        <button key={m.id} type="button" className="card stack" aria-pressed={id === m.id}
          style={{ textAlign: 'left', fontWeight: 500, boxShadow: id === m.id ? '0 0 0 3px var(--brand), var(--shadow-1)' : undefined }} onClick={() => setId(m.id)}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="ico-circle" aria-hidden style={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--brand-soft)', fontSize: '1.6rem', flex: 'none' }}>{m.icon}</span>
            <span className="grow"><span className="sign" style={{ display: 'block', fontSize: '1.5rem' }}>{m.title}</span><span className="small muted" style={{ fontWeight: 600 }}>{m.desc}</span></span>
            {id === m.id && <span className="badge pago" aria-label="escolhido">✓</span>}
          </div>
          {id === m.id && (
            <div className="chips">
              {m.categories.flatMap((c) => c.items).slice(0, 8).map((i) => <span key={i.name} className="chip">{i.name} {brl(i.price)}</span>)}
              <span className="chip">+ {m.categories.flatMap((c) => c.items).length - 8 > 0 ? m.categories.flatMap((c) => c.items).length - 8 : 0} itens</span>
            </div>
          )}
        </button>
      ))}
      <div className="hint ok">Os preços são só um exemplo. Ajuste em Gerência → Cardápio.</div>
      <button className="btn-primary btn-lg btn-block" disabled={busy} onClick={() => void use()}>{busy ? 'Criando…' : `Usar o modelo ${model.title}`}</button>
      <button className="btn-block" onClick={() => nav('/gerente/cardapio')}>Começar do zero</button>
    </div>
  )
}
