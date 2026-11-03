// Página do link de convite: o celular da pessoa entra sem o e-mail e a senha do
// estabelecimento e fica liberado só para ela (só o PIN dela funciona ali). A pessoa
// cria o próprio PIN aqui, então nem o gerente nem o dono ficam sabendo dele.
import { useState } from 'react'
import { acceptInvite, useCloud } from '../data/cloud'

export default function AceitarConvite({ code, onDone }: { code: string; onDone: () => void }) {
  const cloud = useCloud()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const alreadyConnected = cloud.phase === 'pronto' || cloud.phase === 'escolher'

  async function accept() {
    if (!/^\d{4,6}$/.test(pin)) return setError('O PIN deve ter de 4 a 6 números')
    if (pin !== pin2) return setError('Os dois PINs não são iguais. Digite de novo.')
    setBusy(true)
    setError('')
    try {
      await acceptInvite(code, pin)
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
          <p>Este link libera <b>este celular</b> para você usar o sistema do estabelecimento. Crie agora o <b>seu PIN</b>: é com ele que você entra, e só você vai saber.</p>
          <label className="field">Crie o seu PIN (4 a 6 números)
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="field">Digite o PIN de novo
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
          </label>
          <p className="muted small">O link vale uma vez só e por 24 horas. Neste celular, só o seu PIN vai funcionar. Se esquecer o PIN, peça um link novo.</p>
          {alreadyConnected && (
            <p className="small"><b>Atenção:</b> este aparelho já está conectado. Ao aceitar, ele passa a ser só seu.</p>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn-primary btn-lg" onClick={accept} disabled={busy}>{busy ? 'Conectando…' : 'Criar PIN e conectar este celular'}</button>
          <button className="btn-ghost" onClick={onDone}>Agora não</button>
        </div>
      </main>
    </>
  )
}
