<?php

namespace App\Console\Commands;

use App\Models\Loja;
use App\Services\NotaFiscalService;
use Carbon\Carbon;
use Illuminate\Console\Command;

class UpdateNotaFiscalCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'omie:nota_fiscal_update';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Atualiza base de dados de notas discais do Omie';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        foreach (Loja::where('ativo', true)->get() as $loja) {
            $inicio = Carbon::now();
            $this->info("Notas fiscais da loja: {$loja->nome_fantasia} - " . $inicio->format('d/m/Y H:i:s'));
            (new NotaFiscalService($loja))->fetchAll();
            $final = Carbon::now();
            $this->info("Final: " . $final->format('d/m/Y H:i:s') . " - " . "Tempo total: " . $inicio->diffInMinutes($final));
            $this->info("");
        }
    }
}
