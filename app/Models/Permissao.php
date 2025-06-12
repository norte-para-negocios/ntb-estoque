<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Permissao extends Model
{
    protected $fillable = [
        'nome'
    ];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->using(PermissaoUser::class)->withPivot('unidade_id');
    }
}
