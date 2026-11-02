import { useEffect, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useDB } from '../data/store'
import { hasRole, logout, useCurrentUser } from '../data/session'
import type { Role } from '../types'

/** Aplica a cor da marca do estabelecimento em todo o sistema. */
export function useBrandColor(): void {
  const color = useDB().establishment.brandColor
  useEffect(() => {
    document.documentElement.style.setProperty('--brand', color)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
  }, [color])
}

export function Header({ title, right }: { title: string; right?: ReactNode }) {
  const est = useDB().establishment
  const user = useCurrentUser()
  const nav = useNavigate()
  return (
    <header className="app-header">
      <Link to="/" aria-label="Início" style={{ display: 'contents' }}>
        {est.logoUrl ? <img className="logo" src={est.logoUrl} alt="" /> : <div className="logo" />}
      </Link>
      <div className="titles">
        <small>{est.name}{user ? ` · ${user.name}` : ''}</small>
        <strong>{title}</strong>
      </div>
      {right}
      {user && (
        <button className="btn-ghost btn-sm" onClick={() => { logout(); nav('/') }}>Sair</button>
      )}
    </header>
  )
}

/** Só deixa entrar quem tem o perfil necessário. Gerente entra em tudo. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const user = useCurrentUser()
  if (!user) return <Navigate to="/entrar" replace />
  if (!hasRole(user, role)) return <Navigate to="/" replace />
  return <>{children}</>
}
