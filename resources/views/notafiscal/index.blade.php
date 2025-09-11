@extends('layouts.app')

@section('content')
    <div class="container">
        <h2 class="mb-3">
            <a href="{{url()->previous()}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar"><i
                    class="fa-solid fa-arrow-left-long"></i></a>
            {{ __('Notas fiscais') }}: <small>{{ auth()->user()->loja->nome_fantasia }}</small>
            <span style="font-size: 12px;">
                @if(in_array(auth()->user()->loja->nota_fiscal_status, [null, 'Concluído']) && (\App\Services\CanService::canPermissionLoja('Notas Fiscais - Sincronizar', auth()->user()->loja->id) || auth()->user()->perfil == 'Admin'))
                    <a href="{{route('notafiscal.sync')}}"
                       class="btn btn-sm btn-secondary">Sincronizar Notas Fiscais</a>
                @endif
                @if(auth()->user()->loja->nota_fiscal_ultima_atualizacao)
                    Atualizado
                    em: {{\Carbon\Carbon::parse(auth()->user()->loja->nota_fiscal_ultima_atualizacao)->format('d/m/y H:i:s')}}
                @endif
                | Status: {{auth()->user()->loja->nota_fiscal_status??'N/A'}}
            </span>
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
                        <form id="filtrosForm" method="GET" action="{{ route('notafiscal.index') }}">
                            <div class="row g-1">
                                <div class="col-md-3">
                                    <div class="row g-1">
                                        <div class="col-lg-6 col-12">
                                            <div class="mb-3">
                                                <label for="data_inicio" class="form-label">Data Início</label>
                                                <input title="Data criação Omie" type="date" class="form-control"
                                                       id="data_inicio" name="data_inicio"
                                                       value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                                            </div>
                                        </div>
                                        <div class="col-lg-6 col-12">
                                            <div class="mb-3">
                                                <label for="data_final" class="form-label">Data Final</label>
                                                <input type="date" class="form-control" id="data_final"
                                                       name="data_final"
                                                       value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-1">
                                    <div class="mb-3">
                                        <label for="num_nfe" class="form-label">Nº NFe</label>
                                        <input type="text" id="num_nfe" name="num_nfe"
                                               class="form-control" value="{{ request('num_nfe', $num_nfe ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="fornecedor" class="form-label">Fornecedor</label>
                                        <input type="text" id="fornecedor" name="fornecedor"
                                               class="form-control"
                                               value="{{ request('fornecedor', $fornecedor ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="produto" class="form-label">Produto</label>
                                        <input type="text" id="produto" name="produto"
                                               class="form-control" value="{{ request('produto', $produto ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="tipo" class="form-label">Tipo</label>
                                        <select id="tipo" name="tipo" class="form-control">
                                            <option value="">Todos os tipos</option>
                                            <option
                                                value="00" {{ request('tipo', $tipo ?? '') == '00' ? 'selected' : '' }}>
                                                Mercadoria para Revenda
                                            </option>
                                            <option
                                                value="01" {{ request('tipo', $tipo ?? '') == '01' ? 'selected' : '' }}>
                                                Matéria Prima
                                            </option>
                                            <option
                                                value="02" {{ request('tipo', $tipo ?? '') == '02' ? 'selected' : '' }}>
                                                Embalagem
                                            </option>
                                            <option
                                                value="03" {{ request('tipo', $tipo ?? '') == '03' ? 'selected' : '' }}>
                                                Produto em Processo
                                            </option>
                                            <option
                                                value="04" {{ request('tipo', $tipo ?? '') == '04' ? 'selected' : '' }}>
                                                Produto Acabado
                                            </option>
                                            <option
                                                value="05" {{ request('tipo', $tipo ?? '') == '05' ? 'selected' : '' }}>
                                                Subproduto
                                            </option>
                                            <option
                                                value="06" {{ request('tipo', $tipo ?? '') == '06' ? 'selected' : '' }}>
                                                Produto Intermediário
                                            </option>
                                            <option
                                                value="07" {{ request('tipo', $tipo ?? '') == '07' ? 'selected' : '' }}>
                                                Material de Uso e Consumo
                                            </option>
                                            <option
                                                value="08" {{ request('tipo', $tipo ?? '') == '08' ? 'selected' : '' }}>
                                                Ativo Imobilizado
                                            </option>
                                            <option
                                                value="09" {{ request('tipo', $tipo ?? '') == '09' ? 'selected' : '' }}>
                                                Serviços
                                            </option>
                                            <option
                                                value="10" {{ request('tipo', $tipo ?? '') == '10' ? 'selected' : '' }}>
                                                Outros Insumos
                                            </option>
                                            <option
                                                value="99" {{ request('tipo', $tipo ?? '') == '99' ? 'selected' : '' }}>
                                                Outras
                                            </option>
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="status" class="form-label">Status</label>
                                        <select id="status" name="status" class="form-control">
                                            <option value="">Todos</option>
                                            <option
                                                value="P" {{ request('status', $status ?? '') == 'P' ? 'selected' : '' }}>
                                                Pendente
                                            </option>
                                            <option
                                                value="C" {{ request('status', $status ?? '') == 'C' ? 'selected' : '' }}>
                                                Concluído
                                            </option>
                                        </select>
                                    </div>
                                </div>

                                <div class="col-md-3 d-flex align-items-end">
                                    <div class="mb-3">
                                        <button type="button" class="btn btn-primary" onclick="filtrarRegistros()">
                                            <i class="fas fa-search"></i> Filtrar
                                        </button>

                                        <button type="button" class="btn btn-primary" onclick="imprimirRegistros()">
                                            <i class="fas fa-print"></i> Imprimir
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
            <table class="table table-hover table-borderless">
                <tbody>
                @if (isset($notasfiscais) && !empty($notasfiscais))
                    @foreach ($notasfiscais as $nf)
                        <tr>
                            <td class="px-2">
                                <div class="container">
                                    <div class="row">
                                        <div class="col-12 p-0">
                                            <div class="card card-body m-0" style="background-color: #e4e9f5;">
                                                <div class="row">
                                                    <div class="col-md-6 col-12">
                                                        <h6>
                                                            <small>{{ $nf->n_id_receb }}</small>: {{ $nf->c_nome ?? '-' }}
                                                        </h6>
                                                        <p class="mb-0">
                                                            <small>Nº NFe:</small>
                                                            <strong>{{ $nf->c_numero_nfe ?? '-' }}</strong>|
                                                            <small>Emissão:</small> {{ \Carbon\Carbon::parse(normalizarData($nf->d_emissao_nfe))->format('d/m/Y') }}
                                                        </p>
                                                        {{--                                                        <p class="mt-1 mb-2">--}}
                                                        {{--                                                            <small>Valor da NF:</small> R$--}}
                                                        {{--                                                            {{ number_format($nf->n_valor_nfe ?? 0, 2, ',', '.') ?? '' }}--}}
                                                        {{--                                                        </p>--}}
                                                    </div>
                                                    <div class="col-md-6 col-12 text-end">
                                                        <a href="{{ route('notafiscal.itens', $nf->id) }}"
                                                           class="btn btn-secondary text-center">
                                                            <i class="fas fa-eye me-2"></i> Visualizar
                                                        </a>
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
            {{ $notasfiscais->links('pagination::bootstrap-5') }}
        </div>
    </div>
@endsection


@push('js')
    <script>
        document.querySelectorAll('.accordion-collapse').forEach((item) => {
            item.addEventListener('shown.bs.collapse', () => {
                localStorage.setItem('accordionNotaFiscal', item.id);
            });
            item.addEventListener('hidden.bs.collapse', () => {
                localStorage.removeItem('accordionNotaFiscal');
            });
        });

        // Restaurar estado ao carregar
        window.addEventListener('DOMContentLoaded', () => {
            const aberto = localStorage.getItem('accordionNotaFiscal');
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
            const url = '{{ route("notafiscal.relatorio.imprimir") }}';
            const formData = new FormData(filtrosForm);

            axios.post(url, formData, {
                responseType: 'blob'
            }).then((response) => {
                const blob = new Blob([response.data], {type: response.headers['content-type']});
                const blobUrl = window.URL.createObjectURL(blob);
                window.open(blobUrl, '_blank');
                setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
            }).catch((error) => {
                console.error('Falha ao gerar PDF', error);
            });
        }
    </script>
@endpush
