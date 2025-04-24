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
                    <div>
                        <a href="#" class="nav-link" id="filtrosToggle">
                            <i class="fas fa-filter"></i>
                        </a>
                    </div>
                    {{-- <div class="user-actions">
                        <div class="user-info">
                            <img src="{{ asset('images/user-placeholder.jpg') }}" alt="Usuário">
                            <div>
                                <div class="name">{{ Auth::user()->name ?? 'Usuário' }}</div>
                                <div class="role">{{ Auth::user()->role ?? 'Gerente' }}</div>
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
                    </div> --}}
                </div>

                @if (session('status'))
                    <div class="alert alert-success" role="alert">
                        {{ session('status') }}
                    </div>
                @endif

                <!-- Notas Fiscais -->
                <div class="tab-content active" id="notas-content">
                    <div id="filtrosContainer" class="container my-3" style="display: none;">
                        <div class="card">
                            <div class="card-body">
                                <form id="filtrosForm" method="GET" action="{{ route('notafiscal.index') }}">
                                    <div class="row">
                                        <div class="col-md-3">
                                            <div class="mb-3">
                                                <label for="data_inicio" class="form-label">Data Início</label>
                                                <input title="Data criação omie" type="date" class="form-control" id="data_inicio"
                                                    name="data_inicio"
                                                    value="{{ request('data_inicio', $dataInicio ?? '') }}">
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="mb-3">
                                                <label for="data_final" class="form-label">Data Final</label>
                                                <input type="date" class="form-control" id="data_final" name="data_final"
                                                    value="{{ request('data_final', $dataFinal ?? '') }}">
                                            </div>
                                        </div>
                                        <div class="col-md-3">
                                            <div class="mb-3">
                                                <label for="num_nfe" class="form-label">Número NFe</label>
                                                <input type="text" id="num_nfe" name="num_nfe" placeholder="Nº NFe"
                                                    class="form-control" value="{{ request('num_nfe', $numNFe ?? '') }}">
                                            </div>
                                        </div>
                                        <div class="col-md-3 d-flex align-items-end">
                                            <button type="submit" class="btn btn-primary me-2">
                                                <i class="fas fa-search"></i> Filtrar
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>

                    <div class="card-body-nf">
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <tbody>
                                    @if (isset($notasfiscais) && !empty($notasfiscais))
                                        @foreach ($notasfiscais as $nf)
                                            <tr>
                                                <div class="row">
                                                    <div class="col">
                                                        <div class="card card-body">
                                                            <h6>
                                                                {{ $nf->cabec->cNome }}
                                                            </h6>
                                                            <p class="mb-0">
                                                                Nº NFe: <strong>{{ $nf->cabec->cNumeroNFe ?? '' }}</strong>|
                                                                Emissão:
                                                                {{ $nf->cabec->dEmissaoNFe ?? '' }}
                                                            </p>
                                                            <p class="mt-1 mb-0">
                                                                R$
                                                                {{ number_format($nf->cabec->nValorNFe, 2, ',', '.') ?? '' }}
                                                            </p>
                                                            <p class="my-1">
                                                                <a href="{{ route('notafiscal.itens', $nf->cabec->nIdReceb) }}"
                                                                    class="btn btn-secondary btn-sm">
                                                                    <i class="fas fa-eye"></i> Visualizar
                                                                </a>
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </tr>
                                        @endforeach
                                    @else
                                        <tr>
                                            <td class="text-center">Nenhuma nota fiscal encontrada</td>
                                        </tr>
                                    @endif
                                </tbody>
                            </table>
                        </div>
                    </div>
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


        document.addEventListener('DOMContentLoaded', function() {
            const filtrosToggle = document.getElementById('filtrosToggle');
            const filtrosContainer = document.getElementById('filtrosContainer');

            if (filtrosToggle && filtrosContainer) {
                // Alternar visibilidade ao clicar no link
                filtrosToggle.addEventListener('click', function(e) {
                    e.preventDefault();

                    // Alternar entre Exibir e ocultar Filtros
                    if (filtrosContainer.style.display === 'none') {
                        filtrosContainer.style.display = 'block';
                        filtrosToggle.innerHTML =
                            '<i class="fas fa-filter"></i>';
                            // '<i class="fas fa-filter"></i> Ocultar Filtros';
                    } else {
                        filtrosContainer.style.display = 'none';
                        filtrosToggle.innerHTML =
                            '<i class="fas fa-filter"></i>';
                            // '<i class="fas fa-filter"></i> Exibir Filtros';
                    }

                    // Adicionar animação suave (opcional)
                    filtrosContainer.style.transition = 'all 0.3s ease';
                });

                // Manter estado após submit (opcional)
                const filtrosForm = document.getElementById('filtrosForm');
                if (filtrosForm) {
                    filtrosForm.addEventListener('submit', function() {
                        localStorage.setItem('filtrosVisiveis', 'true');
                    });
                }

                // Verificar estado anterior (opcional)
                if (localStorage.getItem('filtrosVisiveis') === 'true') {
                    filtrosContainer.style.display = 'block';
                    filtrosToggle.innerHTML =
                        '<i class="fas fa-filter"></i>';
                        // '<i class="fas fa-filter"></i> Ocultar Filtros';
                    localStorage.removeItem('filtrosVisiveis');
                }
            }
        });
    </script>
@endsection
