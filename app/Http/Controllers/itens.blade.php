@extends('layouts.app')

@section('content')
    <div class="container">
        <div class="card card-body">
            <h5>{{ __($recebimento->cabec->cNome ?? '') }}</h5>
            <h6>N° NFe.: {{ $recebimento->cabec->cNumeroNFe ?? '' }} | Emissão: {{ $recebimento->cabec->dEmissaoNFe ?? '' }}
            </h6>
            <a href="{{ route('notafiscal.imprimir', $recebimento->cabec->nIdReceb, [], false) }}"
                class="btn btn-secondary btn-sm text-start">
                <i class="fa-solid fa-print me-2"></i> Imprimir Tudo
            </a>
        </div>


        <div class="card card-body mt-4">
            <div class="table-responsive">
                <table class="table table-hover">
                    <tbody>
                        @if (isset($recebimento) && !empty($recebimento))
                            @foreach ($recebimento->itensRecebimento as $it)
                                <tr>
                                    <td class="px-0">
                                        <div class="container">
                                            <div class="row">
                                                <div class="col-12 p-0">
                                                    <div class="card card-body m-0 px-0 py-1">
                                                        <h6>
                                                            {{ $it->itensCabec->cDescricaoProduto }}
                                                        </h6>
                                                        <p class="mb-0">
                                                            Cód Prod.: {{ $it->itensCabec->cCodigoProduto ?? '' }}
                                                        </p>
                                                        <p class="mb-0">
                                                            QTDE.: {{ $it->itensCabec->nQtdeNFe ?? '' }}
                                                            {{ strtoupper($it->itensCabec->cUnidadeNfe) }}
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            VL. Unit.: R$
                                                            {{ number_format($it->itensCabec->nPrecoUnit, 2, ',', '.') }}
                                                        </p>
                                                        <p class="mt-1 mb-0">
                                                            VL. Total.: R$
                                                            {{ number_format($it->itensCabec->vTotalItem, 2, ',', '.') }}
                                                        </p>
                                                        <p class="my-1">
                                                            <a href="{{ route('notafiscal.imprimir', [$recebimento->cabec->nIdReceb, $it->itensCabec->cCodigoProduto]) }}"
                                                                class="btn btn-secondary btn-sm">
                                                                <i class="fa-solid fa-print me-2"></i> Imprimir
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
                                <td class="text-center">Nenhum item encontrado</td>
                            </tr>
                        @endif
                    </tbody>
                </table>
            </div>
        </div>
    </div>
@endsection
