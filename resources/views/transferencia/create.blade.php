@extends('layouts.app')

@section('content')
    <div class="container">
        <h1 class="mb-4">Novo Movimento de Estoque</h1>

        <form method="POST" action="{{ route('transferencia.store') }}">
            @csrf

            <div class="row mb-3">
                <div class="col-md-4">
                    <label for="tipo_movimento" class="form-label">Tipo do Movimento de Estoque</label>
                    <select name="tipo_movimento" id="tipo_movimento" class="form-select" required>
                        <option value="transferencia">Transferência entre Locais</option>
                        <option value="entrada">Entrada</option>
                        <option value="saida">Saída</option>
                    </select>
                </div>

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
                            <option value="{{ $local->codigo_local_estoque }}">{{ $local->descricao }}</option>
                        @endforeach
                    </select>
                </div>

                <div class="col-md-6">
                    <label for="estoque_destino" class="form-label">Local de Estoque de Destino</label>
                    <select name="estoque_destino" id="estoque_destino" class="form-select" required>
                        @foreach ($locaisEstoque as $local)
                            <option value="{{ $local->codigo_local_estoque }}">{{ $local->descricao }}</option>
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
                {{-- <label class="form-label">Leitura do QR Code</label> --}}
                <div class="mb-3">
                    <button type="button" class="btn btn-primary" id="btn-ativar-camera">
                        Ativar Leitor de QR Code
                    </button>
                </div>

                <div id="qr-reader" style="width: 300px; display: none;"></div>
                <div id="qr-reader-results" class="mt-2 text-success"></div>

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

<script src="https://unpkg.com/html5-qrcode"></script>

<script>
    // document.addEventListener('DOMContentLoaded', function() {
    //     const qrInput = document.getElementById('qr_input');
    //     const produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');

    //     qrInput.addEventListener('change', function() {
    //         const codigo = this.value;

    //         // Simulação de requisição AJAX
    //         fetch(`/produtos/buscar-por-qrcode/${codigo}`)
    //             .then(response => response.json())
    //             .then(produto => {
    //                 const novaLinha = `
    //                 <tr>
    //                     <td>
    //                         <input type="hidden" name="produtos[]" value="${produto.id}">
    //                         ${produto.nome}
    //                     </td>
    //                     <td>
    //                         <input type="number" name="quantidades[]" value="1" class="form-control" min="1">
    //                     </td>
    //                     <td>
    //                         <input type="text" name="valores[]" value="${produto.valor_unitario}" class="form-control" readonly>
    //                     </td>
    //                     <td>
    //                         <button type="button" class="btn btn-danger btn-sm remover-produto">Remover</button>
    //                     </td>
    //                 </tr>
    //             `;
    //                 produtosTable.insertAdjacentHTML('beforeend', novaLinha);
    //                 qrInput.value = '';
    //                 qrInput.focus();
    //             })
    //             .catch(() => {
    //                 alert('Produto não encontrado!');
    //             });
    //     });

    //     document.addEventListener('click', function(e) {
    //         if (e.target.classList.contains('remover-produto')) {
    //             e.target.closest('tr').remove();
    //         }
    //     });
    // });


    document.addEventListener('DOMContentLoaded', function() {
        document.getElementById('btn-ativar-camera').addEventListener('click', function() {
            const qrReader = document.getElementById('qr-reader');
            qrReader.style.display = 'block';
            console.log('Leitura QR');

            const html5QrCode = new Html5Qrcode("qr-reader");

            html5QrCode.start({
                    facingMode: "environment"
                }, {
                    fps: 10, // frames por segundo
                    qrbox: 250 // área de leitura
                },
                (decodedText, decodedResult) => {
                    document.getElementById('qr-reader-results').innerText =
                        `QR Code lido: ${decodedText}`;

                    // Após leitura, buscar o produto e adicionar na listagem
                    buscarProdutoPorQrCode(decodedText);

                    // Parar a leitura após capturar o código
                    html5QrCode.stop().then(() => {
                        qrReader.style.display = 'none';
                    });
                },
                (errorMessage) => {
                    // console.log(`Erro: ${errorMessage}`);
                }
            ).catch(err => {
                console.error("Erro ao iniciar a câmera", err);
            });
        });
    });

    function buscarProdutoPorQrCode(codigo) {
        fetch(`/movimentacao/produto/buscar-por-qrcode/${codigo}`)
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
        console.log(produto);

        const produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');
        const novaLinha = `
                     <tr>
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
                     </tr>
                 `;
        produtosTable.insertAdjacentHTML('beforeend', novaLinha);;
    }
</script>
