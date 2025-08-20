@extends('layouts.app')

@section('content')
    <div class="container">

        <h2 class="mb-4 d-flex justify-content-between align-items-center">
            <span>
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
            {{ __('Usuários') }}
            </span>
            <a href="{{ route('usuario.create') }}" class="btn btn-primary">
                <i class="fas fa-plus"></i> Novo usuário
            </a>
        </h2>

        <form id="filtrosForm" method="GET" action="{{ route('usuario.index') }}">
            <div class="card card-body">
                <div class="row">
                    <div class="col-9 col-md-4 py-0 px-1">
                        <input type="text" class="form-control" name="search" value="{{ request('search') }}"
                               placeholder="Pesquisar">
                    </div>
                    <div class="col-3 py-0 px-1">
                        <button type="submit" class="btn btn-primary">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </div>
            </div>
        </form>

        <div class="card card-body mt-4">
            <table class="table table-hover" id="tableUsuarios" aria-hidden="true">
                <thead>
                <tr>
                    <th style="width: 80%;">Usuário</th>
                    <th style="width: 20%;">Ações</th>
                </tr>
                </thead>
                <tbody>
                @foreach ($usuarios as $usuario)
                    <tr>
                        <td>
                            <p class="d-flex align-items-center">
                                {{ $usuario->name }}<br>
                                {{ $usuario->email }}
                            </p>
                        </td>
                        <td>
                            <div class="row">
                                <div class="col">
                                    <a href="{{ route('usuario.edit', $usuario->id) }}" class="btn btn-secondary m-1">
                                        <i class="fas fa-pencil"></i>
                                    </a>
                                    <button onclick="deleteRegistro('{{ route('usuario.destroy', $usuario->id) }}')"
                                            class="btn btn-danger text-white m-1">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        </div>
    </div>
@endsection
