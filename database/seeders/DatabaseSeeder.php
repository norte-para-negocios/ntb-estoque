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
            'nome' => 'JR SANTOS RESTAURANTES LTDA',
            'nome_fantasia' => 'DON ANA - BROTAS',

            'cep' => '40279090',
            'uf' => 'BA',
            'cidade' => 'SALVADOR',
            'bairro' => 'PARQUE BELA VISTA',
            'logradouro' => 'RUA TEIXEIRA DE BARROS',
            'numero' => 'SN',

            'omie_app_key' => '1299859033473',
            'omie_app_secret' => '98e0d98a2fe34c7e165cf68faa935a5e',
        ]);
    }
}
