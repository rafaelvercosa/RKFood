# Arquitetura do RKFood

## Visão geral

```
 Celular/tablet (Atendente) ─┐
 Tablet/TV/impressora (Cozinha) ─┼──►  App web (React PWA, Vercel)  ──►  Supabase (Postgres + Auth + Realtime + Storage)
 Celular/PC (Caixa, Gerente) ─┘                                               │
                                                                              ├─► Backup diário → Google Drive (conta do dono da plataforma)
                                                                              └─► Cópia → 2º local (Cloudflare R2 / Backblaze B2, com bloqueio de exclusão)
```

## Multi-empresa (SaaS)

Cada estabelecimento cliente é um *tenant*. Todas as tabelas têm a coluna `establishment_id`, e as
**regras de segurança do banco (RLS)** garantem que um usuário só enxergue os dados do próprio estabelecimento.
O administrador da plataforma cadastra estabelecimentos e ativa ou bloqueia o acesso.

## Login: aparelho + operador

1. **Aparelho:** cada celular, tablet ou TV entra **uma vez** com o e-mail e a senha do estabelecimento (Supabase Auth).
   Essa conta é ligada ao estabelecimento pela tabela `members`.
2. **Operador:** quem vai usar digita o **PIN** (4 a 6 números). O banco confere o PIN (guardado com hash bcrypt)
   e devolve um **token de sessão** que vale 16 h.
3. Toda alteração chama uma função do banco com esse token. A função confere se o token é válido,
   se é do mesmo estabelecimento e se o perfil permite a ação. Depois grava e registra no histórico quem fez.

As tabelas só aceitam **leitura** direta, e só do próprio estabelecimento (RLS).
Inserir, alterar e excluir só acontece pelas funções, o que impede gravar dados inválidos
mesmo que alguém mexa no app pelo navegador.

## Camada de dados

As telas não sabem onde os dados ficam:
- **leitura:** `useDB()` (store.ts)
- **escrita:** funções de `actions.ts`, que validam, gravam e registram no histórico

- **modo demonstração:** `actions.ts` grava no navegador;
- **modo nuvem:** `api.ts` chama as funções do Supabase e `cloud.ts` mantém os dados atualizados pelo Realtime.

As telas são as mesmas nos dois modos.

## Fluxo do pedido

```
            cobrança "antes"                       cobrança "depois"
 criar ──► aguardando_pagamento ──(pago)──► novo ◄── criar
                                            │
                                            ▼
                                        preparo ──► pronto ──► entregue
 (qualquer momento sem pagamento) ──► cancelado (com motivo)
```
Pedido só com itens que não passam pela cozinha (ex.: bebida em lata) já nasce **pronto**.

## Fiado

- Pagar um pedido com a forma **Fiado** cria uma dívida ligada ao cliente.
- **Recebimento de fiado** (total ou parcial) abate a dívida.
- Saldo = soma dos fiados − soma dos recebimentos. Fiado de pedido cancelado não conta.
- Extrato "em aberto" mostra os lançamentos desde a última vez que o saldo zerou.

## Proteção contra perda de dados (3 camadas)

1. **Exclusão reversível + histórico:** nada é apagado de verdade, e cada ação registra quem fez.
2. **Backup diário automático:** GitHub Actions faz `pg_dump` do banco e envia para o Google Drive.
3. **Cópia imutável em outro provedor:** R2/B2 com *object lock* de 30 dias, que nem quem tem a senha consegue apagar.

Restauração possível do banco inteiro ou de **um único estabelecimento**.
