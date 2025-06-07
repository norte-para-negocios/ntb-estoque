@extends('layouts.app')

@section('content')
    <div class="container">
        <div class="card p-3">
            <form action="{{ $action == 'create' ? route('usuario.store') : route('usuario.update', $user->id) }}"
                method="POST">
                <div class="card-header">
                    <h2>{{ __('Novo Usuário') }}</h2>
                </div>

                <div class="card-body">
                    @csrf
                    @if ($action == 'create')
                        @method('POST')
                    @else
                        @method('PUT')
                    @endif
                    <div class="mb-3">
                        <label for="name" class="form-label">Nome do Usuário</label>
                        <input type="text" class="form-control" id="name" name="name"
                            placeholder="Nome do Usuário" minlength="5" maxlength="255" required
                            value="{{ $user->name }}">
                    </div>
                    <div>
                        <label for="email" class="form-label">E-mail</label>
                        <input type="email" class="form-control" id="email" name="email"
                            placeholder="name@example.com" minlength="10" maxlength="255" required
                            value="{{ $user->email }}">
                    </div>
                </div>

                <div class="card-body">
                    <h4>LOJAS</h4>
                    <ul class="list-group">
                        @foreach (\App\Models\Loja::orderBy('nome_fantasia')->get() as $loja)
                            <li class="list-group-item d-flex justify-content-start align-items-center">
                                <span class="w-25">
                                    {{ $loja->nome_fantasia }}
                                </span>
                                <span>
                                    <div class="form-check form-switch py-2">
                                        <input class="form-check-input" type="checkbox" id="loja-{{ $loja->id }}"
                                            name="lojas[]" value="{{ $loja->id }}"
                                            @if ($user->lojas->contains($loja->id)) checked @endif>
                                    </div>
                                </span>
                            </li>
                        @endforeach
                    </ul>
                </div>

                <div class="card-footer d-flex justify-content-between">
                    <a href="{{ route('usuario.index') }}" class="btn btn-secondary">Cancelar</a>
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </form>
        </div>
    </div>
@endsection
