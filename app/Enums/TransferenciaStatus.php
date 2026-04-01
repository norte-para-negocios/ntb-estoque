<?php

namespace App\Enums;

enum TransferenciaStatus: string
{
    case Processando = 'Processando';
    case EmContagem = 'Em contagem';
    case ProcessandoNoOmie = 'Processando no Omie';
    case Concluido = 'Concluído';
}
