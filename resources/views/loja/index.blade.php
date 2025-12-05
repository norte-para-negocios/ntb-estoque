@extends('layouts.app')

@section('content')
    <div class="container">
        <p class="mb-0 fw-semibold d-flex align-items-center justify-content-between">
            <span>
                <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                    <img src="{{asset('images/voltar.png')}}" alt="<-">
                </a>
                <img class="ms-0 p-0" src="{{asset('images/loja.png')}}" alt="Lojas">
                {{ __('Lojas') }}
            </span>

            <a href="{{ route('loja.create') }}" class="btn btn-success text-dark-emphasis">
                <i class="fas fa-plus"></i> Nova loja
            </a>
        </p>

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
                        <button type="submit" class="btn btn-success">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </div>
            </div>
        </form>

        <div class="card card-body mt-4">
            <table class="table table-hover" id="tableLojas" aria-hidden="true">
                <tbody>
                @foreach ($lojas as $loja)
                    <tr>
                        <td>
                            <div class="card card-body text-white" style="background-color: #2EB5C3;">
                                <p class="mb-0 text-white">
                                    {{ $loja->cnpj }}: {{ $loja->nome_fantasia }} | <small class="text-white">{{ $loja->nome }}</small><br>
                                    Loja: {{ $loja->ativo ? 'Ativa' : 'Inativa' }}
                                </p>
                                <hr class="mb-0">
                                <p class="pt-2 mb-1 text-white">
                                    Atualizaçoes: <a href="{{route('loja.sync.force', $loja->id)}}"
                                                     class="btn btn-sm btn-warning text-white">Forçar Liberação
                                        p/ Atualização</a>
                                </p>
                                <div class="row pt-2">
                                    <div class="col text-white">
                                        <strong class="text-white">
                                            Local de Estoque:
                                        </strong>
                                        <br>
                                        {{$loja->local_estoque_ultima_atualizacao ? \Carbon\Carbon::parse($loja->local_estoque_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                        ({{$loja->local_estoque_status??'N/A'}})<br>
                                    </div>

                                    <div class="col text-white">
                                        <strong class="text-white">
                                            Produto:
                                        </strong>
                                        <br>
                                        {{$loja->produto_ultima_atualizacao ? \Carbon\Carbon::parse($loja->produto_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                        ({{$loja->produto_status??'N/A'}})<br>
                                    </div>

                                    <div class="col text-white">
                                        <strong class="text-white">
                                            Ordem de Produção:
                                        </strong>
                                        <br>
                                        {{$loja->ordem_producao_ultima_atualizacao ? \Carbon\Carbon::parse($loja->ordem_producao_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                        ({{$loja->ordem_producao_status??'N/A'}})<br>
                                    </div>

                                    <div class="col text-white">
                                        <strong class="text-white">
                                            Nota Fiscal:
                                        </strong>
                                        <br>
                                        {{$loja->nota_fiscal_ultima_atualizacao ? \Carbon\Carbon::parse($loja->nota_fiscal_ultima_atualizacao)->format('d/m/y H:i:s') : 'dd/mm/aa hh:mm:ss'}}
                                        ({{$loja->nota_fiscal_status??'N/A'}})
                                    </div>
                                </div>
                                <hr class="mb-0">
                                <p class="d-flex align-items-center justify-content-start gap-3 pt-3 text-white">
                                    <span class="text-white">OMIE KEY: {{ Str::limit($loja->omie_app_key, 6) }}</span>
                                    <span class="text-white">OMIE SECRET: {{ Str::limit($loja->omie_app_secret, 6) }}</span>
                                </p>
                            </div>
                        </td>
                        <td>
                            <a href="{{ route('loja.edit', $loja->id) }}" class="btn btn-secondary m-1">
                                <i class="fas fa-pencil text-white"></i>
                            </a>
                            <button onclick="deleteRegistro('{{ route('loja.destroy', $loja->id) }}')"
                                    class="btn btn-danger text-white m-1">
                                <i class="fas fa-trash text-white"></i>
                            </button>
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
