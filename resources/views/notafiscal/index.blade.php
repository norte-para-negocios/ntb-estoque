@extends('layouts.app')

@section('content')
<div class="container-fluid">
    <!-- Main Application -->
    <div class="container" id="mainApp">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>NTB - Estoque</h1>
                <span>Controle de Estoque</span>
            </div>
            <div class="sidebar-menu">
                {{-- <div class="menu-item" onclick="showTab('dashboard')">
                    <i class="fas fa-chart-line"></i>
                    <span>Dashboard</span>
                </div>
                <div class="menu-item" onclick="toggleSubmenu('estoque')">
                    <i class="fas fa-boxes"></i>
                    <span>Estoque</span>
                </div>
                <div class="submenu" id="estoque-submenu">
                    <div class="menu-item" onclick="showTab('insumos')">
                        <i class="fas fa-carrot"></i>
                        <span>Insumos</span>
                    </div>
                    <div class="menu-item" onclick="showTab('produtos')">
                        <i class="fas fa-utensils"></i>
                        <span>Produtos Acabados</span>
                    </div>
                </div> --}}
                <div class="menu-item" onclick="toggleSubmenu('movimentacoes')">
                    <i class="fas fa-exchange-alt"></i>
                    <span>Movimentações</span>
                </div>
                <div class="submenu" id="movimentacoes-submenu">
                    {{-- <div class="menu-item" onclick="showTab('ordens')">
                        <i class="fas fa-clipboard-list"></i>
                        <span>Ordens de Produção</span>
                    </div>
                    <div class="menu-item" onclick="showTab('inventario')">
                        <i class="fas fa-cubes"></i>
                        <span>Inventário</span>
                    </div>
                    <div class="menu-item" onclick="showTab('transferencias')">
                        <i class="fas fa-truck"></i>
                        <span>Transferências</span>
                    </div> --}}
                    <div class="menu-item active" onclick="showTab('notas')">
                        <i class="fas fa-file-invoice"></i>
                        <span>Notas Fiscais</span>
                    </div>
                    {{-- <div class="menu-item" onclick="showTab('entrada-producao')">
                        <i class="fas fa-industry"></i>
                        <span>Entrada de Produção</span>
                    </div> --}}
                </div>
                {{-- <div class="menu-item" onclick="showTab('codigobarras')">
                    <i class="fas fa-barcode"></i>
                    <span>Códigos de Barras</span>
                </div>
                <div class="menu-item" onclick="showTab('relatorios')">
                    <i class="fas fa-chart-bar"></i>
                    <span>Relatórios</span>
                </div>
                <div class="menu-item" onclick="showTab('omie')">
                    <i class="fas fa-plug"></i>
                    <span>Integração Omie</span>
                </div> --}}
                {{-- <div class="menu-item" onclick="showTab('configuracoes')">
                    <i class="fas fa-cog"></i>
                    <span>Configurações</span>
                </div> --}}
            </div>
        </div>

        <!-- Main Content -->
        <div class="main-content">
            <div class="top-bar">
                <div class="page-title">
                    <h2>{{ __('Notas fiscais') }}</h2>
                </div>
                <div class="user-actions">
                    <div class="user-info">
                        {{-- <img src="{{ asset('images/user-placeholder.jpg') }}" alt="Usuário"> --}}
                        <div>
                            <div class="name">{{ Auth::user()->name ?? 'Usuário' }}</div>
                            {{-- <div class="role">{{ Auth::user()->role ?? 'Gerente' }}</div> --}}
                        </div>
                    </div>
                    @auth
                    <form action="{{ route('logout') }}" method="POST">
                        @csrf
                        <button type="submit" class="btn btn-secondary btn-sm">
                            <i class="fas fa-sign-out-alt"></i> Sair
                        </button>
                    </form>
                    @endauth
                </div>
            </div>

            @if (session('status'))
                <div class="alert alert-success" role="alert">
                    {{ session('status') }}
                </div>
            @endif

            <!-- Notas Fiscais -->
            <div class="tab-content active" id="notas-content">
                <div class="card">
                    {{-- <div class="card-header">
                        <h3>Notas Fiscais</h3>
                        <button class="btn btn-primary btn-sm">Nova Nota Fiscal</button>
                    </div> --}}
                    <div class="card-body">
                        <form action="{{ route('notafiscal.index') }}" method="GET" class="mb-4">
                            @csrf
                            <div class="form-group">
                                <label for="nf-filter">Filtrar por</label>
                                <div class="filter-row">
                                    <div>
                                        <label for="data_inicio">Data Início:</label>
                                        <input type="date" id="data_inicio" name="data_inicio" class="form-control" value="{{ request('data_inicio', $dataInicio ?? '') }}">
                                    </div>
                                    <div>
                                        <label for="data_final">Data Final:</label>
                                        <input type="date" id="data_final" name="data_final" class="form-control" value="{{ request('data_final', $dataFinal ?? '') }}">
                                    </div>
                                    <div>
                                        <label for="chave_nfe">Nota Fiscal:</label>
                                        <input type="text" id="chave_nfe" name="chave_nfe" class="form-control" value="{{ request('chave_nfe', $chaveNfe ?? '') }}">
                                    </div>
                                        <button type="submit" class="btn btn-secondary">Filtrar</button>
                                </div>
                            </div>
                        </form>
                       

                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead>
                                    <tr>
                                        <th>Número</th>
                                        <th>Data</th>
                                        <th>Razão Social</th>
                                        <th>Valor</th>
                                        <th>Etiqueta</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @dd($notasfiscais)
                                    @if(isset($notasfiscais->recebimentos) && !empty($notasfiscais))
                                        @foreach($notasfiscais->recebimentos as $nf)
                                        <tr>
                                            <td>{{ $nf->cabec->cNumeroNFe }}</td>
                                            <td>{{ $nf->cabec->dEmissaoNFe }}</td>
                                            <td>{{ $nf->cabec->cNome }}</td>
                                            {{-- <td>{{ $nf->cabec->nValorNFe }}</td> --}}
                                            <td name="Valor">R$ {{ number_format($nf->cabec->nValorNFe, 2, ',', '.') }}</td>
                                            {{-- <td><span class="badge bg-{{ $nf->status == 'Recebida' ? 'success' : 'warning' }}">{{ $nf->status }}</span></td> --}}
                                            <td class="actions">
                                                <button class="btn btn-accent btn-sm" onclick="showBarcodeModal({{ $nf->cabec->cNumeroNFe }})">
                                                    <i class="fas fa-barcode"></i> Imprimir
                                                </button>
                                                {{-- <a href="{{ route('notafiscal.show', $nf->cabec->cNumeroNFe, [], false) }}" class="btn btn-secondary btn-sm">
                                                    <i class="fas fa-eye"></i> Visualizar
                                                </a> --}}
                                            </td>
                                        </tr>
                                        @endforeach
                                    @else
                                        <tr>
                                            <td colspan="7" class="text-center">Nenhuma nota fiscal encontrada</td>
                                        </tr>
                                    @endif
                                </tbody>
                            </table>
                        </div>
                        
                        @if(isset($notasfiscais) && method_exists($notasfiscais, 'links'))
                            <div class="pagination-container">
                                {{ $notasfiscais->appends(request()->query())->links() }}
                            </div>
                        @endif
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Scripts para navegação e interatividade da interface -->
<script>
// Função para mostrar um conteúdo de tab específico
function showTab(tabId) {
    // Esconde todos os conteúdos de tab
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove a classe active de todos os itens de menu
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.classList.remove('active');
    });
    
    // Ativa o conteúdo do tab solicitado
    const tabContent = document.getElementById(tabId + '-content');
    if (tabContent) {
        tabContent.classList.add('active');
    }
    
    // Marca o item de menu como ativo
    const menuItems2 = document.querySelectorAll('.menu-item');
    menuItems2.forEach(item => {
        if (item.getAttribute('onclick') && item.getAttribute('onclick').includes(tabId)) {
            item.classList.add('active');
        }
    });
    
    // Atualiza o título da página
    updatePageTitle(tabId.charAt(0).toUpperCase() + tabId.slice(1));
}

// Função para alternar a visibilidade de um submenu
function toggleSubmenu(submenuId) {
    const submenu = document.getElementById(submenuId + '-submenu');
    if (submenu) {
        submenu.classList.toggle('show');
    }
}

// Função para atualizar o título da página
function updatePageTitle(title) {
    const pageTitle = document.querySelector('.page-title h2');
    if (pageTitle) {
        pageTitle.textContent = title === 'Notas' ? 'Notas Fiscais' : title;
    }
}

// Função para mostrar o modal de código de barras
function showBarcodeModal(cNumeroNFe) {
    // Aqui você implementaria a lógica para mostrar um modal com os códigos de barras
    alert('Gerando etiquetas para a nota fiscal #' + cNumeroNFe);
}

// Inicializar os submenus quando a página carregar
document.addEventListener('DOMContentLoaded', function() {
    // Mostra o submenu Movimentações por padrão
    const movimentacoesSubmenu = document.getElementById('movimentacoes-submenu');
    if (movimentacoesSubmenu) {
        movimentacoesSubmenu.classList.add('show');
    }
});
</script>
@endsection