-- Testes do banco: isolamento entre estabelecimentos, perfis e regras de negócio.
-- Cada bloco lança erro se algo estiver errado. Saída esperada: só "OK ...".
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@teste.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@teste.com');

create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
insert into ctx values
  ('ea', private.bootstrap_establishment('Espetinho A', 'a@teste.com', 'Dono A', '1234')::text),
  ('eb', private.bootstrap_establishment('Espetinho B', 'b@teste.com', 'Dono B', '1234')::text);

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
end $$;
\o /dev/null

-- só para as conferências deste teste (o app não tem acesso a estas funções)
grant execute on function private.order_total(uuid), private.order_paid(uuid), private.customer_balance(uuid) to authenticated;

-- ===================================================== como aparelho A
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
\o

do $$
begin
  assert (select count(*) from public.establishments) = 1, 'A deveria ver só 1 estabelecimento';
  assert (select name from public.my_context()) = 'Espetinho A', 'contexto errado';
  raise notice 'OK isolamento: A só vê o próprio estabelecimento';
end $$;

-- PIN errado
do $$
begin
  perform public.operator_login((select v::uuid from ctx where k = 'ea'), '9999');
  raise exception 'deveria recusar PIN errado';
exception when others then
  assert sqlerrm = 'PIN não encontrado', sqlerrm;
  raise notice 'OK PIN errado recusado';
end $$;

-- Login no estabelecimento B com conta A deve falhar
do $$
begin
  perform public.operator_login((select v::uuid from ctx where k = 'eb'), '1234');
  raise exception 'A não deveria entrar em B';
exception when others then
  assert sqlerrm like 'Este aparelho não tem acesso%', sqlerrm;
  raise notice 'OK conta A não entra no estabelecimento B';
end $$;

insert into ctx select 'ta', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '1234');

-- Hash do PIN não pode ser lido
do $$
begin
  perform pin_hash from public.staff;
  raise exception 'pin_hash não deveria ser legível';
exception when insufficient_privilege then
  raise notice 'OK hash do PIN protegido';
end $$;

-- Escrita direta bloqueada
do $$
begin
  insert into public.categories (establishment_id, name) values ((select v::uuid from ctx where k = 'ea'), 'X');
  raise exception 'insert direto deveria falhar';
exception when insufficient_privilege then
  raise notice 'OK escrita direta nas tabelas bloqueada';
end $$;

-- Cardápio + atendente
do $$
declare
  t uuid := (select v::uuid from ctx where k = 'ta');
  cat uuid := (select id from public.categories where name = 'Espetinhos');
  beb uuid := (select id from public.categories where name = 'Bebidas');
begin
  perform public.save_product(t, null, cat, 'Carne', 'Alcatra', 1000, null, true, true);
  perform public.save_product(t, null, beb, 'Refri', '', 600, null, true, false);
  perform public.save_staff(t, null, 'Ana', '1111', array['atendente']);
  perform public.save_staff(t, null, 'Caixa', '3333', array['caixa']);
  begin
    perform public.save_staff(t, null, 'Repetido', '1111', array['caixa']);
    raise exception 'PIN repetido deveria falhar';
  exception when others then
    assert sqlerrm = 'Esse PIN já está em uso', sqlerrm;
  end;
  perform public.save_customer(t, null, 'Seu João', '(81) 99999-0000', '', 5000);
  raise notice 'OK cardápio, equipe e cliente cadastrados';
end $$;

insert into ctx select 'tana', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '1111');
insert into ctx select 'tcx', token::text from public.operator_login((select v::uuid from ctx where k = 'ea'), '3333');

-- Perfil: atendente não pode mexer no cardápio nem receber
do $$
declare t uuid := (select v::uuid from ctx where k = 'tana');
begin
  begin
    perform public.save_category(t, null, 'Nova');
    raise exception 'atendente não deveria editar cardápio';
  exception when others then assert sqlerrm = 'Seu perfil não permite esta ação.', sqlerrm; end;
  raise notice 'OK perfis respeitados';
end $$;

-- Fluxo de pedido
do $$
declare
  tana uuid := (select v::uuid from ctx where k = 'tana');
  tcx uuid := (select v::uuid from ctx where k = 'tcx');
  ta uuid := (select v::uuid from ctx where k = 'ta');
  carne uuid := (select id from public.products where name = 'Carne');
  refri uuid := (select id from public.products where name = 'Refri');
  joao uuid := (select id from public.customers where name = 'Seu João');
  o1 public.orders; o2 public.orders; o3 public.orders;
begin
  o1 := public.create_order(tana, 'mesa', '4', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 3, 'notes', 'bem passada')));
  o2 := public.create_order(tana, 'nome', 'Maria', 'viagem', '', jsonb_build_array(jsonb_build_object('product_id', refri, 'qty', 1)));
  assert o1.number = 1 and o2.number = 2, 'numeração';
  assert o1.status = 'novo', 'status inicial';
  assert o2.status = 'pronto', 'só bebida nasce pronto';
  assert private.order_total(o1.id) = 3000, 'total';

  perform public.set_order_status(ta, o1.id, 'preparo');
  perform public.set_order_status(ta, o1.id, 'pronto');

  -- pagamento dividido + não pagar a mais
  perform public.pay_order(tcx, o1.id, '[{"method":"pix","amount_cents":1000},{"method":"dinheiro","amount_cents":1000,"cash_received_cents":5000}]');
  begin
    perform public.pay_order(tcx, o1.id, '[{"method":"debito","amount_cents":1500}]');
    raise exception 'deveria recusar valor a mais';
  exception when others then assert sqlerrm like 'Valor maior que o restante%', sqlerrm; end;
  -- erro no meio não grava nada (fiado sem cliente)
  begin
    perform public.pay_order(tcx, o1.id, '[{"method":"pix","amount_cents":500},{"method":"fiado","amount_cents":500}]');
    raise exception 'deveria exigir cliente';
  exception when others then assert sqlerrm = 'Escolha o cliente do fiado', sqlerrm; end;
  assert private.order_paid(o1.id) = 2000, 'atomicidade';
  assert (select paid_cents = 2000 and total_cents = 3000 and not settled from public.orders where id = o1.id), 'colunas de total/pago';

  -- fiado com limite R$ 50
  perform public.pay_order(tcx, o1.id, format('[{"method":"fiado","amount_cents":1000,"customer_id":"%s"}]', joao)::jsonb);
  assert private.customer_balance(joao) = 1000, 'saldo fiado';
  o3 := public.create_order(tana, 'nome', 'João', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 5)));
  begin
    perform public.pay_order(tcx, o3.id, format('[{"method":"fiado","amount_cents":5000,"customer_id":"%s"}]', joao)::jsonb);
    raise exception 'deveria estourar limite';
  exception when others then assert sqlerrm like '%limite de fiado%', sqlerrm; end;
  perform public.receive_fiado(tcx, joao, 400, 'pix', '');
  assert private.customer_balance(joao) = 600, 'recebimento parcial';
  begin
    perform public.receive_fiado(tcx, joao, 9999, 'pix', '');
    raise exception 'não pode receber a mais';
  exception when others then assert sqlerrm like 'Valor maior que a dívida%', sqlerrm; end;

  -- cancelamento
  perform public.cancel_order(tcx, o3.id, 'desistiu');
  assert (select status from public.orders where id = o3.id) = 'cancelado', 'cancelado';
  begin
    perform public.cancel_order(tcx, o1.id, 'teste');
    raise exception 'não cancela pedido pago';
  exception when others then assert sqlerrm like 'Pedido já tem pagamento%', sqlerrm; end;

  -- cliente com dívida não vai para a lixeira
  begin
    perform public.set_trashed(tcx, 'customers', joao, true);
    raise exception 'cliente devendo não deveria ser excluído';
  exception when others then assert sqlerrm = 'Cliente ainda tem fiado em aberto', sqlerrm; end;

  -- lixeira
  perform public.set_trashed(ta, 'products', refri, true);
  assert (select deleted_at is not null from public.products where id = refri), 'lixeira';
  perform public.set_trashed(ta, 'products', refri, false);

  assert (select count(*) from public.audit_log) >= 10, 'histórico';
  raise notice 'OK fluxo completo: pedido, cozinha, pagamento dividido, fiado, limite, cancelamento, lixeira, histórico';
end $$;

-- cobrança antes
do $$
declare
  ta uuid := (select v::uuid from ctx where k = 'ta');
  carne uuid := (select id from public.products where name = 'Carne');
  e public.establishments := (select e from public.establishments e);
  o public.orders;
begin
  perform public.save_establishment(ta, e.name, e.slogan, null, null, '#112233', 'antes', '', '', 'chave@pix');
  o := public.create_order(ta, 'mesa', '9', 'local', '', jsonb_build_array(jsonb_build_object('product_id', carne, 'qty', 1)));
  assert o.status = 'aguardando_pagamento', 'deveria aguardar pagamento';
  begin
    perform public.set_order_status(ta, o.id, 'preparo');
    raise exception 'não deveria preparar antes de pagar';
  exception when others then assert sqlerrm like '%não pode mudar de situação%', sqlerrm; end;
  perform public.pay_order(ta, o.id, '[{"method":"pix","amount_cents":1000}]');
  assert (select status from public.orders where id = o.id) = 'novo', 'pago → cozinha';
  raise notice 'OK cobrança antes: só vai para a cozinha depois de pago';
end $$;

-- ===================================================== como aparelho B
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare ta uuid := (select v::uuid from ctx where k = 'ta');
begin
  assert (select count(*) from public.orders) = 0, 'B não pode ver pedidos de A';
  assert (select count(*) from public.customers) = 0, 'B não pode ver clientes de A';
  assert (select count(*) from public.audit_log) = 1, 'B só vê o próprio histórico';
  begin
    perform public.save_category(ta, null, 'Invasão');
    raise exception 'B usando token de A deveria falhar';
  exception when others then assert sqlerrm like 'Sessão do operador expirada%', sqlerrm; end;
  raise notice 'OK B não vê nem altera nada de A (nem com token roubado)';
end $$;

-- ===================================================== sem login (anon)
reset role;
set role anon;
do $$
begin
  perform * from public.orders;
  raise exception 'anon não deveria ler';
exception when insufficient_privilege then
  raise notice 'OK visitante sem login não acessa nada';
end $$;
reset role;
