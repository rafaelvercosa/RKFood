// Observações rápidas: botões que o atendente toca ao revisar o pedido, em vez de digitar.
// O gerente escolhe quais aparecem (Gerência → Observações rápidas). Sem escolha, valem estes.

export const DEFAULT_QUICK_NOTES = ['Bem passado', 'Ao ponto', 'Mal passado', 'Sem pimenta', 'Sem cebola', 'Bem temperado']

/** Lista de observações de um item: o texto é guardado separado por vírgula. */
export function splitNotes(notes: string): string[] {
  return notes.split(',').map((n) => n.trim()).filter(Boolean)
}

export function joinNotes(list: string[]): string {
  return list.join(', ')
}

/** Liga ou desliga uma observação na lista do item. */
export function toggleNote(notes: string, note: string): string {
  const list = splitNotes(notes)
  const i = list.findIndex((n) => n.toLowerCase() === note.toLowerCase())
  if (i >= 0) list.splice(i, 1)
  else list.push(note)
  return joinNotes(list)
}
