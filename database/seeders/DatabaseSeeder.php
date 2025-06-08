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
        ]);

        Loja::create([
            'cnpj' => '13.228.344/0001-02',
            'nome' => 'RODOLFO NEVES MELO ',
            'nome_fantasia' => 'BAHIA|SH',

            'cep' => '41500300',
            'uf' => 'BA',
            'cidade' => 'SALVADOR',
            'bairro' => 'SÃO CRISTÓVÃO',
            'logradouro' => 'AV SÃO CRISTÓVÃO',
            'numero' => '13223',

            'omie_app_key' => '6180392819601',
            'omie_app_secret' => '261e1daeb9359fc19e648af88651d01f',
        ]);
    }
}
