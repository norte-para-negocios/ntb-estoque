@extends('layouts.app')

@section('content')
    <div class="container">

        <h2 class="mb-2 d-flex justify-content-between align-items-center">
            <span>
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
            {{ __('Lojas') }}
            </span>
            <a href="{{ route('loja.create') }}" class="btn btn-primary">
                <i class="fas fa-plus"></i> Nova loja
            </a>
        </h2>
        <p class="fw-bold mb-3">
            Importante: Cadastre o webhook "{{route('webhook')}}" nos seus aplicativos Omie no endereço <a href="https://developer.omie.com.br/my-apps/">developer.omie.com.br/my-apps</a>, ative todas as opções.
        </p>


        <form id="filtrosForm" method="GET" action="{{ route('loja.index') }}">
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
            <table class="table table-hover" id="tableLojas" aria-hidden="true">
                <thead>
                <tr>
                    <th>Loja</th>
                    <th>Ações</th>
                </tr>
                </thead>
                <tbody>
                @foreach ($lojas as $loja)
                    <tr>
                        <td>
                            <p>
                                {{ $loja->cnpj }}<br>
                                {{ $loja->nome_fantasia }}<br>
                                {{ $loja->nome }}
                            </p>
                            <p>
                                CEP: {{ $loja->cep }}<br>
                                Endereço: {{ $loja->logradouro }},
                                {{ $loja->numero ?? '-' }},
                                {{ $loja->bairro ?? '-' }},
                                {{ $loja->cidade ?? '-' }} - {{ $loja->uf ?? '-' }}
                            </p>
                            <p>
                                OMIE KEY: {{ Str::limit($loja->omie_app_key, 6) }}<br>
                                OMIE SECRET: {{ Str::limit($loja->omie_app_secret, 6) }}
                            </p>
                            <p>
                                Ativa: {{ $loja->ativo ? 'Sim' : 'Não' }}
                            </p>
                        </td>
                        <td>
                            <a href="{{ route('loja.edit', $loja->id) }}" class="btn btn-secondary m-1">
                                <i class="fas fa-pencil"></i>
                            </a>
                            <button onclick="deleteRegistro('{{ route('loja.destroy', $loja->id) }}')"
                                    class="btn btn-danger text-white m-1">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        </div>
    </div>
@endsection
