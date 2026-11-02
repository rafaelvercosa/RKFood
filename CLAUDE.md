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
- Projeto Supabase: `https://yyarqyuirwzlqhsurwmx.supabase.co`. A URL e a chave publishable ficam em
  `.env.local` (fora do git, já criado no computador do Rafael). A senha do banco já foi trocada e
  **não deve ser pedida nem colada em conversa**.
- **Banco aplicado no Supabase real (01/11/2026)** pelo MCP: as 3 migrações, o bucket `midia` e o Realtime.
  Cadastro aberto desligado em Auth. Primeiro estabelecimento: **Espetinho do Rafael** (conta
  `rafaelkvercosa@gmail.com`, gerente Rafael), criado com `private.bootstrap_establishment`.
- **Testado de ponta a ponta no Supabase real**, com `npm run dev` e duas abas: conectar aparelho, PIN,
  cardápio, pedido, cozinha em tempo real (nos dois sentidos), pagamento dividido (Pix + fiado), fiado com
  limite e recebimento parcial, relatório do dia, histórico e upload de foto. Tudo funcionou, inclusive o
  embed com FKs compostas, o filtro `.or(...)`, o Realtime com RLS e as políticas do Storage. O único bug
  encontrado foi um laço nas abas da Gerência (link relativo no React Router 7), já corrigido.
- **Visual "placa de barraca" (02/11/2026)**: fontes Big Shoulders Display (números, preços, títulos) e
  Atkinson Hyperlegible (texto), embutidas via Fontsource; cores em `src/index.css` (fumaça, carvão, milho,
  lona azul, folha; `--brand` vem do estabelecimento); pedidos como comanda picotada (`.comanda`).
  Atendente com botões das mesas 1 a 10. Preview do modo demonstração: `rkfood-demo` (porta 5174, PIN 1234).
- **Pedidos (02/11/2026)**: mesa ou nome em destaque e nº do pedido pequeno (`OrderIdent`); etiqueta
  "Comer aqui"/"Para viagem"; cozinha com cronômetro por comanda, fila na ordem de chegada (com cobrança
  `antes`, conta do pagamento), alerta de atrasados e tempo estimado em `establishments.kitchen_target_min`
  (gerente muda em Gerência → Estabelecimento); **só o gerente** adianta pedido na fila, com motivo
  (`orders.priority_at`/`priority_reason`, RPC `set_order_priority`). Migrações 4 e 5 aplicadas no Supabase
  real e testadas na nuvem, inclusive o cancelamento de pedido.
- Ficaram dados de teste no banco: pedidos de 01/11 (mesa 5) e de 02/11 (mesas 8 e 9, cancelados com
  "Teste do sistema") e o cliente "Cliente Teste" com R$ 10 de fiado.
- Ainda não testado na nuvem: cobrança `antes`, extrato em PDF/WhatsApp, dois aparelhos físicos diferentes
  e a recusa de `set_order_priority` para quem não é gerente (testada só no modo demonstração).
- O perfil **"dono"** ainda não existe; onde o Rafael pediu "gerente ou dono", hoje vale o gerente.

## Próximos passos (nesta ordem)
1. Deploy na Vercel (`docs/implantacao.md`).
2. Pedido do Rafael: **cancelar pedido só com PIN de gerente** e **pagamento como cortesia só com PIN do
   dono**, com tudo registrado no histórico (detalhes em `docs/roadmap.md`).
3. Depois: o **modo contingência offline** e o servidor local na barraca (`docs/roadmap.md`), backups,
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
