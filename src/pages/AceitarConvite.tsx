// Página do link de convite: o celular da pessoa entra sem o e-mail e a senha do
// estabelecimento e fica liberado só para ela (só o PIN dela funciona ali).
import { useState } from 'react'
import { acceptInvite, useCloud } from '../data/cloud'

export default function AceitarConvite({ code, onDone }: { code: string; onDone: () => void }) {
  const cloud = useCloud()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alreadyConnected = cloud.phase === 'pronto' || cloud.phase === 'escolher'

  async function accept() {
    setBusy(true)
    setError('')
    try {
      await acceptInvite(code)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="app-header"><div className="titles"><small>RKFood</small><strong>Convite de acesso</strong></div></header>
      <main className="page" style={{ maxWidth: 440 }}>
        <div className="card stack">
          <h2>Você recebeu um acesso</h2>
          <p>Este link libera <b>este celular</b> para você usar o sistema do estabelecimento. Depois é só entrar com o <b>seu PIN</b>.</p>
          <p className="muted small">O link vale uma vez só e por 24 horas. Neste celular, só o seu PIN vai funcionar.</p>
          {alreadyConnected && (
            <p className="small"><b>Atenção:</b> este aparelho já está conectado. Ao aceitar, ele passa a ser só seu.</p>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn-primary btn-lg" onClick={accept} disabled={busy}>{busy ? 'Conectando…' : 'Aceitar e conectar este celular'}</button>
          <button className="btn-ghost" onClick={onDone}>Agora não</button>
        </div>
      </main>
    </>
  )
}
