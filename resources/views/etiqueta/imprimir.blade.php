<!DOCTYPE html>
<html lang="pt_BR">

<head>
    <meta charset="UTF-8">
    <title>Etiqueta de Produto</title>
    <style>
        * {
            font-family: 'Courier New', Courier, monospace;
            font-size: 10pt;
            color: #000000;
        }

        body {
            margin: 0;
            padding: 0;
            color: #000000;
        }

        .container {
            height: 4.34cm;
            border: 1px dashed #ccc;
            padding: 3mm;
            color: #000000;
        }

        table {
            width: 100%;
            color: #000000;
        }

        p {
            margin: 0;
            padding: 0;
            text-align: center;
            color: #000000;
        }

        td {
            border: 1px dashed #ccc;
            vertical-align: top;
            color: #000000;
        }

        tr {
            border: 1px dashed #ccc;
            color: #000000;
        }

        p {
            color: #000000;
        }
    </style>
</head>

<body>
    @foreach ($etiquetas as $etiqueta)
        <div class="container">
            <table aria-hidden="true">
                <tbody>
                    <tr>
                        <td colspan="2" style="margin:0 !important; padding: 0 !important;">
                            <p style="margin:0 !important; padding: 0 !important; text-align: left !important;">
                                {{ substr(trim($etiqueta['descricao']), 0, 38) }}
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="width: 30% !important; padding: 0 !important;">
                            <p style="margin-bottom: 0 !important; padding-bottom: 0 !important;">
                                {!! QrCode::size(100)->generate($etiqueta['codigo_produto']) !!}
                            </p>
                            <p style="font-size: 8pt !important; padding: 0 !important; margin: 0 !important; line-height: 8pt !important;">
                                {{ substr(trim($etiqueta['codigo_produto']), 0, 16) }}
                            </p>
                        </td>
                        <td style="width: 70%;">
                            @if ($etiqueta['fornecedor'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    {{ substr(trim($etiqueta['fornecedor']), 0, 25) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['nfe'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    NF: {{ substr(trim($etiqueta['nfe']), 0, 21) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['lote'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Lote: {{ substr(trim($etiqueta['lote']), 0, 19) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['quantidade'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Quant.: {{ substr(trim($etiqueta['quantidade']), 0, 17) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['qtde_nf'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Qt. NF: {{ substr(trim($etiqueta['qtde_nf']), 0, 17) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['qtde_etiqueta'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Qt. etiq.: {{ substr(trim($etiqueta['qtde_etiqueta']), 0, 14) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['inclusao'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Dt. receb: {{ substr(trim($etiqueta['inclusao']), 0, 14) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['produzido'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Fabricado: {{ substr(trim($etiqueta['produzido']), 0, 14) }}
                                </span><br>
                            @endif
                            @if ($etiqueta['validade'] !== '')
                                <span style="margin-bottom: 2mm !important;">
                                    Validade: {{ substr(trim($etiqueta['validade']), 0, 15) }}
                                </span><br>
                            @endif
                        </td>
                    </tr>
                    <tr>
                        <td colspan="2" style="vertical-align: bottom !important;">
                            <p style="font-size: 7pt !important; text-align: left !important;">CNPJ:{{ trim(Auth::user()->loja->cnpj) ?? '-' }}</p>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    @endforeach
</body>

</html>
