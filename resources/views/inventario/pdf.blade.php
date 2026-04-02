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
    <h2 class="mb-4">
        {{ 'Inventário: '.$inventario->id }} - <small>{{ $loja->nome_fantasia ?? '' }}</small>
    </h2>
    <p class="mb-0">
        <span class="fw-bold">Data:</span>
        <span>{{ $inventario->data->format('d/m/Y') }}</span>
        <br>
        <span class="fw-bold">Local de Estoque:</span>
        <span>{{ $inventario->localEstoque->codigo_local_estoque }} - {{ $inventario->localEstoque->descricao }}</span>
        <br>
        <span class="fw-bold">Tipo de Inventário:</span>
        <span>
            {{ \App\Helpers\Constants::TIPO_MOVIMENTO_INVENTARIO[$inventario->motivo] ?? 'Desconhecido' }}
        </span>
    </p>
</div>
<div class="container" style="padding-top: 20px;">
    <div class="row">
        <div class="col-xs-12">
            <table class="table table-bordered table-condensed table-fixed">
                <thead style="font-size: 9px; font-weight: 700;">
                <tr>
                    <th>Código do Produto</th>
                    <th>Descrição do Produto</th>
                    <th>Unidade</th>
                    <th style="text-align: right;">Quantidade</th>
                    <th style="text-align: center;">Status</th>
                </tr>
                </thead>
                <tbody style="font-size: 9px; font-weight: 500;">
                @foreach ($inventario->items()->where('quan', '>=', 0)->get() as $item)
                    <tr>
                        <td style="width: 100px;">
                            {{ $item->produto->codigo ?? '' }}
                        </td>
                        <td style="width: 800px;">
                            {{ $item->produto->descricao ?? '' }}
                        </td>
                        <td style="width: 100px;">
                            {{ $item->produto->unidade ?? '' }}
                        </td>
                        <td style="text-align: right; width: 160px;">
                            {{ number_format($item->quan, 2, ',', '.') }}
                        </td>
                        <td style="width: 120px; text-align: center;">
                            {{ $item->status?->value ?? 'N/A' }}
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
