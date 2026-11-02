import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from '../components/Layout'
import { periodDates, type PeriodKey } from '../data/reports'
import Compras from './dono/Compras'
import Desempenho from './dono/Desempenho'
import FichaTecnica from './dono/FichaTecnica'
import Materiais from './dono/Materiais'
import Vendas from './dono/Vendas'

/** Período escolhido; vale para Vendas, Desempenho e Compras ao mesmo tempo. */
export interface Period { key: PeriodKey | 'datas'; from: string; to: string }

export default function Dono() {
  const [period, setPeriod] = useState<Period>(() => ({ key: 'hoje', ...periodDates('hoje') }))
  const tabs = [
    { to: 'vendas', label: 'Vendas', el: <Vendas period={period} onPeriod={setPeriod} /> },
    { to: 'desempenho', label: 'Desempenho', el: <Desempenho period={period} onPeriod={setPeriod} /> },
    { to: 'compras', label: 'Lista de compras', el: <Compras period={period} onPeriod={setPeriod} /> },
    { to: 'ficha', label: 'Ficha técnica', el: <FichaTecnica /> },
    { to: 'materiais', label: 'Materiais', el: <Materiais /> },
  ]
  return (
    <>
      <Header title="Área do dono" />
      <main className="page">
        <nav className="tabs" aria-label="Seções do dono">
          {tabs.map((t) => (
            <NavLink key={t.to} to={`/dono/${t.to}`} className={({ isActive }) => `btn ${isActive ? 'on' : ''}`}>{t.label}</NavLink>
          ))}
        </nav>
        <Routes>
          {tabs.map((t) => <Route key={t.to} path={t.to} element={t.el} />)}
          <Route path="*" element={<Navigate to="/dono/vendas" replace />} />
        </Routes>
      </main>
    </>
  )
}
