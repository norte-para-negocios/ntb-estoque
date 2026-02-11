<!DOCTYPE html>
<html lang="pt_BR">

<head>
    <meta charset="UTF-8">
    <title>Etiqueta de Produto</title>
    <style>
        * {
            font-family: 'Inter', sans-serif;
            font-size: 10px;
            color: #000000;
        }

        body {
            margin: 0;
            padding: 0;
            color: #000000;
        }

        .container {
            height: 4.34cm;
            padding: 3mm;
            color: #000000;
            page-break-after: always;
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
            vertical-align: top;
            color: #000000;
        }

        tr {
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
                        <td style="margin:0 !important; padding: 0 !important; width: 70%;">
                            <table>
                                <tbody>
                                    <tr>
                                        <td colspan="3">
                                            <p
                                                style="margin:0 0 10px 0 !important; padding: 0 !important; text-align: left !important; font-weight: bold; font-size: 11px;">
                                                {{ substr(trim($etiqueta['descricao']), 0, 38) }}
                                            </p>
                                        </td>
                                    </tr>

                                    @if (($etiqueta['produzido'] !== '') && ($etiqueta['validade'] !== ''))
                                        <tr style="padding-bottom: 10px;">
                                            <td style="padding: 0 0 10px 0; width: 30%">
                                                Fabricação:<br>
                                                <span style="font-size: 11px; font-weight: bold;">
                                                    {{trim($etiqueta['produzido'])}}
                                                </span>
                                            </td>

                                            <td style="padding-bottom: 10px; width: 30%;">
                                                Validade:<br>
                                                <span
                                                    style="font-size: 11px; font-weight: bold;">{{ substr(trim($etiqueta['validade']), 0, 10) }}</span>
                                            </td>

                                            <td style="padding-bottom: 10px; width: 40%;">
                                                @if(($etiqueta['qtde_etiqueta'] !== '') && ($etiqueta['qtde_nf'] === ''))
                                                    Qtde Etiqueta:<br>
                                                    <span style="font-size: 11px; font-weight: bold;">
                                                        {{ substr(trim($etiqueta['qtde_etiqueta']), 0, 15) }}
                                                    </span>
                                                @endif
                                            </td>
                                        </tr>
                                    @endif

                                    @if (($etiqueta['qtde_nf'] !== '') && ($etiqueta['qtde_etiqueta'] !== ''))
                                        <tr>
                                            <td style="padding-bottom: 10px; width: 50%;">
                                                Qtde NF<br>
                                                <span style="font-size: 11px; font-weight: bold;">
                                                    {{ substr(trim($etiqueta['qtde_nf']), 0, 17) }}
                                                </span>
                                            </td>
                                            <td colspan="2" style="padding-bottom: 10px; width: 50%;">
                                                Qtde Etiqueta<br>
                                                <span style="font-size: 11px; font-weight: bold;">
                                                    {{substr(trim($etiqueta['qtde_etiqueta']), 0, 17)}}
                                                </span>
                                            </td>
                                        </tr>
                                    @endif

                                    <tr>
                                        <td style="padding-bottom: 10px; width: 50%;" colspan="2">
                                            Produto:{{ substr(trim($etiqueta['codigo_produto']), 0, 6) }}
                                        </td>

                                        <td style="padding-bottom: 10px; width: 50%;">
                                            @if($etiqueta['quantidade'] !== "")
                                                {{ substr(trim($etiqueta['quantidade']), 0, 14) }}
                                            @endif
                                        </td>
                                    </tr>

                                    <tr>
                                        <td colspan="3">
                                            @if ($etiqueta['lote'] !== '')
                                                <p style="text-align: left; margin-bottom: 4px;">
                                                    Lote: {{ substr(trim($etiqueta['lote']), 0, 22) }}
                                                </p>
                                            @endif

                                            @if ($etiqueta['inclusao'] !== '')
                                                <p style="text-align: left; margin-bottom: 4px;">
                                                    Recebido em: {{ substr(trim($etiqueta['inclusao']), 0, 10) }}
                                                </p>
                                            @endif

                                            @if ($etiqueta['fornecedor'] !== '')
                                                <p style="text-align: left; margin-bottom: 4px;">
                                                    {{ substr(trim($etiqueta['fornecedor']), 0, 28) }}
                                                </p>
                                            @endif

                                            CNPJ:{{ trim(Auth::user()->loja->cnpj) ?? '-' }}
                                        </td>
                                    </tr>

                                </tbody>
                            </table>
                        </td>

                        <td>
                            <p style="margin-bottom: 16px !important; padding-bottom: 0 !important;">
                                {{--QRCODE--}}
                                {!! QrCode::size(100)->generate($etiqueta['codigo_produto']) !!}
                            </p>
                            <p style="text-align: right;">
                                {{--MARCA--}}
                                <img src="{{asset('images/ntb.png')}}" alt="NTB" style="height: 28px; width: auto;">
                            </p>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    @endforeach
</body>

</html>