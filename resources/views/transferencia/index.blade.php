@extends('layouts.app')

@section('filtro')
    <form id="filtrosForm" method="GET" action="{{ route('transferencia.index') }}">
        <div class="row">
            <div class="col-6">
                <div class="mb-3">
                    <label for="data_inicio" class="form-label">Data</label>
                    <input title="Data criação Omie" type="date" class="form-control"
                           id="data_inicio" name="data_inicio"
                           value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                </div>
            </div>
            <div class="col-6">
                <div class="mb-3">
                    <label for="data_final" class="form-label">Data Final</label>
                    <input type="date" class="form-control" id="data_final" name="data_final"
                           value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                </div>
            </div>
        </div>
    </form>
@endsection

@section('content')
    <div class="container mb-5">
        <p class="mb-0 fw-semibold">
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>

            <img class="ms-0 p-0" src="{{asset('images/transferencia.png')}}" alt="Transferências entre estoques">
            {{ __('Transferências') }}
        </p>

        <table class="table table-hover table-borderless mb-5" style="background-color: #f4f4f4;">
            <tbody>
            @if (isset($transferencias) && !empty($transferencias))
                @foreach ($transferencias as $tr)
                    @php
                        $produto = \App\Models\Produto::where('loja_id', auth()->user()->current_loja_id)->where('codigo_produto', $tr->id_prod)->first();
                        $local = \App\Models\LocalEstoque::where('loja_id', auth()->user()->current_loja_id)->where('codigo_local_estoque', $tr->codigo_local_estoque)->first();
                        $localDestino = \App\Models\LocalEstoque::where('loja_id', auth()->user()->current_loja_id)->where('codigo_local_estoque', $tr->codigo_local_estoque_destino)->first();
                    @endphp
                    <tr style="background-color: #f4f4f4;">
                        <td class="m-0 px-0" style="background-color: #f4f4f4;">
                            <div class="container">
                                <div class="row">
                                    <div class="col-12 p-0">
                                        <small class="text-muted">
                                            Data: {{$tr->data->format('d/m/Y')}}
                                        </small>
                                        <div class="card m-0">
                                            <div class="card-header d-flex justify-content-between"
                                                 style="font-size: .7rem;
                                                 background-color:
                                                 @if ($tr->id_movest === null)
                                                    #F24646
                                                @else
                                                    #2EB5C3
                                                @endif;
                                                 ">
                                                <span class="text-white">
                                                    Produto - {{ $produto->codigo }} -
                                                    @if ($tr->id_movest === null)
                                                        Operação não realizada no OMIE!
                                                    @else
                                                        {{ $tr->descricao_status }}
                                                    @endif
                                                </span>
                                            </div>
                                            <div class="card-footer" style="background-color: #ffffff;">
                                                <div class="row">
                                                    <div class="col-md-5 col-8">
                                                        <small>Nome do produto</small><br>
                                                        <span class="fw-semibold">
                                                            {{ $produto->descricao ?? '' }}
                                                        </span>
                                                    </div>

                                                    <div class="col-md-2 col-4">
                                                        <small>Quantidade</small><br>
                                                        <span class="fw-semibold">
                                                            {{ number_format($tr->quan, 3, ',', '.') }}
                                                            {{ $produto->unidade ?? '' }}
                                                        </span>
                                                    </div>

                                                    <div class="col-md-2 col-4">
                                                        <small>Origem</small><br>
                                                        <span class="fw-semibold">
                                                            {{ $local->descricao ?? '' }}
                                                        </span>
                                                    </div>

                                                    <div class="col-md-2 col-4">
                                                        <small>Destino</small><br>
                                                        <span class="fw-semibold">
                                                            {{ $localDestino->descricao ?? '' }}
                                                        </span>
                                                    </div>

                                                    <div
                                                        class="col-md-1 col-4 text-end ps-0 d-flex justify-content-end justify-content-md-center align-items-center p-0">
                                                        @if (!in_array($tr->status, ['Iniciado']))
                                                            <button type="button"
                                                                    onclick="deleteRegistro('{{ route('transferencia.destroy', $tr->id) }}')"
                                                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold pt-2">
                                                                <img src="{{asset('images/excluir.png')}}" alt=""
                                                                     class="me-1">Excluir
                                                            </button>
                                                        @endif
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                @endforeach
            @else
                <tr>
                    <td class="text-center">Nenhum registro encontrado</td>
                </tr>
            @endif
            </tbody>
        </table>
        {{ $transferencias->links('pagination::bootstrap-5') }}
    </div>

    <div class="container-fluid fixed-bottom">
        <div class="row bg-white">
            <div class="col d-flex justify-content-end align-items-center py-3">
                <button onclick="createTransferencia('{{ route('transferencia.create') }}')" class="btn btn-success text-white">
                    <i class="fas fa-plus text-white"></i> Nova transferência
                </button>
            </div>
        </div>
    </div>
@endsection

@push('js')
    <script>
        function createTransferencia(url) {
            localStorage.removeItem('produtos');
            window.location = url;
        }

        document.querySelectorAll('.accordion-collapse').forEach((item) => {
            item.addEventListener('shown.bs.collapse', () => {
                localStorage.setItem('accordionTransferencia', item.id);
            });
            item.addEventListener('hidden.bs.collapse', () => {
                localStorage.removeItem('accordionTransferencia');
            });
        });

        // Restaurar estado ao carregar
        window.addEventListener('DOMContentLoaded', () => {
            const aberto = localStorage.getItem('accordionTransferencia');
            if (aberto) {
                const el = document.getElementById(aberto);
                new bootstrap.Collapse(el, {toggle: true});
            }
        });

        function filtrarRegistros() {
            document.getElementById('filtrosForm').submit();
        }

        function imprimirRegistros() {
            const filtrosForm = document.getElementById('filtrosForm');
            const url = '{{ route("transferencia.pdf") }}';
            const formData = new FormData(filtrosForm);

            axios.post(url, formData, {
                responseType: 'blob'
            }).then((response) => {
                const blob = new Blob([response.data], {type: response.headers['content-type']});
                const blobUrl = window.URL.createObjectURL(blob);
                window.open(blobUrl, '_blank');
                setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
            }).catch((error) => {
                swal.fire({
                    title: "Ops :(!",
                    text: error,
                    icon: "error",
                    button: "OK!",
                });
            });
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
