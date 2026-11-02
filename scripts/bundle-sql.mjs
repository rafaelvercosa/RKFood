// Junta as migrações num único arquivo para colar no SQL Editor do Supabase.
// Uso: npm run db:bundle
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const header = `-- ARQUIVO GERADO por "npm run db:bundle". Não edite aqui: edite supabase/migrations/.
-- Cole tudo no Supabase → SQL Editor → New query → Run. Rodar UMA vez num projeto novo.\n\n`
const body = files.map((f) => `-- >>>>>>>>>> ${f}\n${readFileSync(`${dir}/${f}`, 'utf8')}`).join('\n\n')
writeFileSync('supabase/instalar_tudo.sql', header + body)
console.log(`supabase/instalar_tudo.sql gerado com ${files.length} migrações`)
