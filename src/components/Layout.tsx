import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Modal } from './ui'
import { areaForPath } from '../manual/content'
import { useDB } from '../data/store'
import { logoutOperator as logout } from '../data/api'
import { hasRole, useCurrentUser } from '../data/session'
import { inkOn } from '../lib/color'
import type { Role } from '../types'

/** Aplica a cor da marca do estabelecimento em todo o sistema. */
export function useBrandColor(): void {
  const color = useDB().establishment.brandColor
  useEffect(() => {
    document.documentElement.style.setProperty('--brand', color)
    document.documentElement.style.setProperty('--brand-ink', inkOn(color))
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
  }, [color])
}

/** Botão ?: abre a ajuda da tela em que a pessoa está, com atalho para o manual inteiro. */
function HelpButton() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const area = areaForPath(pathname)
  return (
    <>
      <button className="icon-btn help-btn" aria-label="Ajuda desta tela" onClick={() => setOpen(true)}>?</button>
      {open && (
        <Modal title={area ? `Como usar: ${area.title}` : 'Ajuda'} onClose={() => setOpen(false)}>
          {area ? (
            <>
              <p className="muted" style={{ fontWeight: 700 }}>{area.serve}</p>
              <ol className="help-steps">{area.steps.map((st) => <li key={st}>{st}</li>)}</ol>
              <div className="hint"><b>Dica: </b>{area.tip}</div>
              <div className="row">
                <Link to={`/manual/${area.id}`} className="btn btn-primary grow" onClick={() => setOpen(false)}>Abrir no manual</Link>
                <button className="grow" onClick={() => setOpen(false)}>Entendi</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontWeight: 700 }}>O manual explica cada área do aplicativo, passo a passo.</p>
              <Link to="/manual" className="btn btn-primary" onClick={() => setOpen(false)}>Abrir o manual</Link>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

export function Header({ title, right, back, backTo }: { title: string; right?: ReactNode; back?: boolean; backTo?: string }) {
  const est = useDB().establishment
  const user = useCurrentUser()
  const nav = useNavigate()
  return (
    <header className="app-header">
      {back ? (
        <button className="icon-btn" aria-label="Voltar" onClick={() => (backTo ? nav(backTo) : nav(-1))}>‹</button>
      ) : (
        <Link to="/" aria-label="Início" style={{ display: 'contents' }}>
          {est.logoUrl ? <img className="logo" src={est.logoUrl} alt="" /> : <div className="logo" />}
        </Link>
      )}
      <div className="titles">
        <small>{est.name}{user ? ` · ${user.name}` : ''}</small>
        <strong>{title}</strong>
      </div>
      {right}
      {user && <HelpButton />}
      {user && (
        // volta para a tela principal sem sair do PIN (para trocar de função)
        <Link to="/" className="btn btn-ghost btn-sm header-home" aria-label="Início">🏠</Link>
      )}
      {user && (
        <button className="btn-ghost btn-sm" aria-label="Sair" onClick={() => { void logout(); nav('/') }}>⎋</button>
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
