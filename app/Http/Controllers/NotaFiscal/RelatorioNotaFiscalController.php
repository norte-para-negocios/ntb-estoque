<?php

namespace App\Http\Controllers\NotaFiscal;

use App\Exports\RelatorioNotaFiscalExport;
use App\Http\Controllers\Controller;
use App\Services\CanService;
use App\Services\OmieService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use PDF;


class RelatorioNotaFiscalController extends Controller
{
   private $omie;

   public function __construct()

    {
        $this->middleware('auth');
        $this->omie = new OmieService();
    }

    public function index(Request $request)
    {
        if (!CanService::canPermissionLoja('Relatório - Ordens de Produção', Auth::user()->loja->id) && Auth::user()->perfil !== 'Admin') {
            abort(403, "Você não possui a permissão: Relatório - Ordens de Produção!");
        }

        return view('notafiscal.relatorio.index');
    }

    public function imprimir(Request $request)

    {
        $data_inicio = Carbon::parse($request->has('data_inicio') ? $request->get('data_inicio') : session('inicio'));
        $data_final = Carbon::parse($request->has('data_final') ? $request->get('data_final') : session('final'));
        session(['inicio' => $data_inicio->format('Y-m-d'), 'final' => $data_final->format('Y-m-d')]);

        // $data_inicio = Carbon::parse('2025-8-16');
        // $data_final = Carbon::parse('2025-8-16');

        $num_nfe = $request->get('num_nfe');

        $notasfiscais = [];
        $nfes = $this->omie->getNotasFiscais($data_inicio, $data_final);

         $pdf = PDF::loadView('notafiscal.relatorio.pdf', ['nfes' => $nfes, 'loja' => Auth::user()->loja, 'params' => $request->all()])
            ->setOption('enable-local-file-access', true);

        //dd($pdf);

        return $pdf->inline("relatorios-ordem-producao.pdf");



    }




}
