import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole, useBrandColor } from './components/Layout'
import { ToastHost } from './components/ui'
import Atendente from './pages/Atendente'
import Caixa from './pages/Caixa'
import Cozinha from './pages/Cozinha'
import Fiado, { ClienteFiado } from './pages/Fiado'
import Gerente from './pages/Gerente'
import Home from './pages/Home'
import Login from './pages/Login'

export default function App() {
  useBrandColor()
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </BrowserRouter>
  )
}
