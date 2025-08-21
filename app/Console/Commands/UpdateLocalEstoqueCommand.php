<?php

namespace App\Console\Commands;

use App\Models\Loja;
use App\Services\LocalEstoqueService;
use Illuminate\Console\Command;

class UpdateLocalEstoqueCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'omie:local_estoque_update';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Atualiza base de dados de locais de estoque do Omie';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        foreach (Loja::all() as $loja) {
            $this->info("Atualizando locais de estoque da loja: {$loja->nome}");
            (new LocalEstoqueService($loja))->fetchAll();
            $this->info("Locais de estoque da loja {$loja->nome}, atualizados com sucesso!");
        }
    }
}
