import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Header } from '../components/Layout'
import { AREAS, DAY_STEPS, FAQ, FIRST_USE, GLOSSARY, PERMISSIONS, PERMISSION_ROLES } from '../manual/content'
import { shareText } from '../lib/share'
import { ROLE_LABEL } from '../types'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Manual() {
  const { id } = useParams()
  if (id === 'perfis') return <Perfis />
  if (id === 'perguntas') return <Perguntas />
  if (id === 'comece') return <Comece />
  const area = AREAS.find((a) => a.id === id)
  return area ? <Area area={area} /> : <Indice />
}

function Indice() {
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    const n = norm(q.trim())
    if (!n) return AREAS
    return AREAS.filter((a) => norm([a.title, a.short, a.serve, ...a.steps, a.tip, a.caution].join(' ')).includes(n))
  }, [q])
  return (
    <>
      <Header title="Manual" back />
      <main className="page" style={{ maxWidth: 640 }}>
        <input type="search" placeholder="O que você quer saber?" aria-label="Buscar no manual" value={q} onChange={(e) => setQ(e.target.value)} />
        {!q && (
          <Link to="/manual/comece" className="role-tile big">
            <span className="ico-circle" aria-hidden style={{ background: 'rgb(255 255 255 / 0.14)' }}>▶</span>
            <span>
              <span className="tile-desc">Comece por aqui</span>
              <span className="tile-title">Um dia de trabalho em 5 passos</span>
            </span>
          </Link>
        )}
        <div className="section-title">Cada área do app</div>
        <div className="stack" style={{ gap: 10 }}>
          {found.map((a) => (
            <Link key={a.id} to={`/manual/${a.id}`} className="manual-card">
              <span className="ico-circle" aria-hidden>{a.icon}</span>
              <span className="grow"><span className="tile-title">{a.title}</span><span className="tile-desc">{a.short}</span></span>
              <span aria-hidden>›</span>
            </Link>
          ))}
          {found.length === 0 && <div className="card empty">Nada encontrado para “{q}”.</div>}
        </div>
        <div className="row">
          <Link to="/manual/perfis" className="btn grow">Quem pode o quê</Link>
          <Link to="/manual/perguntas" className="btn grow">Perguntas e glossário</Link>
        </div>
      </main>
    </>
  )
}

function Area({ area }: { area: (typeof AREAS)[number] }) {
  const text = `${area.title}: ${area.serve}\n\n${area.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nDica: ${area.tip}\nCuidado: ${area.caution}`
  return (
    <>
      <Header title={area.title} back backTo="/manual" />
      <main className="page manual-body" style={{ maxWidth: 640 }}>
        <section className="card stack">
          <div className="small muted" style={{ fontWeight: 800 }}>Para que serve</div>
          <p>{area.serve}</p>
          <div className="chips"><span className="small muted" style={{ fontWeight: 800 }}>Quem usa:</span><span className="chip" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>{area.who}</span></div>
        </section>
        <section className="card stack">
          <div className="small muted" style={{ fontWeight: 800 }}>Passo a passo</div>
          <ol>{area.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
        <div className="hint ok"><b>Dica: </b>{area.tip}</div>
        <div className="hint"><b>Cuidado: </b>{area.caution}</div>
        {area.faq?.map((f) => (
          <details key={f.q} className="card"><summary style={{ fontWeight: 800 }}>{f.q}</summary><p style={{ marginTop: 8 }}>{f.a}</p></details>
        ))}
        <div className="row">
          <button className="btn-ok grow" onClick={() => void shareText(text)}>Mandar para a equipe</button>
          <button className="grow" onClick={() => window.print()}>Salvar em PDF</button>
        </div>
      </main>
    </>
  )
}

function Comece() {
  return (
    <>
      <Header title="Comece por aqui" back backTo="/manual" />
      <main className="page manual-body" style={{ maxWidth: 640 }}>
        <section className="card stack">
          <h3>Um dia de trabalho</h3>
          <ol>{DAY_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
        <section className="card stack">
          <h3>Primeiro uso do estabelecimento</h3>
          <ol>{FIRST_USE.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
        <div className="hint ok"><b>Dica: </b>toque no botão ? de qualquer tela para ver a ajuda daquela tela.</div>
      </main>
    </>
  )
}

function Perfis() {
  return (
    <>
      <Header title="Quem pode o quê" back backTo="/manual" />
      <main className="page" style={{ maxWidth: 640 }}>
        <section className="card" style={{ overflowX: 'auto' }}>
          <table className="list perm-table">
            <thead><tr><th>Ação</th>{PERMISSION_ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r].slice(0, 4)}</th>)}</tr></thead>
            <tbody>
              {PERMISSIONS.map(([action, ...flags]) => (
                <tr key={action}>
                  <td>{action}</td>
                  {flags.map((f, i) => <td key={i} style={{ textAlign: 'center' }}>{f ? <span className="badge pago" aria-label="pode">Sim</span> : <span className="muted" aria-label="não pode">–</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="hint">Cancelar pede o PIN do gerente; cortesia pede o PIN do dono. Toda recusa fica no histórico.</div>
      </main>
    </>
  )
}

function Perguntas() {
  const navigate = useNavigate()
  return (
    <>
      <Header title="Perguntas e glossário" back backTo="/manual" />
      <main className="page manual-body" style={{ maxWidth: 640 }}>
        <section className="stack">
          <h3>Perguntas frequentes</h3>
          {FAQ.map((f) => <details key={f.q} className="card"><summary style={{ fontWeight: 800 }}>{f.q}</summary><p style={{ marginTop: 8 }}>{f.a}</p></details>)}
        </section>
        <section className="card stack">
          <h3>Glossário</h3>
          <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
            {GLOSSARY.map(([t, d]) => <div key={t}><dt style={{ fontWeight: 800 }}>{t}</dt><dd style={{ margin: 0 }} className="muted">{d}</dd></div>)}
          </dl>
        </section>
        <button onClick={() => navigate('/manual')}>Voltar ao índice</button>
      </main>
    </>
  )
}
