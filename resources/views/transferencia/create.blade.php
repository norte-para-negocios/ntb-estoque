@extends('layouts.app')

@section('content')
    <div class="container">

        <div class="row">
            <div class="col-12">
                <button type="button" class="btn btn-primary" id="botaoPermissao" style="display: none;">Permitir Acessar a
                    Câmera</button>
            </div>
        </div>

        <div class="row">
            <div class="col-12">
                <h1 class="mb-4">Novo Movimento de Estoque</h1>
            </div>
        </div>


        <form method="POST" action="{{ route('transferencia.store') }}">
            @csrf

            <div class="row mb-3">
                <div class="col-md-4">
                    <label for="data" class="form-label">Data</label>
                    <input type="date" name="data" id="data" class="form-control"
                        value="{{ \Carbon\Carbon::now()->format('Y-m-d') }}" required>
                </div>
            </div>

            <div class="row mb-3">
                <div class="col-md-6">
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

                <div class="col-md-6">
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

            <div class="mb-3">
                <label for="motivo" class="form-label">Motivo do Movimento de Estoque</label>
                <select name="motivo" id="motivo" class="form-select" required>
                    <option value="">Selecione o motivo</option>
                    <option value="TRF">Transferência entre Locais de Estoque.</option>
                    <option value="TPQ">Transferência por Perda ou Quebra.</option>
                </select>
            </div>

            <div class="mb-3">
                <div class="mb-3">
                    <button type="button" id="botaoUsarCamera" class="btn btn-primary" style="display: none;">
                        Ler QR Code
                    </button>
                    <button type="button" id="botaoPararCamera" class="btn btn-primary" style="display: none;">
                        Parar Leitura
                    </button>
                </div>
                <div id="reader"></div>
                <div id="resultado">Aguardando leitura...</div>
            </div>

            <div class="mb-3">
                <h5>Produtos para Transferência</h5>
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

            <div class="mb-3">
                <label for="observacao" class="form-label">Observação</label>
                <textarea name="observacao" id="observacao" class="form-control" rows="3"></textarea>
            </div>

            <button type="submit" class="btn btn-primary">Confirmar</button>
        </form>
    </div>
@endsection

@push('css')
    <style>
        #reader {
            width: 300px;
            margin: auto;
        }

        #resultado {
            text-align: center;
            margin-top: 1rem;
        }
    </style>
@endpush

@push('js')
    <script src="{{ asset('vendor/html5-qrcode.min.js') }}"></script>
    <script>
        async function verificarPermissaoCamera() {
            try {
                // Tenta acessar a câmera com vídeo, sem exibir o stream
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true
                });

                stream.getTracks().forEach(track => track.stop());

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
                document.getElementById('botaoPermissao').style.display = 'none';
                document.getElementById('botaoPararCamera').style.display = 'none';
                document.getElementById('botaoUsarCamera').style.display = 'inline-block';
            } catch (erro) {
                alert('Permissão negada ou erro ao acessar a câmera.');
            }
        }

        function onScanStop() {
            html5QrCode.stop()
                .then(() => {
                    document.getElementById("resultado").innerText = "Aguardando leitura...";
                    document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                    document.getElementById('botaoPararCamera').style.display = 'none';
                })
                .catch(err => console.error("Erro ao parar a câmera:", err));
        }

        // Função chamada quando um QR Code é detectado
        function onScanSuccess(decodedText, decodedResult) {
            document.getElementById("resultado").innerText =
                `QR Code detectado: ${decodedText}`;
            // Após leitura, buscar o produto e adicionar na listagem
            buscarProdutoPorQrCode(decodedText);

            html5QrCode.stop()
                .then(() => console.log("Leitura parada."))
                .catch(err => console.error("Erro ao parar:", err));
        }

        // Função opcional para erros de leitura em cada frame
        function onScanError(errorMessage) {
            // errorMessage pode ser ignorado ou logado
            console.warn("Falha na leitura:", errorMessage);
        }

        function buscarProdutoPorQrCode(codigo) {
            fetch(`/transferencia/produto/buscar-por-qrcode/${codigo}`)
                .then(response => response.json())
                .then(produto => {
                    if (produto.data.id) {
                        adicionarProdutoNaListagem(produto.data);
                    } else {
                        alert('Produto não encontrado!');
                    }
                });
        }

        function adicionarProdutoNaListagem(produto) {
            const produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');
            const novaLinha =
                `<tr>
                <td>
                    <input type="hidden" name="produtos[]" value="${produto.id}">
                    ${produto.nome}
                </td>
                <td>
                    <input type="number" name="quantidades[]" value="1" class="form-control" min="1">
                </td>
                <td>
                    <input type="text" name="valores[]" value="${produto.valor_unitario}" class="form-control" readonly>
                </td>
                <td>
                    <button type="button" class="btn btn-danger btn-sm remover-produto">Remover</button>
                </td>
            </tr>`;
            produtosTable.insertAdjacentHTML('beforeend', novaLinha);;
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
                document.getElementById("resultado").innerText =
                    "Não foi possível iniciar a câmera: " + err;
            });
        }

        document.getElementById('botaoPermissao').onclick = solicitarPermissaoCamera;
        document.getElementById('botaoUsarCamera').onclick = usarCamera;
        document.getElementById('botaoPararCamera').onclick = onScanStop;

        verificarPermissaoCamera();
    </script>
@endpush
