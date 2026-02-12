<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <!-- CSRF Token -->
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>
        {{ config('app.name', 'NTB - Estoque') }}
        {{ isset(auth()->user()->current_loja_id) ? '| ' . auth()->user()->loja->nome_fantasia : ''}}
    </title>

    <!-- Fonts -->
    <link rel="dns-prefetch" href="//fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=Nunito" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    <script>
        window.reverbConfig = @json([
            'key' => config('broadcasting.connections.reverb.key'),
            'host' => config('broadcasting.connections.reverb.options.host'),
            'port' => config('broadcasting.connections.reverb.options.port'),
            'scheme' => config('broadcasting.connections.reverb.options.scheme'),
        ]);
    </script>
    <!-- Scripts -->
    @vite(['resources/sass/app.scss', 'resources/js/app.js'])
    @stack('css')
    <style>
        #loader {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        }
    </style>
</head>

<body>
    <div id="loader">
        <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Carregando...</span>
        </div>
    </div>

    <div id="app">
        <nav class="navbar navbar-expand-lg ntb-header bg-white">
            <div class="container-fluid">
                <div class="d-flex justify-content-start align-items-center">
                    <button type="button" data-bs-toggle="offcanvas" data-bs-target="#offcanvasMenu"
                        aria-controls="offcanvasMenu" class="btn btn-lg">
                        <img src="{{asset('images/menu.png')}}" alt="">
                    </button>

                    <a class="navbar-brand ntb-logo ms-2" href="{{ route('home.index') }}">
                        <img src="{{asset('ntb-logo.png')}}" alt="{{ config('app.name', 'NTB - Estoque') }}">
                    </a>
                </div>
                @auth
                    @if(in_array(Route::currentRouteName(), ['notafiscal.index', 'ordemproducao.index', 'transferencia.index', 'transfers.index', 'inventario.index', 'transfers.contagem', 'inventario.contagem']))
                        <button type="button" data-bs-toggle="offcanvas" data-bs-target="#offcanvasFiltro"
                            aria-controls="offcanvasFiltro" class="btn fw-semibold" id="btn-filtrar">
                            <img src="{{asset('images/filtrar.png')}}" alt="Botão Filtrar"> Filtrar
                        </button>
                    @endif
                @endauth
            </div>
        </nav>

        <div class="offcanvas offcanvas-start" tabindex="-1" id="offcanvasMenu" aria-labelledby="offcanvasMenuLabel">
            <div class="offcanvas-header">
                <h5 class="offcanvas-title" id="offcanvasMenuLabel">
                    <img src="{{asset('ntb-logo.png')}}" alt="{{ config('app.name', 'NTB - Estoque') }}">
                </h5>
                <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
            </div>
            <div class="offcanvas-body">
                @auth
                    @include('layouts.menu')
                @endauth
            </div>
        </div>

        @auth
            <div class="offcanvas offcanvas-end" tabindex="-1" id="offcanvasFiltro" aria-labelledby="offcanvasFiltroLabel">
                <div class="offcanvas-header">
                    <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
                </div>
                <div class="offcanvas-body p-0 d-flex flex-column justify-content-between">
                    <div class="container" id="div-filtro">
                        @yield('filtro')
                    </div>
                    <div class="container-fluid">
                        <div class="row bg-white">
                            <div class="col d-flex justify-content-between align-items-center py-3">
                                <button type="button" data-bs-dismiss="offcanvas" class="btn">Voltar</button>
                                <div>
                                    @yield('botoes-filtro')
                                    <button type="submit" form="filtrosForm" class="btn btn-success text-white">
                                        <img src="{{asset('images/check.png')}}" alt="Check">
                                        Filtrar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        @endauth

        <main class="py-4">
            @yield('content')
        </main>
    </div>
    <script src="https://code.jquery.com/jquery-3.7.1.min.js"
        integrity="sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=" crossorigin="anonymous"></script>
    <script>
        $(document).ready(function () {
            @if (session('success'))
                notyf.open({ type: "success", message: "{{ session('success') }}" });
            @elseif(session('error'))
                notyf.open({ type: "error", message: "{{ session('error') }}" });
            @elseif(session('info'))
                notyf.open({ type: "info", message: "{{ session('info') }}" });
            @elseif(session('warning'))
                notyf.open({ type: "warning", message: "{{ session('warning') }}" });
            @endif

            document.getElementById("loader").style.display = "none";
            document.getElementById("app").style.display = "block";

            window.Echo.private(`App.Models.User.{{auth()->id()}}`).listenToAll((eventName, e) => {
                const type = eventName.replace('.', ''); // Remove o ponto

                if (['success', 'error', 'info', 'warning'].includes(type)) {
                    notyf.open({ type, message: e.message });
                } else {
                    console.warn(`Tipo de evento não reconhecido: ${eventName}`, e);
                    notyf.open({ type: 'waring', message: e.message });
                }
            });

            window.Echo.channel(`All.User`).listenToAll((eventName, e) => {
                const type = eventName.replace('.', ''); // Remove o ponto

                if (['success', 'error', 'info', 'warning'].includes(type)) {
                    notyf.open({ type, message: e.message });
                } else {
                    console.warn(`Tipo de evento não reconhecido: ${eventName}`, e);
                    notyf.open({ type: 'waring', message: e.message });
                }
            });

        });
    </script>

    @stack('js')
    @include('layouts.delete')
</body>

</html>