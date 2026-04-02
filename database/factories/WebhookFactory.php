<?php

namespace Database\Factories;

use App\Models\Loja;
use App\Models\Webhook;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Webhook>
 */
class WebhookFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'loja_id' => Loja::factory(),
            'message_id' => fake()->uuid(),
            'message' => [
                'topic' => 'Produto.Incluido',
                'event' => ['codigo_produto' => fake()->randomNumber(5)],
            ],
        ];
    }
}
