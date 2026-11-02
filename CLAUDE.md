# RKFood: contexto para o Claude Code

## Sobre o projeto e o dono
- **RKFood** é um SaaS de pedidos para espetinhos, carrocinhas e pequenas lanchonetes. O dono é o **Rafael**
  (GitHub `rafaelvercosa`), que vai vender o sistema para vários estabelecimentos e quer o código como portfólio.
- **Converse em português do Brasil**, em linguagem simples. O Rafael não é programador profissional:
  explique os passos de painel (Supabase, Vercel, GitHub) clique a clique, faça uma pergunta de cada vez quando
  precisar de decisão e vá desenvolvendo aos poucos, conversando.
- Commits em português, organizados por etapa. Trabalhe num branch e junte na `main` quando o Rafael aprovar.
  A Vercel publica a partir da `main`.

## Decisões já tomadas (não reabrir sem motivo)
- **Stack:** React 19 + TypeScript + Vite (PWA), React Router, Vitest. Backend **Supabase** (projeto na região
  São Paulo) e hospedagem na **Vercel**.
- **Multi-empresa:** toda tabela tem `establishment_id`. O RLS libera só **leitura** do próprio estabelecimento.
  **Toda escrita** passa por funções RPC `SECURITY DEFINER` em `supabase/migrations/`, que validam o perfil e
  gravam no `audit_log`.
- **Login em dois níveis:** o aparelho entra com o e-mail e a senha do estabelecimento (Supabase Auth +
  tabela `members`). Cada operador entra com um **PIN** (hash bcrypt em `staff.pin_hash`, nunca legível pelo
  app), que gera um token em `private.operator_sessions` (16 h). Os perfis são atendente, cozinha, caixa e
  gerente; o gerente pode tudo.
- **Nada é apagado:** exclusão = `deleted_at` (lixeira com restaurar); pedido só é cancelado, com motivo.
  Dinheiro sempre em **centavos** (inteiros).
- **Formas de pagamento:** pix, crédito, débito, dinheiro (com troco) e **fiado** (cliente com limite,
  recebimento parcial, extrato em PDF e WhatsApp). O pagamento pode ser dividido em várias formas.
- **Cobrança configurável:** `antes` (o pedido só vai para a cozinha depois de pago) ou `depois`.
- **Dois modos no app:** sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` o app roda em **modo
  demonstração** (localStorage, `src/data/actions.ts`); com elas, roda em **modo nuvem**
  (`src/data/api.ts` + `src/data/cloud.ts`). As telas são as mesmas nos dois modos.
- **Backups (planejado):** 3 camadas. Exclusão reversível + histórico; `pg_dump` diário por GitHub
  Actions para o Google Drive do Rafael; cópia em R2/B2 com object lock de 30 dias.

## Estado atual
- `main` contém a etapa 1 (telas e modo demonstração) e a etapa 2 (Supabase), além do roteiro.
- Testes: `npm test` (12 testes de regras de negócio no modo demo) e `supabase/tests/run_local.sh`
  (11 testes SQL: isolamento entre estabelecimentos, perfis, pedido, pagamento, fiado), todos passando num
  Postgres local.
- **Ainda NÃO testado contra o Supabase real.** A sessão na nuvem onde isto foi feito não tinha acesso de
  rede ao Supabase.
- Projeto Supabase: `https://yyarqyuirwzlqhsurwmx.supabase.co`. A URL e a chave publishable ficam em
  `.env.local` (fora do git). O Rafael precisa criar esse arquivo a partir de `.env.example`. A senha do banco
  já foi trocada e **não deve ser pedida nem colada em conversa**.

## Próximos passos (nesta ordem)
1. **Aplicar o banco** no Supabase: rodar `supabase/migrations/*.sql` em ordem (pelo MCP do Supabase ou
   colando `supabase/instalar_tudo.sql` no SQL Editor). Conferir se as tabelas, as funções, o bucket `midia`
   e a publicação Realtime foram criados.
2. Em Auth, desligar **Allow new users to sign up**.
3. Criar o usuário do estabelecimento em Authentication → Users (Auto Confirm) e rodar
   `select private.bootstrap_establishment('Nome', 'email', 'Nome do dono', 'PIN');`
4. `npm run dev` com `.env.local` e **testar de ponta a ponta no Supabase real**: conectar aparelho, PIN,
   pedido, cozinha em tempo real (duas abas/aparelhos), pagamento, fiado, upload de foto, relatórios.
   Pontos de atenção que nunca rodaram de verdade: o embed `orders?select=*,order_items(*),payments(*)`
   (FKs compostas), o filtro `.or(...)` em `src/data/cloud.ts`, o Realtime com RLS e as políticas do Storage.
5. Deploy na Vercel (`docs/implantacao.md`).
6. Depois: o **modo contingência offline** e o servidor local na barraca (`docs/roadmap.md`), backups,
   painel do administrador da plataforma, ficha técnica e lista de compras, relatórios por período.

## Mapa do código
- `src/types.ts`: modelo de dados (camelCase; o banco usa snake_case e `cloud.ts` converte)
- `src/data/api.ts`: única porta de escrita das telas · `cloud.ts`: auth do aparelho, carga e Realtime ·
  `store.ts`: snapshot lido por `useDB()` · `selectors.ts`: cálculos puros (totais, saldo do fiado, relatório do dia)
- `src/pages/`: Atendente, Cozinha (modo TV, som, impressão 58/80 mm), Caixa, Fiado, Gerente/*, ConectarAparelho, Login (PIN)
- `supabase/migrations/`: esquema + RLS, funções RPC, Storage/Realtime · `npm run db:bundle` gera `instalar_tudo.sql`
- `docs/arquitetura.md`, `docs/implantacao.md`, `docs/roadmap.md`

## Comandos
```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # tsc + vite build
npm run db:bundle  # regenerar supabase/instalar_tudo.sql depois de mexer nas migrações
```
