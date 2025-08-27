@extends('layouts.app')

@section('content')
    <div class="container">
        <div class="card card-body mb-4">
            <div class="row">
                <div class="col-12 d-flex justify-content-between align-items-start">
                    <h1>
                        <span>
                        <a href="{{route('inventario.index')}}" class="btn btn-sm btn-outline-primary mb-1"
                           title="Voltar">
                            <i class="fa-solid fa-arrow-left-long"></i>
                        </a>
                        Inventário #{{ $inventario->id }}:
                        </span>
                        <small>{{ auth()->user()->loja->nome_fantasia }}</small>
                    </h1>
                    @if ($inventario->finalizado === null)
                        <form method="POST" action="{{ route('inventario.finish', $inventario->id) }}"
                              id="formInventario">
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

            <div class="row">
                <div class="col-lg-4 col-12">
                    <div class="mb-3">
                        <label for="tipo_produto" class="form-label">Tipo de Produto</label>
                        <select id="tipo_produto" name="tipo_produto" class="form-control"
                                onchange="searchTipo(this.value)">
                            <option value="" {{ ($tipo_produto ?? '') == '' ? 'selected' : '' }}>
                                Todos
                            </option>
                            @foreach (\App\Helpers\Constants::PRODUTO_TIPO_ITEM as $key => $value)
                                <option value="{{ $key }}" {{ ($tipo_produto ?? '') == $key ? 'selected' : '' }}>
                                    {{ $key }} - {{ $value }}
                                </option>
                            @endforeach
                        </select>
                    </div>
                </div>
                <div class="col-lg-4 col-12">
                    <div class="mb-3">
                        <label for="familia_produto" class="form-label">Família</label>
                        <select id="familia_produto" name="familia_produto" class="form-control"
                                onchange="searchFamilia(this.value)">
                            <option value="">
                                Todos
                            </option>
                            @foreach ($inventario->items->groupBy('produto_familia')->sortBy('produto_familia') as $produto_familia => $produtosfamilia)
                                <option value="{{ $produto_familia }}">
                                    {{ $produto_familia == '' ? 'Sem Classificação' : $produto_familia }}
                                </option>
                            @endforeach
                        </select>
                    </div>
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
                <table class="table table-bordered" id="produtos_inventario">
                    <thead class="table-light">
                    <tr>
                        <th class="col-10">Produto</th>
                        <th class="col-2">Quantidade</th>
                    </tr>
                    </thead>
                    <tbody>
                    @foreach ($inventario->items->groupBy('produto_familia') as $familia => $items)
                        <tr data-produto="" data-familia="{{ $familia }}" data-tipo="">
                            <td colspan="2" class="bg-secondary text-white">
                                <strong>{{ $familia == '' ? 'Sem Classificação' : $familia }}</strong>
                            </td>
                        </tr>
                        @foreach ($items->sortBy('produto_descricao') as $item)
                            <tr data-produto="{{ $item->produto_descricao }} - {{ $item->produto_codigo }}"
                                data-familia="{{ $familia }}" data-tipo="{{ $item->produto->tipo_item ?? '' }}">
                                <td class="align-middle">
                                    <div class="d-flex justify-content-between">
                                        <span>
                                            {{ $item->produto_descricao }}
                                            <small> #{{ $item->produto_codigo }}</small>
                                        </span>
                                        <span>{{ $item->produto->unidade ?? '-' }}</span>
                                    </div>
                                    @if ($inventario->finalizado !== null || (in_array($item->status, ['Concluído', 'Erro'])))
                                        <span>{{ $item->codigo_status ? $item->codigo_status . ' - ' : '' }} {{ $item->descricao_status }}</span>
                                    @endif
                                </td>
                                <td>
                                    @if (($inventario->status === 'Em contagem') && ($item->id_ajuste === null) && ($item->id_movest === null))
                                        <input type="number" class="form-control" min="0.001" step="0.001"
                                               onblur="setQuantidade('{{ route('inventario.setQuantidade', $item->id) }}', this.value)"
                                               value="{{ $item->quan }}"> {{ $item->produto_unidade }}
                                    @else
                                        {{ $item->quan }}
                                    @endif
                                </td>
                            </tr>
                        @endforeach
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
            if (quantidade >= 0) {
                axios.post(url, {
                    "quantidade": quantidade
                })
            }
        }

        $(document).ready(function () {

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
                        });
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
                axios.get(`/inventario/local/${local}/produto/${codigo}/data/${data}`).then(function (r) {
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
                        .then(function () {
                            document.getElementById('botaoUsarCamera').style.display = 'inline-block';
                            document.getElementById('botaoPararCamera').style.display = 'none';
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


        function searchTipo(el) {
            const tipo = el.toLowerCase();
            rows.forEach(row => {
                const rowTipo = row.dataset.tipo.toLowerCase();
                row.style.display = rowTipo.includes(tipo) ? '' : 'none';
            });
        }

        function searchFamilia(el) {
            const familia = el.toLowerCase();
            rows.forEach(row => {
                const rowFamilia = row.dataset.familia.toLowerCase();
                row.style.display = rowFamilia.includes(familia) ? '' : 'none';
            });
        }

        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
            }
        });
    </script>
@endpush
