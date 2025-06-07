<h5 class="mb-3">MENU</h5>

<h5 class="mb-3">Bem-vindo(a), {{ Auth::user()->name }}</h5>

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
    <a href="{{ route('notafiscal.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-cubes me-3"></i>Inventário
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('transferencia.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-truck me-3"></i>Transferências
    </a>
</div>

<div class="d-grid gap-2 mb-2">
    <a href="{{ route('usuario.index') }}" class="btn btn-secondary text-start">
        <i class="fas fa-users me-3"></i>Usuários
    </a>
</div>

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
