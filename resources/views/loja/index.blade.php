@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">{{ __('Lojas') }}</h2>
        <div class="card card-body">
            <form id="filtrosForm" method="GET" action="{{ route('loja.index') }}">
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
                            <a href="{{ route('loja.create') }}" class="btn btn-primary">
                                <i class="fas fa-plus"></i> Nova loja
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
                            <th>Empresa</th>
                            <th>Endereço</th>
                            <th>OMIE - Parâmetros</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($lojas as $loja)
                            <tr>
                                <td>
                                    {{ $loja->cnpj }}<br>
                                    {{ $loja->nome_fantasia }}<br>
                                    {{ $loja->nome }}
                                </td>
                                <td>
                                    <p>
                                        CEP: {{ $loja->cep }}<br>
                                        Endereço: {{ $loja->logradouro }},
                                        {{ $loja->numero ?? '-' }},
                                        {{ $loja->bairro ?? '-' }},
                                        {{ $loja->cidade ?? '-' }} - {{ $loja->uf ?? '-' }}
                                    </p>
                                </td>
                                <td>
                                    OMIE KEY: {{ Str::limit($loja->omie_app_key, 6) }}<br>
                                    OMIE SECRET: {{ Str::limit($loja->omie_app_secret, 6) }}
                                </td>
                                <td>
                                    <a href="{{ route('loja.edit', $loja->id) }}" class="btn btn-secondary">
                                        <i class="fas fa-pencil"></i> Editar
                                    </a>
                                    <button onclick="deleteRegistro('{{ route('loja.destroy', $loja->id) }}')"
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
