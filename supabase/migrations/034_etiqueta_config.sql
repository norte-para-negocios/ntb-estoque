-- Padrão da etiqueta por loja: o admin da loja define o que aparece, formato,
-- cor, tipografia, ordem dos campos, logo/borda e o tamanho padrão. O usuário só
-- escolhe o tamanho em cm na hora de imprimir (não persiste aqui).

create table if not exists etiqueta_config (
  loja_id bigint primary key references lojas(id) on delete cascade,
  nome_exibido text,
  -- campos mostrar/ocultar (todos visíveis por padrão)
  mostrar_fabricacao    boolean not null default true,
  mostrar_validade      boolean not null default true,
  mostrar_qtde_nf       boolean not null default true,
  mostrar_qtde_etiqueta boolean not null default true,
  mostrar_lote          boolean not null default true,
  mostrar_recebido      boolean not null default true,
  mostrar_fornecedor    boolean not null default true,
  mostrar_cnpj          boolean not null default true,
  -- ordem dos campos opcionais do corpo (chaves estáveis)
  ordem_campos text[] not null default
    array['fabricacao','validade','qtde_nf','qtde_etiqueta','lote','recebido','fornecedor'],
  -- tipografia
  fonte_escala numeric not null default 1.0 check (fonte_escala between 0.7 and 1.5),
  negrito_nome      boolean not null default true,
  negrito_descricao boolean not null default true,
  -- cor de destaque (hex tipo #1C8D99; null = preto)
  cor_destaque text,
  -- elementos
  mostrar_logo  boolean not null default true,
  mostrar_borda boolean not null default false,
  -- tamanho padrão (cm) e calibração (mm)
  largura_cm numeric not null default 7.26 check (largura_cm between 2 and 30),
  altura_cm  numeric not null default 4.0  check (altura_cm between 2 and 30),
  offset_x numeric not null default 0,
  offset_y numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- RLS: leitura escopada por loja do usuário (igual impressao_etiquetas). Escrita
-- vem do service client (server action), que ignora RLS.
alter table etiqueta_config enable row level security;

create policy "etiqueta_config_select_por_loja"
  on etiqueta_config
  for select
  using (
    exists (
      select 1 from loja_user lu
      where lu.loja_id = etiqueta_config.loja_id
        and lu.user_id = auth.uid()
    )
  );
