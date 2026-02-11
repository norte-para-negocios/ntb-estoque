@extends('layouts.app')

@section('filtro')
    <form id="filtrosForm" method="GET" action="{{ route('transfers.index') }}">
        <div class="row">
            <div class="col-6">
                <div class="mb-3">
                    <label for="data_inicio" class="form-label">Início</label>
                    <input title="Data criação Omie" type="date" class="form-control" id="data_inicio" name="data_inicio"
                        value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}">
                </div>
            </div>
            <div class="col-6">
                <div class="mb-3">
                    <label for="data_final" class="form-label">Final</label>
                    <input type="date" class="form-control" id="data_final" name="data_final"
                        value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}">
                </div>
            </div>
            <div class="col-12">
                <div class="mb-3">
                    <label for="familia" class="form-label">Família</label>
                    <select id="familia" name="familia" class="form-control">
                        <option value="">Todas as famílias</option>
                        @foreach(\App\Models\Produto::where('loja_id', auth()->user()->current_loja_id)->select('descricao_familia')->orderBy('descricao_familia')->distinct()->get() as $familia)
                            <option value="{{$familia->descricao_familia}}" {{ session('familia') === $familia->descricao_familia ? 'selected' : '' }}>
                                {{$familia->descricao_familia}}
                            </option>
                        @endforeach
                    </select>
                </div>
            </div>
            <div class="col-12">
                <div class="mb-3">
                    <label for="tipo" class="form-label">Tipo</label>
                    <select id="tipo" name="tipo" class="form-control">
                        <option value="">Todos os tipos</option>
                        <option value="00" {{ request('tipo', $tipo ?? '') == '00' ? 'selected' : '' }}>
                            Mercadoria para Revenda
                        </option>
                        <option value="01" {{ request('tipo', $tipo ?? '') == '01' ? 'selected' : '' }}>
                            Matéria Prima
                        </option>
                        <option value="02" {{ request('tipo', $tipo ?? '') == '02' ? 'selected' : '' }}>
                            Embalagem
                        </option>
                        <option value="03" {{ request('tipo', $tipo ?? '') == '03' ? 'selected' : '' }}>
                            Produto em Processo
                        </option>
                        <option value="04" {{ request('tipo', $tipo ?? '') == '04' ? 'selected' : '' }}>
                            Produto Acabado
                        </option>
                        <option value="05" {{ request('tipo', $tipo ?? '') == '05' ? 'selected' : '' }}>
                            Subproduto
                        </option>
                        <option value="06" {{ request('tipo', $tipo ?? '') == '06' ? 'selected' : '' }}>
                            Produto Intermediário
                        </option>
                        <option value="07" {{ request('tipo', $tipo ?? '') == '07' ? 'selected' : '' }}>
                            Material de Uso e Consumo
                        </option>
                        <option value="08" {{ request('tipo', $tipo ?? '') == '08' ? 'selected' : '' }}>
                            Ativo Imobilizado
                        </option>
                        <option value="09" {{ request('tipo', $tipo ?? '') == '09' ? 'selected' : '' }}>
                            Serviços
                        </option>
                        <option value="10" {{ request('tipo', $tipo ?? '') == '10' ? 'selected' : '' }}>
                            Outros Insumos
                        </option>
                        <option value="99" {{ request('tipo', $tipo ?? '') == '99' ? 'selected' : '' }}>
                            Outras
                        </option>
                    </select>
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
        <table class="table table-borderless mb-5" style="background-color: #f4f4f4;">
            <tbody>
                @if (isset($transferencias) && !empty($transferencias))
                    @foreach ($transferencias as $transferencia)
                        <tr style="background-color: #f4f4f4;">
                            <td class="m-0 px-0" style="background-color: #f4f4f4;">
                                <div class="container">
                                    <div class="row">
                                        <div class="col-12 p-0">
                                            <small class="text-muted">
                                                Data: {{$transferencia->data->format('d/m/Y')}}
                                            </small>
                                            <div class="card m-0">
                                                <div class="card-header d-flex justify-content-between"
                                                    style="font-size: .7rem; background-color: @if ($transferencia->status !== 'Concluído') #F24646 @else #2EB5C3 @endif;">
                                                    {{$transferencia->status}}
                                                    @if($transferencia->finalizado)
                                                        | {{$transferencia->finalizado->format('d/m/Y')}}
                                                    @endif
                                                </div>
                                                <div class="card-footer">
                                                    <div class="row">
                                                        
                                                        <div class="col-md-2 col-sm-3 col-3 d-flex justify-content-start align-items-center">
                                                            <div>
                                                                <small>Estoque</small><br>
                                                                <span class="fw-semibold">#{{$transferencia->id}}</span>
                                                            </div>
                                                        </div>
                                                        
                                                        <div
                                                            class="col-md-2 col-sm-3 col-9 d-flex justify-content-start align-items-center">
                                                            <div>
                                                                <small>Produtos</small><br>
                                                                <span class="fw-semibold">
                                                                    {{$transferencia->movimentos()->count() ?? 0}}
                                                                </span>
                                                            </div>
                                                        </div>
                                                            

                                                        <div class="col-md-3 col-sm-6 col-12 d-flex justify-content-start align-items-center">
                                                            <div>
                                                                <small>Local</small><br>
                                                                <span class="fw-semibold">
                                                                    {{$transferencia->localOrigem->descricao ?? ''}}
                                                                    -
                                                                    {{$transferencia->localDestino->descricao ?? ''}}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div
                                                            class="col-md-5 col-12 mt-3 mt-md-0 text-end ps-0 d-flex justify-content-end align-items-center p-0 pe-md-2 gap-1">
                                                            <a href="{{ route('transfers.contagem', $transferencia->id) }}"
                                                                class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold pt-2">
                                                                <img src="{{asset('images/editar.png')}}" alt="Imprimir" class="me-1">
                                                                Editar
                                                            </a>
                                                            @if($transferencia->status === 'Finalizado')
                                                                <button type="button"
                                                                    onclick="duplicarInventario('{{route('transfers.duplicar', $transferencia->id)}}')"
                                                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold pt-2"
                                                                    title="Duplicar Transferência">
                                                                    <img src="{{asset('images/duplicar.png')}}" alt="Duplicar" class="me-1">
                                                                    Duplicar
                                                                </button>
                                                            @endif
                                                            @if($transferencia->status !== 'Processando no Omie')
                                                                <a href="{{ route('transfers.pdf', $transferencia->id) }}"
                                                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold pt-2">
                                                                    <img src="{{asset('images/imprimir.png')}}" alt="Imprimir" class="me-1">
                                                                    Imprimir
                                                                </a>

                                                                <button type="button"
                                                                    onclick="deleteRegistro('{{ route('transfers.destroy', $transferencia->id) }}')"
                                                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold pt-2">
                                                                    <img src="{{asset('images/excluir.png')}}" alt="" class="me-1">Excluir
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
                        <td class="text-center">Nenhuma transferência encontrada</td>
                    </tr>
                @endif
            </tbody>
        </table>
        {{ $transferencias->links('pagination::bootstrap-5') }}
    </div>
    @include('transfers.create')

    <div class="container-fluid fixed-bottom">
        <div class="row bg-white">
            <div class="col d-flex justify-content-end align-items-center py-3">
                <button class="btn btn-success text-white" data-bs-toggle="modal" data-bs-target="#createInventarioModal">
                    <i class="fas fa-plus text-white"></i> Nova transferência
                </button>
            </div>
        </div>
    </div>
@endsection

@push('js')
    <script>
        function duplicarInventario(baseurl) {
            const hoje = new Date().toISOString().split('T')[0];
            swal.fire({
                title: 'Informe a data da transferência?',
                input: 'date',
                inputLabel: 'Data da transferência',
                inputPlaceholder: 'Escolha uma data',
                showCancelButton: true,
                confirmButtonText: 'Duplicar',
                cancelButtonText: 'Cancelar',
                inputAttributes: {
                    required: true,
                    max: hoje
                },
                preConfirm: (date) => {
                    if (!date) {
                        swal.showValidationMessage('Você precisa escolher uma data');
                    }
                    return date;
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    window.location.href = `${baseurl}?data=${encodeURIComponent(result.value)}`;
                }
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