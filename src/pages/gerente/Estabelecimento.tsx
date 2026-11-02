import { useState } from 'react'
import { attempt, Segmented } from '../../components/ui'
import { saveEstablishment, uploadImage } from '../../data/api'
import { useDB } from '../../data/store'
import { resizeImage } from '../../lib/image'
import type { Establishment } from '../../types'

export default function EstabelecimentoForm() {
  const db = useDB()
  const [form, setForm] = useState<Establishment>(db.establishment)
  const set = (patch: Partial<Establishment>) => setForm((f) => ({ ...f, ...patch }))

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
      <div className="card stack">
        <h3>Tela inicial</h3>
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
          <label className="btn">🖼️ Logomarca<input type="file" accept="image/*" hidden onChange={(e) => pick('logoUrl', e.target.files?.[0])} /></label>
          {form.logoUrl && <button className="btn-sm btn-ghost" onClick={() => set({ logoUrl: null })}>Remover logo</button>}
          <label className="btn">📷 Foto do estabelecimento<input type="file" accept="image/*" hidden onChange={(e) => pick('coverUrl', e.target.files?.[0])} /></label>
          {form.coverUrl && <button className="btn-sm btn-ghost" onClick={() => set({ coverUrl: null })}>Remover foto</button>}
        </div>
        <label className="field">Nome *<input value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="field">Frase de apresentação<input value={form.slogan} onChange={(e) => set({ slogan: e.target.value })} /></label>
        <label className="field" style={{ maxWidth: 200 }}>Cor da marca
          <input type="color" value={form.brandColor} onChange={(e) => set({ brandColor: e.target.value })} style={{ padding: 4 }} />
        </label>
      </div>

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
      </div>

      <div className="card stack">
        <h3>Contato e Pix</h3>
        <label className="field">Telefone / WhatsApp<input inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        <label className="field">Endereço<input value={form.address} onChange={(e) => set({ address: e.target.value })} /></label>
        <label className="field">Chave Pix (aparece no extrato do fiado)<input value={form.pixKey} onChange={(e) => set({ pixKey: e.target.value })} /></label>
      </div>

      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveEstablishment(form), 'Dados salvos')}>Salvar</button>
    </div>
  )
}
