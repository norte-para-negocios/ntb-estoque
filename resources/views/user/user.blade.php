@extends('layouts.app')

@section('content')
    <div class="container">
        <p class="mb-4 fw-semibold d-flex align-items-center justify-content-between">
            <span>
                <a href="{{route('home.index')}}" class="btn m-0 p-0" title="Voltar">
                    <img src="{{asset('images/voltar.png')}}" alt="<-">
                </a>
                <img class="ms-0 p-0" src="{{asset('images/usuario.png')}}" alt="Usuário">
                @if($action == "create")
                    {{ __('Novo Usuário') }}
                @else
                    {{ __('Editando Usuário: ' . $user->name) }}
                @endif
            </span>
        </p>

        <div class="card p-3">
            <form action="{{ $action == 'create' ? route('usuario.store') : route('usuario.update', $user->id) }}"
                  method="POST">
                <div class="card-body">
                    @csrf
                    @if ($action == 'create')
                        @method('POST')
                    @else
                        @method('PUT')
                    @endif
                    <div class="mb-3">
                        <label for="name" class="form-label">Nome do Usuário</label>
                        <input type="text" class="form-control" id="name" name="name"
                               placeholder="Nome do Usuário" minlength="5" maxlength="255" required
                               value="{{ $user->name }}">
                    </div>
                    <div class="mb-3">
                        <label for="email" class="form-label">E-mail</label>
                        <input type="email" class="form-control" id="email" name="email"
                               placeholder="name@example.com" minlength="10" maxlength="255" required
                               value="{{ $user->email }}">
                    </div>

                    <div>
                        <label for="perfil" class="form-label">Perfil de Acesso</label>
                        <select class="form-control" id="perfil" name="perfil" required>
                            <option value="Usuário" @if($user->perfil === "Usuário") selected @endif>Usuário</option>
                            <option value="Admin" @if($user->perfil === "Admin") selected @endif>Admin</option>
                        </select>
                    </div>
                </div>

                <div class="card-body">
                    <h4>LOJAS</h4>
                    <ul class="list-group">
                        @foreach (\App\Models\Loja::orderBy('nome_fantasia')->get() as $loja)
                            <li class="list-group-item mb-4">
                                <div class="form-check form-switch text-success fs-5">
                                    <input class="form-check-input" type="checkbox" name="lojas[]"
                                           value="{{ $loja->id }}" id="loja-{{ $loja->id }}"
                                           @if ($user->lojas->contains($loja->id)) checked @endif>
                                    <label class="form-check-label" for="loja-{{ $loja->id }}">
                                        {{ $loja->nome_fantasia }}
                                    </label>
                                </div>

                                <div class="row">
                                    <div class="col">
                                        <h4 class="mt-3">Permissões</h4>
                                        <div class="form-check form-switch fs-5 ms-3 mb-1 text-primary">
                                            <input class="form-check-input" type="checkbox"
                                                   id="all-permissoes-{{ $loja->id }}"
                                                   @if ($user->hasAllPermissoes($loja->id)) checked @endif
                                                   onchange="toggleAllPermissoes(this, '{{ $user->id }}', '{{ $loja->id }}')">
                                            <label class="form-check-label fw-semibold" for="all-permissoes-{{ $loja->id }}">
                                                Marcar/Desmarcar todas
                                            </label>
                                        </div>
                                        <ul class="list-group ms-3" id="permissoes-{{ $loja->id }}">
                                            @foreach (\App\Models\Permissao::orderBy('nome')->get() as $permissao)
                                                <li class="list-group-item">
                                                    <div class="form-check form-switch fs-5">
                                                        <input class="form-check-input" type="checkbox" name="permissao[]"
                                                               value="{{ $loja->id }}|{{ $permissao->id }}"
                                                               id="permissao-{{ $loja->id }}-{{ $permissao->id }}"
                                                               @if ($user->canPermissao($loja->id, $permissao->id)) checked
                                                               onchange="detachPermissao('{{ $user->id }}', '{{ $loja->id }}', '{{ $permissao->id }}')"
                                                               @else
                                                                   onchange="attachPermissao('{{ $user->id }}', '{{ $loja->id }}', '{{ $permissao->id }}')" @endif>
                                                        <label class="form-check-label" for="permissao-{{ $loja->id }}-{{ $permissao->id }}">
                                                            {{ $permissao->nome }}
                                                        </label>
                                                    </div>
                                                </li>
                                            @endforeach
                                        </ul>
                                    </div>

                                    <div class="col">
                                        <h4 class="mt-3">Locais de Estoque</h4>
                                        <div class="form-check form-switch fs-5 ms-3 mb-1 text-primary">
                                            <input class="form-check-input" type="checkbox"
                                                   id="all-locais-{{ $loja->id }}"
                                                   @if ($user->hasAllLocais($loja->id)) checked @endif
                                                   onchange="toggleAllLocais(this, '{{ $user->id }}', '{{ $loja->id }}')">
                                            <label class="form-check-label fw-semibold" for="all-locais-{{ $loja->id }}">
                                                Marcar/Desmarcar todos
                                            </label>
                                        </div>
                                        <ul class="list-group ms-3" id="locais-{{ $loja->id }}">
                                            @foreach (\App\Models\LocalEstoque::where('loja_id', $loja->id)->orderBy('descricao')->get() as $local)
                                                <li class="list-group-item">
                                                    <div class="form-check form-switch fs-5">
                                                        <input class="form-check-input" type="checkbox" name="local[]"
                                                               value="{{ $loja->id }}|{{ $local->id }}"
                                                               id="local-{{ $loja->id }}-{{ $local->id }}"
                                                               @if ($user->locais()->where('local_estoque_user.loja_id', $loja->id)->where('local_estoque_user.local_estoque_id', $local->id)->exists())
                                                                   checked onchange="detachLocal('{{ $user->id }}', '{{ $loja->id }}', '{{ $local->id }}')"
                                                               @else
                                                                   onchange="attachLocal('{{ $user->id }}', '{{ $loja->id }}', '{{ $local->id }}')"
                                                               @endif
                                                        >
                                                        <label class="form-check-label" for="local-{{ $loja->id }}-{{ $local->id }}">
                                                            {{ $local->descricao }}
                                                        </label>
                                                    </div>
                                                </li>
                                            @endforeach
                                        </ul>
                                    </div>
                                </div>
                            </li>
                            <hr>
                        @endforeach
                    </ul>
                </div>
                <div class="card-footer d-flex justify-content-between">
                    <a href="{{ route('usuario.index') }}" class="btn btn-secondary">Cancelar</a>
                    <button type="submit" class="btn btn-success">Salvar</button>
                </div>
            </form>
        </div>
    </div>
@endsection

@push('js')
    <script>
        function updateSelectAllToggle(lojaId) {
            const checkboxes = document.querySelectorAll(`#permissoes-${lojaId} input[type="checkbox"]`);
            const allChecked = Array.from(checkboxes).every(checkbox => checkbox.checked);
            const masterToggle = document.getElementById(`all-permissoes-${lojaId}`);
            if (masterToggle) {
                masterToggle.checked = allChecked;
            }
        }

        function attachPermissao(userId, lojaId, permissaoId) {
            axios.post(`/usuario/${userId}/permissao`, {
                "loja_id": lojaId,
                "permissao_id": permissaoId,
            }).then(() => {
                updateSelectAllToggle(lojaId);
            })
        }

        function detachPermissao(userId, lojaId, permissaoId) {
            axios.delete(`/usuario/${userId}/loja/${lojaId}/permissao/${permissaoId}`).then(() => {
                updateSelectAllToggle(lojaId);
            });
        }

        function updateSelectAllLocaisToggle(lojaId) {
            const checkboxes = document.querySelectorAll(`#locais-${lojaId} input[type="checkbox"]`);
            const allChecked = Array.from(checkboxes).every(checkbox => checkbox.checked);
            const masterToggle = document.getElementById(`all-locais-${lojaId}`);
            if (masterToggle) {
                masterToggle.checked = allChecked;
            }
        }

        function attachLocal(userId, lojaId, localId) {
            axios.post(`/usuario/${userId}/local`, {
                "loja_id": lojaId,
                "local_id": localId,
            }).then(() => {
                updateSelectAllLocaisToggle(lojaId);
            })
        }

        function detachLocal(userId, lojaId, localId) {
            axios.delete(`/usuario/${userId}/loja/${lojaId}/local/${localId}`).then(() => {
                updateSelectAllLocaisToggle(lojaId);
            });
        }

        function toggleAllPermissoes(masterEl, userId, lojaId) {
            const checkboxes = document.querySelectorAll(`#permissoes-${lojaId} input[type="checkbox"]`);
            checkboxes.forEach(checkbox => {
                if (checkbox.checked === masterEl.checked) return;
                checkbox.checked = masterEl.checked;
                const permissaoId = checkbox.value.split('|')[1];
                masterEl.checked
                    ? attachPermissao(userId, lojaId, permissaoId)
                    : detachPermissao(userId, lojaId, permissaoId);
            });
        }

        function toggleAllLocais(masterEl, userId, lojaId) {
            const checkboxes = document.querySelectorAll(`#locais-${lojaId} input[type="checkbox"]`);
            checkboxes.forEach(checkbox => {
                if (checkbox.checked === masterEl.checked) return;
                checkbox.checked = masterEl.checked;
                const localId = checkbox.value.split('|')[1];
                masterEl.checked
                    ? attachLocal(userId, lojaId, localId)
                    : detachLocal(userId, lojaId, localId);
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
