// Modo nuvem: antes de tudo, o aparelho precisa entrar com a conta do estabelecimento.
import { useState, type ReactNode } from 'react'
import { chooseEstablishment, signInDevice, signOutDevice, useCloud } from '../data/cloud'

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="app-header"><div className="titles"><small>RKFood</small><strong>Conectar aparelho</strong></div></header>
      <main className="page" style={{ maxWidth: 440 }}>{children}</main>
    </>
  )
}

export default function ConectarAparelho() {
  const cloud = useCloud()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (cloud.phase === 'iniciando' || cloud.phase === 'carregando') {
    return <Shell><div className="card empty" role="status">Carregando…</div></Shell>
  }

  if (cloud.phase === 'erro') {
    return (
      <Shell>
        <div className="card stack">
          <p className="error-text" role="alert">{cloud.error}</p>
          <button onClick={() => location.reload()}>Tentar de novo</button>
          <button className="btn-ghost" onClick={() => void signOutDevice()}>Entrar com outra conta</button>
        </div>
      </Shell>
    )
  }

  if (cloud.phase === 'escolher') {
    return (
      <Shell>
        <div className="card stack">
          <h2>Qual estabelecimento?</h2>
          {cloud.establishments.map((e) => (
            <button key={e.establishment_id} className="btn-lg" onClick={() => void chooseEstablishment(e.establishment_id)}>{e.name}</button>
          ))}
        </div>
      </Shell>
    )
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInDevice(email, password)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <form className="card stack" onSubmit={submit}>
        <h2>Entrar com a conta do estabelecimento</h2>
        <p className="muted small">Faça isso uma vez em cada celular, tablet ou TV. Depois, cada pessoa entra só com o PIN.</p>
        <label className="field">E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn-primary btn-lg" disabled={busy}>{busy ? 'Conectando…' : 'Conectar'}</button>
      </form>
    </Shell>
  )
}
