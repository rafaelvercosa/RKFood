-- =============================================================================
-- RKFood: fotos (Storage) e atualização em tempo real (Realtime)
-- =============================================================================

-- Fotos do cardápio, logomarca e foto do estabelecimento.
-- Caminho do arquivo: <establishment_id>/<nome-do-arquivo>.jpg
-- Leitura pública (aparece no cardápio); escrita só pela conta do próprio estabelecimento.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('midia', 'midia', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$
      create policy midia_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'midia' and (storage.foldername(name))[1] in (select id::text from private.my_establishments() id))
    $p$;
    execute $p$
      create policy midia_update on storage.objects for update to authenticated
      using (bucket_id = 'midia' and (storage.foldername(name))[1] in (select id::text from private.my_establishments() id))
    $p$;
    execute $p$
      create policy midia_delete on storage.objects for delete to authenticated
      using (bucket_id = 'midia' and (storage.foldername(name))[1] in (select id::text from private.my_establishments() id))
    $p$;
  end if;
end
$$;

-- Tempo real: aparelhos recebem pedidos e mudanças na hora.
-- O Realtime respeita o RLS: cada aparelho só recebe o que é do seu estabelecimento.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.orders, public.order_items, public.payments, public.fiado_settlements,
      public.products, public.categories, public.customers, public.establishments;
  end if;
end
$$;
