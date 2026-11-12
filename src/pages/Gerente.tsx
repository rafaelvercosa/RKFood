import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from '../components/Layout'
import Cardapio from './gerente/Cardapio'
import Equipe from './gerente/Equipe'
import EstabelecimentoForm from './gerente/Estabelecimento'
import Relatorios from './gerente/Relatorios'
import Modelo from './gerente/Modelo'
import ObservacoesRapidas from './gerente/ObservacoesRapidas'
import Seguranca from './gerente/Seguranca'

const TABS = [
  { to: 'cardapio', label: 'Cardápio', el: <Cardapio /> },
  { to: 'relatorios', label: 'Relatórios', el: <Relatorios /> },
  { to: 'equipe', label: 'Equipe', el: <Equipe /> },
  { to: 'estabelecimento', label: 'Estabelecimento', el: <EstabelecimentoForm /> },
  { to: 'observacoes', label: 'Observações rápidas', el: <ObservacoesRapidas /> },
  { to: 'seguranca', label: 'Lixeira e histórico', el: <Seguranca /> },
]
/** Páginas sem aba (abertas por atalhos). */
const EXTRA = [{ to: 'modelo', el: <Modelo /> }]

export default function Gerente() {
  return (
    <>
      <Header title="Gerência" />
      <main className="page">
        <nav className="tabs" aria-label="Seções da gerência">
          {TABS.map((t) => (
            <NavLink key={t.to} to={`/gerente/${t.to}`} className={({ isActive }) => `btn ${isActive ? 'on' : ''}`}>{t.label}</NavLink>
          ))}
        </nav>
        <Routes>
          {[...TABS, ...EXTRA].map((t) => <Route key={t.to} path={t.to} element={t.el} />)}
          {/* caminhos absolutos: no React Router 7, link relativo dentro de /gerente/* parte da URL inteira */}
          <Route path="*" element={<Navigate to="/gerente/cardapio" replace />} />
        </Routes>
      </main>
    </>
  )
}
