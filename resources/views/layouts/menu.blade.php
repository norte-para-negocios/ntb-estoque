<div class="d-grid mb-4">
    <h6>Acessando:</h6>
    <select class="form-control" onchange="changeLoja(this)">
        <option value="">Seleciona uma loja</option>
        @foreach (Auth::user()->lojas as $loja)
            <option value="{{ $loja->id }}" @if (Auth::user()->current_loja_id == $loja->id) selected @endif>
                {{ $loja->nome_fantasia }}
            </option>
        @endforeach
    </select>
</div>

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('home.index') }}" class="text-start text-decoration-none fw-bold">
        <img src="{{asset('images/home.png')}}"> Página Inicial
    </a>
</div>

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('notafiscal.index') }}" class="text-start text-decoration-none fw-bold">
        <img src="{{asset('images/nota-fiscal.png')}}"> Notas Fiscais
    </a>
</div>

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('ordemproducao.index') }}" class="text-start text-decoration-none fw-bold">
        <img src="{{asset('images/ordem-producao.png')}}" alt=""> Ordens de Produção
    </a>
</div>

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('transferencia.index') }}" class="text-start text-decoration-none fw-bold">
        <img src="{{asset('images/transferencia.png')}}" alt=""> Transferências
    </a>
</div>

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('inventario.index') }}" class="text-start text-decoration-none fw-bold">
        <img src="{{asset('images/inventario.png')}}" alt=""> Inventário
    </a>
</div>


<div class="d-grid gap-2 mb-4">
    <a href="{{ route('produto.index') }}" class="text-start text-decoration-none fw-bold">
        <i class="fa-brands fa-product-hunt me-3"></i>Produtos
    </a>
</div>

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('locais-estoque.index') }}" class="text-start text-decoration-none fw-bold">
        <i class="fa-solid fa-boxes-stacked me-3"></i>Locais de Estoque
    </a>
</div>

@if (auth()->user()->perfil === 'Admin')
    <div class="d-grid gap-2 mb-4">
        <a href="{{ route('loja.index') }}" class="text-start text-decoration-none fw-bold">
            <i class="fas fa-building me-3"></i>Lojas
        </a>
    </div>
    <div class="d-grid gap-2 mb-4">
        <a href="{{ route('usuario.index') }}" class="text-start text-decoration-none fw-bold">
            <i class="fas fa-users me-3"></i> Usuários
        </a>
    </div>

    <div class="d-grid gap-2 mb-4">
        <a href="{{ route('log.index') }}" class="text-start text-decoration-none fw-bold">
            <i class="fa-solid fa-bug me-3"></i>Logs de Integração
        </a>
    </div>
@endif

<div class="d-grid gap-2 mb-4">
    <a href="{{ route('logout') }}" class="text-start text-decoration-none fw-bold"
       onclick="event.preventDefault();
        document.getElementById('logout-form').submit();">
        <img src="{{asset('images/sair.png')}}" alt=""> Sair
    </a>
    <form id="logout-form" action="{{ route('logout') }}" method="POST" class="d-none">
        @csrf
    </form>
</div>

@push('js')
    <script>
        let usuarioLogado = '';

        window.onload = function () {
            usuarioLogado = '{{ Auth::id() }}';
        };

        function changeLoja(el) {
            axios.post(`/usuario/${usuarioLogado}/loja/${el.value}`);
        }
    </script>
@endpush
