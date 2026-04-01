<?php

namespace Database\Factories;

use App\Models\Loja;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Loja>
 */
class LojaFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'cnpj' => fake()->numerify('##.###.###/####-##'),
            'nome' => fake()->company(),
            'nome_fantasia' => fake()->companySuffix().' '.fake()->word(),
            'omie_app_key' => fake()->numerify('################'),
            'omie_app_secret' => fake()->sha256(),
            'ativo' => true,
        ];
    }

    public function inativo(): static
    {
        return $this->state(fn (array $attributes) => [
            'ativo' => false,
        ]);
    }
}
