-- Constraints unique para upsert nativo nos syncs Omie
alter table local_estoques add constraint uq_local unique (loja_id, codigo_local_estoque);
alter table ordens_producao add constraint uq_op unique (loja_id, identificacao_n_cod_op);
alter table notas_fiscais add constraint uq_nf unique (loja_id, n_id_receb);
alter table nota_fiscal_items add constraint uq_nfi unique (loja_id, n_id_receb, n_sequencia);
