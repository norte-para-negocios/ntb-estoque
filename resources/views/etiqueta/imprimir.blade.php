<!DOCTYPE html>
<html  lang="pt_BR">

<head>
    <meta charset="UTF-8">
    <title>Etiqueta de Produto</title>
    <style>
        @page {
            margin: 0;
            padding: 0;
            size: 7cm 4cm;
        }

        body {
            margin: 0;
            /* padding: 0.1cm; */
            font-family: 'Courier New', sans-serif;
            width: 7cm;
            height: 4cm;
            box-sizing: border-box;
            font-size: 7pt;
        }

        .label-container {
            display: flex;
            flex-flow: column;
            width: 100%;
            height: 100%;
            border: 1px dashed #ccc;
            /* Apenas para visualização */
        }

        .qrcode-section {
            width: 30%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 0.1cm;
        }

        .info-section {
            display: flex;
            width: 70%;
            padding: 0.2cm;
            justify-content: start;
            align-items: left;
            flex-direction: column;

        }

        .product-name {
            font-weight: bold;
            font-size: 7pt;
            /* text-align: center; */
            margin-bottom: 0.2cm;
            margin-left: 0;
            margin-right: 0;

        }

        .product-code {
            font-size: 7pt;
            text-align: center;
            margin-bottom: 0.2cm;
            word-break: break-all;
        }

        .label-field {
            margin-bottom: 0.1cm;
        }

        /* Espaçamento das infomações */
        .label-field strong {
            display: inline-block;
            /* width: 1.3cm; */
        }
    </style>
</head>

<body>
    @foreach ($etiquetas as $etiqueta)
        <div class="label-container">
            <div style="padding-top: 0.3cm; padding-left: 0.2cm; font-size: 8pt;">
                <div class="product-name">{{ substr($etiqueta['descricao'], 0, 42) }}</div>
            </div>

            <div style="display: flex; padding-left: 0.2cm;">
                <div class="qrcode-section">
                    {!! QrCode::size(90)->generate($etiqueta['codigo_produto']) !!}
                </div>
                <div class="info-section">
                    <div class="label-field"><strong>Código:</strong>{{ trim($etiqueta['codigo_produto']) }}</div>
                    <div class="label-field"><strong>Lote:</strong> {{ trim($etiqueta['lote']) }}</div>
                    <div class="label-field"><strong>Quant.:</strong> {{ trim($etiqueta['quantidade']) }}</div>
                    <div class="label-field"><strong>Validade:</strong> {{ trim($etiqueta['validade']) }}</div>
                </div>
            </div>
        </div>
    @endforeach
</body>

</html>
