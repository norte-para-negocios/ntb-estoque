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
                                        <label for="data_producao" class="form-label">Conclusão</label>
                                        <input type="date" id="data_producao" name="data_producao" class="form-control"
                                            value="{{ request('data_producao', $data_producao ?? '') }}">
                                    </div>
                                </div>

                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="tipo_produto" class="form-label">Tipo de Produto</label>
                                        <select id="tipo_produto" name="tipo_produto" class="form-control">
                                            <option value="" {{ ($tipo_produto ?? '') == '' ? 'selected' : '' }}>Todos
                                            </option>
                                            <option value="00" {{ ($tipo_produto ?? '') == '00' ? 'selected' : '' }}>
                                                00 - Mercadoria para Revenda
                                            </option>
                                            <option value="01" {{ ($tipo_produto ?? '') == '01' ? 'selected' : '' }}>
                                                01 - Matéria Prima
                                            </option>
                                            <option value="02" {{ ($tipo_produto ?? '') == '02' ? 'selected' : '' }}>
                                                02 - Embalagem
                                            </option>
                                            <option value="03" {{ ($tipo_produto ?? '') == '03' ? 'selected' : '' }}>
                                                03 - Produto em Processo
                                            </option>
                                            <option value="04" {{ ($tipo_produto ?? '') == '04' ? 'selected' : '' }}>
                                                04 - Produto Acabado
                                            </option>
                                            <option value="05" {{ ($tipo_produto ?? '') == '05' ? 'selected' : '' }}>
                                                05 - Subproduto
                                            </option>
                                            <option value="06" {{ ($tipo_produto ?? '') == '06' ? 'selected' : '' }}>
                                                06 - Produto Intermediário
                                            </option>
                                            <option value="07" {{ ($tipo_produto ?? '') == '07' ? 'selected' : '' }}>
                                                07 - Material de Uso e Consumo
                                            </option>
                                            <option value="08" {{ ($tipo_produto ?? '') == '08' ? 'selected' : '' }}>
                                                08 - Ativo Imobilizado
                                            </option>
                                            <option value="09" {{ ($tipo_produto ?? '') == '09' ? 'selected' : '' }}>
                                                09 - Serviços
                                            </option>
                                            <option value="10" {{ ($tipo_produto ?? '') == '10' ? 'selected' : '' }}>
                                                10 - Outros Insumos
                                            </option>
                                            <option value="99" {{ ($tipo_produto ?? '') == '99' ? 'selected' : '' }}>
                                                99 - Outras
                                            </option>
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

        {{-- <div class="container mb-3"><br>
            <div class="row">
                <div class="col-12">
                    <button type="button"
                        onclick="imprimir('{{ $data_inicio }}', '{{ $data_final }}', '{{ $ordem_producao }}')"
                        class="btn btn-primary">
                        <i class="fa-solid fa-print me-2"></i> Imprimir Todos
                    </button>
                </div>
            </div>
        </div> --}}

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
                                                            <h6 class="mb-0">
                                                                <small>Produto:</small> {{ $op->produto_codigo ?? '' }} -
                                                                {{ $op->produto_descricao ?? '' }}
                                                            </h6>
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
                                                            <p class="mb-2">
                                                                <small>Lote:</small>
                                                                {{ $op->identificacao_c_num_op ?? '' }}<br>
                                                                <small>Ordem de Produção:</small>
                                                                {{ $op->identificacao_c_num_op ?? '' }}<br>
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
                                                                    value="{{ \App\Models\OrdemProducao::where('num_ordem', $op->identificacao_c_num_op)->first()->validade ?? '' }}"
                                                                    onblur="sincValidade(this,'{{ $op->identificacao_c_num_op }}')">
                                                            </div>
                                                            <div class="text-end">
                                                                <button type="button"
                                                                    onclick="imprimir('{{ $op->id }}')"
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
        // Função para Inserir ou alterar a data de validade
        function sincValidade(el, cNumOP) {
            axios.post("{{ route('ordemproducao.sincValidade') }}", {
                "num_ordem": cNumOP,
                "validade": el.value
            }).then(function(r) {
                console.log(r)
            }).catch(function(r) {
                console.log(r)
            })
        }

        function imprimir(ordem_producao) {
            const url = `/ordenspro/${ordem_producao}/imprimir`;
            window.location.href = url;
        }
    </script>
@endsection
