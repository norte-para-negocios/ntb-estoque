@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-4">Relatório - {{ __('Ordens de Produção') }}:
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
                            <div class="col-12">
                                <div class="mb-3">
                                    <label for="data_producao" class="form-label">Previsão/Conclusão</label>
                                    <input type="date" id="data_producao" name="data_producao" class="form-control"
                                        value="{{ request('data_producao', $data_producao ?? '') }}">
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
                                    <label for="ordem_producao" class="form-label">Nº Ordem de Produção</label>
                                    <input type="text" id="ordem_producao" name="ordem_producao"
                                        placeholder="Nº 2021/38804" class="form-control"
                                        value="{{ request('ordem_producao', $ordem_producao ?? '') }}">
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
            document.getElementById('filtrosForm').action = "{{ route('relatorio.ordemproducao.imprimir') }}";
            document.getElementById('filtrosForm').submit();
        }

        function downloadExcel() {
            document.getElementById('filtrosForm').action = "{{ route('relatorio.ordemproducao.excel') }}";
            document.getElementById('filtrosForm').submit();
        }
    </script>
@endpush
