# Implantação: Supabase + Vercel

Passo a passo para colocar o RKFood no ar e cadastrar um estabelecimento cliente.

## 1. Banco de dados (uma vez por projeto Supabase)

1. Supabase → **SQL Editor** → **New query**.
2. Abra o arquivo [`supabase/instalar_tudo.sql`](../supabase/instalar_tudo.sql), copie **tudo**, cole e clique em **Run**.
   A mensagem esperada é *Success. No rows returned*.
3. **Authentication → Sign In / Providers → Email**: desligue **Allow new users to sign up**.
   Assim só você cria contas. Os estabelecimentos não se cadastram sozinhos.

> Para atualizar o banco no futuro, rode apenas os arquivos novos de `supabase/migrations/`.

## 2. Cadastrar um estabelecimento cliente

1. **Authentication → Users → Add user → Create new user**
   - E-mail: o do estabelecimento (ex.: `espetinhodoze@gmail.com`)
   - Senha: uma senha forte. É ela que se digita uma vez em cada aparelho.
   - Marque **Auto Confirm User**.
2. **SQL Editor**, rode (trocando os valores):
   ```sql
   select private.bootstrap_establishment('Espetinho do Zé', 'espetinhodoze@gmail.com', 'Zé', '1234');
   ```
   Isso cria o estabelecimento, liga a conta de e-mail a ele, cria o usuário **Zé** (gerente, PIN `1234`)
   e as categorias iniciais (Espetinhos, Acompanhamentos, Bebidas).
3. Pronto. No app, o aparelho entra com o e-mail e a senha, e o Zé digita o PIN.
   Ele mesmo cadastra o cardápio, as fotos, a equipe e a logomarca na tela **Gerência**.

Outra conta de e-mail para o mesmo estabelecimento (opcional):
```sql
select private.add_member('<id do estabelecimento>', 'outro@email.com');
```

## 3. Publicar o app (Vercel)

1. Em vercel.com, entre com o GitHub → **Add New → Project** → importe `RKFood`.
2. Framework: **Vite** (detectado sozinho).
3. Em **Environment Variables**, adicione:
   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<seu-projeto>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
4. **Deploy**. A cada atualização no GitHub, a Vercel publica sozinha.

Sem essas variáveis o app roda em **modo demonstração** (dados só no navegador).

## 4. Rodar localmente contra o Supabase

```bash
cp .env.example .env.local   # preencha URL e chave
npm run dev
```

## Testes do banco (opcional, para desenvolvedores)

Com um Postgres 15+ local:
```bash
PGHOST=localhost PGPORT=5432 ./supabase/tests/run_local.sh
```
Roda as migrações num banco de teste e confere o isolamento entre estabelecimentos,
os perfis e as regras de pedido, pagamento e fiado.
