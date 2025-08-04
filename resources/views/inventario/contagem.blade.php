@extends('layouts.app')

@section('content')
    <div class="container">
        <div class="card card-body mb-4">
            <div class="row">
                <div class="col-12 d-flex justify-content-between align-items-start">
                    <h1 class="">
                        Inventário #{{ $inventario->id }}:
                        <small>{{ auth()->user()->loja->nome_fantasia }}</small>
                    </h1>
                    @if ($inventario->finalizado === null)
                        <form method="POST" action="{{ route('inventario.finish', $inventario->id) }}" id="formInventario">
                            @csrf
                            <button type="submit" class="btn btn-primary text-white" form="formInventario">
                                <i class="fa-solid fa-check fa-lg" style="color: #ffffff;"></i>
                                Finalizar
                            </button>
                        </form>
                    @endif
                </div>
                <div class="col-12">
                    <p class="mb-0">
                        <span class="fw-bold">Data:</span>
                        <span>{{ $inventario->data->format('d/m/Y') }}</span>
                    </p>
                    <p class="mb-0">
                        <span class="fw-bold">Local de Estoque:</span>
                        <span>
                            {{ $localEstoque->codigo }} - {{ $localEstoque->descricao }}
                        </span>
                    </p>
                    <p>
                        <span class="fw-bold">Tipo de Inventário:</span>
                        <span>
                            {{ \App\Helpers\Constants::TIPO_MOVIMENTO_INVENTARIO[$inventario->motivo] ?? 'Desconhecido' }}
                        </span>
                    </p>
                </div>
            </div>
        </div>

        <div class="card card-body">
            <nav class="navbar navbar-dark bg-primary px-2">
                <span class="text-white fs-4 me-2">Produtos</span>
                <form class="d-flex flex-grow-1">
                    <div class="input-group">
                        <input class="form-control" type="search" placeholder="Ctrl+F ou digite para buscar..."
                            id="search" autofocus />
                        <button type="button" id="botaoPermissao" class="btn btn-secondary rounded-end-2"
                            style="display: none;">
                            Conceder Acesso a Câmera
                        </button>
                        <button type="button" id="botaoUsarCamera" class="btn btn-light rounded-end-2"
                            style="display: none;" data-bs-toggle="modal" data-bs-target="#qrcodeModal">
                            <i class="fa-solid fa-camera fa-2xl" style="color: #ff6b35;"></i>
                        </button>
                        <button type="button" id="botaoPararCamera" class="btn btn-secondary rounded-end-2"
                            style="display: none;">
                            Parar Leitura
                        </button>
                    </div>
                </form>
            </nav>

            <div class="table-responsive">
                <table class="table table-bordered" id="produtos_inventario">
                    <thead class="table-light">
                        <tr>
                            <th class="col-10">Produto</th>
                            <th class="col-2">Quantidade</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($inventario->items as $item)
                            <tr data-produto="{{ $item->produto_descricao }} - {{ $item->produto_codigo }}">
                                <td>
                                    {{ $item->produto_descricao }}
                                    <small> #{{ $item->produto_codigo }}</small>
                                </td>
                                <td>
                                    @if ($inventario->finalizado === null)
                                        <input type="number" class="form-control" min="0.001" step="0.001"
                                            onblur="setQuantidade('{{ route('inventario.setQuantidade', $item->id) }}', this.value)"
                                            value="{{ $item->quan }}">
                                    @else
                                        {{ $item->quan }} <br>
                                        {{ $item->codigo_status }} - {{ $item->descricao_status }}<br>
                                        ID Movimento: {{ $item->id_movest }}<br>
                                        ID Ajuste: {{ $item->id_ajuste }}
                                    @endif
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    @include('inventario.qrcode')
@endsection

@push('js')
    <script src="{{ asset('vendor/html5-qrcode.min.js') }}"></script>
    <script>
        function setQuantidade(url, quantidade) {
            if (quantidade > 0) {
                axios.post(url, {
                    "quantidade": quantidade
                })
            }
        }
        $(document).ready(function() {

            async function verificarPermissaoCamera() {
                const jaPermitido = localStorage.getItem('cameraPermitida');

                if (jaPermitido === 'true') {
                    document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                    document.getElementById('botaoPararCamera').style.display = 'none';
                    return;
                }

                try {
                    // Tenta acessar a câmera com vídeo, sem exibir o stream
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: true
                    });

                    stream.getTracks().forEach(track => track.stop());

                    localStorage.setItem('cameraPermitida', 'true');

                    // Se não lançar erro, permissão foi concedida
                    document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                    document.getElementById('botaoPararCamera').style.display = 'none';
                } catch (erro) {
                    // Se erro for de permissão, exibe botão para solicitar
                    console.warn('Permissão não concedida ou erro:', erro);
                    document.getElementById('botaoPermissao').style.display = 'inline-block';
                }
            }

            async function solicitarPermissaoCamera() {
                try {
                    await navigator.mediaDevices.getUserMedia({
                        video: true
                    });
                    localStorage.setItem('cameraPermitida', 'true');
                    document.getElementById('botaoPermissao').style.display = 'none';
                    document.getElementById('botaoPararCamera').style.display = 'none';
                    document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                } catch (erro) {
                    alert('Permissão negada ou erro ao acessar a câmera.');
                }
            }

            function onScanStop() {
                if (html5QrCode.isScanning) {
                    html5QrCode.stop()
                        .then(() => {
                            document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                            document.getElementById('botaoPararCamera').style.display = 'none';
                        })
                        .catch(err => console.error("Erro ao parar a câmera:", err));
                }
            }

            // Função chamada quando um QR Code é detectado
            function onScanSuccess(decodedText, decodedResult) {
                searchInput.value = decodedText;
                searchInput.dispatchEvent(new Event('input', {
                    bubbles: true
                }));

                if (html5QrCode.isScanning) {
                    html5QrCode.stop()
                        .then(function() {
                            document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                            document.getElementById('botaoPararCamera').style.display = 'none';
                            console.log("Leitura parada.")
                        })
                        .catch(function(err) {
                            console.error("Erro ao parar:", err)
                        });
                }

                qrcodeModal.hide();
            }

            // Função opcional para erros de leitura em cada frame
            function onScanError(errorMessage) {
                // errorMessage pode ser ignorado ou logado
                console.warn("Falha na leitura:", errorMessage);
            }

            function buscarProdutoPorQrCode(codigo) {
                let local = document.getElementById('estoque_origem').value;
                let data = document.getElementById('data').value;
                axios.get(`/inventario/local/${local}/produto/${codigo}/data/${data}`).then(function(r) {
                    adicionarProdutoNaListagem(r.data.data);
                });
            }

            // Cria uma instância apontando para o elemento #reader
            const html5QrCode = new Html5Qrcode("reader");


            // Inicia a câmera traseira, 10 quadros por segundo, e área de escaneamento 250×250
            function usarCamera() {
                document.getElementById('botaoUsarCamera').style.display = 'none';
                document.getElementById('botaoPararCamera').style.display = 'inline-block';

                html5QrCode.start({
                        facingMode: "environment"
                    }, {
                        fps: 10,
                        qrbox: {
                            width: 250,
                            height: 250
                        }
                    },
                    onScanSuccess
                    // ,onScanError
                ).catch(err => {
                    alert("Não foi possível iniciar a câmera: " + err);
                });
            }

            const qrcodeModal = new bootstrap.Modal(document.getElementById('qrcodeModal'), {
                backdrop: 'static',
                keyboard: false
            })

            document.getElementById('qrcodeModal').addEventListener('shown.bs.modal', event => {
                usarCamera();
            });

            document.getElementById('qrcodeModal').addEventListener('hidden.bs.modal', event => {
                if (html5QrCode.isScanning) {
                    html5QrCode.stop()
                        .then(function() {
                            document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                            document.getElementById('botaoPararCamera').style.display = 'none';
                            console.log("Leitura parada.")
                        })
                        .catch(function(err) {
                            console.error("Erro ao parar:", err)
                        });
                }
            });

            document.getElementById('botaoPermissao').onclick = solicitarPermissaoCamera;
            document.getElementById('botaoPararCamera').onclick = onScanStop;

            verificarPermissaoCamera();

            function removeProduto(el) {
                const linha = el.closest('tr');
                if (linha) {
                    linha.remove();
                }
            }
        });

        const searchInput = document.getElementById('search');
        const rows = Array.from(document.querySelectorAll('#produtos_inventario tbody tr'));

        // Filtragem instantânea
        searchInput.addEventListener('input', () => {
            const term = searchInput.value.toLowerCase();

            rows.forEach(row => {
                const nome = row.dataset.produto.toLowerCase();
                row.style.display = nome.includes(term) ? '' : 'none';
            });
        });


        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
            }
        });
    </script>
@endpush
