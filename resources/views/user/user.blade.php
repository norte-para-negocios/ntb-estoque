@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">{{ __('Novo Usuário') }}</h2>
        <form action="{{ $action == 'create' ? route('usuario.store') : route('usuario.update', $user->id) }}" method="POST">
            @csrf
            @if ($action == 'create')
                @method('POST')
            @else
                @method('PUT')
            @endif
            <div class="card pt-3 px-4">
                <div class="card-body">
                    <div class="mb-3">
                        <label for="name" class="form-label">Nome do Usuário</label>
                        <input type="text" class="form-control" id="name" name="name" placeholder="Nome do Usuário"
                            minlength="5" maxlength="255" required value="{{ $user->name }}">
                    </div>
                    <div class="mb-3">
                        <label for="email" class="form-label">E-mail</label>
                        <input type="email" class="form-control" id="email" name="email"
                            placeholder="name@example.com" minlength="10" maxlength="255" required value="{{ $user->email }}">
                    </div>
                </div>
                <div class="card-body d-flex justify-content-between">
                    <a href="{{ route('usuario.index') }}" class="btn btn-secondary">Cancelar</a>
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </div>
        </form>
    </div>
@endsection
