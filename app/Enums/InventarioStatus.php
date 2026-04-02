<?php

namespace App\Enums;

enum InventarioStatus: string
{
    case EmContagem = 'Em contagem';
    case ProcessandoNoOmie = 'Processando no Omie';
    case Finalizado = 'Finalizado';
}
