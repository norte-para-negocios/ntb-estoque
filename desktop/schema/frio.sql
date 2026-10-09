--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10 (Ubuntu 17.10-1.pgdg24.04+1)
-- Dumped by pg_dump version 17.10 (Ubuntu 17.10-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id bigint,
    loja_id bigint,
    codigo_omie bigint,
    codigo_integracao character varying(60),
    razao_social character varying(150),
    nome_fantasia character varying(120),
    cnpj_cpf character varying(20),
    pessoa_fisica boolean,
    inscricao_estadual character varying(20),
    inscricao_municipal character varying(20),
    cest character varying(10),
    email character varying(120),
    telefone character varying(30),
    cep character varying(10),
    uf character varying(2),
    cidade character varying(100),
    bairro character varying(100),
    logradouro character varying(200),
    numero character varying(20),
    complemento character varying(120),
    inativo boolean,
    origem character varying(10),
    full_object jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: fat_cupom_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fat_cupom_itens (
    loja_id bigint NOT NULL,
    id_item bigint NOT NULL,
    n_id_cupom bigint NOT NULL,
    id_produto bigint,
    cfop text,
    ncm text,
    quant numeric DEFAULT 0 NOT NULL,
    v_unit numeric DEFAULT 0 NOT NULL,
    v_desc numeric DEFAULT 0 NOT NULL,
    v_item numeric DEFAULT 0 NOT NULL,
    x_prod text
);


--
-- Name: fat_cupom_pagamentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fat_cupom_pagamentos (
    loja_id bigint NOT NULL,
    n_id_cupom bigint NOT NULL,
    sequencia integer NOT NULL,
    tipo_doc text,
    valor numeric DEFAULT 0 NOT NULL,
    categoria text,
    id_conta_corrente bigint
);


--
-- Name: fat_cupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fat_cupons (
    loja_id bigint NOT NULL,
    n_id_cupom bigint NOT NULL,
    chave text,
    data date NOT NULL,
    hora text,
    num text,
    serie text,
    seq_caixa bigint,
    id_cliente bigint,
    id_vendedor bigint,
    valor numeric DEFAULT 0 NOT NULL,
    cancelado boolean DEFAULT false NOT NULL,
    devolvido boolean DEFAULT false NOT NULL
);


--
-- Name: movimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movimentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: movimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentos (
    id bigint DEFAULT nextval('public.movimentos_id_seq'::regclass),
    loja_id bigint,
    transferencia_id bigint,
    codigo_local_estoque bigint,
    id_prod bigint,
    data timestamp with time zone,
    tipo character varying(3),
    quan numeric,
    valor numeric,
    obs text,
    origem character varying(3),
    motivo character varying(3),
    codigo_local_estoque_destino bigint,
    codigo_status character varying(20),
    descricao_status text,
    id_movest bigint,
    id_ajuste bigint,
    response text,
    status character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: movimentos_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentos_historico (
    loja_id integer,
    cod_prod bigint,
    codigo text,
    descricao text,
    data date,
    entradas numeric,
    saidas numeric
);


--
-- Name: nota_fiscal_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nota_fiscal_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nota_fiscal_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nota_fiscal_items (
    id bigint DEFAULT nextval('public.nota_fiscal_items_id_seq'::regclass),
    loja_id bigint,
    nota_fiscal_id bigint,
    n_id_receb character varying(20),
    produto_codigo character varying(20),
    quantidade integer,
    n_sequencia bigint,
    n_id_item bigint,
    n_id_pedido bigint,
    n_id_it_pedido bigint,
    n_id_produto bigint,
    c_codigo_produto character varying(60),
    c_descricao_produto character varying(120),
    c_ignorar_item character varying(1),
    c_adicionar_novo character varying(1),
    c_associar_existente character varying(1),
    c_item_devolvido character varying(1),
    c_ncm character varying(13),
    c_ean character varying(14),
    c_cfop character varying(10),
    n_qtde_nfe numeric,
    c_unidade_nfe character varying(6),
    n_preco_unit numeric,
    v_desconto numeric,
    v_frete numeric,
    v_total_item numeric,
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    categoria_contabil_id bigint
);


--
-- Name: notas_fiscais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notas_fiscais_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notas_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_fiscais (
    id bigint DEFAULT nextval('public.notas_fiscais_id_seq'::regclass),
    loja_id bigint,
    n_id_receb character varying(20),
    n_id_fornecedor bigint,
    c_pessoa_fisica character varying(1),
    c_nome character varying(100),
    c_razao_social character varying(60),
    c_inscricao character varying(20),
    c_cnpj_cpf character varying(20),
    c_chave_nfe character varying(44),
    c_etapa character varying(2),
    c_numero_nfe character varying(10),
    c_serie_nfe character varying(3),
    c_modelo_nfe character varying(2),
    d_emissao_nfe date,
    n_valor_nfe numeric,
    c_ambiente_nfe character varying(1),
    c_natureza_operacao character varying(60),
    full_object jsonb,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    origem character varying(10)
);


--
-- Name: ordens_producao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ordens_producao_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ordens_producao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordens_producao (
    id bigint DEFAULT nextval('public.ordens_producao_id_seq'::regclass),
    loja_id bigint,
    num_ordem character varying(60),
    validade date,
    quantidade numeric,
    identificacao_n_cod_op bigint,
    identificacao_c_cod_int_op character varying(20),
    identificacao_c_num_op character varying(15),
    identificacao_n_cod_produto bigint,
    identificacao_c_cod_int_prod character varying(60),
    identificacao_d_dt_previsao date,
    identificacao_n_qtde numeric,
    identificacao_codigo_local_estoque bigint,
    adicionais_c_etapa character varying(2),
    adicionais_n_cod_projeto bigint,
    adicionais_d_dt_inicio date,
    adicionais_d_dt_conclusao date,
    produto_codigo character varying(60),
    produto_descricao character varying(120),
    produto_tipo_item character varying(2),
    produto_unidade character varying(6),
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    concluida boolean,
    dt_conclusao_real date,
    dt_inclusao date,
    observacao text
);


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    message_id character varying(40) NOT NULL,
    message jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.webhooks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.webhooks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fat_cupom_itens fat_cupom_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fat_cupom_itens
    ADD CONSTRAINT fat_cupom_itens_pkey PRIMARY KEY (loja_id, id_item);


--
-- Name: fat_cupom_pagamentos fat_cupom_pagamentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fat_cupom_pagamentos
    ADD CONSTRAINT fat_cupom_pagamentos_pkey PRIMARY KEY (loja_id, n_id_cupom, sequencia);


--
-- Name: fat_cupons fat_cupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fat_cupons
    ADD CONSTRAINT fat_cupons_pkey PRIMARY KEY (loja_id, n_id_cupom);


--
-- Name: ordens_producao uq_op_loja_cod; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao
    ADD CONSTRAINT uq_op_loja_cod UNIQUE (loja_id, identificacao_n_cod_op);


--
-- Name: webhooks uq_webhooks_loja_message; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT uq_webhooks_loja_message UNIQUE (loja_id, message_id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: fat_cupom_itens_cupom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fat_cupom_itens_cupom_idx ON public.fat_cupom_itens USING btree (loja_id, n_id_cupom);


--
-- Name: fat_cupom_itens_produto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fat_cupom_itens_produto_idx ON public.fat_cupom_itens USING btree (loja_id, id_produto);


--
-- Name: fat_cupom_pagamentos_cupom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fat_cupom_pagamentos_cupom_idx ON public.fat_cupom_pagamentos USING btree (loja_id, n_id_cupom);


--
-- Name: fat_cupons_loja_data_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fat_cupons_loja_data_idx ON public.fat_cupons USING btree (loja_id, data);


--
-- Name: idx_webhooks_loja_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_loja_message ON public.webhooks USING btree (loja_id, message_id);


--
-- Name: movimentos_loja_id_ajuste_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX movimentos_loja_id_ajuste_unique ON public.movimentos USING btree (loja_id, id_ajuste) WHERE (id_ajuste IS NOT NULL);


--
-- Name: nota_fiscal_items_loja_receb_seq_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX nota_fiscal_items_loja_receb_seq_unique ON public.nota_fiscal_items USING btree (loja_id, n_id_receb, n_sequencia);


--
-- Name: notas_fiscais_loja_receb_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notas_fiscais_loja_receb_unique ON public.notas_fiscais USING btree (loja_id, n_id_receb);


--
-- PostgreSQL database dump complete
--


