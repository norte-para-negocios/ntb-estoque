@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-3">
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
            {{ __('Produtos') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small>
        </h2>

        <div class="card card-body mt-4">
            <div class="row">
                <div class="col-md-3 col-12">
                    <button class="btn btn-secondary" onclick="update()">
                        <i class="fa-solid fa-arrows-rotate"></i> Produto
                    </button>
                </div>

                <div class="col-md-9 col-12">
                    <form class="d-flex align-items-end" role="search" action="{{route('produto.index')}}" method="GET">
                        @csrf
                        <input class="form-control me-2" type="search" placeholder="Pesquisar" aria-label="Search"
                               name="search"/>
                        <button class="btn btn-outline-primary" type="submit">Pesquisar</button>
                    </form>
                </div>
            </div>

        </div>
        <div class="card card-body mt-4">
            <table class="table table-hover">
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
                swal({
                    title: "Tudo certo, só aguardar alguns instantes!",
                    text: response.data.message,
                    icon: "success",
                    button: "OK!",
                });
            }).catch(error => {
                swal({
                    title: "Ops :(!",
                    text: error.message,
                    icon: "error",
                    button: "OK!",
                });
            })
        }
    </script>
@endpush
