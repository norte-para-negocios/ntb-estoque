<?php

namespace App\Http\Controllers;

use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;

class NotafiscalController extends Controller
{
    public function index(Request $request)
    {
        $omie = new OmieService();

        $dtInicio = Carbon::parse($request->get('data_inicio'));
        $dtFinal = Carbon::parse($request->get('data_final'));
        $chaveNfe = $request->get('chave_nfe');

        $notasfiscais = $omie->getNotasFiscais($dtInicio, $dtFinal);

        dd($notasfiscais);

        if (isset($ossRequest->registros) && $ossRequest->registros > 0) {
            for ($i = 1; $i <= $ossRequest->total_de_paginas; $i++) {
                if ($i == 1) {
                    $this->setOSs($ossRequest);
                } else {
                    $this->setOSs($this->omie->getOSs($i));
                }
            }
        }

        // Pesquisar email de Maria
        foreach ($notasfiscais as $pessoa) {
            if ($pessoa->nome === 'Maria') {
                echo $pessoa->contatos->email; // Output: maria@exemplo.com
            }
        }

        if (is_null($chaveNfe)) {
            /**
             * 1. Pegar recebimento Filtrar na objeto $$notasfiscais por recebimentos->cabec->cNumeroNFe.
             * 2. Achei o recebimento 1 único recebimento então retornar para tela que detalhe o Recebimento listando os produtos do mesmo.
             * 3. Senão retornar com apenas os recebimentos que possuem o número de nota fiscal pesquisado.
             **/

        }
        return view('notafiscal.index', compact('notasfiscais'));
    }
}
