<?php

namespace App\Enums;

enum InventarioItemStatus: string
{
    case Iniciado = 'Iniciado';
    case Concluido = 'Concluído';
    case Erro = 'Erro';
    case SemCmc = 'Sem CMC';
}
