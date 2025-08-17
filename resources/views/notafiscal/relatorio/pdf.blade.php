<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <meta content="width=device-width, initial-scale=1.0" name="viewport">
    <meta content="ie=edge" http-equiv="X-UA-Compatible">
    <title>Scales</title>

      
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
                    <thead style="font-size: 9px; font-weight: bold;">
                        <tr>
                            <th class="col-especialidade">Nº Nota Fiscal</th>                           
                            <th class="col-status">Fornecedor</th> 
                            <th class="col-especialidade">Emissão</th>
                            <th class="col-status">Valor</th>
                            
                           
                        </tr>
                    </thead>
                    <tbody style="font-size: 9px; font-weight: regular;">
                        {{-- @dd($nfes) --}}
                        @foreach ($nfes as $nf)
                            <tr>
                                <td>
                                    {{ $nf->cabec->cNumeroNFe ?? '' }}
                                </td>
                                <td>
                                    {{ $nf->cabec->cNome ?? '' }}
                                </td>
                                <td>
                                    {{ $nf->cabec->dEmissaoNFe ?? '' }}
                                </td>
                                <td>
                                    {{ $nf->cabec->nValorNFe ?? '' }}
                                </td>
                                <td>
                                    {{ $nf->itensRecebimento->cabec->cDescricaoProduto ?? '' }}
                                </td>                                     
                            </tr>
                           
                        @endforeach
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</body>

</html>
