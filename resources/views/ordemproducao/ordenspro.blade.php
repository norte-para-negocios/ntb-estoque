@extends('layouts.app')

@section('content')
    <div class="container-fluid">
        <!-- Main Content -->
        <div class="main-content">
            <div class="top-bar">
                <div class="page-title">
                    <h2>{{ __('Ordens de Produção') }}</h2>
                </div>
                <div>
                    <a href="#" class="nav-link" id="filtrosToggle">
                        <i class="fas fa-filter"></i>
                    </a>
                </div>
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
                            <form id="filtrosForm" method="GET" action="{{ route('notafiscal.ordenspro') }}">
                                <div class="row">
                                    <div class="col-md-3">
                                        <div class="mb-3">
                                            <label for="data_inicio" class="form-label">Data Início</label>
                                            <input title="Data criação omie" type="date" class="form-control"
                                                id="data_inicio" name="data_inicio"
                                                value="{{ request('data_inicio', $dataInicio ?? '') }}">
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="mb-3">
                                            <label for="data_final" class="form-label">Data Final</label>
                                            <input type="date" class="form-control" id="data_final" name="data_final"
                                                value="{{ request('data_final', $dataFinal ?? '') }}">
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
            </div>

            <div class="card-body-nf">
                <div class="table-responsive">
                    <table class="table table-hover">
                        <tbody>
                            @foreach ($ordenspro as $op)
                                <tr>
                                    <div class="row">
                                        <div class="col">
                                            <div class="card card-body">
                                                <h6>
                                                    Cód. OP: {{ $op->identificacao->cCodIntOP }}
                                                </h6>
                                                <p class="mb-0">
                                                    Lote : <strong>{{ $op->identificacao->cNumOP ?? '' }}</strong>
                                                </p>
                                                <p class="mt-1 mb-0">
                                                    Cód. Produto: {{ $op->identificacao->nCodProduto }}
                                                </p>
                                                <p class="mt-1 mb-0">
                                                    nCodOP: {{ $op->identificacao->nCodOP }}
                                                </p>
                                                <p class="mt-1 mb-0">
                                                    QTDE a Produzir.: {{ $op->identificacao->nQtde }}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
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
                    } else {
                        filtrosContainer.style.display = 'none';
                        filtrosToggle.innerHTML = '<i class="fas fa-filter"></i>';
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
                    filtrosToggle.innerHTML = '<i class="fas fa-filter"></i>';
                    localStorage.removeItem('filtrosVisiveis');
                }
            }
        });
    </script>
@endsection
