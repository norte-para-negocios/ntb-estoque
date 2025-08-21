<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <meta content="width=device-width, initial-scale=1.0" name="viewport">
    <meta content="ie=edge" http-equiv="X-UA-Compatible">
    <title>NTB - Estoque</title>
    <style>
        {!! file_get_contents(resource_path('css/bootstrap3-3-7.min.css')) !!}
    </style>
</head>
<body>
<h2 class="mb-4 text-center">{{ __('Nota Fiscal') }} - {{ $loja->nome ?? '' }}</h2>
<div class="container" style="padding-top: 20px;">
    <div class="row">
        <div class="col-xs-12">
            <table class="table table-bordered table-condensed table-fixed">
                <thead style="font-size: 9px; font-weight: 700;">
                <tr>
                    <th>Código do Produto</th>
                    <th>Descrição do Produto</th>
                    <th>Unidade</th>
                    <th>Quant.</th>
                    <th>Valor Total</th>
                    <th>CFOP - Entrada</th>
                    <th>CFOP - Documento</th>
                    <th>Situação Tributária</th>
                </tr>
                </thead>
                <tbody style="font-size: 9px; font-weight: 500;">
                @foreach ($notasfiscais as $nf)
                    <tr>
                        <td colspan="7">
                            {{$nf->c_razao_social}} <small>{{$nf->c_cnpj_cpf}}</small> ({{$nf->c_numero_nfe}}) -
                            Emissão: {{$nf->d_emissao_nfe->format('d/m/Y')}}
                        </td>
                    </tr>
                    @foreach($nf->nfItems as $item)
                        <tr>
                            <td>
                                {{ $item->produto->codigo ?? '' }}
                            </td>
                            <td>
                                {{ $item->produto->descricao ?? '' }}
                            </td>
                            <td>
                                {{ $item->produto->unidade ?? '' }}
                            </td>
                            <td style="text-align: right;">
                                {{ number_format((json_decode($item->full_object)->itensCabec->nQtdeNFe ?? 0), 2, ',', '.') }}
                            </td>
                            <td style="text-align: right;">
                                {{ number_format((json_decode($item->full_object)->itensCabec->vTotalItem ?? 0), 2, ',', '.') }}
                            </td>
                            <td>
                                {{ json_decode($item->full_object)->itensAjustes->cCFOPEntrada ?? '-' }}
                            </td>
                            <td>
                                {{ json_decode($item->full_object)->itensCabec->cCFOP ?? '-' }}
                            </td>
                            <td>
                                {{ json_decode($item->full_object)->itensICMS->cSitTrib ?? '-' }}
                            </td>
                        </tr>
                    @endforeach
                @endforeach
                </tbody>
            </table>
        </div>
    </div>
</div>
</body>

</html>
