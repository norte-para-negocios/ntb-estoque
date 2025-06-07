@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">{{ __('Notas fiscais') }}</h2>

        <div class="accordion" id="accordionExample">
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne"
                        aria-expanded="false" aria-controls="collapseOne">
                        <i class="fa-solid fa-filter me-2"></i>
                        FILTRO
                    </button>
                </h2>
                <div id="collapseOne" class="accordion-collapse collapse" data-bs-parent="#accordionExample">
                    <div class="accordion-body">
                        <form id="filtrosForm" method="GET" action="{{ route('notafiscal.index') }}">
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
                                        <label for="num_nfe" class="form-label">Número NFe</label>
                                        <input type="text" id="num_nfe" name="num_nfe" placeholder="Nº NFe"
                                            class="form-control" value="{{ request('num_nfe', $num_nfe ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-3 d-flex align-items-end">
                                    <div class="mb-3">
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
            <div class="table-responsive">
                <table class="table table-hover">
                    <tbody>
                        @if (isset($notasfiscais) && !empty($notasfiscais))
                            @foreach ($notasfiscais as $nf)
                                <tr>
                                    <td class="px-0">
                                        <div class="container">
                                            <div class="row">
                                                <div class="col-12 p-0">
                                                    <div class="card card-body m-0">
                                                        <h6>
                                                            {{ $nf->cabec->cNome }}
                                                        </h6>
                                                        <p class="mb-0">
                                                            Nº NFe: <strong>{{ $nf->cabec->cNumeroNFe ?? '' }}</strong>|
                                                            Emissão:
                                                            {{ $nf->cabec->dEmissaoNFe ?? '' }}
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            R$
                                                            {{ number_format($nf->cabec->nValorNFe, 2, ',', '.') ?? '' }}
                                                        </p>
                                                        <p class="my-1">
                                                            <a href="{{ route('notafiscal.itens', $nf->cabec->nIdReceb) }}"
                                                                class="btn btn-secondary btn-sm">
                                                                <i class="fas fa-eye"></i> Visualizar
                                                            </a>
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
                                <td class="text-center">Nenhuma nota fiscal encontrada</td>
                            </tr>
                        @endif
                    </tbody>
                </table>
            </div>
        </div>
    </div>
@endsection
