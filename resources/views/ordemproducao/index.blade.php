@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">{{ __('Ordens de Produção') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small></h2>

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
                            <div class="row">
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="data_producao" class="form-label">Previsão/Conclusão</label>
                                        <input type="date" id="data_producao" name="data_producao" class="form-control"
                                            value="{{ request('data_producao', $data_producao ?? '') }}">
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
                                                Todos</option>
                                            <option value="S" {{ request('op_concluido', $op_concluido ?? '') == 'S' ? 'selected' : '' }}>Concluído</option>
                                            <option value="N" {{ request('op_concluido', $op_concluido ?? '') == 'N' ? 'selected' : '' }}>Pendente</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="col-md-2 d-flex align-items-end">
                                    <div class="mb-3">
                                        <button type="submit" class="btn btn-primary me-2">
                                            <i class="fas fa-search"></i> Filtrar
                                        </button>
                                    </div>
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
                    @if ($ordenspro->count() > 0)
                        @foreach ($ordenspro as $op)
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
            {{ $ordenspro->links('pagination::bootstrap-5') }}
        </div>
    </div>

    <script>
        function sincValidade(validade, ordemproducao_id) {
            axios.post(`/ordenspro/${ordemproducao_id}/validade`, {
                "validade": validade
            })
        }

        function imprimir(ordemproducao_id) {
            const url = `/ordenspro/${ordemproducao_id}/imprimir`;
            window.location.href = url;
        }
    </script>
@endsection
