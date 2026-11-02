import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole, useBrandColor } from './components/Layout'
import { ToastHost } from './components/ui'
import { isCloud } from './data/backend'
import { startCloud, useCloud } from './data/cloud'
import AceitarConvite from './pages/AceitarConvite'
import ConectarAparelho from './pages/ConectarAparelho'
import Atendente from './pages/Atendente'
import Caixa from './pages/Caixa'
import Cozinha from './pages/Cozinha'
import Fiado, { ClienteFiado } from './pages/Fiado'
import Gerente from './pages/Gerente'
import Dono from './pages/Dono'
import Home from './pages/Home'
import Login from './pages/Login'

if (isCloud) startCloud()

export default function App() {
  useBrandColor()
  const cloud = useCloud()
  // link de convite (/convite/<código>): antes de conectar o aparelho e do PIN
  const [invite, setInvite] = useState(() => (isCloud ? /^\/convite\/([\w-]+)/.exec(location.pathname)?.[1] ?? null : null))
  if (invite && cloud.phase !== 'iniciando' && cloud.phase !== 'carregando') {
    return (
      <>
        <AceitarConvite code={invite} onDone={() => { history.replaceState(null, '', '/entrar'); setInvite(null) }} />
        <ToastHost />
      </>
    )
  }
  if (isCloud && cloud.phase !== 'pronto') {
    return (
      <>
        <ConectarAparelho />
        <ToastHost />
      </>
    )
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/entrar" element={<Login />} />
        <Route path="/atendente" element={<RequireRole role="atendente"><Atendente /></RequireRole>} />
        <Route path="/cozinha" element={<RequireRole role="cozinha"><Cozinha /></RequireRole>} />
        <Route path="/caixa" element={<RequireRole role="caixa"><Caixa /></RequireRole>} />
        <Route path="/fiado" element={<RequireRole role="caixa"><Fiado /></RequireRole>} />
        <Route path="/fiado/:id" element={<RequireRole role="caixa"><ClienteFiado /></RequireRole>} />
        <Route path="/gerente/*" element={<RequireRole role="gerente"><Gerente /></RequireRole>} />
        <Route path="/dono/*" element={<RequireRole role="dono"><Dono /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </BrowserRouter>
  )
}
