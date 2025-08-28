@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
            {{ __('Ordens de Produção') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small>
            <span style="font-size: 12px;">
                @if(auth()->user()->loja->ordem_producao_ultima_atualizacao)
                    Atualizado
                    em: {{\Carbon\Carbon::parse(auth()->user()->loja->ordem_producao_ultima_atualizacao)->format('d/m/y H:i:s')}}
                @elseif(in_array(auth()->user()->loja->ordem_producao_status, [null, 'Concluído']))
                    <a href="{{route('ordemproducao.sync')}}" class="btn btn-sm btn-secondary">Sincronizar Ordens de Produção</a>
                @endif
                | Status: {{auth()->user()->loja->ordem_producao_status??'N/A'}}
            </span>
        </h2>

        <div class="accordion" id="accordionExample">
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                            data-bs-target="#collapseOne" aria-expanded="false" aria-controls="collapseOne">
                        <i class="fa-solid fa-filter me-2"></i>
                        FILTRO
                    </button>
                </h2>
                <div id="collapseOne" class="accordion-collapse collapse" data-bs-parent="#accordionExample">
                    <div class="accordion-body">
                        <form id="filtrosForm" method="GET" action="{{ route('ordemproducao.index') }}">
                            <div class="row g-1">
                                <div class="col-md-3">
                                    <div class="row g-1">
                                        <div class="col-lg-6 col-12">
                                            <div class="mb-3">
                                                <label for="data_inicio" class="form-label">Data Início</label>
                                                <input title="Data criação Omie" type="date" class="form-control"
                                                       id="data_inicio" name="data_inicio"
                                                       value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                                            </div>
                                        </div>
                                        <div class="col-lg-6 col-12">
                                            <div class="mb-3">
                                                <label for="data_final" class="form-label">Data Final</label>
                                                <input type="date" class="form-control" id="data_final"
                                                       name="data_final"
                                                       value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="tipo_produto" class="form-label">Tipo de Produto</label>
                                        <select id="tipo_produto" name="tipo_produto" class="form-control">
                                            <option value="" {{ ($tipo_produto ?? '') == '' ? 'selected' : '' }}>
                                                Todos
                                            </option>
                                            @foreach (\App\Helpers\Constants::PRODUTO_TIPO_ITEM as $key => $value)
                                                <option value="{{ $key }}"
                                                    {{ ($tipo_produto ?? '') == $key ? 'selected' : '' }}>
                                                    {{ $key }} - {{ $value }}
                                                </option>
                                            @endforeach
                                        </select>
                                    </div>
                                </div>

                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="ordem_producao" class="form-label">Nº Ordem de Produção</label>
                                        <input type="text" id="ordem_producao" name="ordem_producao"
                                               placeholder="Nº 2021/38804" class="form-control"
                                               value="{{ request('ordem_producao', $ordem_producao ?? '') }}">
                                    </div>
                                </div>

                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="op_produto" class="form-label">Produto</label>
                                        <input type="text" id="op_produto" name="op_produto"
                                               placeholder="Código/Descrição" class="form-control"
                                               value="{{ request('op_produto', $op_produto ?? '') }}">
                                    </div>
                                </div>

                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="op_produto" class="form-label">Concluído</label>
                                        <select id="op_concluido" name="op_concluido" class="form-control">
                                            <option value=""
                                                {{ request('op_concluido', $op_concluido ?? '') == '' ? 'selected' : '' }}>
                                                Todos
                                            </option>
                                            <option
                                                value="S" {{ request('op_concluido', $op_concluido ?? '') == 'S' ? 'selected' : '' }}>
                                                Concluído
                                            </option>
                                            <option
                                                value="N" {{ request('op_concluido', $op_concluido ?? '') == 'N' ? 'selected' : '' }}>
                                                Pendente
                                            </option>
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-2 d-flex align-items-end my-3">

                                    <button type="button" class="btn btn-primary ms-2" onclick="filtrarRegistros()"
                                            title="Filtrar registros">
                                        <i class="fas fa-search"></i>
                                    </button>

                                    <button type="button" class="btn btn-primary ms-2" onclick="imprimirRegistros()"
                                            title="Imprimir registros">
                                        <i class="fas fa-print"></i>
                                    </button>

                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <div class="card card-body mt-4">
            <table class="table table-hover table-borderless" aria-hidden="true">
                <tbody>
                @if ($ordensProducao->count() > 0)
                    @foreach ($ordensProducao as $op)
                        <tr>
                            <td class="px-2">
                                <div class="container">
                                    <div class="row">
                                        <div class="col-12 p-0">
                                            <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                <div class="row">
                                                    <div class="col">
                                                        <p class="mb-0">
                                                            <small>Ordem de Produção:</small>
                                                            {{ $op->identificacao_c_num_op ?? '' }}
                                                        </p>
                                                        <p class="mb-0">
                                                            <small>Produto:</small> {{ $op->produto_codigo ?? '' }} -
                                                            {{ $op->produto_descricao ?? '' }}
                                                        </p>
                                                        <p class="mb-0">
                                                            <small>Status:</small>
                                                            @if ((json_decode($op->full_object)->outrasInf->cConcluida ?? '') == 'S')
                                                                <span class="badge bg-success">
                                                                        Produzida em:
                                                                        {{ json_decode($op->full_object)->outrasInf->dConclusao ?? '' }}
                                                                    </span>
                                                            @else
                                                                <span class="badge bg-warning">
                                                                        Pendente
                                                                    </span>
                                                            @endif
                                                        </p>
                                                        <p class="mb-0">
                                                            <small>Tipo:</small>
                                                            {{ $op->produto_tipo_item }} -
                                                            {{ \App\Helpers\Constants::PRODUTO_TIPO_ITEM[$op->produto_tipo_item] ?? '' }}
                                                        </p>
                                                        <p class="mb-0">
                                                            <small>Lote:</small>
                                                            {{ $op->identificacao_c_num_op ?? '' }}<br>
                                                        </p>
                                                        <p class="mb-0">
                                                            <small>Quantidade:</small>
                                                            {{ $op->identificacao_n_qtde ?? '' }}
                                                            ({{ $op->produto_unidade ?? '' }})
                                                        </p>
                                                    </div>

                                                    <div class="col">
                                                        <div class="mb-3">
                                                            <label for="data_validade"
                                                                   class="form-label mb-0">Validade:</label>
                                                            <input type="date" class="form-control"
                                                                   id="data_validade" name="data_validade"
                                                                   value="{{ $op->validade ?? '' }}"
                                                                   onblur="sincValidade(this.value,{{ $op->id }})">
                                                        </div>
                                                        <div class="text-end">
                                                            <button type="button"
                                                                    onclick="imprimir({{ $op->id }})"
                                                                    class="btn btn-secondary btn-sm">
                                                                <i class="fa-solid fa-print me-2"></i> Imprimir
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    @endforeach
                @else
                    <tr>
                        <td class="text-center">Nenhuma ordem de produção encontrada</td>
                    </tr>
                @endif
                </tbody>
            </table>
            {{ $ordensProducao->links('pagination::bootstrap-5') }}
        </div>
    </div>

    <script>
        function sincValidade(validade, ordemproducao_id) {
            axios.post(`/ordem-producao/${ordemproducao_id}/validade`, {
                "validade": validade
            })
        }

        function imprimir(ordemproducao_id) {
            const url = `/ordem-producao/${ordemproducao_id}/imprimir`;
            window.location.href = url;
        }

        document.querySelectorAll('.accordion-collapse').forEach((item) => {
            item.addEventListener('shown.bs.collapse', () => {
                localStorage.setItem('accordionNotaOrdemProducao', item.id);
            });
            item.addEventListener('hidden.bs.collapse', () => {
                localStorage.removeItem('accordionNotaOrdemProducao');
            });
        });

        window.addEventListener('DOMContentLoaded', () => {
            const aberto = localStorage.getItem('accordionNotaOrdemProducao');
            if (aberto) {
                const el = document.getElementById(aberto);
                const collapse = new bootstrap.Collapse(el, {toggle: true});
            }
        });

        function filtrarRegistros() {
            document.getElementById('filtrosForm').submit();
        }

        function imprimirRegistros() {
            const filtrosForm = document.getElementById('filtrosForm');
            const url = '{{ route("ordemproducao.relatorio.imprimir") }}';
            const formData = new FormData(filtrosForm);

            axios.post(url, formData, {
                responseType: 'blob'
            }).then((response) => {
                const blob = new Blob([response.data], {type: response.headers['content-type']});
                const blobUrl = window.URL.createObjectURL(blob);
                window.open(blobUrl, '_blank');
                setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
            }).catch((error) => {
                swal.fire({
                    title: "Ops :(!",
                    text: error,
                    icon: "error",
                    button: "OK!",
                });
            });
        }

    </script>
@endsection
