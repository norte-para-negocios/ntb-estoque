<?php

namespace App\Enums;

enum SincronizacaoStatus: string
{
    case Processando = 'Processando';
    case Concluido = 'Concluído';
    case Erro = 'Erro';
}
