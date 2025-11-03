@extends('layouts.app')

@section('filtro')
    <form id="filtrosForm" method="GET" action="{{ route('notafiscal.index') }}">
        <div class="container-fluid">
            <div class="row">
                <div class="col-12">
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
                                <input type="date"
                                       class="form-control"
                                       id="data_final"
                                       name="data_final"
                                       value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}"
                                >
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-12">
                    <div class="mb-3">
                        <label for="num_nfe" class="form-label">Nº NFe</label>
                        <input type="text" id="num_nfe" name="num_nfe"
                               class="form-control" value="{{ request('num_nfe', $num_nfe ?? '') }}">
                    </div>
                </div>

                <div class="col-12">
                    <div class="mb-3">
                        <label for="fornecedor" class="form-label">Fornecedor</label>
                        <input type="text" id="fornecedor" name="fornecedor"
                               class="form-control"
                               value="{{ request('fornecedor', $fornecedor ?? '') }}">
                    </div>
                </div>

                <div class="col-12">
                    <div class="mb-3">
                        <label for="produto" class="form-label">Produto</label>
                        <input type="text" id="produto" name="produto"
                               class="form-control" value="{{ request('produto', $produto ?? '') }}">
                    </div>
                </div>

                <div class="col-12">
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

                <div class="col-12">
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
            </div>
        </div>
    </form>
@endsection

@section('content')
    <div class="container">
        <p class="mb-0 fw-semibold">
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>
            <img class="ms-0 p-0" src="{{asset('images/nota-fiscal.png')}}" alt="Notas Fiscais">
            {{ __('Notas Fiscais') }}
        </p>
        <p class="mt-0 pt-0">
            <span style="font-size: 12px;">
                @if(auth()->user()->loja->nota_fiscal_ultima_atualizacao)
                    Atualizado
                    em: {{\Carbon\Carbon::parse(auth()->user()->loja->nota_fiscal_ultima_atualizacao)->format('d/m/y H:i:s')}}
                @endif
                | Status: {{auth()->user()->loja->nota_fiscal_status??'N/A'}}
                @if(in_array(auth()->user()->loja->nota_fiscal_status, [null, 'Concluído']) && (\App\Services\CanService::canPermissionLoja('Notas Fiscais - Sincronizar', auth()->user()->loja->id) || auth()->user()->perfil == 'Admin'))
                    <a href="{{route('notafiscal.sync')}}" title="Sinclonizar Notas Fiscais com o Omie"
                       class="btn btn-sm btn-outline-secondary text-dark-emphasis">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </a>
                @endif
            </span>
        </p>

        <table class="table table-hover table-borderless" style="background-color: #f4f4f4;">
            <tbody>
            @if (isset($notasfiscais) && !empty($notasfiscais))
                @foreach ($notasfiscais as $nf)
                    <tr style="background-color: #f4f4f4;">
                        <td class="px-2" style="background-color: #f4f4f4;">
                            <div class="container">
                                <div class="row">
                                    <div class="col-12 p-0">
                                        <span>Emissão: {{ \Carbon\Carbon::parse(normalizarData($nf->d_emissao_nfe))->format('d/m/Y') }}</span>
                                        <div class="card m-0">
                                            <div class="card-header">
                                                <span class="text-white">
                                                    NF nº {{ $nf->c_numero_nfe ?? '-' }}
                                                </span>
                                            </div>
                                            <div class="card-footer" style="background-color: #ffffff;">
                                                <div class="row">
                                                    <div class="col-8">
                                                        <small>Fornecedor</small>
                                                        <p>
                                                            <strong>
                                                                {{ $nf->c_nome ?? '-' }}
                                                            </strong>
                                                        </p>
                                                    </div>
                                                    <div
                                                        class="col-4 text-end ps-0 d-flex justify-content-end align-items-center">
                                                        <a href="{{ route('notafiscal.itens', $nf->id) }}"
                                                           class="btn btn-outline-secondary text-center text-muted fw-semibold">
                                                            <img src="{{asset('images/eye.png')}}" alt="" class="me-1">
                                                            Ver
                                                        </a>
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
        {{ $notasfiscais->links('pagination::bootstrap-5') }}
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

        {{--function filtrarRegistros() {--}}
        {{--    document.getElementById('filtrosForm').submit();--}}
        {{--}--}}

        {{--function imprimirRegistros() {--}}
        {{--    const filtrosForm = document.getElementById('filtrosForm');--}}
        {{--    const url = '{{ route("notafiscal.relatorio.imprimir") }}';--}}
        {{--    const formData = new FormData(filtrosForm);--}}

        {{--    axios.post(url, formData, {--}}
        {{--        responseType: 'blob'--}}
        {{--    }).then((response) => {--}}
        {{--        const blob = new Blob([response.data], {type: response.headers['content-type']});--}}
        {{--        const blobUrl = window.URL.createObjectURL(blob);--}}
        {{--        window.open(blobUrl, '_blank');--}}
        {{--        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);--}}
        {{--    }).catch((error) => {--}}
        {{--        console.error('Falha ao gerar PDF', error);--}}
        {{--    });--}}
        {{--}--}}
    </script>
@endpush

@push('css')
    <style>
        body {
            background: #f4f4f4;
        }
    </style>
@endpush
