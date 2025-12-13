@extends('layouts.app')

@section('content')
    <div class="container">

        <p class="mb-4 fw-semibold d-flex align-items-center justify-content-between">
            <span>
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                    <img src="{{asset('images/voltar.png')}}" alt="<-">
                </a>
                <img class="ms-0 p-0" src="{{asset('images/usuario.png')}}" alt="Usuários">
            {{ __('Usuários') }}
            </span>
            <a href="{{ route('usuario.create') }}" class="btn btn-success text-dark-emphasis">
                <i class="fas fa-plus"></i> Novo usuário
            </a>
        </p>

        <form id="filtrosForm" method="GET" action="{{ route('usuario.index') }}">
            <div class="card card-body">
                <div class="row">
                    <div class="col-9 col-md-4 py-0 px-1">
                        <input type="text" class="form-control" name="search" value="{{ request('search') }}"
                               placeholder="Pesquisar">
                    </div>
                    <div class="col-3 py-0 px-1">
                        <button type="submit" class="btn btn-success">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </div>
            </div>
        </form>

        <div class="card card-body mt-4">
            <table class="table table-striped" id="tableUsuarios" aria-hidden="true">
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
                                        <i class="fas fa-pencil text-white"></i>
                                    </a>
                                    <button onclick="deleteRegistro('{{ route('usuario.destroy', $usuario->id) }}')"
                                            class="btn btn-danger text-white m-1">
                                        <i class="fas fa-trash text-white"></i>
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

@push('css')
    <style>
        body {
            background-color: #F4F4F4;
        }
    </style>
@endpush
