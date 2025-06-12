<?php

namespace Database\Seeders;

use App\Helpers\Constants;
use App\Models\Permissao;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class PermissaoSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        foreach (Constants::PERMISSOES as $permissao) {
            Permissao::firstOrCreate(['nome' => $permissao]);
        }
    }
}
