@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-3">
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1"
               title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
            {{ __('Locais de Estoque') }}:
            <small>{{ auth()->user()->loja->nome_fantasia }}</small>
        </h2>

        <div class="card card-body mt-4">
            <div class="row">
                <div class="col-md-3 col-12">
                    <button class="btn btn-secondary" onclick="update()">
                        <i class="fa-solid fa-arrows-rotate"></i> Locais de Estoque
                    </button>
                </div>
            </div>

        </div>
        <div class="card card-body mt-4">
            <table class="table table-hover">
                <thead>
                <tr>
                    <td>Código Local Estoque</td>
                    <td>Código</td>
                    <td>Descrição</td>
                </tr>
                </thead>
                <tbody>
                @foreach ($locais as $local)
                    <tr>
                        <td>
                            {{$local->codigo_local_estoque??''}}
                        </td>
                        <td>
                            {{$local->codigo??''}}
                        </td>
                        <td>
                            {{$local->descricao??''}}
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
            {{ $locais->links('pagination::bootstrap-5') }}
        </div>
    </div>
@endsection

@push('js')
    <script>
        function update() {
            axios.get('/local-estoque/update').then(response => {
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
