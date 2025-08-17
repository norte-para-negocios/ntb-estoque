@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">Relatório - {{ __('Notas Fiscais') }}:
            <small>{{ auth()->user()->loja->nome_fantasia }}</small>
        </h2>

        <div class="row d-flex justify-content-start">
            <div class="col-12 col-lg-6">
                <div class="card">
                    <div class="card-header">
                        <h2 class="accordion-header">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse"
                                data-bs-target="#collapseOne" aria-expanded="false" aria-controls="collapseOne">
                                <i class="fa-solid fa-filter me-2"></i>
                                FILTRO
                            </button>
                        </h2>
                    </div>
                    <div class="card-body">
                        <form id="filtrosForm" method="POST">
                            @csrf
                            @method('POST')

                            {{-- <div class="col-lg-6 col-12">
                                <div class="mb-3">
                                    <label for="data_inicio" class="form-label">Data Início</label>
                                    <input title="Data criação Omie" type="date" class="form-control" id="data_inicio"
                                        name="data_inicio"
                                        value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                                </div>
                            </div> --}}

                            <div class="col-12">
                                <div class="mb-3">
                                    <label for="num_nfe" class="form-label">Nº NFe</label>
                                    <input type="text" id="num_nfe" name="num_nfe" placeholder="Nº 000101474"
                                        class="form-control" value="{{ request('num_nfe', $num_nfe ?? '') }}">
                                </div>
                            </div>

                            <div class="col-12">
                                <div class="mb-3">
                                    <label for="tipo_produto" class="form-label">Tipo de Produto</label>
                                    <select id="tipo_produto" name="tipo_produto" class="form-control">
                                        <option value="" {{ ($tipo_produto ?? '') == '' ? 'selected' : '' }}>
                                            Todos
                                        </option>
                                        @foreach (\App\Helpers\Constants::PRODUTO_TIPO_ITEM as $key => $value)
                                            <option value="{{ $key }}"
                                                {{ ($tipo_produto ?? '') == $key ? 'selected' : '' }}>
                                                {{ $key }} - {{ $value }}
                                            </option>
                                        @endforeach
                                    </select>
                                </div>
                            </div>

                            <div class="col-12">
                                <div class="mb-3">
                                    <label for="op_produto" class="form-label">Produto</label>
                                    <input type="text" id="op_produto" name="op_produto" placeholder="Código/Descrição"
                                        class="form-control" value="{{ request('op_produto', $op_produto ?? '') }}">
                                </div>
                            </div>

                            <div class="col-12">
                                <div class="mb-3">
                                    <label for="op_produto" class="form-label">Concluído</label>
                                    <select id="op_concluido" name="op_concluido" class="form-control">
                                        <option value=""
                                            {{ request('op_concluido', $op_concluido ?? '') == '' ? 'selected' : '' }}>
                                            Todos</option>
                                        <option value="S"
                                            {{ request('op_concluido', $op_concluido ?? '') == 'S' ? 'selected' : '' }}>
                                            Concluído</option>
                                        <option value="N"
                                            {{ request('op_concluido', $op_concluido ?? '') == 'N' ? 'selected' : '' }}>
                                            Pendente</option>
                                    </select>
                                </div>
                            </div>
                            <div class="col-12 d-flex align-items-end">
                                <div class="mb-3">
                                    <button type="button" class="btn btn-primary me-2" onclick="printPDF()">
                                        <i class="fas fa-print"></i> Imprimir
                                    </button>
                                    <button type="button" class="btn btn-primary me-2" onclick="downloadExcel()">
                                        <i class="fas fa-file-csv"></i> Excel
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
@push('js')
    <script>
        function printPDF() {
            document.getElementById('filtrosForm').action = "{{ route('relatorio.notafiscal.imprimir') }}";
            document.getElementById('filtrosForm').submit();
        }

        function downloadExcel() {
            document.getElementById('filtrosForm').action = "{{ route('relatorio.notafiscal.excel') }}";
            document.getElementById('filtrosForm').submit();
        }
    </script>
@endpush
