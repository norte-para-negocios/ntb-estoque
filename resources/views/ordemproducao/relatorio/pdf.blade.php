<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="utf-8">
    <meta content="width=device-width, initial-scale=1.0" name="viewport">
    <meta content="ie=edge" http-equiv="X-UA-Compatible">
    <title>Scales</title>
    <link rel="stylesheet" href="{{ asset('vendor/bootstrap3-3-7.min.css') }}">
    <style>
        .table-fixed {
            table-layout: fixed;
            width: 100%;
        }

        .col-servico {
            width: 200px;
        }

        .col-especialidade {
            width: 180px;
        }

        .col-status {
            width: 80px;
        }

        .col-data {
            width: 80px;
        }

        .col-carga {
            width: 60px;
        }

        .col-honorario {
            width: 100px;
        }

        .col-observacao {
            width: 150px;
        }

        /* Permitir quebra de linha em todas as células */
        .table-fixed td,
        .table-fixed th {
            white-space: normal;
            word-wrap: break-word;
            word-break: break-word;
            vertical-align: top;
        }

        /* Manter alinhamento à direita para valores numéricos */
        .text-right {
            text-align: right;
        }

        /* Altura mínima para as células */
        .table-fixed td {
            min-height: 20px;
        }
    </style>
</head>

<body>
    <div class="container" style="padding-top: 20px;">
        <div class="row">
            <div class="col-xs-12">
                <table class="table table-bordered table-condensed table-fixed">
                    <thead style="font-size: 9px; font-weight: bold;">
                        <tr>
                            <th class="col-servico">Loja</th>
                            <th class="col-especialidade">Ordem de Produção</th>
                            <th class="col-status">Conclusão</th>
                            <th class="col-data text-left">Produto</th>
                        </tr>
                    </thead>
                    <tbody style="font-size: 9px; font-weight: regular;">
                        @foreach ($ordenspro as $ordem)
                            <tr>
                                <td>
                                    {{ $loja->nome }}
                                </td>
                                <td>
                                    {{ $loja->num_ordem }}
                                </td>
                                <td>
                                    {{ $loja->adicionais_d_dt_conclucao ?? '' }}
                                </td>
                                <td>
                                    {{ $loja->produto_descricao }}
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
