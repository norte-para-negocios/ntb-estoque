<?php

namespace App\Enums;

enum MovimentoStatus: string
{
    case Iniciado = 'Iniciado';
    case Processando = 'Processando';
    case Concluido = 'Concluído';
    case Erro = 'Erro';
}
