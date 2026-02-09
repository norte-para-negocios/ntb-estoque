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
    <div class="container">
        <h2 class="mb-4 text-center">
            Transferências: <small>{{ $loja->nome_fantasia ?? '' }}</small>
        </h2>
        <p class="mb-0">
            <span class="fw-bold">Data:</span>
            <span>{{ \Carbon\Carbon::parse($transferencia->data)->format('d/m/Y') }}</span>
        </p>
        <p class="mb-0">
            <span class="fw-bold">Estoque Origem:</span>
            <span>{{ $transferencia->localOrigem->codigo ?? '' }} -
                {{ $transferencia->localOrigem->descricao ?? '' }}</span>
        </p>
        <p class="mb-0">
            <span class="fw-bold">Estoque Destino:</span>
            <span>{{ $transferencia->localDestino->codigo ?? '' }} -
                {{ $transferencia->localDestino->descricao ?? '' }}</span>
        </p>
    </div>
    <div class="container" style="padding-top: 20px;">
        <div class="row">
            <div class="col-xs-12">
                <table class="table table-bordered table-condensed table-fixed">
                    <thead style="font-size: 9px; font-weight: 700;">
                        <tr>
                            <th>Cód.</th>
                            <th>Descrição do Produto</th>
                            <th>Unidade</th>
                            <th style="text-align: right;">Quantidade</th>
                            <th style="text-align: center;">Status</th>
                        </tr>
                    </thead>
                    <tbody style="font-size: 9px; font-weight: 500;">
                        @foreach($transferencia->movimentos as $movimento)
                            <tr>
                                <td style="width: 100px;">
                                    {{ $movimento->produto->codigo ?? '' }}
                                </td>
                                <td style="width: 700px;">
                                    {{ $movimento->produto->descricao ?? '' }}
                                </td>
                                <td style="width: 90px;">
                                    {{ $movimento->produto->unidade ?? '' }}
                                </td>
                                <td style="text-align: right; width: 120px;">
                                    {{ $movimento->quan ?? '-' }}
                                </td>
                                <td style="width: 120px; text-align: center;">
                                    {{ $movimento->status ?? 'N/A' }}
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