// Qual "motor" de dados está em uso.
// Com VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY definidos (arquivo .env.local
// ou variáveis da Vercel), o app usa o Supabase. Sem eles, roda em modo demonstração.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isCloud = Boolean(url && key)

export const supabase: SupabaseClient | null = isCloud
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rkfood:auth' } })
  : null

export function sb(): SupabaseClient {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}
