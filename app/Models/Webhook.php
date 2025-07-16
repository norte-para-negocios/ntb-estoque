<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;

class Webhook extends Model
{
    protected $fillable = [
        'loja_id',
        'message_id',
        'message',
    ];

    protected function casts(): array
    {
        return [
            'message' => 'json:unicode',
        ];
    }

    public function loja()
    {
        return $this->belongsTo(Loja::class);
    }
}
