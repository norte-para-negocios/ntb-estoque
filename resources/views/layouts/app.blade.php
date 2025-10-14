<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <!-- CSRF Token -->
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>{{ config('app.name', 'NTB - Estoque') }}</title>

    <!-- Fonts -->
    <link rel="dns-prefetch" href="//fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=Nunito" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
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

        #content {
            display: none;
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
            <div class="justify-content-start">
                <button type="button" data-bs-toggle="offcanvas" data-bs-target="#offcanvasTop"
                        aria-controls="offcanvasTop" class="btn btn-lg">
                    <img src="{{asset('images/menu.png')}}" alt="">
                </button>
                <a class="navbar-brand ntb-logo" href="{{ route('home.index') }}">
                    <img src="{{asset('ntb-logo.png')}}" alt="{{ config('app.name', 'NTB - Estoque') }}">
                </a>
            </div>

            <button class="btn" hidden id="btn-filtrar">
                <img src="{{asset('images/filtrar.png')}}"> Filtrar
            </button>
        </div>
    </nav>

    <div class="offcanvas offcanvas-start bg-white" tabindex="-1" id="offcanvasTop" aria-labelledby="offcanvasTopLabel">
        <div class="offcanvas-header">
            <h5 class="offcanvas-title" id="offcanvasTopLabel">
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

    <main class="py-4">
        @yield('content')
    </main>

</div>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"
        integrity="sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=" crossorigin="anonymous"></script>
<script>
    $(document).ready(function () {
        @if (session('success'))
        notyf.open({type: "success", message: "{{ session('success') }}"});
        @elseif(session('error'))
        notyf.open({type: "error", message: "{{ session('error') }}"});
        @elseif(session('info'))
        notyf.open({type: "info", message: "{{ session('info') }}"});
        @elseif(session('warning'))
        notyf.open({type: "warning", message: "{{ session('warning') }}"});
        @endif

        document.getElementById("loader").style.display = "none";
        document.getElementById("app").style.display = "block";

        window.Echo.private(`App.Models.User.{{auth()->id()}}`).listenToAll((eventName, e) => {
            const type = eventName.replace('.', ''); // Remove o ponto

            if (['success', 'error', 'info', 'warning'].includes(type)) {
                notyf.open({type, message: e.message});
            } else {
                console.warn(`Tipo de evento não reconhecido: ${eventName}`, e);
                notyf.open({type: 'waring', message: e.message});
            }
        });

        window.Echo.channel(`All.User`).listenToAll((eventName, e) => {
            const type = eventName.replace('.', ''); // Remove o ponto

            if (['success', 'error', 'info', 'warning'].includes(type)) {
                notyf.open({type, message: e.message});
            } else {
                console.warn(`Tipo de evento não reconhecido: ${eventName}`, e);
                notyf.open({type: 'waring', message: e.message});
            }
        });

    });
</script>

@stack('js')
@include('layouts.delete')
</body>

</html>
