<!DOCTYPE html>
<html lang="pt_BR">

<head>
    <meta charset="UTF-8">
    <title>Etiqueta de Produto</title>
    <style>
        * {
            font-family: 'Courier New', Courier, monospace;
            font-size: 10pt;
        }

        body {
            margin: 0;
            padding: 0;
        }

        .container {
            height: 4.36cm;
            border: 1px dashed #ccc;
            padding: 3mm;
        }

        table {
            width: 100%;
        }

        .product {
            /* margin-top: 2mm; */
            /* font-size: 10pt; */
        }

        p {
            margin: 0;
            padding: 0;
            text-align: center;
        }

        td {
            border: 1px dashed #ccc;
            vertical-align: top;
        }

        tr {
            border: 1px dashed #ccc;
        }
    </style>
</head>

<body>
    @foreach ($etiquetas as $etiqueta)
        @for ($x = 0; $x <= $etiqueta['quantidade']; $x++)
            <div class="container">
                <table aria-hidden="true">
                    <tbody>
                        <tr>
                            <td colspan="2" style="margin:0; padding: 0;">
                                <div class="product">
                                    {{ substr($etiqueta['descricao'], 0, 38) }}
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td style="width: 30%; padding: 0;">
                                <p style="margin-bottom: 0; padding-bottom: 0;">
                                    {!! QrCode::size(102)->generate($etiqueta['codigo_produto']) !!}
                                </p>
                                <p style="font-size: 8pt; padding: 0; margin: 0; line-height: 8pt;">
                                    {{ substr(trim($etiqueta['codigo_produto']), 0, 16) }}
                                </p>
                            </td>
                            <td style="width: 70%;">
                                @if ($etiqueta['fornecedor'] !== '')
                                    <span style="margin-bottom: 2mm;">
                                        {{ substr(trim($etiqueta['fornecedor']), 0, 25) }}
                                    </span><br>
                                @endif
                                @if ($etiqueta['nfe'] !== '')
                                    <span style="margin-bottom: 2mm;">
                                        NF: {{ substr(trim($etiqueta['nfe']), 0, 21) }}
                                    </span><br>
                                @endif
                                @if ($etiqueta['lote'] !== '')
                                    <span style="margin-bottom: 2mm;">
                                        Lote: {{ substr(trim($etiqueta['lote']), 0, 19) }}
                                    </span><br>
                                @endif
                                @if ($etiqueta['quantidade'] !== '')
                                    <span style="margin-bottom: 2mm;">
                                        Quant.: {{ substr(trim($etiqueta['quantidade']), 0, 17) }}
                                    </span><br>
                                @endif
                                @if ($etiqueta['validade'] !== '')
                                    <span style="margin-bottom: 2mm;">
                                        Validade: {{ substr(trim($etiqueta['validade']), 0, 15) }}
                                    </span><br>
                                @endif
                            </td>
                        </tr>
                        <tr>
                            <td colspan="2" style="vertical-align: bottom;">
                                <small>CNPJ:{{ trim(Auth::user()->loja->cnpj) ?? '-' }}</small>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        @endfor
    @endforeach
</body>

</html>
