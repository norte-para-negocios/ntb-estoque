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
            padding: 0.1cm;
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
            font-size: 8pt;
            /* text-align: center; */
            margin-bottom: 0.2cm;
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
    @if (isset($recebimento) && !empty($recebimento))
        
        @foreach ($recebimento->itensRecebimento as $it)
            @if (($it->itensCabec->cCodigoProduto == $cCodigoProduto && $cCodigoProduto !== '') || $cCodigoProduto == '')
                <div class="label-container">
                    <div class="qrcode-section">
                        {!! QrCode::size(80)->generate($it->itensCabec->cCodigoProduto) !!}
                        <div class="product-code">{{ $it->itensCabec->cCodigoProduto }}</div>
                    </div>
                    <div class="info-section">
                        <tr>
                            <div class="product-name">{{ strtoupper($it->itensCabec->cDescricaoProduto ?? '') }}</div>
                            <div class="label-field"><strong>Produto:</strong>
                                {{ $it->itensCabec->cCodigoProduto ?? '' }}</div>
                            <div class="label-field"><strong>Lote:</strong> {{ $it->itensCabec->cNCM ?? '' }}</div>
                            <div class="label-field"><strong>Qtd:</strong> {{ $it->itensCabec->nQtdeNFe ?? '' }}
                                {{ strtoupper($it->itensCabec->cUnidadeNfe) }}</div>
                            <div class="label-field"><strong>Validade:</strong> {{ $it->itensCabec->nIdValidade ?? '' }}
                            </div>

                        </tr>
                    </div>
                </div>
            @endif
        @endforeach
    @endif
</body>

</html>
