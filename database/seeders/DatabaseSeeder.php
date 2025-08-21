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
            'nome' => 'RODOLFO NEVES MELO',
            'nome_fantasia' => 'BAHIA|SH',

            'cep' => '41500300',
            'uf' => 'BA',
            'cidade' => 'SALVADOR',
            'bairro' => 'SÃO CRISTÓVÃO',
            'logradouro' => 'AV SÃO CRISTÓVÃO',
            'numero' => '13223',

            'omie_app_key' => '6482942183718',
            'omie_app_secret' => 'dd771bab663d33b8151f4556f0a06e8f',
        ]);
    }
}
