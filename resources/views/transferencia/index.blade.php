@extends('layouts.app')

@section('content')
    <div class="container">

        <h2 class="mb-4 d-flex justify-content-between align-items-center">
            <span>
                {{ __('Transferências') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small>
            </span>

            <a href="{{ route('transferencia.create') }}" class="btn btn-primary">
                <i class="fas fa-plus"></i> Nova transferência
            </a>
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
                        <form id="filtrosForm" method="GET" action="{{ route('transferencia.index') }}">
                            <div class="row">
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="data_inicio" class="form-label">Data</label>
                                        <input title="Data criação Omie" type="date" class="form-control"
                                            id="data_inicio" name="data_inicio"
                                            value="{{ request('data_inicio', $data_inicio) }}">
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="data_final" class="form-label">Data Final</label>
                                        <input type="date" class="form-control" id="data_final" name="data_final"
                                            value="{{ request('data_final', $data_final) }}">
                                    </div>
                                </div>
                                <div class="col-md-6 d-flex align-items-end">
                                    <div class="mb-3 g-6">
                                        <button type="submit" class="btn btn-primary">
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
                    @if (isset($transferencias) && !empty($transferencias))
                        @foreach ($transferencias as $tr)
                            @php
                                $omie = new \App\Services\OmieService();
                                $produto = $omie->getConsultaProduto($tr->id_prod);
                                $local = $omie->getLocalEstoque($tr->codigo_local_estoque);
                                $localDestino = $omie->getLocalEstoque($tr->codigo_local_estoque_destino);
                            @endphp
                            <tr>
                                <td class="px-2">
                                    <div class="container">
                                        <div class="row">
                                            <div class="col-12 p-0">
                                                <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                    <div class="row">
                                                        <div class="col-md-6 col-12">
                                                            <p class="mb-0">
                                                                Data : <strong>{{ $tr->data->format('d/m/Y') }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Código Produto: {{ $produto->codigo }} -
                                                                <strong>{{ $produto->descricao ?? '' }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Tipo Movimento:
                                                                <strong>{{ \App\Helpers\Constants::TIPO_TRANSFERENCIA[$tr->tipo] ?? '' }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Origem : <strong>{{ $tr->codigo_local_estoque ?? '' }} -
                                                                    {{ $local->descricao ?? '' }}</strong>
                                                                <span> | </span>
                                                                Destino :
                                                                <strong>{{ $tr->codigo_local_estoque_destino ?? '' }} -
                                                                    {{ $localDestino->descricao ?? '' }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Quantidade :
                                                                <strong>
                                                                    {{ number_format($tr->quan, 3, ',', '.') }}
                                                                    {{ $produto->unidade ?? '' }}
                                                                </strong>
                                                                <span> | </span>
                                                                Valor Unitário :
                                                                <strong>{{ number_format($tr->valor ?? 0, 2, ',', '.') }}</strong>
                                                            </p>
                                                        </div>
                                                        <div class="col-md-6 col-12">
                                                            <p class="mb-0">
                                                                @if ($tr->id_movest === null)
                                                                    Situação:
                                                                    <span class="badge bg-warning">
                                                                        Operação não realizada no OMIE!
                                                                    </span>
                                                                @else
                                                                    Situação: <span class="badge bg-success">
                                                                        {{ $tr->descricao_status }}
                                                                    </span>
                                                                @endif
                                                            </p>
                                                            <p class="mb-0">
                                                                Movimento nº: <strong>{{ $tr->id_movest }}</strong> |
                                                                Ajuste nº: <strong>{{ $tr->id_ajuste }}</strong>
                                                            </p>

                                                            <p class="mb-0">
                                                            <div class="d-grid gap-2 col-sm-6 col-md-4 col-12">
                                                                @if ($tr->id_movest === null)
                                                                    <a href="{{ route('transferencia.reprocess', $tr->id) }}"
                                                                        class="btn btn-sm btn-secondary text-white" >
                                                                        <i class="fa-solid fa-arrows-rotate"></i>
                                                                    </a>
                                                                @endif
                                                                <button
                                                                    onclick="deleteRegistro('{{ route('transferencia.destroy', $tr->id) }}')"
                                                                    class="btn btn-sm btn-danger text-white">
                                                                    <i class="fas fa-trash"></i>
                                                                </button>
                                                            </div>
                                                            </p>

                                                            @if ($tr->response !== null)
                                                                <p class="mt-2 mb-0">
                                                                    Observações: <strong>{{ $tr->response ?? '' }}</strong>
                                                                </p>
                                                            @endif
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
                            <td class="text-center">Nenhuma nota fiscal encontrada</td>
                        </tr>
                    @endif
                </tbody>
            </table>
            {{ $transferencias->links('pagination::bootstrap-5') }}
        </div>
    </div>
@endsection
