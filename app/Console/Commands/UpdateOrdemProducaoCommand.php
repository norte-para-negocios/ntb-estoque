<?php

namespace App\Console\Commands;

use App\Models\Loja;
use App\Services\OrdemProducaoService;
use Illuminate\Console\Command;

class UpdateOrdemProducaoCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'omie:ordens-producao';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Atualiza base de dados de ordens de produção do Omie';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        foreach (Loja::all() as $loja) {
            $this->info("Atualizando ordens de produção para a loja: {$loja->nome}");
            (new OrdemProducaoService($loja))->fetchAll();
            $this->info("Ordens de produção atualizadas com sucesso para a loja: {$loja->nome}");
        }
    }
}
