<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreTransferenciaItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'codigo' => 'required|string|max:60',
            'quantidade' => 'required|numeric',
        ];
    }

    public function messages(): array
    {
        return [
            'codigo.required' => 'O código do produto é obrigatório.',
            'codigo.max' => 'O código do produto não pode ter mais de 60 caracteres.',
            'quantidade.required' => 'A quantidade é obrigatória.',
            'quantidade.numeric' => 'A quantidade deve ser um número.',
        ];
    }
}
