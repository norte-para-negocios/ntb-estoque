@extends('layouts.app')

@section('content')
    <div class="container">

        <h2 class="mb-4 d-flex justify-content-between align-items-center">
            <span>
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1"
               title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
                {{ __('Inventários') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small>
            </span>

            <button class="btn btn-primary text-white" data-bs-toggle="modal" data-bs-target="#createInventarioModal">
                <i class="fas fa-plus"></i> Novo inventário
            </button>
        </h2>

        <div class="accordion" id="accordionExample">
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                        data-bs-target="#collapseOne" aria-expanded="false" aria-controls="collapseOne">
                        <i class="fa-solid fa-filter me-2"></i>
                        FILTRO
                    </button>
                </h2>
                <div id="collapseOne" class="accordion-collapse collapse" data-bs-parent="#accordionExample">
                    <div class="accordion-body">
                        <form id="filtrosForm" method="GET" action="{{ route('inventario.index') }}">
                            <div class="row">
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="data_inicio" class="form-label">Início</label>
                                        <input title="Data criação Omie" type="date" class="form-control"
                                            id="data_inicio" name="data_inicio"
                                            value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="mb-3">
                                        <label for="data_final" class="form-label">Final</label>
                                        <input type="date" class="form-control" id="data_final" name="data_final"
                                            value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                                    </div>
                                </div>
                                <div class="col-md-6 d-flex align-items-end">
                                    <div class="mb-3 g-6">
                                        <button type="submit" class="btn btn-primary text-white">
                                            <i class="fas fa-search"></i> Filtrar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <div class="card card-body mt-4">
            <table class="table table-hover table-borderless" aria-hidden="true">
                <tbody>
                    @if (isset($inventarios) && !empty($inventarios))
                        @foreach ($inventarios as $inventario)
                            <tr>
                                <td class="px-2">
                                    <div class="container">
                                        <div class="row">
                                            <div class="col-12 p-0">
                                                <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                    <div class="row">
                                                        <div class="col-md-6 col-12">
                                                            <p class="mb-0">
                                                                Data :
                                                                <strong>{{ $inventario->data->format('d/m/Y') }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Tipo Movimento:
                                                                <strong>{{ \App\Helpers\Constants::TIPO_MOVIMENTO_INVENTARIO[$inventario->motivo] ?? '' }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Local:
                                                                <strong>{{ $inventario->codigo_local_estoque ?? '' }} -
                                                                    {{ $inventario->localEstoque->descricao ?? '' }}</strong>
                                                            </p>
                                                            <p class="mb-0">
                                                                Produtos contados:
                                                                <strong>
                                                                    {{ $inventario->items()->count() ?? '' }}
                                                                </strong>
                                                            </p>
                                                        </div>
                                                        <div class="col-md-6 col-12">
                                                            <p class="mb-2">
                                                                @if ($inventario->finalizado === null)
                                                                    Situação:
                                                                    <span class="badge bg-warning fs-6 text-dark">
                                                                        Inventário em curso
                                                                    </span>
                                                                @else
                                                                    Finalizado em: <span class="badge bg-success fs-6 text-dark">
                                                                        {{ $inventario->finalizado->format('d/m/Y') }}
                                                                    </span>
                                                                @endif
                                                            </p>


                                                            <div class="mb-0">
                                                                <div class="d-grid gap-2 col-sm-6 col-md-4 col-12">
                                                                    <a href="{{ route('inventario.contagem', $inventario->id) }}"
                                                                        class="btn btn-primary text-white p-2 d-flex justify-content-start align-items-center">
                                                                        <i class="fa-solid fa-calculator fa-xl mx-2"
                                                                            style="color: #ffffff;"></i>
                                                                        <span class="fs-5">Contagem</span>
                                                                    </a>
                                                                    <a href="{{ route('inventario.destroy', $inventario->id) }}"
                                                                        onclick="event.preventDefault(); deleteRegistro(this.href);"
                                                                        class="btn btn-danger text-white p-2 d-flex justify-content-start align-items-center">
                                                                        <i class="fa-solid fa-trash fa-xl mx-2"></i>
                                                                        <span class="fs-5">Excluir</span>
                                                                    </a>
                                                                </div>
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
                            <td class="text-center">Nenhuma nota fiscal encontrada</td>
                        </tr>
                    @endif
                </tbody>
            </table>
            {{ $inventarios->links('pagination::bootstrap-5') }}
        </div>
    </div>
    @include('inventario.create')
@endsection

@push('js')
    <script>
        document.querySelectorAll('.accordion-collapse').forEach((item) => {
            item.addEventListener('shown.bs.collapse', () => {
                localStorage.setItem('accordionInventario', item.id);
            });
            item.addEventListener('hidden.bs.collapse', () => {
                localStorage.removeItem('accordionInventario');
            });
        });

        // Restaurar estado ao carregar
        window.addEventListener('DOMContentLoaded', () => {
            const aberto = localStorage.getItem('accordionInventario');
            if (aberto) {
                const el = document.getElementById(aberto);
                const collapse = new bootstrap.Collapse(el, {toggle: true});
            }
        });
    </script>
@endpush
