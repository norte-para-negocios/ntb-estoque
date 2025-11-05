@extends('layouts.app')
@section('filtro')
    <form id="filtrosForm" method="GET" action="{{ route('ordemproducao.index') }}">
        <div class="row">
            <div class="col-12">
                <div class="row g-1">
                    <div class="col-lg-6">
                        <div class="mb-3">
                            <label for="data_inicio" class="form-label">Data Início</label>
                            <input title="Data criação Omie" type="date" class="form-control"
                                   id="data_inicio" name="data_inicio"
                                   value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                        </div>
                    </div>
                    <div class="col-lg-6">
                        <div class="mb-3">
                            <label for="data_final" class="form-label">Data Final</label>
                            <input type="date" class="form-control" id="data_final"
                                   name="data_final"
                                   value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                        </div>
                    </div>
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
                    <input type="text" id="op_produto" name="op_produto"
                           placeholder="Código/Descrição" class="form-control"
                           value="{{ request('op_produto', $op_produto ?? '') }}">
                </div>
            </div>

            <div class="col-12">
                <div class="mb-3">
                    <label for="op_produto" class="form-label">Concluído</label>
                    <select id="op_concluido" name="op_concluido" class="form-control">
                        <option value=""
                            {{ request('op_concluido', $op_concluido ?? '') == '' ? 'selected' : '' }}>
                            Todos
                        </option>
                        <option
                            value="S" {{ request('op_concluido', $op_concluido ?? '') == 'S' ? 'selected' : '' }}>
                            Concluído
                        </option>
                        <option
                            value="N" {{ request('op_concluido', $op_concluido ?? '') == 'N' ? 'selected' : '' }}>
                            Pendente
                        </option>
                    </select>
                </div>
            </div>

            {{--            <div class="col-12 d-flex align-items-end my-3">--}}
            {{--                <button type="button" class="btn btn-primary ms-2" onclick="filtrarRegistros()"--}}
            {{--                        title="Filtrar registros">--}}
            {{--                    <i class="fas fa-search"></i>--}}
            {{--                </button>--}}
            {{--                <button type="button" class="btn btn-primary ms-2" onclick="imprimirRegistros()"--}}
            {{--                        title="Imprimir registros">--}}
            {{--                    <i class="fas fa-print"></i>--}}
            {{--                </button>--}}
            {{--            </div>--}}

        </div>
    </form>
@endsection

@section('content')
    <div class="container">
        <p class="mb-0 fw-semibold">
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>
            <img class="ms-0 p-0" src="{{asset('images/ordem-producao.png')}}" alt="Ordens de Produção">
            {{ __('Ordens de Produção') }}
        </p>

        <p class="mt-0 pt-0">
            <span style="font-size: 12px;">
                @if(auth()->user()->loja->ordem_producao_ultima_atualizacao)
                    Atualizado
                    em: {{\Carbon\Carbon::parse(auth()->user()->loja->ordem_producao_ultima_atualizacao)->format('d/m/y H:i:s')}}
                @endif
                | Status: {{auth()->user()->loja->ordem_producao_status??'N/A'}}
                @if(in_array(auth()->user()->loja->ordem_producao_status, [null, 'Concluído']) && (\App\Services\CanService::canPermissionLoja('Ordens de Produção - Sincronizar', auth()->user()->loja->id) || auth()->user()->perfil == 'Admin'))
                    <a href="{{route('ordemproducao.sync')}}"
                       class="btn btn-sm btn-outline-secondary text-dark-emphasis"
                       title="Sinclonizar Ordens de Produção com o Omie"
                    >
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </a>
                @endif
            </span>
        </p>

        <table class="table table-hover table-borderless" style="background-color: #f4f4f4;">
            <tbody>
            @if ($ordensProducao->count() > 0)
                @foreach ($ordensProducao as $op)
                    <tr style="background-color: #f4f4f4;">
                        <td class="m-0 px-0" style="background-color: #f4f4f4;">
                            <div class="container">
                                <div class="row">
                                    <div class="col-12 p-0">
                                        <div class="card m-0">
                                            <div class="card-header d-flex justify-content-between"
                                                 style="background-color:
                                                 @if( (json_decode($op->full_object)->outrasInf->cConcluida === 'N') &&
                                                    (\Carbon\Carbon::parse($op->adicionais_d_dt_conclusao)
                                                        ->lessThan(\Carbon\Carbon::now())
                                                        )
                                                    )
                                                    #F24646
                                                  @elseif(json_decode($op->full_object)->outrasInf->cConcluida === 'S')
                                                  #2EB5C3
                                                  @else
                                                  #5D5D5D
                                                 @endif;
                                                 font-size: .7rem;">
                                                <span class="text-white">
                                                    Data: {{\Carbon\Carbon::parse($op->adicionais_d_dt_conclusao)->format('d/m/Y')}} | Produto em Processo {{ $op->produto_codigo ?? '-' }}
                                                </span>

                                                <span class="text-white" id="display-validade{{$op->id}}">
                                                    @if($op->validade)
                                                        Validade {{ \Carbon\Carbon::parse($op->validade)->format('d/m/Y') }}
                                                    @endif
                                                </span>
                                            </div>
                                            <div class="card-footer" style="background-color: #ffffff;">
                                                <div class="row">
                                                    <div class="col-md-5 col-12 mb-2">
                                                        <small>Nome de produto</small><br>
                                                        <span
                                                            class="fw-semibold">{{ $op->produto_descricao ?? '' }}</span>
                                                    </div>

                                                    <div class="col-md-2 col-6 mb-2">
                                                        <small>Ordem de produção</small><br>
                                                        <span
                                                            class="fw-semibold">{{ $op->identificacao_c_num_op ?? '' }}</span>
                                                    </div>

                                                    <div class="col-md-1 col-6 mb-2">
                                                        <small>Quantidade</small><br>
                                                        <span class="fw-semibold">
                                                            {{ $op->identificacao_n_qtde ?? '' }}
                                                            ({{ $op->produto_unidade ?? '' }})
                                                        </span>
                                                    </div>

                                                    <div class="col-md-3 col-8 d-flex">
                                                        <button
                                                            class="btn btn-sm btn-outline-primary mx-0 btn-validade fw-semibold px-2"
                                                            style="width: 40px;"
                                                            onclick="subtrai(
                                                                '{{$op->id}}',
                                                                '{{\Carbon\Carbon::parse($op->adicionais_d_dt_conclusao)->format('Y-m-d')}}'
                                                                )"
                                                        >
                                                            -
                                                        </button>

                                                        <input type="date"
                                                               class="form-control rounded-0 validade mx-1"
                                                               id="validade-{{$op->id}}"
                                                               name="validade"
                                                               value="{{ $op->validade ? \Carbon\Carbon::parse($op->validade)->format('Y-m-d') : ''}}"
                                                               style="text-align: center;"
                                                               onblur="sincValidade(this.value,'{{ $op->id }}', '{{\Carbon\Carbon::parse($op->adicionais_d_dt_conclusao)->format('Y-m-d')}}')"
                                                        >

                                                        <button
                                                            class="btn btn-sm btn-outline-primary btn-validade fw-semibold px-2"
                                                            style="width: 40px;"
                                                            onclick="soma(
                                                                '{{$op->id}}',
                                                                '{{\Carbon\Carbon::parse($op->adicionais_d_dt_conclusao)->format('Y-m-d')}}'
                                                                )"
                                                        >
                                                            +
                                                        </button>
                                                    </div>

                                                    <div
                                                        class="col-md-1 col-4 text-end ps-0 d-flex justify-content-end justify-content-md-center align-items-center p-0">
                                                        <button type="button"
                                                                onclick="imprimir({{ $op->id }})"
                                                                class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold">
                                                            <img src="{{asset('images/imprimir.png')}}" alt=""
                                                                 class="me-1">Imprimir
                                                        </button>
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
                    <td class="text-center">Nenhuma ordem de produção encontrada</td>
                </tr>
            @endif
            </tbody>
        </table>
        {{ $ordensProducao->links('pagination::bootstrap-5') }}

    </div>
@endsection

@push('js')
    <script>
        function diferencaEmDias(data1, data2) {
            const umDiaEmMs = 1000 * 60 * 60 * 24;
            const diferencaMs = new Date(data2) - new Date(data1);
            return Math.floor(diferencaMs / umDiaEmMs);
        }

        function sincValidade(validade, ordemproducao_id, dtConclusao) {
            axios.post(`/ordem-producao/${ordemproducao_id}/validade`, {
                "validade": validade
            });

            if (dtConclusao !== '' && validade !== '') {
                const displayValidade = document.getElementById('display-validade' + ordemproducao_id);
                let dias = diferencaEmDias(dtConclusao, validade);
                displayValidade.innerHTML = (dias > 0) ? `Validade  +${dias} dias` : `Validade ${dias} dias`;
            }
        }

        function imprimir(ordemproducao_id) {
            const url = `/ordem-producao/${ordemproducao_id}/imprimir`;
            window.location.href = url;
        }

        document.querySelectorAll('.accordion-collapse').forEach((item) => {
            item.addEventListener('shown.bs.collapse', () => {
                localStorage.setItem('accordionNotaOrdemProducao', item.id);
            });
            item.addEventListener('hidden.bs.collapse', () => {
                localStorage.removeItem('accordionNotaOrdemProducao');
            });
        });

        window.addEventListener('DOMContentLoaded', () => {
            const aberto = localStorage.getItem('accordionNotaOrdemProducao');
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
            const url = '{{ route("ordemproducao.relatorio.imprimir") }}';
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

        function subtrai(opId, dataConclusao) {
            const inputValidade = document.getElementById(`validade-${opId}`);
            if (!inputValidade) {
                console.warn("Elemento #validade não encontrado.");
                return;
            }
            let data = inputValidade.value !== '' ? new Date(inputValidade.value) : new Date();
            data.setDate(data.getDate() - 1);
            const dataFormatada = data.toISOString().split('T')[0];
            inputValidade.value = dataFormatada;
            sincValidade(dataFormatada, opId, dataConclusao);
        }

        function soma(opId, dataConclusao) {
            const inputValidade = document.getElementById(`validade-${opId}`);
            if (!inputValidade) {
                console.warn("Elemento #validade não encontrado.");
                return;
            }
            let data = inputValidade.value !== '' ? new Date(inputValidade.value) : new Date();
            data.setDate(data.getDate() + 1);
            const dataFormatada = data.toISOString().split('T')[0];
            inputValidade.value = dataFormatada;
            sincValidade(dataFormatada, opId, dataConclusao);
        }
    </script>
@endpush

@push('css')
    <style>
        body {
            background: #f4f4f4;
        }

        .validade {
            color: #2EB5C3 !important;
            border-color: #D5D5D5 !important;
            border-top: none !important;
            border-left: none !important;
            border-right: none !important;
        }

        .btn-validade {
            color: #2EB5C3 !important;
            border-color: #D5D5D5 !important;
        }
    </style>
@endpush
