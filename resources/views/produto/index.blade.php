@extends('layouts.app')

@section('content')
    <div class="container mb-5">
        <p class="mb-0 fw-semibold">
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>

            <img class="ms-0 p-0" src="{{asset('images/produto.png')}}" alt="Produtos da Loja">
            {{ __('Produtos') }}
        </p>
        <p class="mt-0 pt-0">
            <span style="font-size: 12px;">
                @if(auth()->user()->loja->produto_ultima_atualizacao)
                    Atualizado
                    em: {{\Carbon\Carbon::parse(auth()->user()->loja->produto_ultima_atualizacao)->format('d/m/y H:i:s')}}
                @endif
                | Status: {{auth()->user()->loja->produto_status?->value ?? 'N/A'}}
                @if(in_array(auth()->user()->loja->produto_status, [null, \App\Enums\SincronizacaoStatus::Concluido]) && (\App\Services\CanService::canPermissionLoja('Produtos - Sincronizar', auth()->user()->loja->id) || auth()->user()->perfil == 'Admin'))
                    <button class="btn btn-sm btn-outline-secondary text-dark-emphasis" onclick="update()">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                @endif
            </span>
        </p>

        <div class="card card-body mt-4">
            <div class="row">
                <div class="col-12">
                    <form class="d-flex align-items-end" role="search" action="{{route('produto.index')}}" method="GET">
                        @csrf
                        <input class="form-control me-2" type="search" placeholder="Pesquisar" aria-label="Search"
                               name="search"/>
                        <button class="btn btn-success" type="submit">Pesquisar</button>
                    </form>
                </div>
            </div>
        </div>

        <div class="card card-body mt-4">
            <table class="table table-striped">
                <thead>
                <tr>
                    <td>Família</td>
                    <td>Código</td>
                    <td>Descrição/Unidade</td>
                    <td>Tipo</td>
                    <td>Unitário</td>
                </tr>
                </thead>
                <tbody>
                @foreach ($produtos as $produto)
                    <tr>
                        <td>
                            {{$produto->descricao_familia??''}}
                        </td>
                        <td>
                            {{$produto->codigo??''}}
                        </td>
                        <td>
                            {{$produto->descricao??''}}
                        </td>
                        <td>
                            {{\App\Helpers\Constants::PRODUTO_TIPO_ITEM[$produto->tipo_item??'99']}}
                        </td>
                        <td>
                            {{number_format(($produto->valor_unitario??0), 2, ',', '.')}}
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
            {{ $produtos->links('pagination::bootstrap-5') }}
        </div>
    </div>
@endsection

@push('js')
    <script>
        function update() {
            axios.get('/produto/update').then(response => {
                swal.fire({
                    title: "Tudo certo, só aguardar alguns instantes!",
                    text: response.data.message,
                    icon: "success",
                    button: "OK!",
                });
            }).catch(error => {
                swal.fire({
                    title: "Ops :(!",
                    text: error.message,
                    icon: "error",
                    button: "OK!",
                });
            })
        }
    </script>
@endpush

@push('css')
    <style>
        body {
            background-color: #F4F4F4;
        }
    </style>
@endpush
