import { useState } from 'react'
import { attempt } from '../../components/ui'
import { saveQuickNotes } from '../../data/api'
import { useDB } from '../../data/store'
import { DEFAULT_QUICK_NOTES } from '../../lib/quickNotes'

/** Botões de observação que o atendente toca ao revisar o pedido. */
export default function ObservacoesRapidas() {
  const db = useDB()
  const [list, setList] = useState<string[]>(db.establishment.quickNotes.length ? db.establishment.quickNotes : DEFAULT_QUICK_NOTES)
  const [text, setText] = useState('')

  function add() {
    const n = text.trim()
    if (!n) return
    if (n.includes(',')) return void attempt(() => { throw new Error('Não use vírgula na observação') })
    if (n.length > 30) return void attempt(() => { throw new Error('Use até 30 letras') })
    if (list.some((x) => x.toLowerCase() === n.toLowerCase())) return setText('')
    if (list.length >= 20) return void attempt(() => { throw new Error('No máximo 20 observações rápidas') })
    setList([...list, n])
    setText('')
  }

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <section className="card stack">
        <h3>Observações rápidas</h3>
        <p className="muted small">Estes botões aparecem para o atendente ao revisar o pedido. Toque no ✕ para tirar um.</p>
        <div className="note-chips" style={{ gridColumn: 'auto' }}>
          {list.map((n) => (
            <button key={n} type="button" onClick={() => setList(list.filter((x) => x !== n))} aria-label={`Tirar ${n}`}>{n} ✕</button>
          ))}
          {list.length === 0 && <span className="muted small">Sem botões: vale a lista padrão.</span>}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input placeholder="Nova observação (ex.: Sem farofa)" aria-label="Nova observação" value={text} maxLength={30} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button onClick={add}>Adicionar</button>
        </div>
        <button className="btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setList(DEFAULT_QUICK_NOTES)}>Voltar à lista padrão</button>
      </section>
      <section className="card stack">
        <div className="small muted" style={{ fontWeight: 800 }}>Como o atendente vê</div>
        <div className="note-chips" style={{ gridColumn: 'auto' }}>
          {list.slice(0, 4).map((n, i) => <button key={n} type="button" className={i === 0 ? 'on' : ''} tabIndex={-1}>{i === 0 ? '✓ ' : ''}{n}</button>)}
          <button type="button" tabIndex={-1}>✎ Outra</button>
        </div>
      </section>
      <button className="btn-primary btn-lg" onClick={() => attempt(() => saveQuickNotes(sameAsDefault(list) ? [] : list), 'Observações salvas')}>Salvar</button>
    </div>
  )
}

const sameAsDefault = (l: string[]) => l.length === DEFAULT_QUICK_NOTES.length && l.every((n, i) => n === DEFAULT_QUICK_NOTES[i])
