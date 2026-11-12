import { Link } from 'react-router-dom'
import { OrderIdent, Segmented } from '../components/ui'
import { logoutOperator as logout } from '../data/api'
import { dailySummary, isOrderPaid, modeLabel, orderRemaining, orderTotal } from '../data/selectors'
import { hasRole, useCurrentUser } from '../data/session'
import { useDB } from '../data/store'
import { hhmm, today } from '../lib/dates'
import { setClickSound, useClickSound } from '../lib/clickSound'
import { brl } from '../lib/money'
import { setTheme, useTheme } from '../lib/theme'
import type { Database, Role, User } from '../types'
import { STATUS_LABEL } from '../types'

interface Area { role: Role; to: string; ico: string; label: string; desc: string; count?: (db: Database) => number }

const KITCHEN_OPEN = ['novo', 'preparo']

const AREAS: Area[] = [
  { role: 'atendente', to: '/atendente', ico: '📝', label: 'Fazer pedido', desc: 'Atendimento' },
  {
    role: 'cozinha', to: '/cozinha', ico: '🔥', label: 'Cozinha', desc: 'Fila de preparo',
    count: (db) => db.orders.filter((o) => o.businessDate === today() && KITCHEN_OPEN.includes(o.status)).length,
  },
  {
    role: 'caixa', to: '/caixa', ico: '💵', label: 'Caixa', desc: 'Receber pagamentos',
    count: (db) => db.orders.filter((o) => o.status !== 'cancelado' && orderRemaining(db, o) > 0).length,
  },
  { role: 'caixa', to: '/fiado', ico: '📒', label: 'Fiado', desc: 'Clientes e extratos' },
]
const MORE: Area[] = [
  { role: 'gerente', to: '/gerente', ico: '🎚️', label: 'Gerência', desc: 'Cardápio, fotos e equipe' },
  { role: 'dono', to: '/dono', ico: '📈', label: 'Área do dono', desc: 'Vendas, materiais e lista de compras' },
]

/** Atendente "puro": só faz pedido. Ganha um início só com o que ele precisa. */
function isOnlyWaiter(user: User): boolean {
  return user.roles.length > 0 && user.roles.every((r) => r === 'atendente')
}

export default function Home() {
  const db = useDB()
  const est = db.establishment
  const user = useCurrentUser()
  const clickSound = useClickSound()
  const theme = useTheme()
  const todayCard = user && hasRole(user, 'dono') ? dailySummary(db, today()) : null

  return (
    <>
      <section className={`home-hero ${est.coverUrl ? 'has-cover' : ''}`} style={est.coverUrl ? { backgroundImage: `url(${est.coverUrl})` } : undefined}>
        <div className="hero-top">
          {est.logoUrl ? <img className="logo-big" src={est.logoUrl} alt={`Logomarca ${est.name}`} /> : <span className="logo-big" style={{ display: 'grid', placeItems: 'center', color: 'var(--brand)', fontFamily: 'var(--font-sign)', fontWeight: 800, fontSize: '1.6rem' }} aria-hidden>{est.name.slice(0, 1).toUpperCase()}</span>}
          <span className="name">{est.name}</span>
          {user && <Link to="/manual" className="btn icon-btn hero-btn" aria-label="Manual de instruções" style={{ fontFamily: 'var(--font-sign)', fontSize: '1.5rem' }}>?</Link>}
          {user && <button className="icon-btn hero-btn" aria-label="Sair" onClick={() => void logout()}>⎋</button>}
        </div>
        <div className="greet">
          {user ? (<><small>Bom trabalho,</small><h1>{user.name}</h1></>) : (<h1>{est.name}</h1>)}
          {!user && est.slogan && <p className="slogan">{est.slogan}</p>}
        </div>
      </section>

      {todayCard && (
        <section className="today-card" aria-label="Resumo de hoje">
          <div className="label"><span>Hoje</span><span className="chip">só o dono vê</span></div>
          <div className="small muted" style={{ fontWeight: 700 }}>Vendas</div>
          <div className="big money">{brl(todayCard.sales)}</div>
          <div className="chips">
            <span className="chip">{todayCard.orderCount} {todayCard.orderCount === 1 ? 'pedido' : 'pedidos'}</span>
            <span className="chip">Ticket médio {brl(todayCard.averageTicket)}</span>
          </div>
        </section>
      )}

      <main className="page" style={{ paddingTop: todayCard ? 18 : 16 }}>
        {!user ? (
          <Link to="/entrar" className="btn btn-primary btn-lg btn-block">Entrar</Link>
        ) : isOnlyWaiter(user) ? (
          <WaiterHome user={user} />
        ) : (
          <>
            <FirstUse />
            <div className="section-title">O que você quer fazer?</div>
            <div className="role-grid">
              {AREAS.filter((a) => hasRole(user, a.role)).map((a) => {
                const n = a.count?.(db) ?? 0
                return (
                  <Link key={a.to} to={a.to} className="btn role-tile">
                    <span className="ico-circle" aria-hidden>{a.ico}</span>
                    <span>
                      <span className="tile-title">{a.label}</span>
                      <span className="tile-desc">{n > 0 && a.count ? `${n} ${a.to === '/caixa' ? 'a receber' : 'na fila'}` : a.desc}</span>
                    </span>
                    {n > 0 && <span className="count" aria-hidden>{n}</span>}
                  </Link>
                )
              })}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {MORE.filter((a) => hasRole(user, a.role)).map((a) => (
                <Link key={a.to} to={a.to} className="btn role-row">
                  <span className="ico-circle" aria-hidden>{a.ico}</span>
                  <span className="grow"><span className="tile-title">{a.label}</span><span className="tile-desc">{a.desc}</span></span>
                  <span aria-hidden>›</span>
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="stack" style={{ justifyItems: 'center', gap: 6, marginTop: 8 }}>
          <span className="small muted">Tema neste aparelho</span>
          <Segmented value={theme} onChange={setTheme} options={[
            { value: 'claro', label: '☀️ Claro' },
            { value: 'escuro', label: '🌙 Escuro' },
            { value: 'sistema', label: '📱 Sistema' },
          ]} />
        </div>
        <label className="check" style={{ justifySelf: 'center' }}>
          <input type="checkbox" checked={clickSound} onChange={(e) => setClickSound(e.target.checked)} />
          Som dos botões neste aparelho
        </label>
        <p className="muted small center">RKFood · pedidos, cozinha e caixa</p>
      </main>
    </>
  )
}

/** Início do atendente: botão grande de novo pedido, prontos para entregar e os próprios pedidos em aberto. */
function WaiterHome({ user }: { user: User }) {
  const db = useDB()
  const mine = db.orders.filter((o) => o.businessDate === today() && o.createdBy === user.id && !['entregue', 'cancelado'].includes(o.status))
  const ready = mine.filter((o) => o.status === 'pronto')
  const open = mine.filter((o) => o.status !== 'pronto')
  return (
    <>
      <Link to="/atendente" className="btn role-tile big">
        <span className="ico-circle" aria-hidden style={{ background: 'rgb(255 255 255 / 0.16)' }}>＋</span>
        <span><span className="tile-title">Novo pedido</span><span className="tile-desc">Escolha a mesa ou o nome</span></span>
      </Link>
      {ready.length > 0 && (
        <>
          <div className="section-title">Prontos para entregar</div>
          <div className="stack" style={{ gap: 10 }}>
            {ready.map((o) => (
              <Link key={o.id} to="/atendente?aba=pedidos" className="card comanda pronto row between" style={{ textDecoration: 'none' }}>
                <OrderIdent order={o} />
                <span className="badge pronto">{STATUS_LABEL.pronto}</span>
              </Link>
            ))}
          </div>
        </>
      )}
      <div className="section-title">Meus pedidos em aberto</div>
      {open.length === 0 && <div className="card empty">Nenhum pedido em aberto.</div>}
      <div className="stack" style={{ gap: 10 }}>
        {open.map((o) => (
          <div key={o.id} className="card row between">
            <div>
              <OrderIdent order={o} />
              <div className="small muted">{hhmm(o.createdAt)} · {modeLabel(o)}</div>
            </div>
            <div className="stack" style={{ justifyItems: 'end', gap: 4 }}>
              <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
              <span className="money small"><b>{brl(orderTotal(o))}</b> {isOrderPaid(db, o) ? '· pago' : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/** Lista guiada para o dono que acabou de começar: some quando tudo estiver feito. */
export function useChecklist() {
  const db = useDB()
  const staff = db.users.filter((u) => !u.deletedAt)
  const steps = [
    { key: 'cardapio', label: 'Montar o cardápio', hint: 'Comece com um modelo de espetinho', to: '/gerente/modelo', done: db.products.some((p) => !p.deletedAt) },
    { key: 'equipe', label: 'Cadastrar a equipe', hint: 'Atendente, cozinha, caixa', to: '/gerente/equipe', done: staff.length > 1 },
    { key: 'convite', label: 'Chamar a equipe pelo WhatsApp', hint: 'Cada um entra pelo próprio celular', to: '/gerente/equipe', done: db.devices.some((d) => d.kind === 'convite') || staff.some((u) => u.pinPending === false && u.createdBy) },
    { key: 'teste', label: 'Fazer um pedido de teste', hint: 'Do atendente até a cozinha', to: '/atendente', done: db.orders.length > 0 },
  ]
  return steps
}

function FirstUse() {
  const user = useCurrentUser()
  const steps = useChecklist()
  if (!user || !hasRole(user, 'dono')) return null
  const done = steps.filter((s) => s.done).length + 1 // o 1º passo (conectar o aparelho) já foi feito
  const total = steps.length + 1
  if (done >= total) return null
  const next = steps.find((s) => !s.done)
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="card" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
        <h2>Vamos deixar tudo pronto</h2>
        <p style={{ fontWeight: 700 }}>São {total} passos rápidos. Você já fez {done}.</p>
        <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${(done / total) * 100}%` }} /></div>
      </div>
      {steps.map((s) => (
        <Link key={s.key} to={s.to} className={`btn check-step ${s.done ? 'done' : s === next ? 'next' : ''}`}>
          <span className="n" aria-hidden>{s.done ? '✓' : steps.indexOf(s) + 2}</span>
          <span className="grow"><strong>{s.label}</strong><span className="small muted" style={{ display: 'block' }}>{s.hint}</span></span>
          {s === next && <span className="badge" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>Começar</span>}
        </Link>
      ))}
    </section>
  )
}
