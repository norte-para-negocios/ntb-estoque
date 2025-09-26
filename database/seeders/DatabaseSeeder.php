<?php

namespace Database\Seeders;

use App\Models\Loja;
use App\Models\User;
// use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::create([
            'name' => 'Rodolfo Melo',
            'email' => 'rmelo@bahiash.com.br',
            'password' => 'Omie@2025**',
            'perfil' => 'Admin',
        ]);

        Loja::create([
            'cnpj' => '13.228.344/0001-02',
            'nome' => 'BAHIA SOFTWARE HOUSE TECNOLOGIA EM INFORMACAO LTDA',
            'nome_fantasia' => 'BAHIASH',

            'cep' => '41820022',
            'uf' => 'BA',
            'cidade' => 'SALVADOR',
            'bairro' => 'CAMINHO DAS ÁRVORES',
            'logradouro' => 'RUA EWERTON VISCO',
            'numero' => '290',

            'omie_app_key' => '6657964342029',
            'omie_app_secret' => 'fc7627f5617b0963448f79e88ba53829',
        ]);
    }
}
