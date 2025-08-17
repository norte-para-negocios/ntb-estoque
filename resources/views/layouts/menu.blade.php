<h5 class="mb-3">MENU</h5>

<h5 class="mb-3">Bem-vindo(a), {{ Auth::user()->name }}</h5>

<div class="d-grid mb-4">
    <h6 class="mb-0">Escolha uma Loja</h6>
    <select class="form-control" onchange="changeLoja(this)">
        <option value="">SELECIONE UMA LOJA</option>
        @foreach (Auth::user()->lojas as $loja)
            <option value="{{ $loja->id }}" @if (Auth::user()->current_loja_id == $loja->id) selected @endif>
                {{ $loja->nome_fantasia }}
            </option>
        @endforeach
    </select>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('notafiscal.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-file-invoice me-3"></i>Notas Fiscais
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('ordemproducao.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-clipboard-list me-3"></i>Ordens de Produção
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('transferencia.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-truck me-3"></i>Transferências
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('inventario.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-cubes me-3"></i>Inventário
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('relatorio.ordemproducao.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-print me-3"></i>Relatório de Ordens de Produção
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('relatorio.notafiscal.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-print me-3"></i>Relatório de Nota Fiscal
    </a>
</div>

@if (Auth::user()->perfil === 'Admin')
    <div class="d-grid gap-2 mb-2">
        <a href="{{ route('loja.index') }}" class="btn btn-secondary text-start">
            <i class="fas fa-building me-3"></i>Lojas
        </a>
    </div>
@endif

@if (Auth::user()->perfil === 'Admin')
    <div class="d-grid gap-2 mb-2">
        <a href="{{ route('usuario.index') }}" class="btn btn-secondary text-start">
            <i class="fas fa-users me-3"></i>Usuários
        </a>
    </div>
@endif

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('logout') }}" class="btn btn-secondary text-start"
        onclick="event.preventDefault();
        document.getElementById('logout-form').submit();">
        <i class="fas fa-arrow-right-from-bracket me-3"></i>Sair
    </a>
    <form id="logout-form" action="{{ route('logout') }}" method="POST" class="d-none">
        @csrf
    </form>
</div>

@push('js')
    <script>
        if (typeof usuarioLogado === "undefined") {
            const usuarioLogado = '';
        }

        window.onload = function() {
            usuarioLogado = '{{ Auth::id() }}';
        };

        function changeLoja(el) {
            console.log("O DOM está pronto!", usuarioLogado);
            axios.post(`/usuario/${usuarioLogado}/loja/${el.value}`).then(function(r) {
                console.log(r);
            }).catch(function(e) {
                console.log(e);
            });
        }
    </script>
@endpush
