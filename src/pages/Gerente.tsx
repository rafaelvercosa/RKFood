import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from '../components/Layout'
import Cardapio from './gerente/Cardapio'
import Equipe from './gerente/Equipe'
import EstabelecimentoForm from './gerente/Estabelecimento'
import Relatorios from './gerente/Relatorios'
import Seguranca from './gerente/Seguranca'

const TABS = [
  { to: 'cardapio', label: 'Cardápio', el: <Cardapio /> },
  { to: 'relatorios', label: 'Relatórios', el: <Relatorios /> },
  { to: 'equipe', label: 'Equipe', el: <Equipe /> },
  { to: 'estabelecimento', label: 'Estabelecimento', el: <EstabelecimentoForm /> },
  { to: 'seguranca', label: 'Lixeira e histórico', el: <Seguranca /> },
]

export default function Gerente() {
  return (
    <>
      <Header title="Gerência" />
      <main className="page">
        <nav className="tabs" aria-label="Seções da gerência">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `btn ${isActive ? 'on' : ''}`}>{t.label}</NavLink>
          ))}
        </nav>
        <Routes>
          {TABS.map((t) => <Route key={t.to} path={t.to} element={t.el} />)}
          <Route path="*" element={<Navigate to="cardapio" replace />} />
        </Routes>
      </main>
    </>
  )
}
