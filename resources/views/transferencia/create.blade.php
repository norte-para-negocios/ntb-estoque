@extends('layouts.app')

@section('content')
    <div class="container">
        <form method="POST" action="{{ route('transferencia.store') }}" id="formTransferencia">
            @csrf
            <div class="card card-body mb-4">
                <div class="row">
                    <div class="col-12 d-flex justify-content-between align-items-start">
                        <h1>
                            Nova Transferência:
                            <small>{{ auth()->user()->loja->nome_fantasia }}</small>
                        </h1>
                        <button type="submit" class="btn btn-primary text-white">
                            <i class="fa-solid fa-check fa-lg" style="color: #ffffff;"></i>
                            Finalizar
                        </button>
                    </div>
                </div>


                <div class="row mt-3">
                    <div class="col-md-2 mb-3">
                        <label for="data" class="form-label">Data</label>
                        <input type="date" name="data" id="data" class="form-control"
                               value="{{ \Carbon\Carbon::now()->format('Y-m-d') }}" required>
                    </div>

                    <div class="col-md-4 mb-3">
                        <label for="motivo" class="form-label">Motivo do Movimento de Estoque</label>
                        <select name="motivo" id="motivo" class="form-select" required>
                            <option value="">Selecione o motivo</option>
                            @foreach (\App\Helpers\Constants::TIPO_MOVIMENTO_TRANSFERENCIA as $key => $value)
                                <option value="{{ $key }}">{{ $value }}</option>
                            @endforeach
                        </select>
                    </div>

                    <div class="col-md-3 mb-3">
                        <label for="estoque_origem" class="form-label">Local de Estoque de Origem</label>
                        <select name="estoque_origem" id="estoque_origem" class="form-select" required>
                            @foreach ($locaisEstoque as $local)
                                <option value="{{ $local->codigo_local_estoque }}">
                                    <small>{{ $local->codigo }}</small> -
                                    {{ $local->descricao }}
                                </option>
                            @endforeach
                        </select>
                    </div>

                    <div class="col-md-3 mb-3">
                        <label for="estoque_destino" class="form-label">Local de Estoque de Destino</label>
                        <select name="estoque_destino" id="estoque_destino" class="form-select" required>
                            @foreach ($locaisEstoque as $local)
                                <option value="{{ $local->codigo_local_estoque }}">
                                    <small>{{ $local->codigo }}</small> -
                                    {{ $local->descricao }}
                                </option>
                            @endforeach
                        </select>
                    </div>
                </div>
            </div>

            <div class="card card-body">
                <nav class="navbar navbar-dark bg-primary px-2">
                    <span class="text-white fs-4 me-2">Produtos</span>
                    <div class="d-flex flex-grow-1">
                        <div class="input-group">
                            <input class="form-control" type="search" placeholder="Ctrl+F ou digite para buscar..."
                                   id="search" autofocus/>
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
                    </div>
                </nav>
                <div class="table-responsive">
                    <table class="table table-bordered" id="produtos_transferencia">
                        <thead class="table-light">
                        <tr>
                            <th>Produto</th>
                            <th>Quantidade</th>
                            <th>Valor Unitário</th>
                            <th>Ação</th>
                        </tr>
                        </thead>
                        <tbody>
                        <!-- Linhas dinâmicas via JS -->
                        </tbody>
                    </table>
                </div>
            </div>
        </form>
    </div>
    @include('inventario.qrcode')
@endsection

@push('js')
    <script src="{{ asset('vendor/html5-qrcode.min.js') }}"></script>
    <script>
        $(document).ready(function () {
            async function verificarPermissaoCamera() {
                const jaPermitido = localStorage.getItem('cameraPermitida');
                if (jaPermitido === 'true') {
                    document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                    document.getElementById('botaoPararCamera').style.display = 'none';
                    return;
                }
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: true
                    });
                    stream.getTracks().forEach(track => track.stop());
                    localStorage.setItem('cameraPermitida', 'true');
                    document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                    document.getElementById('botaoPararCamera').style.display = 'none';
                } catch (erro) {
                    alert('Permissão não concedida ou erro:', erro);
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
                // Após leitura, buscar o produto e adicionar na listagem
                buscarProdutoPorQrCode(decodedText);

                if (html5QrCode.isScanning) {
                    html5QrCode.stop()
                        .then(function () {
                            document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                            document.getElementById('botaoPararCamera').style.display = 'none';
                        });
                }
                qrcodeModal.hide();
            }

            // Função opcional para erros de leitura em cada frame
            function onScanError(errorMessage) {
                // errorMessage pode ser ignorado ou logado
                alert("Falha na leitura:", errorMessage);
            }

            function buscarProdutoPorQrCode(codigo) {
                let local = document.getElementById('estoque_origem').value;
                let data = document.getElementById('data').value;
                axios.get(`/transferencia/local/${local}/produto/${codigo}/data/${data}`).then(function (r) {
                    adicionarProdutoNaListagem(r.data.data);
                });
            }

            function adicionarProdutoNaListagem(produto) {
                const produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');
                const novaLinha =
                    `<tr data-produto="${produto.nome}">
                <td>
                    <input type="hidden" name="produtos[]" value="${produto.id}">
                    ${produto.nome}
                </td>
                <td>
                    <input type="number" name="quantidades[]" value="1" class="form-control" min="1" step="0.001">
                </td>
                <td>
                    <input type="text" name="valores[]" value="${produto.valor_unitario}" class="form-control" readonly>
                </td>
                <td>
                    <button type="button" class="btn btn-danger btn-sm" onclick="removeProduto(this)">Remover</button>
                </td>
            </tr>`;
                produtosTable.insertAdjacentHTML('beforeend', novaLinha);
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
                        .then(function () {
                            document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                            document.getElementById('botaoPararCamera').style.display = 'none';
                        });
                }
            });

            document.getElementById('botaoPermissao').onclick = solicitarPermissaoCamera;
            document.getElementById('botaoUsarCamera').onclick = usarCamera;
            document.getElementById('botaoPararCamera').onclick = onScanStop;

            verificarPermissaoCamera();

            function removeProduto(el) {
                const linha = el.closest('tr');
                if (linha) {
                    linha.remove();
                }
            }
        })

        const formTransferencia = document.getElementById('formTransferencia');

        formTransferencia.addEventListener('submit', function (event) {
            const valor1 = document.getElementById('estoque_origem').value;
            const valor2 = document.getElementById('estoque_destino').value;
            const produtos = document.getElementsByName('produtos[]');

            if (valor1 && valor2 && valor1 === valor2) {
                alert('O local de estoque de origem e destino não podem ser iguais!');
                event.preventDefault();
            }

            if (produtos.length == 0) {
                alert('Informe os produtos a serem transferidos!');
                event.preventDefault();
            }
        });

        const searchInput = document.getElementById('search');
        const rows = Array.from(document.querySelectorAll('#produtos_transferencia tbody tr'));

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
