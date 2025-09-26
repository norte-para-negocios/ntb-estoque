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
            Importante: Cadastre o webhook "{{route('webhook')}}" nos seus aplicativos Omie no endereço <a
                href="https://developer.omie.com.br/my-apps/">developer.omie.com.br/my-apps</a>, ative todas as
            opções.
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
                            <div class="card card-body text-white" style="background-color: rgba(243,106,30,0.73);">
                                <p class="mb-0">
                                    {{ $loja->cnpj }}: {{ $loja->nome_fantasia }} | <small>{{ $loja->nome }}</small><br>
                                    Loja: {{ $loja->ativo ? 'Ativa' : 'Inativa' }}
                                </p>
                                <hr class="mb-0">
                                <p class="mb-1">
                                    Atualizaçoes: <a href="{{route('loja.sync.force', $loja->id)}}" class="btn btn-sm btn-link btn-light text-white">Forçar Liberação p/ Atualização</a><br>
                                    <strong>Local de
                                        Estoque:</strong> {{$loja->local_estoque_ultima_atualizacao ? \Carbon\Carbon::parse($loja->local_estoque_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                    ({{$loja->local_estoque_status??'N/A'}})<br>
                                    <strong>Produto:</strong> {{$loja->produto_ultima_atualizacao ? \Carbon\Carbon::parse($loja->produto_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                    ({{$loja->produto_status??'N/A'}})<br>
                                    <strong>Ordem de
                                        Produção:</strong> {{$loja->ordem_producao_ultima_atualizacao ? \Carbon\Carbon::parse($loja->ordem_producao_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                    ({{$loja->ordem_producao_status??'N/A'}})<br>
                                    <strong>Nota
                                        Fiscal:</strong> {{$loja->nota_fiscal_ultima_atualizacao ? \Carbon\Carbon::parse($loja->nota_fiscal_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                    ({{$loja->nota_fiscal_status??'N/A'}})
                                </p>
                                <hr class="mb-0">
                                <p>
                                    OMIE KEY: {{ Str::limit($loja->omie_app_key, 6) }}<br>
                                    OMIE SECRET: {{ Str::limit($loja->omie_app_secret, 6) }}
                                </p>
                            </div>
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
