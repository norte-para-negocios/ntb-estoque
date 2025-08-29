<?php

namespace App\Console\Commands;

use App\Models\Loja;
use App\Services\ProdutoService;
use Illuminate\Console\Command;

class UpdateProdutoCommand extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'omie:produto_update';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Atualiza base de dados de produtos do Omie';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        foreach (Loja::where('ativo', true)->get() as $loja) {
            $this->info("Atualizando produtos da loja: {$loja->nome_fantasia}");
            (new ProdutoService($loja))->fetchAll();
            $this->info("Produtos da loja: {$loja->nome_fantasia}, atualizados com sucesso!");
        }
    }
}
