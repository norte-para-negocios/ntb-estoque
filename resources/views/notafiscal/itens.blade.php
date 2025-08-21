@extends('layouts.app')

@section('content')
    <div class="container">

        <h2 class="mb-3">
            <a href="{{url()->previous()}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar"><i class="fa-solid fa-arrow-left-long"></i></a>
            {{ __('Notas fiscais - Itens') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small>
        </h2>

        <div class="card card-body">
            <h5>{{ __($notaFiscal->c_nome ?? '') }}</h5>
            <h6>N° NFe.: {{ $notaFiscal->c_numero_nfe ?? '' }} |
                Emissão: {{ $notaFiscal->d_emissao_nfe ?? '' }}
            </h6>
            <a href="{{ route('notafiscal.imprimir', $notaFiscal->id, [], false) }}"
               class="btn btn-secondary btn-sm text-start">
                <i class="fa-solid fa-print me-2"></i> Imprimir Tudo
            </a>
        </div>

        <div class="card card-body mt-4">
            <table class="table table-hover table-borderless">
                <tbody>
                @if ($notaFiscal->nfItems()->count() > 0)
                    @foreach ($notaFiscal->nfItems as $item)
                        <tr>
                            <td class="px-2">
                                <div class="container">
                                    <div class="row">
                                        <div class="col-12 p-0">
                                            <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                <h6>
                                                    <small>Produto:</small> {{ $item->c_codigo_produto ?? '' }} -
                                                    {{ $item->c_descricao_produto }}
                                                    {{ $item->produto->tipo_item ?? '' }}
                                                </h6>
                                                @if ($item->n_id_produto > 0)
                                                    <div class="mb-3">
                                                        <label for="quantidade"
                                                               class="form-label mb-0">Quantidade
                                                            ({{ $item->produto->unidade ?? "-" }}):</label>
                                                        <input type="number" class="form-control" id="quantidade"
                                                               name="quantidade"
                                                               value="{{ $item->quantidade ?? 1 }}"
                                                               onblur="setQuantidade(this,'{{ route('notafiscal.setQuantidade', [$item->id]) }}')">
                                                    </div>
                                                    <p class="my-1">
                                                        <a href="{{ route('notafiscal.imprimir', [$item->nota_fiscal_id, $item->n_id_produto]) }}"
                                                           class="btn btn-secondary btn-sm">
                                                            <i class="fa-solid fa-print me-2"></i> Imprimir
                                                        </a>
                                                    </p>
                                                @else
                                                    <p class="text-danger">Produto não está cadastrado no estoque</p>
                                                @endif
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

    <script>
        function setQuantidade(el, url) {
            axios.post(url, {
                "quantidade": el.value
            })
        }
    </script>
@endsection
