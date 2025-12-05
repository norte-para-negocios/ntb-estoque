@extends('layouts.app')

@section('content')
    <div class="container">
        <p class="mb-0 fw-semibold">
            <a href="{{route('notafiscal.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
                <img class="ms-0 p-0" src="{{asset('images/nota-fiscal.png')}}" alt="Notas Fiscais">
                {{ __('Notas Fiscais') }} /
            </a>

            <img class="ms-0 p-0" src="{{asset('images/nota-fiscal.png')}}" alt="Fornecedor">
            {{ __($notaFiscal->c_nome ?? '') }}
        </p>


        {{--        <div class="card card-body">--}}
        {{--            <h5>{{ __($notaFiscal->c_nome ?? '') }}</h5>--}}
        {{--            <h6>N° NFe.: {{ $notaFiscal->c_numero_nfe ?? '' }} |--}}
        {{--                Emissão: {{ $notaFiscal->d_emissao_nfe ?? '' }}--}}
        {{--            </h6>--}}
        {{--            <a href="{{ route('notafiscal.imprimir', $notaFiscal->id, [], false) }}"--}}
        {{--               class="btn btn-secondary btn-sm text-start">--}}
        {{--                <i class="fa-solid fa-print me-2"></i> Imprimir Tudo--}}
        {{--            </a>--}}
        {{--        </div>--}}


        <table class="table table-hover table-borderless" style="background-color: #f4f4f4;">
            <tbody>
            @if ($notaFiscal->nfItems()->count() > 0)
                @foreach ($notaFiscal->nfItems as $item)
                    <tr style="background-color: #f4f4f4;">
                        <td class="px-2" style="background-color: #f4f4f4;">
                            <div class="container">
                                <div class="row">
                                    <div class="col-12 p-0">
                                        <span>Emissão: {{ \Carbon\Carbon::parse(normalizarData($notaFiscal->d_emissao_nfe))->format('d/m/Y') }}</span>
                                        <div class="card m-0">
                                            <div class="card-header">
                                                <span class="text-white">
                                                    Produto {{ $item->c_codigo_produto ?? '' }}
                                                </span>
                                            </div>
                                            <div class="card-footer" style="background-color: #ffffff;">
                                                <div class="row">
                                                    <div class="col-sm-5 col-9">
                                                        <small>Nome do produto</small>
                                                        <p class="fw-semibold">
                                                            {{ $item->c_descricao_produto }}
                                                        </p>
                                                    </div>
                                                    <div class="col-sm-1 col-3">
                                                        <small>Medida</small>
                                                        <p class="fw-semibold">
                                                            {{ $item->produto->unidade ?? "-" }}

                                                        </p>
                                                    </div>
                                                    <div
                                                        class="col-sm-4 col-8 d-flex justify-content-around align-items-center">
                                                        <span class="me-1" style="font-size: .7rem;">
                                                            Quantidade de produto por etiqueta
                                                        </span>
                                                        <div class="d-flex">
                                                            <button
                                                                class="btn btn-sm btn-outline-primary mx-0 btn-quantidade fw-semibold px-2"
                                                                onclick="subtrai('quantidade-{{$item->id}}')"
                                                            >
                                                                -
                                                            </button>
                                                            <input type="number"
                                                                   class="form-control rounded-0 quantidade mx-1"
                                                                   id="quantidade-{{$item->id}}"
                                                                   name="quantidade"
                                                                   value="{{ $item->quantidade ?? 1 }}"
                                                                   onblur="setQuantidade(this,'{{ route('notafiscal.setQuantidade', [$item->id]) }}')"
                                                                   style="width: 60px; text-align: center;"
                                                            >
                                                            <button
                                                                class="btn btn-sm btn-outline-primary btn-quantidade fw-semibold px-2"
                                                                onclick="soma('quantidade-{{$item->id}}')"
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div
                                                        class="col-sm-2 col-4 text-end ps-0 d-flex justify-content-end align-items-center p-0">
                                                        <a href="{{ route('notafiscal.imprimir', [$item->nota_fiscal_id, $item->n_id_produto]) }}"
                                                           class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold">
                                                            <img src="{{asset('images/imprimir.png')}}" alt=""
                                                                 class="me-1">
                                                            Imprimir
                                                        </a>
                                                    </div>
                                                </div>
                                            </div>

                                            {{--                                            <h6>--}}
                                            {{--                                                <small>Produto:</small> {{ $item->c_codigo_produto ?? '' }} ---}}
                                            {{--                                                {{ $item->c_descricao_produto }}--}}
                                            {{--                                                {{ $item->produto->tipo_item ?? '' }}--}}
                                            {{--                                            </h6>--}}
                                            {{--                                            @if ($item->n_id_produto > 0)--}}
                                            {{--                                                <div class="mb-3">--}}
                                            {{--                                                    <label for="quantidade"--}}
                                            {{--                                                           class="form-label mb-0">Quantidade--}}
                                            {{--                                                        ({{ $item->produto->unidade ?? "-" }}):</label>--}}
                                            {{--                                                    <input type="number" class="form-inline form-control" id="quantidade"--}}
                                            {{--                                                           name="quantidade"--}}
                                            {{--                                                           value="{{ $item->quantidade ?? 1 }}"--}}
                                            {{--                                                           onblur="setQuantidade(this,'{{ route('notafiscal.setQuantidade', [$item->id]) }}')">--}}
                                            {{--                                                </div>--}}
                                            {{--                                                <p class="my-1">--}}
                                            {{--                                                    <a href="{{ route('notafiscal.imprimir', [$item->nota_fiscal_id, $item->n_id_produto]) }}"--}}
                                            {{--                                                       class="btn btn-secondary btn-sm">--}}
                                            {{--                                                        <i class="fa-solid fa-print me-2"></i> Imprimir--}}
                                            {{--                                                    </a>--}}
                                            {{--                                                </p>--}}
                                            {{--                                            @else--}}
                                            {{--                                                <p class="text-danger">Produto não está cadastrado no estoque</p>--}}
                                            {{--                                            @endif--}}
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
@endsection

@push('js')
    <script>
        (function esconderBtnFiltro() {
            const btn = document.getElementById("btn-filtrar");
            if (btn) {
                btn.style.display = "none";
            }
        })();

        function setQuantidade(el, url) {
            axios.post(url, {
                "quantidade": el.value
            })
        }

        function subtrai(id) {
            const quantidade = document.getElementById(id);
            if (quantidade && !isNaN(quantidade.value)) {
                const valorAtual = parseInt(quantidade.value, 10);

                if (valorAtual > 1) {
                    quantidade.value = valorAtual - 1;
                }
            }
        }

        function soma(id) {
            const quantidade = document.getElementById(id);
            if (quantidade && !isNaN(quantidade.value)) {
                const valorAtual = parseInt(quantidade.value, 10);
                quantidade.value = valorAtual + 1;
            }
        }

    </script>
@endpush

@push('css')
    <style>
        body {
            background: #f4f4f4;
        }

        .quantidade {
            color: #2EB5C3 !important;
            border-color: #D5D5D5 !important;
            border-top: none !important;
            border-left: none !important;
            border-right: none !important;
        }

        .btn-quantidade {
            color: #2EB5C3 !important;
            border-color: #D5D5D5 !important;
        }
    </style>
@endpush
