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
        font-family: 'Courier New', sans-serif;
        width: 7cm;
        height: 4cm;
        box-sizing: border-box;
        font-size: 7pt;
        line-height: 1.2;
    }

    .label-container {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 100%;
        border: 1px dashed #ccc;
        box-sizing: border-box;
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
        font-size: 7pt;
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
        width: 100%;
        height: 100%;
        border: 1px dashed #ccc;
        box-sizing: border-box;
        table-layout: fixed;
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

</html>
