import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Layout'
import { useDB } from '../data/store'
import { login } from '../data/session'
import { ROLE_LABEL } from '../types'

export default function Login() {
  const db = useDB()
  const nav = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const users = db.users.filter((u) => !u.deletedAt)

  function tryPin(value: string) {
    setPin(value)
    setError('')
    const user = users.find((u) => u.pin === value)
    if (user) {
      login(user)
      nav('/', { replace: true })
    } else if (value.length >= 6) {
      setError('PIN não encontrado')
      setPin('')
    }
  }

  const press = (k: string) => {
    if (k === '⌫') return setPin((p) => p.slice(0, -1))
    if (k === 'C') return setPin('')
    tryPin(pin + k)
  }

  return (
    <>
      <Header title="Entrar" />
      <main className="page" style={{ maxWidth: 420 }}>
        <div className="card stack center">
          <h2>Digite seu PIN</h2>
          <div style={{ fontSize: '2rem', letterSpacing: '0.5em', minHeight: '2.6rem' }} aria-live="polite">
            {'•'.repeat(pin.length) || <span className="muted small" style={{ letterSpacing: 0 }}>4 a 6 números</span>}
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
              <button key={k} className="btn-lg" onClick={() => press(k)} aria-label={k === '⌫' ? 'Apagar' : k === 'C' ? 'Limpar' : k}>
                {k}
              </button>
            ))}
          </div>
        </div>
        <details className="card flat">
          <summary className="muted small">Modo demonstração: usuários de teste</summary>
          <table className="list small" style={{ marginTop: 8 }}>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="muted">{u.roles.map((r) => ROLE_LABEL[r]).join(', ')}</td>
                  <td className="right"><code>{u.pin}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </main>
    </>
  )
}
