@extends('layouts.app')
@section('content')
    <div class="container pb-5">
        <p class="mb-3 fw-semibold">
            <a href="{{route('transferencia.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>

            <img class="ms-0 p-0" src="{{asset('images/transferencia.png')}}" alt="Transferências entre estoques">

            <a href="{{route('transferencia.index')}}" class="btn m-0 p-0 fw-semibold" title="Voltar">
                Transferências de itens
            </a>

            / + {{ __('Nova Transferência') }}
        </p>

        <form method="POST" action="{{ route('transferencia.store') }}" id="formTransferencia">
            @csrf
            <div class="row px-2">
                <div class="col-md-3 col-6 mb-3">
                    <label for="estoque_origem" class="form-label mb-0"><small>Local de Origem</small></label>
                    <select name="estoque_origem" id="estoque_origem" class="form-select" required>
                        @foreach ($locaisEstoque as $local)
                            <option value="{{ $local->codigo_local_estoque }}">
                                <small>{{ $local->codigo }}</small> -
                                {{ $local->descricao }}
                            </option>
                        @endforeach
                    </select>
                </div>

                <div class="col-md-3 col-6 mb-3">
                    <label for="estoque_destino" class="form-label mb-0"><small>Local de Destino</small></label>
                    <select name="estoque_destino" id="estoque_destino" class="form-select" required>
                        @foreach ($locaisEstoque as $local)
                            <option value="{{ $local->codigo_local_estoque }}">
                                <small>{{ $local->codigo }}</small> -
                                {{ $local->descricao }}
                            </option>
                        @endforeach
                    </select>
                </div>

                <div class="col-md-3 col-6 mb-3">
                    <label for="motivo" class="form-label mb-0"><small>Motivo</small></label>
                    <select name="motivo" id="motivo" class="form-select" required>
                        <option value="">Selecione o motivo</option>
                        @foreach (\App\Helpers\Constants::TIPO_MOVIMENTO_TRANSFERENCIA as $key => $value)
                            <option value="{{ $key }}">{{ $value }}</option>
                        @endforeach
                    </select>
                </div>

                <div class="col-md-3 col-6 mb-3">
                    <label for="data" class="form-label mb-0"><small>Data</small></label>
                    <input type="date" name="data" id="data" class="form-control"
                           value="{{ \Carbon\Carbon::now()->format('Y-m-d') }}" required>
                </div>
            </div>

            <small class="text-muted px-2">
                Adicione produtos que deseja transferir
            </small>

            <div class="px-2">
                <div class="card card-body mb-3">
                    <div class="row">
                        <div class="col-md-7 col-12 mb-3">
                            <input class="search form-control fw-semibold rounded-0"
                                   type="search"
                                   placeholder="Ctrl+F ou digite para buscar..."
                                   id="search"
                                   autofocus/>
                        </div>

                        <div
                            class="col-md-5 col-12 d-flex justify-content-md-start justify-content-around align-items-center gap-1">
                            <button type="button" id="botaoPermissao"
                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold"
                                    style="display: none;">
                                Conceder Acesso a Câmera
                            </button>

                            <button type="button" id="botaoUsarCamera"
                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold"
                                    style="display: none;" data-bs-toggle="modal" data-bs-target="#qrcodeModal"
                                    title="Scanear QRCode">
                                <img src="{{asset('images/qrcode.png')}}" alt="+" class="me-1">Ler QRcode
                            </button>

                            <button type="button" id="botaoPararCamera"
                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold"
                                    style="display: none;">
                                Parar Leitura
                            </button>

                            <button type="button"
                                    class="btn btn-sm btn-outline-secondary text-center text-muted fw-semibold"
                                    data-bs-toggle="modal"
                                    data-bs-target="#produtoModal" title="Buscar na lista">
                                <img src="{{asset('images/lista.png')}}" alt="+" class="me-1">Buscar na lista
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <table class="table table-hover table-borderless mb-5" style="background-color: #f4f4f4;"
                   id="produtos_transferencia">
                <tbody></tbody>
            </table>
        </form>
    </div>
    @include('inventario.qrcode')
    @include('transferencia.produto')

    <div class="container-fluid fixed-bottom">
        <div class="row bg-white">
            <div class="col d-flex justify-content-end align-items-center py-3">
                <button type="submit" form="formTransferencia" class="btn btn-success text-white">
                    <i class="fas fa-plus text-white"></i> Finalizar
                </button>
            </div>
        </div>
    </div>
@endsection

@push('js')
    <script src="{{ asset('vendor/html5-qrcode.min.js') }}"></script>
    <script>
        function removeProduto(botao) {
            const linha = botao.closest('tr');
            const produtoId = linha.getAttribute('data-id');
            linha.remove();
            let produtosSalvos = JSON.parse(localStorage.getItem('produtos')) || [];
            console.log(produtosSalvos);
            produtosSalvos = produtosSalvos.filter(produto => produto.id !== produtoId);
            localStorage.setItem('produtos', JSON.stringify(produtosSalvos));
        }

        function subtrai(opId) {
            const inputValidade = document.getElementById(`quantidade-${opId}`);
            if (!inputValidade) {
                return;
            }
            let q = Number(inputValidade.value)
            let novoValor = q - 1;
            if (novoValor > 0) {
                inputValidade.value = novoValor;
            }
        }

        function soma(opId) {
            const inputValidade = document.getElementById(`quantidade-${opId}`);
            if (!inputValidade) {
                return;
            }
            let q = Number(inputValidade.value)
            let novoValor = q + 1;
            inputValidade.value = novoValor;
        }

        $(document).ready(function () {
            const produtosSalvos = JSON.parse(localStorage.getItem('produtos')) || [];
            produtosSalvos.forEach(produto => adicionarProdutoNaListagem(produto));

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
                axios.get(`/transferencia/local-estoque/${local}/produto/${codigo}/data/${data}`).then(function (r) {
                    adicionarProdutoNaListagem(r.data.data);
                });
            }


            function adicionarProdutoNaListagem(produto) {
                const produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');
                const jaExisteNaTabela = produtosTable.querySelector(`tr[data-id="${produto.id}"]`) ?? false;
                if (jaExisteNaTabela) {
                    return;
                }
                const novaLinha =
                    `<tr data-id="${produto.id}" data-nome="${produto.nome}" style="background-color: #f4f4f4;">
                        <td class="m-0 px-0" style="background-color: #f4f4f4;">
                            <div class="container">
                                <div class="card card-body rounded-0 border-0" style="background-color: #ffffff;">
                                    <div class="row">
                                        <div class="col-7 d-flex justify-content-start align-items-center">
                                            <button type="button" class="btn btn-outline-secondary btn-sm me-3" onclick="removeProduto(this)">
                                                <img src="/images/excluir-verde.png" alt="Excluir">
                                            </button>
                                            <span class="fw-semibold">${produto.nome} <small>#${produto.id}</small></span>
                                        </div>

                                        <div class="col-1 p-0">
                                            <small>Medida</small><br>
                                            <span class="fw-semibold">
                                                ${produto.unidade}
                                                <input type="hidden" name="produtos[]" value="${produto.id}">
                                            </span>
                                        </div>

                                        <div class="col-md-4 col-8 d-flex">
                                            <button
                                                type="button"
                                                class="btn btn-sm btn-outline-primary mx-0 btn-validade fw-semibold px-2"
                                                style="width: 40px;"
                                                onclick="subtrai('${produto.id}')"
                                            >
                                                -
                                            </button>

                                            <input type="number"
                                                   class="form-control rounded-0 validade mx-1"
                                                   id="quantidade-${produto.id}"
                                                   name="quantidades[]"
                                                   style="text-align: center;"
                                                   min="0.000001"
                                            >

                                            <button
                                                type="button"
                                                class="btn btn-sm btn-outline-primary btn-validade fw-semibold px-2"
                                                style="width: 40px;"
                                                onclick="soma('${produto.id}')"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>`;
                produtosTable.insertAdjacentHTML('beforeend', novaLinha);
                let produtosSalvos = JSON.parse(localStorage.getItem('produtos')) || [];
                const jaExisteNoStorage = produtosSalvos.some(p => p.id === produto.id);
                if (!jaExisteNoStorage) {
                    produtosSalvos.push(produto);
                    localStorage.setItem('produtos', JSON.stringify(produtosSalvos));
                }
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

            const produtoModal = new bootstrap.Modal(document.getElementById('produtoModal'), {
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

            // document.getElementById('addProdutoButton').addEventListener('click', event => {
            //     event.preventDefault();
            //     const produto = document.getElementById('selectProduto');
            //     buscarProdutoPorQrCode(produto.value);
            //     produtoModal.hide();
            // })

            $('#produtoModal').on('shown.bs.modal', function () {
                $('#selectProduto').select2({
                    dropdownParent: $(this),
                    theme: 'bootstrap-5',
                    placeholder: 'Digite para buscar…',
                    ajax: {
                        url: '{{route('transferencia.produtos')}}',
                        dataType: 'json',
                        delay: 250,
                        data: function (params) {
                            return {
                                q: params.term,
                                page: params.page || 1
                            };
                        },
                        processResults: function (response, params) {
                            params.page = params.page || 1;
                            return {
                                results: response.data.map(function (item) {
                                    return {
                                        id: item.id,
                                        text: item.text
                                    };
                                }),
                                pagination: {
                                    more: response.current_page < response.last_page
                                }
                            };
                        },
                        cache: true
                    }
                });
            });
        })

        const formTransferencia = document.getElementById('formTransferencia');

        formTransferencia.addEventListener('submit', function (event) {
            const valor1 = document.getElementById('estoque_origem').value;
            const valor2 = document.getElementById('estoque_destino').value;
            const produtos = document.getElementsByName('produtos[]');

            if (valor1 && valor2 && valor1 === valor2) {
                alert('O local-estoque de estoque de origem e destino não podem ser iguais!');
                event.preventDefault();
            }

            if (produtos.length === 0) {
                alert('Informe os produtos a serem transferidos!');
                event.preventDefault();
            }
        });

        const searchInput = document.getElementById('search');


        // Filtragem instantânea
        searchInput.addEventListener('input', () => {
            const term = searchInput.value.toLowerCase();
            const rows = Array.from(document.querySelectorAll('#produtos_transferencia tbody tr'));
            rows.forEach(row => {
                const nome = row.dataset.nome.toLowerCase();
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


@push('css')
    <style>
        body {
            background-color: #F4F4F4;
        }

        .search {
            color: #2EB5C3;
            border: none !important;
            border-bottom: 1px solid #c7c7c7 !important;
        }

        .search::placeholder {
            color: #2EB5C3;
        }

        .form-select {
            background-color: #ffffff !important;
        }

        .validade {
            color: #2EB5C3 !important;
            border-color: #D5D5D5 !important;
            border-top: none !important;
            border-left: none !important;
            border-right: none !important;
        }

        .btn-validade {
            color: #2EB5C3 !important;
            border-color: #D5D5D5 !important;
        }
    </style>
@endpush
