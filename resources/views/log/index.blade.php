@extends('layouts.app')
@push('css')

    <style>
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
        <h2 class="mb-3">
            <a href="{{route('home.index')}}" class="btn btn-sm btn-outline-primary mb-1" title="Voltar">
                <i class="fa-solid fa-arrow-left-long"></i>
            </a>
            {{ __('Logs de Integração com APIs') }}
        </h2>

        <div class="card card-body mt-4">
            <div class="row">
                <div class="col-md-9 col-12">
                    <form class="d-flex align-items-end" role="search" action="{{route('log.index')}}" method="GET">
                        @csrf
                        <input class="form-control me-2" type="search" placeholder="Pesquisar" aria-label="Search"
                               name="search"/>
                        <button class="btn btn-outline-primary" type="submit">Pesquisar</button>
                    </form>
                </div>
            </div>

        </div>
        <div class="card card-body mt-4">
            <table class="table table-hover table-fixed">
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
