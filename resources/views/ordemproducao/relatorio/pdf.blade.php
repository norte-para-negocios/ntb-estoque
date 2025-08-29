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
<h2 class="mb-4 text-center">{{ __('Ordens de Produção') }} - {{ $loja->nome_fantasia ?? '' }}</h2>
<div class="container" style="padding-top: 20px;">
    <div class="row">
        <div class="col-xs-12">
            <table class="table table-bordered table-condensed table-fixed">
                <thead style="font-size: 9px; font-weight: bold;">
                <tr>
                    <th class="col-especialidade">Conclusão</th>
                    <th class="col-especialidade">Cód Produto</th>
                    <th class="col-status">Descrição Produto</th>
                    <th class="col-servico">Número da OP</th>
                    <th class="col-data text-left">Und</th>
                    <th class="col-data text-left">Qtd Prevista</th>
                </tr>
                </thead>
                <tbody style="font-size: 9px; font-weight: regular;">
                @foreach ($ordensProducao as $ordem)
                    <tr>
                        <td>
                            {{ $ordem->identificacao_d_dt_previsao ? $ordem->identificacao_d_dt_previsao->format('d/m/Y') : '' }}
                        </td>
                        <td>
                            {{ $ordem->produto_codigo ?? '' }}
                        </td>
                        <td>
                            {{ $ordem->produto_descricao ?? '' }}
                        </td>
                        <td>
                            {{ $ordem->identificacao_c_num_op ?? '' }}
                        </td>
                        <td>
                            {{ $ordem->produto_unidade ?? '' }}
                        </td>
                        <td>
                            {{ $ordem->identificacao_n_qtde ?? '' }}
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
