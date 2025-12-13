@extends('layouts.app')
@push('css')

    <style>
        body {
            background-color: #F4F4F4;
        }
        .table-fixed {
            table-layout: fixed;
            width: 100%;
        }

        .table-fixed td {
            white-space: normal; /* permite quebra de linha */
            overflow-wrap: break-word; /* quebra palavras grandes */
        }
    </style>

@endpush
@section('content')
    <div class="container">
        <p class="mb-4 fw-semibold">
            <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>
            <img class="ms-0 p-0" src="{{asset('images/log.png')}}" alt="Log">
            {{ __('Logs de Integração com APIs') }}
        </p>

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
                        <form id="filtrosForm" method="GET" action="{{ route('log.index') }}">
                            @csrf
                            <div class="row g-1">
                                <div class="col-md-3">
                                    <div class="row g-1">
                                        <div class="col-lg-6 col-12">
                                            <div class="mb-3">
                                                <label for="data_inicio" class="form-label">Data Início</label>
                                                <input title="Data registro início" type="datetime-local"
                                                       class="form-control"
                                                       id="data_inicio" name="data_inicio"
                                                       value="{{ request('data_inicio', $data_inicio ? $data_inicio->format('Y-m-d') : date('Y-m-d')) }}"
                                                       required>
                                            </div>
                                        </div>
                                        <div class="col-lg-6 col-12">
                                            <div class="mb-3">
                                                <label for="data_final" class="form-label">Data Final</label>
                                                <input title="Data registro final" type="datetime-local"
                                                       class="form-control" id="data_final"
                                                       name="data_final"
                                                       value="{{ request('data_final', $data_final ? $data_final->format('Y-m-d') : date('Y-m-d')) }}"
                                                       required>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-1">
                                    <div class="mb-3">
                                        <label for="loja_id" class="form-label">Loja</label>
                                        <select id="loja_id" name="loja_id" class="form-control" required>
                                            @foreach(\App\Models\Loja::orderBy('nome_fantasia')->get() as $loja)
                                                <option
                                                    value="{{$loja->id}}" {{ request('loja_id', $loja_id ?? '') == $loja->id ? 'selected' : '' }}>
                                                    {{$loja->nome_fantasia}}
                                                </option>
                                            @endforeach
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="model" class="form-label">Model</label>
                                        <select id="model" name="model" class="form-control" required>
                                            @foreach(\App\Models\IntegrationAttempt::groupBy('model')->select('model')->get() as $item)
                                                <option
                                                    value="{{$item->model}}" {{ request('model', $model ?? '') == $item->model ? 'selected' : '' }}>
                                                    {{$item->model}}
                                                </option>
                                            @endforeach
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="request_field" class="form-label">Request</label>
                                        <input type="text" id="request_field" name="request_field"
                                               class="form-control" value="{{ request('request_field', $request_field ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="response_field" class="form-label">Response</label>
                                        <input type="text" id="response_field" name="response_field"
                                               class="form-control" value="{{ request('response_field', $response_field ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="code" class="form-label">Http Code</label>
                                        <input type="number" step="1" id="code" name="code" class="form-control"
                                               value="{{ request('code', $code ?? '') }}">
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-3">
                                        <label for="status" class="form-label">Status</label>
                                        <select id="status" name="status" class="form-control">
                                            <option value="">Todos</option>
                                            <option
                                                value="1" {{ request('status', $status ?? '') == '1' ? 'selected' : '' }}>
                                                Erro
                                            </option>
                                            <option
                                                value="0" {{ request('status', $status ?? '') == '0' ? 'selected' : '' }}>
                                                Sucesso
                                            </option>
                                        </select>
                                    </div>
                                </div>

                                <div class="col-md-3 d-flex align-items-end">
                                    <div class="mb-3">
                                        <button type="submit" class="btn btn-success">
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
            <table class="table table-striped table-fixed">
                <thead>
                <tr>
                    <th>Log</th>
                </tr>
                </thead>
                <tbody>
                @foreach ($logs as $log)
                    <tr>
                        <td class="text-wrap">
                            <div class="row">
                                <div class="col">
                                    <p>
                                        #{{$log->id}}<br>
                                        Data: {{$log->created_at->format('d/m/Y H:i:s')}}
                                    </p>

                                    <p class="text-wrap">
                                        <span>Request:</span><br>
                                        {{$log->request??''}}
                                    </p>

                                    <p>
                                        <span>Response:</span><br>
                                        {{$log->response??''}}
                                    </p>

                                    <p>
                                        <span>Error:</span><br>
                                        {{$log->error_message??''}}
                                    </p>

                                </div>
                            </div>
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
            {{ $logs->links('pagination::bootstrap-5') }}
        </div>
    </div>
@endsection
