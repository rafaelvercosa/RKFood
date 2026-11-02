import { Link } from 'react-router-dom'
import { useDB } from '../data/store'
import { hasRole, logout, useCurrentUser } from '../data/session'
import type { Role } from '../types'

const AREAS: { role: Role; to: string; ico: string; label: string; desc: string }[] = [
  { role: 'atendente', to: '/atendente', ico: '📝', label: 'Fazer pedido', desc: 'Atendente' },
  { role: 'cozinha', to: '/cozinha', ico: '🔥', label: 'Cozinha', desc: 'Fila de preparo' },
  { role: 'caixa', to: '/caixa', ico: '💳', label: 'Caixa', desc: 'Receber pagamentos' },
  { role: 'caixa', to: '/fiado', ico: '📒', label: 'Fiado', desc: 'Clientes e extratos' },
  { role: 'gerente', to: '/gerente', ico: '⚙️', label: 'Gerência', desc: 'Cardápio, equipe, relatórios' },
]

export default function Home() {
  const est = useDB().establishment
  const user = useCurrentUser()
  return (
    <>
      <section className="home-hero" style={est.coverUrl ? { backgroundImage: `url(${est.coverUrl})` } : undefined}>
        <div>
          {est.logoUrl && <img className="logo-big" src={est.logoUrl} alt={`Logomarca ${est.name}`} />}
          <h1>{est.name}</h1>
          {est.slogan && <p style={{ opacity: 0.9 }}>{est.slogan}</p>}
        </div>
      </section>
      <main className="page">
        {!user ? (
          <Link to="/entrar" className="btn btn-primary btn-lg btn-block">Entrar</Link>
        ) : (
          <>
            <div className="row between">
              <div>
                <div className="muted small">Olá,</div>
                <h2>{user.name}</h2>
              </div>
              <button onClick={logout}>Trocar usuário</button>
            </div>
            <div className="role-grid">
              {AREAS.filter((a) => hasRole(user, a.role)).map((a) => (
                <Link key={a.to} to={a.to} className="btn role-tile">
                  <span className="ico" aria-hidden>{a.ico}</span>
                  <span>{a.label}</span>
                  <span className="muted small" style={{ fontWeight: 500 }}>{a.desc}</span>
                </Link>
              ))}
            </div>
          </>
        )}
        <p className="muted small center">RKFood · pedidos, cozinha e caixa</p>
      </main>
    </>
  )
}
