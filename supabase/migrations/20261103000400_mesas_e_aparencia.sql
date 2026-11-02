-- =============================================================================
-- RKFood: quantidade de mesas e aparência só pelo dono
--
--  * table_count: quantos botões de mesa o atendente vê (0 = nenhum, só o campo
--    de texto). Gerente ou dono escolhe.
--  * Aparência do estabelecimento (nome, frase, cor, logomarca e foto): só o dono
--    muda. O gerente continua mudando o funcionamento (cobrança, tempo de preparo,
--    mesas) e o contato (telefone, endereço, Pix).
-- =============================================================================

alter table public.establishments
  add column table_count integer not null default 10
    check (table_count between 0 and 200);

drop function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int);

create function public.save_establishment(
  p_token uuid, p_name text, p_slogan text, p_logo_url text, p_cover_url text, p_brand_color text,
  p_payment_timing text, p_phone text, p_address text, p_pix_key text, p_kitchen_target_min int, p_table_count int
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  cur public.establishments;
  changes text[] := '{}';
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do estabelecimento' using errcode = 'P0001'; end if;
  if p_kitchen_target_min is null or p_kitchen_target_min not between 1 and 180 then
    raise exception 'O tempo estimado deve ser de 1 a 180 minutos' using errcode = 'P0001';
  end if;
  if p_table_count is null or p_table_count not between 0 and 200 then
    raise exception 'A quantidade de mesas deve ser de 0 a 200' using errcode = 'P0001';
  end if;
  select * into cur from public.establishments where id = op.establishment_id for update;
  if (trim(p_name), coalesce(p_slogan, ''), p_logo_url, p_cover_url, p_brand_color)
     is distinct from (cur.name, cur.slogan, cur.logo_url, cur.cover_url, cur.brand_color)
     and not ('dono' = any (op.roles)) then
    raise exception 'Só o dono pode mudar o nome, a frase, a cor, a logomarca e a foto' using errcode = 'P0001';
  end if;
  update public.establishments
  set name = trim(p_name), slogan = coalesce(p_slogan, ''), logo_url = p_logo_url, cover_url = p_cover_url,
      brand_color = p_brand_color, payment_timing = p_payment_timing, phone = coalesce(p_phone, ''),
      address = coalesce(p_address, ''), pix_key = coalesce(p_pix_key, ''),
      kitchen_target_min = p_kitchen_target_min, table_count = p_table_count
  where id = op.establishment_id;
  if cur.kitchen_target_min is distinct from p_kitchen_target_min then
    changes := changes || format('tempo estimado: %s → %s min', cur.kitchen_target_min, p_kitchen_target_min);
  end if;
  if cur.table_count is distinct from p_table_count then
    changes := changes || format('mesas: %s → %s', cur.table_count, p_table_count);
  end if;
  if cur.brand_color is distinct from p_brand_color then
    changes := changes || format('cor: %s → %s', cur.brand_color, p_brand_color);
  end if;
  perform private.audit(op.establishment_id, op.id, 'estabelecimento.editar',
    'Dados do estabelecimento atualizados' ||
      case when cardinality(changes) > 0 then ' (' || array_to_string(changes, '; ') || ')' else '' end);
end
$$;

revoke all on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int, int) to authenticated;
