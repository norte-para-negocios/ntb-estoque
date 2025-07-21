<?php

namespace App\Helpers;

class Constants
{
    const UF = [
        'BA' => 'BAHIA',
        'AC' => 'ACRE',
        'AL' => 'ALAGOAS',
        'AP' => 'AMAPÁ',
        'AM' => 'AMAZONAS',
        'CE' => 'CEARÁ',
        'DF' => 'DISTRITO FEDERAL',
        'ES' => 'ESPÍRITO SANTO',
        'GO' => 'GOIÁS',
        'MA' => 'MARANHÃO',
        'MT' => 'MATO GROSSO',
        'MS' => 'MATO GROSSO DO SUL',
        'MG' => 'MINAS GERAIS',
        'PA' => 'PARÁ',
        'PB' => 'PARAÍBA',
        'PR' => 'PARANÁ',
        'PE' => 'PERNAMBUCO',
        'PI' => 'PIAUÍ',
        'RJ' => 'RIO DE JANEIRO',
        'RN' => 'RIO GRANDE DO NORTE',
        'RS' => 'RIO GRANDE DO SUL',
        'RO' => 'RONDÔNIA',
        'RR' => 'RORAIMA',
        'SC' => 'SANTA CATARINA',
        'SP' => 'SÃO PAULO',
        'SE' => 'SERGIPE',
        'TO' => 'TOCANTINS',
    ];

    const MES = [
        "1" => "Janeiro",
        "2" => "Fevereiro",
        "3" => "Março",
        "4" => "Abril",
        "5" => "Maio",
        "6" => "Junho",
        "7" => "Julho",
        "8" => "Agosto",
        "9" => "setembro",
        "10" => "Outubro",
        "11" => "Novembro",
        "12" => "Dezembro",
    ];

    const PRODUTO_TIPO_ITEM = [
        "00" => "Mercadoria para Revenda",
        "01" => "Matéria Prima",
        "02" => "Embalagem",
        "03" => "Produto em Processo",
        "04" => "Produto Acabado",
        "05" => "Subproduto",
        "06" => "Produto Intermediário",
        "07" => "Material de Uso e Consumo",
        "08" => "Ativo Imobilizado",
        "09" => "Serviços",
        "10" => "Outros Insumos",
        "99" => "Outras",
    ];

    const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

    const DATE_FORMAT_PT_BR = 'd/m/Y';
    const DATE_FORMAT_YMD = 'Ymd';

    const PERMISSOES = [
        "Notas Fiscais",
        "Ordens de Produção",
        "Inventário",
        "Transferência",
    ];

    const TIPO_MOVIMENTO_TRANSFERENCIA = [
        "TRF" => "Transferência entre Locais de Estoque",
        "TPQ" => "Transferência por Perda ou Quebra"
    ];

    const TIPO_MOVIMENTO_INVENTARIO = [
        "INV" => "Ajuste por Inventário",
        "INI" => "Ajuste por Inventário (Estoque Inicial)",
        // "CMC" => "Ajuste do Valor do CMC",
        // "PDV" => "Integração com PDV"
    ];
}
