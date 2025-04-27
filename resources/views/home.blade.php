<!DOCTYPE html>
<html lang="pt-BR">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FoodStock - Menu</title>
    <!-- Fonts -->
    <link rel="dns-prefetch" href="//fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=Nunito" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    <!-- Scripts -->
    @vite(['resources/sass/home.scss', 'resources/js/app.js'])
</head>

<body>
    <div class="container">
        <!-- Sidebar Menu -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>NTB Estoque</h1>
                <span>Controle de Estoque</span>
            </div>
            <div class="sidebar-menu">
                <!-- Links principais conforme solicitado -->
                <div class="menu-item" onclick="window.location.href='{{ route('notafiscal.index') }}'">
                    <i class="fas fa-file-invoice"></i>
                    <span>Notas Fiscais</span>
                </div>
                <div class="menu-item" onclick="window.location.href='{{ route('notafiscal.ordenspro') }}'">
                    <i class="fas fa-clipboard-list"></i>
                    <span>Ordens de Produção</span>
                </div>
                <div class="menu-item" onclick="window.location.href='{{ route('home.index') }}'">
                    <i class="fas fa-cubes"></i>
                    <span>Inventário</span>
                </div>
                <div class="menu-item" onclick="window.location.href='{{ route('home.index') }}'">
                    <i class="fas fa-truck"></i>
                    <span>Transferências</span>
                </div>

                <!-- Separador -->
                <div class="menu-separator"></div>

                <!-- Autenticação -->
                <div class="auth-section">
                    <div class="auth-buttons">
                        {{-- <div class="menu-item auth-item" onclick="window.location.href='/login'">
                            <i class="fas fa-sign-in-alt"></i>
                            <span>Login</span>
                        </div>
                        <div class="menu-item auth-item" onclick="window.location.href='/register'">
                            <i class="fas fa-user-plus"></i>
                            <span>Register</span>
                        </div> --}}

                        {{-- <div class="menu-item auth-item logout" onclick="window.location.href='{{ route('logout') }}'">
                            <i class="fas fa-sign-out-alt"></i>
                            <span>Logout</span>
                        </div> --}}

                        <div class="menu-item auth-item logout">
                            <a href="{{ route('logout') }}"
                                onclick="event.preventDefault();
                                             document.getElementById('logout-form').submit();">
                                <i class="fas fa-sign-out-alt"></i>
                                <span>Logout</span>
                            </a>

                            <form id="logout-form" action="{{ route('logout') }}" method="POST" class="d-none">
                                @csrf
                            </form>
                        </div>


                    </div>
                </div>

                <!-- Informações do usuário (quando logado) -->
                <div class="user-info">
                    {{-- <img src="/img/user-placeholder.jpg" alt="Usuário"> --}}
                    <div class="user-details">
                        <div class="name">{{ Auth::user()->name }}</div>
                        {{-- <div class="role">Função</div> --}}
                    </div>
                </div>
            </div>
        </div>

        <!-- Conteúdo principal -->
        <div class="main-content">
            <div class="top-bar">
                <button class="menu-toggle" id="menuToggle">
                    <i class="fas fa-bars"></i>
                </button>
                <div class="page-title">
                    <h2>FoodStock Menu</h2>
                </div>
            </div>
            <div class="content-placeholder">
                <p>Selecione uma opção no menu para continuar.</p>
            </div>
        </div>
    </div>

    <script>
        // Script para toggle do menu em dispositivos móveis
        document.getElementById('menuToggle').addEventListener('click', function() {
            document.querySelector('.sidebar').classList.toggle('show');
        });

        // Marcar o item de menu ativo
        const menuItems = document.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', function() {
                menuItems.forEach(i => i.classList.remove('active'));
                this.classList.add('active');
            });
        });
    </script>
</body>

</html>
