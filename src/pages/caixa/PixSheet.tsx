import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Modal, toast } from '../../components/ui'
import { useDB } from '../../data/store'
import { brl } from '../../lib/money'
import { buildPix } from '../../lib/pix'

/** Pix com QR Code e "copia e cola". O sistema não confirma o Pix: o caixa confere no app do banco. */
export function PixSheet({ amount, label, onConfirm, onClose }: { amount: number; label?: string; onConfirm: () => void; onClose: () => void }) {
  const est = useDB().establishment
  const key = est.pixKey.trim()
  const code = key ? buildPix({ key, name: est.name, amountCents: amount }) : ''
  const [svg, setSvg] = useState('')
  useEffect(() => {
    if (!code) return
    let live = true
    QRCode.toString(code, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((s) => live && setSvg(s)).catch(() => live && setSvg(''))
    return () => { live = false }
  }, [code])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      toast('Código Pix copiado')
    } catch {
      toast('Não deu para copiar. Selecione o código e copie.')
    }
  }

  return (
    <Modal title={label ? `Pix · ${label}` : 'Pix'} onClose={onClose}>
      {!key ? (
        <div className="stack">
          <p className="hint">A chave Pix ainda não foi cadastrada. O gerente ou o dono cadastra em Gerência → Estabelecimento.</p>
          <button className="btn-ok btn-lg" onClick={onConfirm}>Confirmar recebimento mesmo assim</button>
        </div>
      ) : (
        <div className="pix-box">
          <p className="muted" style={{ fontWeight: 700 }}>Peça para o cliente ler o QR Code</p>
          <div className="num" style={{ fontSize: '3.2rem' }}>{brl(amount)}</div>
          {svg ? <div className="qr" role="img" aria-label={`QR Code Pix no valor de ${brl(amount)}`} dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="qr" style={{ width: 228, height: 228 }} />}
          <div className="pix-code">
            <span className="grow" style={{ minWidth: 0 }}><span className="small muted" style={{ display: 'block', fontWeight: 800 }}>Pix copia e cola</span><code>{code}</code></span>
            <button className="btn-sm" onClick={() => void copy()}>Copiar</button>
          </div>
          <p className="hint" style={{ width: '100%' }}>O sistema não confirma o Pix sozinho. Veja no app do banco e só então toque em Confirmar.</p>
          <button className="btn-ok btn-lg btn-block" onClick={onConfirm}>Confirmar recebimento</button>
        </div>
      )}
    </Modal>
  )
}
