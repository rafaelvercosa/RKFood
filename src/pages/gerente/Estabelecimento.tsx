import { useState } from 'react'
import { attempt, Segmented } from '../../components/ui'
import { saveEstablishment, uploadImage } from '../../data/api'
import { hasRole, useCurrentUser } from '../../data/session'
import { useDB } from '../../data/store'
import { resizeImage } from '../../lib/image'
import { contrast, inkOn } from '../../lib/color'
import type { Establishment } from '../../types'

const BRAND_SWATCHES = [
  { name: 'Brasa', color: '#cf3f17' },
  { name: 'Folha', color: '#1e7a46' },
  { name: 'Lona azul', color: '#2a62c4' },
  { name: 'Milho', color: '#ffc53d' },
  { name: 'Carvão', color: '#2a2420' },
]

export default function EstabelecimentoForm() {
  const db = useDB()
  const [form, setForm] = useState<Establishment>(db.establishment)
  const set = (patch: Partial<Establishment>) => setForm((f) => ({ ...f, ...patch }))
  // nome, frase, cor, logomarca e foto: só o dono muda (o banco confere de novo)
  const isOwner = hasRole(useCurrentUser(), 'dono')

  async function pick(field: 'logoUrl' | 'coverUrl', file: File | undefined) {
    if (!file) return
    try {
      set({ [field]: await uploadImage(await resizeImage(file, field === 'logoUrl' ? 320 : 1280, 0.82)) })
    } catch (e) {
      attempt(() => { throw e })
    }
  }

  return (
    <div className="stack">
      <fieldset className="card stack" disabled={!isOwner} style={{ margin: 0, minWidth: 0 }}>
        <h3>Aparência</h3>
        {!isOwner && <p className="muted small">Só o dono muda o nome, a frase, a cor, a logomarca e a foto.</p>}
        <div
          className="home-hero"
          style={{ minHeight: 180, borderRadius: 12, overflow: 'hidden', background: form.coverUrl ? `url(${form.coverUrl}) center/cover` : form.brandColor }}
        >
          <div>
            {form.logoUrl && <img className="logo-big" src={form.logoUrl} alt="" style={{ width: 64, height: 64 }} />}
            <h2 style={{ color: '#fff' }}>{form.name || 'Nome do estabelecimento'}</h2>
            <p style={{ color: '#fff', opacity: 0.9 }}>{form.slogan}</p>
          </div>
        </div>
        <div className="row">
          <label className="btn" aria-disabled={!isOwner}>🖼️ Logomarca<input type="file" accept="image/*" hidden onChange={(e) => pick('logoUrl', e.target.files?.[0])} /></label>
          {form.logoUrl && <button className="btn-sm btn-ghost" onClick={() => set({ logoUrl: null })}>Remover logo</button>}
          <label className="btn" aria-disabled={!isOwner}>📷 Foto do estabelecimento<input type="file" accept="image/*" hidden onChange={(e) => pick('coverUrl', e.target.files?.[0])} /></label>
          {form.coverUrl && <button className="btn-sm btn-ghost" onClick={() => set({ coverUrl: null })}>Remover foto</button>}
        </div>
        <label className="field">Nome *<input value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="field">Frase de apresentação<input value={form.slogan} onChange={(e) => set({ slogan: e.target.value })} /></label>
        <div className="stack" style={{ gap: 8 }}>
          <span className="small" style={{ fontWeight: 800 }}>Cor da marca</span>
          <div className="row" role="group" aria-label="Escolher a cor da marca">
            {BRAND_SWATCHES.map((c) => (
              <button key={c.color} type="button" aria-pressed={form.brandColor.toLowerCase() === c.color} aria-label={c.name} title={c.name}
                onClick={() => set({ brandColor: c.color })}
                style={{ width: 48, height: 48, minHeight: 48, padding: 0, borderRadius: '50%', background: c.color, color: inkOn(c.color), boxShadow: form.brandColor.toLowerCase() === c.color ? `0 0 0 3px var(--surface), 0 0 0 6px ${c.color}` : 'var(--shadow-1)' }}>
                {form.brandColor.toLowerCase() === c.color ? '✓' : ''}
              </button>
            ))}
            <label className="btn btn-sm" style={{ minHeight: 48 }}>Outra cor<input type="color" value={form.brandColor} onChange={(e) => set({ brandColor: e.target.value })} style={{ width: 40, minHeight: 32, padding: 2, marginLeft: 6 }} aria-label="Escolher outra cor" /></label>
          </div>
          <p className="small muted">O texto sobre a cor muda sozinho para {inkOn(form.brandColor) === '#ffffff' ? 'branco' : 'escuro'}, para continuar fácil de ler{contrast(form.brandColor, inkOn(form.brandColor)) < 4.5 ? '. Essa cor ficou clara ou apagada: prefira um dos tons acima.' : '.'}</p>
        </div>
      </fieldset>

      <div className="card stack">
        <h3>Funcionamento</h3>
        <div className="stack">
          <span className="small" style={{ fontWeight: 600 }}>Quando o cliente paga?</span>
          <Segmented value={form.paymentTiming} onChange={(v) => set({ paymentTiming: v })} options={[
            { value: 'depois', label: 'Depois de consumir' },
            { value: 'antes', label: 'Antes (paga e depois prepara)' },
          ]} />
          <p className="muted small">
            {form.paymentTiming === 'antes'
              ? 'O pedido só aparece na cozinha depois que o caixa registrar o pagamento.'
              : 'O pedido vai direto para a cozinha; o caixa recebe quando o cliente for embora.'}
          </p>
        </div>
        <label className="field" style={{ maxWidth: 260 }}>Tempo estimado de preparo (minutos)
          <input
            type="number" inputMode="numeric" min={1} max={180}
            value={form.kitchenTargetMin || ''}
            onChange={(e) => set({ kitchenTargetMin: Math.round(Number(e.target.value)) || 0 })}
          />
        </label>
        <p className="muted small">
          A cozinha mostra um cronômetro em cada comanda. Passou desse tempo, o pedido fica vermelho e toca um aviso.
        </p>
        <label className="field" style={{ maxWidth: 260 }}>Quantidade de mesas
          <input
            type="number" inputMode="numeric" min={0} max={200}
            value={form.tableCount}
            onChange={(e) => set({ tableCount: Math.max(0, Math.round(Number(e.target.value)) || 0) })}
          />
        </label>
        <p className="muted small">
          {form.tableCount > 0
            ? `O atendente vê botões das mesas 1 a ${form.tableCount}. Mesa fora dessa lista continua pelo campo de texto.`
            : 'Sem botões de mesa: o atendente digita a mesa ou o nome do cliente.'}
        </p>
      </div>

      <div className="card stack">
        <h3>Contato e Pix</h3>
        <label className="field">Telefone / WhatsApp<input inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        <label className="field">Endereço<input value={form.address} onChange={(e) => set({ address: e.target.value })} /></label>
        <label className="field">Chave Pix (QR Code do caixa e extrato do fiado)<input value={form.pixKey} onChange={(e) => set({ pixKey: e.target.value })} /></label>
      </div>

      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveEstablishment(form), 'Dados salvos')}>Salvar</button>
    </div>
  )
}
