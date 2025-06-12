@extends('layouts.app')

@section('content')
    <div class="container">
        <div class="card p-3">
            <form action="{{ $action == 'create' ? route('usuario.store') : route('usuario.update', $user->id) }}"
                method="POST">
                <div class="card-header">
                    <h2>{{ __('Novo Usuário') }}</h2>
                </div>

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
                            <li class="list-group-item">
                                <div class="form-check form-switch fs-5">
                                    <input class="form-check-input" type="checkbox" name="lojas[]"
                                        value="{{ $loja->id }}" id="loja-{{ $loja->id }}"
                                        @if ($user->lojas->contains($loja->id)) checked @endif>
                                    <label class="form-check-label" for="loja-{{ $loja->id }}">
                                        {{ $loja->nome_fantasia }}
                                    </label>
                                </div>
                                <ul class="list-group mt-2 ms-3">
                                    @foreach (\App\Models\Permissao::orderBy('nome')->get() as $permissao)
                                        <li class="list-group-item">
                                            <div class="form-check form-switch fs-5">
                                                <input class="form-check-input" type="checkbox" name="permissao[]"
                                                    value="{{ $permissao->id }}" id="permissao-{{ $permissao->id }}"
                                                    @if ($user->canPermissao($loja->id, $permissao->id)) checked
                                                                onchange="detachPermissao('{{ $user->id }}', '{{ $loja->id }}', '{{ $permissao->id }}')"
                                                                @else
                                                                onchange="attachPermissao('{{ $user->id }}', '{{ $loja->id }}', '{{ $permissao->id }}')" @endif>
                                                <label class="form-check-label" for="loja-{{ $permissao->id }}">
                                                    {{ $permissao->nome }}
                                                </label>
                                            </div>
                                        </li>
                                    @endforeach
                                </ul>

                            </li>
                        @endforeach
                    </ul>
                </div>

                <div class="card-footer d-flex justify-content-between">
                    <a href="{{ route('usuario.index') }}" class="btn btn-secondary">Cancelar</a>
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </form>
        </div>
    </div>
@endsection


@push('js')
    <script>
        function attachPermissao(userId, lojaId, permissaoId) {
            axios.post(`/usuario/${userId}/permissao`, {
                "loja_id": lojaId,
                "permissao_id": permissaoId,
            })
        }

        function detachPermissao(userId, lojaId, permissaoId) {
            axios.delete(`/usuario/${userId}/loja/${lojaId}/permissao/${permissaoId}`);
        }
    </script>
@endpush
