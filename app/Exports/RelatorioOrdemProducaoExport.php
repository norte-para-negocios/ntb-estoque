<?php

namespace App\Exports;

use Illuminate\Contracts\View\View;
use Maatwebsite\Excel\Concerns\FromView;

class RelatorioOrdemProducaoExport implements FromView
{
    public function __construct(protected $ordenspro, protected $loja, protected $params) {}

    public function view(): View
    {
        return view('ordemproducao.relatorio.csv', [
            'ordenspro' => $this->ordenspro,
            'loja' => $this->loja,
            'params' => $this->params,
        ]);
    }
}
