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
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="data_inicio" class="form-label">Data Início</label>
                                        <input title="Data criação Omie" type="date" class="form-control"
                                            id="data_inicio" name="data_inicio"
                                            value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="data_final" class="form-label">Data Final</label>
                                        <input type="date" class="form-control" id="data_final" name="data_final"
                                            value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="ordem_producao" class="form-label">Nº Ordem de Produção</label>
                                        <input type="text" id="ordem_producao" name="ordem_producao"
                                            placeholder="Nº da OP '2021/38804'" class="form-control"
                                            value="{{ request('ordem_producao', $ordem_producao ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-3 d-flex align-items-end">
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

        <div class="container mb-3"><br>
            <div class="row">
                <div class="col-12">
                    <button type="button"
                        onclick="imprimir('{{ $data_inicio }}', '{{ $data_final }}', '{{ $ordem_producao }}')"
                        class="btn btn-primary">
                        <i class="fa-solid fa-print me-2"></i> Imprimir Todos
                    </button>
                </div>
            </div>
        </div>

        <div class="card card-body mt-4">
            <table class="table table-hover table-borderless">
                <tbody>
                    @if (isset($ordenspro) && !empty($ordenspro))
                        @foreach ($ordenspro as $op)
                            @php
                                $omie = new \App\Services\OmieService();
                                $produto = $omie->getConsultaProduto($op->identificacao->nCodProduto);
                            @endphp
                            <tr>
                                <td class="px-2">
                                    <div class="container">
                                        <div class="row">
                                            <div class="col-12 p-0">
                                                <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                    <div class="row">
                                                        <div class="col">
                                                            <h6 class="mb-3">
                                                                <small>Produto:</small> {{ $produto->codigo ?? '' }} -
                                                                {{ $produto->descricao ?? '' }}
                                                            </h6>
                                                            <p class="mb-2">
                                                                <small>Lote:</small> {{ $op->identificacao->cNumOP ?? '' }}<br>
                                                                <small>Ordem de Produção:</small>
                                                                {{ $op->identificacao->cNumOP ?? '' }}<br>
                                                                <small>Quantidade:</small> {{ $op->identificacao->nQtde ?? '' }}
                                                                ({{ $produto->unidade ?? '' }})
                                                            </p>
                                                        </div>

                                                        <div class="col">
                                                            <div class="mb-3">
                                                                <label for="data_validade" class="form-label mb-0">Validade:</label>
                                                                <input type="date" class="form-control"
                                                                    id="data_validade" name="data_validade"
                                                                    value="{{ \App\Models\OrdemProducao::where('num_ordem', $op->identificacao->cNumOP)->first()->validade ?? '' }}"
                                                                    onblur="sincValidade(this,'{{ $op->identificacao->cNumOP }}')">
                                                            </div>
                                                            <div class="text-end">
                                                                <button type="button"
                                                                    onclick="imprimir('{{ $data_inicio }}', '{{ $data_final }}', '{{ $op->identificacao->cNumOP }}')"
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

        function imprimir(data_inicio, data_final, ordem_producao) {
            const url =
                `{{ route('etiqueta.imprimir') }}?data_inicio=${encodeURIComponent(data_inicio)}&data_final=${encodeURIComponent(data_final)}&ordem_producao=${encodeURIComponent(ordem_producao)}`;
            window.location.href = url;
        }
    </script>
@endsection
