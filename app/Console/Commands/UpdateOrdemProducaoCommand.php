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
    protected $signature = 'omie:ordem_producao_update';

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
        foreach (Loja::where('ativo', true)->get() as $loja) {
            $this->info("Atualizando ordens de produção da loja: {$loja->nome}");
            (new OrdemProducaoService($loja))->fetchAll();
            $this->info("Ordens de produção da loja: {$loja->nome}, atualizadas com sucesso!");
        }
    }
}
