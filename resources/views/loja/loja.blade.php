@extends('layouts.app')

@section('content')
    <div class="container">
        <div class="row d-flex justify-content-center">
            <div class="col-md-8 col-12">
                <div class="card">
                    <form action="{{ $action == 'create' ? route('loja.store') : route('loja.update', $loja->id) }}"
                          method="POST" id="formLoja">
                        <div class="card-header">
                            <h2 class="my-4">
                                <a href="{{route('loja.index')}}" class="btn btn-sm btn-outline-primary mb-1"
                                   title="Voltar">
                                    <i class="fa-solid fa-arrow-left-long"></i>
                                </a>
                                @if ($action == 'create')
                                    {{ __('Nova Loja') }}
                                @else
                                    {{ __('Editando Loja: ') . $loja->nome }}
                                @endif
                            </h2>
                            <p>
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" role="switch" id="switchCheckDefault"
                                       name="ativo"
                                       @if ($loja->ativo) checked @endif>
                                <label class="form-check-label" for="switchCheckDefault">Loja Ativa</label>
                            </div>
                            </p>
                        </div>

                        <div class="card-body">
                            @csrf
                            @if ($action == 'create')
                                @method('POST')
                            @else
                                @method('PUT')
                            @endif
                            <div class="mb-4 row align-items-center">
                                <label for="pj_cnpj" class="form-label col-sm-3 col-form-label">CNPJ</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control cnpj" id="pj_cnpj" name="cnpj"
                                           onblur="getPessoaJuridica(this.value, '#pj_nome', '#pj_fantasia', '#pj_cep', '#pj_uf', '#pj_cidade', '#pj_bairro', '#pj_logradouro', '#pj_numero')"
                                           required value="{{ $loja->cnpj }}">
                                    <div id="pj-feedback" class="mt-2"></div>
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_nome" class="form-label col-sm-3 col-form-label">Nome</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="pj_nome" name="nome" required
                                           value="{{ $loja->nome }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_fantasia" class="form-label col-sm-3 col-form-label">Nome
                                    fantasia</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="pj_fantasia" name="fantasia" required
                                           value="{{ $loja->nome_fantasia }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_cep" class="form-label col-sm-3 col-form-label">CEP</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control cep" id="pj_cep" name="cep"
                                           value="{{ $loja->cep }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_logradouro" class="form-label col-sm-3 col-form-label">Logradouro</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="pj_logradouro" name="logradouro"
                                           value="{{ $loja->logradouro }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_numero" class="form-label col-sm-3 col-form-label">Número</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="pj_numero" name="numero"
                                           value="{{ $loja->numero }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_bairro" class="form-label col-sm-3 col-form-label">Bairro</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="pj_bairro" name="bairro"
                                           value="{{ $loja->bairro }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_cidade" class="form-label col-sm-3 col-form-label">Cidade</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="pj_cidade" name="cidade"
                                           value="{{ $loja->cidade }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="pj_uf" class="form-label col-sm-3 col-form-label">UF</label>
                                <div class="col-sm-9">
                                    <select class="form-control" id="pj_uf" name="uf">
                                        @foreach (\App\Helpers\Constants::UF as $key => $value)
                                            <option value="{{ $key }}"
                                                    @if ($key == $loja->uf) selected @endif>{{ $value }}
                                            </option>
                                        @endforeach
                                    </select>
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="omie_app_key" class="form-label col-sm-3 col-form-label">OMIE - KEY</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="omie_app_key" name="omie_app_key"
                                           value="{{ $loja->omie_app_key }}">
                                </div>
                            </div>

                            <div class="mb-4 row align-items-center">
                                <label for="omie_app_secret" class="form-label col-sm-3 col-form-label">OMIE -
                                    SECRET</label>
                                <div class="col-sm-9">
                                    <input type="text" class="form-control" id="omie_app_secret"
                                           name="omie_app_secret" value="{{ $loja->omie_app_secret }}">
                                </div>
                            </div>

                        </div>
                        <div class="card-body d-flex justify-content-between">
                            <a href="{{ route('loja.index') }}" class="btn btn-secondary">Cancelar</a>
                            <button type="submit" class="btn btn-primary" form="formLoja">Salvar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <script>
        @php
            include resource_path('js/getPessoaJuridica.js');
        @endphp
    </script>
@endsection
