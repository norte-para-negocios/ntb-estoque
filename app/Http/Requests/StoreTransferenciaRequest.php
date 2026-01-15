<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreTransferenciaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'codigo_local_origem' => 'required|integer',
            'codigo_local_destino' => 'required|integer',
            'data' => 'required|date',
            'motivo' => 'required|string|max:3|in:'.implode(',', array_keys(\App\Helpers\Constants::TIPO_MOVIMENTO_TRANSFERENCIA)),
        ];
    }

    public function messages(): array
    {
        return [
            'codigo_local_origem.required' => 'O código do local de origem é obrigatório.',
            'codigo_local_origem.integer' => 'O código do local de origem deve ser um número inteiro.',
            'codigo_local_destino.required' => 'O código do local de destino é obrigatório.',
            'codigo_local_destino.integer' => 'O código do local de destino deve ser um número inteiro.',
            'data.required' => 'A data é obrigatória.',
            'data.date' => 'A data deve ser uma data válida.',
            'motivo.required' => 'O motivo é obrigatório.',
            'motivo.in' => 'O motivo selecionado é inválido.',
        ];
    }
}
