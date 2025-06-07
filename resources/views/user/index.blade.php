@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">{{ __('Usuários') }}</h2>


        <div class="card card-body">
            <form id="filtrosForm" method="GET" action="{{ route('usuario.index') }}">
                <div class="row">
                    <div class="col-md-6 col-12">
                        <div class="row">
                            <div class="col-10">
                                <div class="mb-3">
                                    <input title="Digite um termo para pesquisar" type="text" class="form-control"
                                        id="search" name="search" value="{{ request('search') }}"
                                        placeholder="Pesquisar">
                                </div>
                            </div>
                            <div class="col-2">
                                <div class="mb-3">
                                    <button type="submit" class="btn btn-primary">
                                        <i class="fas fa-search"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6 col-12">
                        <div class="col-12 d-flex justify-content-end">
                            <a href="{{ route('usuario.create') }}" class="btn btn-primary">
                                <i class="fas fa-plus"></i> Novo usuário
                            </a>
                        </div>
                    </div>
                </div>
            </form>
        </div>

        <div class="card card-body mt-4">
            <div class="table-responsive">
                <table class="table table-hover" id="tableUsuarios" aria-hidden="true">
                    <thead>
                        <tr>
                            <th>Usuário</th>
                            <th>E-mail</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($usuarios as $usuario)
                            <tr>
                                <td>
                                    {{ $usuario->name }}
                                </td>
                                <td>
                                    {{ $usuario->email }}
                                </td>
                                <td>
                                    <a href="{{ route('usuario.edit', $usuario->id) }}" class="btn btn-secondary">
                                        <i class="fas fa-pencil"></i> Editar
                                    </a>
                                    <button onclick="deleteRegistro('{{ route('usuario.destroy', $usuario->id) }}')"
                                        class="btn btn-danger text-white">
                                        <i class="fas fa-trash"></i> Excluir
                                    </button>
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
        </div>
    </div>
@endsection
