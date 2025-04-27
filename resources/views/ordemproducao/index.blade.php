@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">{{ __('Ordens de Produção') }}</h2>

        <div class="accordion" id="accordionExample">
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne"
                        aria-expanded="false" aria-controls="collapseOne">
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
                                    <button type="submit" class="btn btn-primary me-2">
                                        <i class="fas fa-search"></i> Filtrar
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <div class="card card-body mt-4">
            <div class="table-responsive">
                <table class="table table-hover">
                    <tbody>
                        @if (isset($ordenspro) && !empty($ordenspro))
                            @foreach ($ordenspro as $op)
                                @php
                                    $omie = new \App\Services\OmieService();
                                    $produto = $omie->getConsultaProduto($op->identificacao->nCodProduto);
                                @endphp
                                <tr>
                                    <td class="px-0">
                                        <div class="container">
                                            <div class="row">
                                                <div class="col-12 p-0">
                                                    <div class="card card-body m-0 px-0 py-2">
                                                        <h6>
                                                            Cód. OP: {{ $op->identificacao->cCodIntOP }}
                                                        </h6>
                                                        <p class="mb-0">
                                                            Lote : <strong>{{ $op->identificacao->cNumOP ?? '' }}</strong>
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            Produto: {{ $op->identificacao->nCodProduto }}  - {{ $produto->descricao }}
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            nCodOP: {{ $op->identificacao->nCodOP }}
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            QTDE a Produzir.: {{ $op->identificacao->nQtde }}
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            Unidade de medida: {{ $produto->unidade }}
                                                        </p>
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
    </div>
@endsection
