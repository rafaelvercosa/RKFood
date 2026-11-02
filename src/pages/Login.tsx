import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Layout'
import { loginPin } from '../data/api'
import { isCloud } from '../data/backend'
import { useDB } from '../data/store'
import { ROLE_LABEL } from '../types'

export default function Login() {
  const db = useDB()
  const nav = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const demoUsers = db.users.filter((u) => !u.deletedAt)

  async function submit(value = pin) {
    if (value.length < 4 || busy) return
    setBusy(true)
    setError('')
    try {
      await loginPin(value)
      nav('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  function press(k: string) {
    setError('')
    if (k === '⌫') return setPin((p) => p.slice(0, -1))
    if (k === 'C') return setPin('')
    const next = (pin + k).slice(0, 6)
    setPin(next)
    if (next.length === 6) void submit(next)
  }

  return (
    <>
      <Header title="Entrar" />
      <main className="page" style={{ maxWidth: 420 }}>
        <form className="card stack center" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <h2>Digite seu PIN</h2>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label="PIN"
            value={pin}
            onChange={(e) => { setError(''); setPin(e.target.value.replace(/\D/g, '').slice(0, 6)) }}
            style={{ fontSize: '2rem', textAlign: 'center', letterSpacing: '0.5em' }}
            placeholder="••••"
          />
          {error && <p className="error-text" role="alert">{error}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
              <button type="button" key={k} className="btn-lg keypad-key" onClick={() => press(k)} aria-label={k === '⌫' ? 'Apagar' : k === 'C' ? 'Limpar' : k}>
                {k}
              </button>
            ))}
          </div>
          <button type="submit" className="btn-primary btn-lg" disabled={pin.length < 4 || busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        {!isCloud && (
          <details className="card flat">
            <summary className="muted small">Modo demonstração: usuários de teste</summary>
            <table className="list small" style={{ marginTop: 8 }}>
              <tbody>
                {demoUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="muted">{u.roles.map((r) => ROLE_LABEL[r]).join(', ')}</td>
                    <td className="right"><code>{u.pin}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </main>
    </>
  )
}
