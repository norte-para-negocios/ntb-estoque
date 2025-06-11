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
                            <span style="margin-bottom: 2mm;">
                                Lote: {{ substr(trim($etiqueta['lote']), 0, 19) }}
                            </span>
                            <br>
                            <span style="margin-bottom: 2mm;">
                                Quantidade: {{ substr(trim($etiqueta['quantidade']), 0, 13) }}
                            </span>
                            <br>
                            <span style="margin-bottom: 2mm;">
                                Validade: {{ substr(trim($etiqueta['validade']), 0, 15) }}
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td colspan="2" style="vertical-align: bottom;">
                            <small>CNPJ:{{ Auth::user()->loja->cnpj ?? '-' }}</small>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    @endforeach
</body>

</html>







{{--

<!DOCTYPE html>
<html lang="pt_BR">

<head>
    <meta charset="UTF-8">
    <title>Etiqueta de Produto</title>
    <style>
        @page {
            margin: 0;
            padding: 5mm;
            size: 7cm 4cm;
            width: 100%;
            height: 100%;
        }

        body {
            margin: 0;
            font-family: 'Courier New', sans-serif;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            font-size: 7pt;
            line-height: 1.2;
        }

        .qrcode-section {
            width: 30%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 0.1cm;
            box-sizing: border-box;
        }

        .qrcode-section img {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
        }

        .info-section {
            width: 70%;
            padding: 0.15cm;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            box-sizing: border-box;
            overflow: hidden;
        }

        .product-name {
            font-weight: bold;
            font-size: 9pt;
            margin: 0 0 0.15cm 0;
            line-height: 1.1;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }

        .product-code {
            font-size: 7pt;
            margin: 0 0 0.15cm 0;
            word-break: break-all;
            line-height: 1.1;
        }

        .label-field {
            margin-bottom: 0.1cm;
            margin: 0 0 0.1cm 0;
            font-size: 9pt;
            line-height: 1.1;
            word-wrap: break-word;
        }

        .label-field strong {
            display: inline-block;
            min-width: 1.2cm;
            font-weight: bold;
        }

        /* Alternativa usando CSS Grid (mais compatível com PDF) */
        .label-container-grid {
            display: grid;
            grid-template-columns: 30% 70%;
            width: 100%;
            height: 100%;
            border: 1px dashed #ccc;
            box-sizing: border-box;
        }

        /* Alternativa usando Table Layout (máxima compatibilidade) */
        .label-container-table {
            display: table;
            size: 7cm 4cm;
            border: 1px dashed #ccc;
            box-sizing: border-box;
            table-layout: fixed;
            background-color: darkorange;
        }

        .qrcode-section-table {
            display: table-cell;
            width: 30%;
            text-align: center;
            vertical-align: middle;
            padding: 0.1cm;
            box-sizing: border-box;
        }

        .info-section-table {
            display: table-cell;
            width: 70%;
            vertical-align: top;
            padding: 0.15cm;
            align-items: left;
            box-sizing: border-box;
        }
    </style>
</head>

<body>
    @foreach ($etiquetas as $etiqueta)
        <div class="label-container-table">
            <div style="padding-top: 0.3cm; padding-left: 0.2cm; font-size: 8pt;">
                <div class="product-name">{{ substr($etiqueta['descricao'], 0, 42) }}</div>
            </div>

            <div style="display: flex; padding-left: 0.2cm;">
                <div class="qrcode-section-table">
                    {!! QrCode::size(110)->generate($etiqueta['codigo_produto']) !!}
                </div>
                <div class="info-section-table">
                    <div class="label-field"><strong>Código:</strong><br>{{ trim($etiqueta['codigo_produto']) }}</div>
                    <div class="label-field"><strong>Lote:</strong><br> {{ trim($etiqueta['lote']) }}</div>
                    <div class="label-field"><strong>Quant.:</strong><br> {{ trim($etiqueta['quantidade']) }}</div>
                    <div class="label-field"><strong>Validade:</strong><br> {{ trim($etiqueta['validade']) }}</div>
                </div>
            </div>
        </div>
    @endforeach
</body>

</html> --}}
