<!DOCTYPE html>
<html>

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
            justify-content: center;
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
            width: 1.3cm;
        }
    </style>
</head>

<body>
    @foreach ($dadosInfoSection as $info)
        {{-- @dd($info) --}}
        <div class="label-container">
            <div class="qrcode-section">
                {!! QrCode::size(80)->generate($info['nCodProduto']) !!}
                <div class="product-code">{{ $info['nCodProduto'] }}</div>
            </div>
            <div class="info-section">
                <div class="product-name">{{ substr($info['descricao'],0,20) }}</div>
                <div class="label-field"><strong>Lote:</strong> {{ $info['lote'] }}</div>
                {{-- <div class="label-field"><strong>Produto:</strong> {{ $info['nCodProduto'] }}</div> --}}
                <div class="label-field"><strong>Qtde:</strong> {{ $info['nQtde'] }} {{ $info['unidade'] }}</div>
                <div class="label-field"><strong>Validade:</strong> {{ $info['validade'] }}</div>
            </div>
        </div>
    @endforeach

</body>

</html>
