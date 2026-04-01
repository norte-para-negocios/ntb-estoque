@extends('layouts.app')

@section('content')
    <div class="container mb-5">
        <p class="mb-0 fw-semibold">
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>
            <img class="ms-0 p-0" src="{{asset('images/local.png')}}" alt="Locais de Estoque">
            {{ __('Locais de Estoque') }}
        </p>
        <p class="mt-0 pt-0">
            <span style="font-size: 12px;">
                @if(auth()->user()->loja->local_estoque_ultima_atualizacao)
                    Atualizado
                    em: {{\Carbon\Carbon::parse(auth()->user()->loja->local_estoque_ultima_atualizacao)->format('d/m/y H:i:s')}}
                @endif
                | Status: {{auth()->user()->loja->local_estoque_status?->value ?? 'N/A'}}
                @if(in_array(auth()->user()->loja->local_estoque_status, [null, \App\Enums\SincronizacaoStatus::Concluido]) && (\App\Services\CanService::canPermissionLoja('Locais de Estoque - Sincronizar', auth()->user()->loja->id) || auth()->user()->perfil == 'Admin'))
                    <button class="btn btn-sm btn-outline-secondary text-dark-emphasis" onclick="update()">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                @endif
            </span>
        </p>

        <div class="card card-body mt-4">
            <table class="table table-striped">
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


@push('css')
    <style>
        body {
            background-color: #F4F4F4;
        }
    </style>
@endpush
