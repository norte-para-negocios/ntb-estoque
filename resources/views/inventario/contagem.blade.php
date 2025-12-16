@extends('layouts.app')
@section('content')
    <div class="container pb-5">
        <p>
            <a href="{{route('inventario.index')}}" class="btn m-0 p-0" title="Voltar">
                <img src="{{asset('images/voltar.png')}}" alt="<-">
            </a>
            <img class="ms-0 p-0" src="{{asset('images/inventario.png')}}" alt="Inventário de estoque">
            / + Novo Inventário #{{ $inventario->id }}
        </p>
        <div class="row px-2">
            <div class="col-md-3 col-6 mb-3">
                <label for="inventario_data" class="form-label mb-0"><small>Data</small></label>
                <input id="inventario_data" type="date" class="form-control" readonly
                       value="{{$inventario->data->format('Y-m-d')}}">
            </div>
            <div class="col-md-3 col-6 mb-3">
                <label for="inventario_estoque" class="form-label mb-0"><small>Local de Estoque</small></label>
                <select id="inventario_estoque" class="form-select" readonly>
                    <option value="{{ $localEstoque->codigo }}">
                        {{ $localEstoque->descricao??'' }}
                    </option>
                </select>
            </div>
            <div class="col-md-3 col-6 mb-3">
                <label for="inventario_motivo" class="form-label mb-0"><small>Tipo de Inventário</small></label>
                <select id="inventario_motivo" class="form-select" readonly>
                    <option value="{{ $inventario->motivo }}">
                        {{ \App\Helpers\Constants::TIPO_MOVIMENTO_INVENTARIO[$inventario->motivo] ?? 'Desconhecido' }}
                    </option>
                </select>
            </div>
        </div>
        <small class="text-muted px-2">
            Adicionar produtos no inventário
        </small>

        <div class="px-2">
            <div class="card card-body mb-3">
                <div class="row">
                    <div class="col-md-7 col-12">
                        <select class="search form-control fw-semibold rounded-0"
                                placeholder="Digite para buscar..."
                                id="search">
                        </select>
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
               id="produtos_inventario">
            <tbody>
            @foreach ($inventario->items->sortBy('produto_descricao') as $item)
                <tr data-id="{{$item->produto_codigo}}" data-nome="{{$item->produto_descricao}}"
                    style="background-color: #f4f4f4;">
                    <td class="m-0 px-0" style="background-color: #f4f4f4;">
                        <div class="container">
                            <div class="card card-body rounded-0 border-0" style="background-color: #ffffff;">
                                <div class="row">
                                    <div class="col-7 d-flex justify-content-start align-items-center">
                                        <button type="button" class="btn btn-outline-secondary btn-sm me-3"
                                                onclick="deleteRegistro('{{ route('inventarioitem.destroy', $item->id) }}')">
                                            <img src="/images/excluir-verde.png" alt="Excluir">
                                        </button>
                                        <span class="fw-semibold">
                                            {{$item->produto_descricao}} <small>#{{$item->produto_codigo}}</small>

                                            @if ($inventario->finalizado !== null || (in_array($item->status, ['Concluído', 'Erro', 'Cancelado', 'Sem CMC'])))
                                                @if($item->status === 'Sem CMC')
                                                    <br><span class="badge text-bg-warning">
                                                        CMC Zerado para o Produto, a movimentação não foi realizada no Omie
                                                    </span>
                                                @else
                                                    <br><span class="badge text-bg-success">
                                                        {{ $item->codigo_status ? $item->codigo_status . ' - ' : '' }} {{ $item->descricao_status }}
                                                    </span>
                                                @endif
                                            @endif
                                        </span>
                                    </div>

                                    <div class="col-1 p-0">
                                        <small>Medida</small><br>
                                        <span class="fw-semibold">
                                            {{$item->produto->unidade??'--'}}
                                        </span>
                                    </div>

                                    <div class="col-md-4 col-8 d-flex">
                                        <button
                                            type="button"
                                            class="btn btn-sm btn-outline-primary mx-0 btn-validade fw-semibold px-2"
                                            style="width: 40px;"
                                            onclick="subtrai('{{$item->produto_codigo}}')"
                                        >
                                            -
                                        </button>

                                        <input type="number"
                                               class="form-control rounded-0 validade mx-1"
                                               id="quantidade-{{$item->produto_codigo}}"
                                               style="text-align: center;"
                                               min="0.000001"
                                               step="0.000001"
                                               value="{{$item->quan??1}}"
                                               required
                                               @if ($inventario->status === 'Em contagem')
                                                   onblur="setQuantidade('{{ route('inventario.setQuantidade', $item->id) }}', this.value)"
                                               @else
                                                   onblur="editQuantidade(this, '{{ route('inventario.editQuantidade', $item->id) }}', this.value)"
                                            @endif
                                        >

                                        <button
                                            type="button"
                                            class="btn btn-sm btn-outline-primary btn-validade fw-semibold px-2"
                                            style="width: 40px;"
                                            onclick="soma('{{$item->produto_codigo}}')"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            @endforeach
            </tbody>
        </table>
        @include('inventario.qrcode')
        @include('inventario.produto')
        <div class="container-fluid fixed-bottom">
            <div class="row bg-white">
                <div class="col d-flex justify-content-end align-items-center py-3">
                    @if($inventario->finalizado === null)
                        <a href="{{ route('inventario.pdf', $inventario->id) }}"
                           class="btn btn-success text-white me-2">
                            <i class="fas fa-print text-white"></i>
                            Imprimir
                        </a>
                    @endif
                    @if ($inventario->finalizado === null)
                        <form method="POST" action="{{ route('inventario.finish', $inventario->id) }}"
                              id="formInventario">
                            @csrf
                            <button type="submit" class="btn btn-success text-white" form="formInventario">
                                <i class="fas fa-plus text-white"></i>
                                Finalizar
                            </button>
                        </form>
                    @endif
                </div>
            </div>
        </div>
    </div>
@endsection

@push('js')
    <script src="{{ asset('vendor/html5-qrcode.min.js') }}"></script>
    <script>
        function subtrai(opId) {
            const inputValidade = document.getElementById(`quantidade-${opId}`);
            if (!inputValidade) {
                return;
            }
            let q = Number(inputValidade.value)
            let novoValor = q - 1;
            if (novoValor > 0) {
                inputValidade.value = novoValor;
                inputValidade.dispatchEvent(new Event('blur'));
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
            inputValidade.dispatchEvent(new Event('blur'));
        }

        function setQuantidade(url, quantidade) {
            if (quantidade >= 0) {
                axios.post(url, {
                    "quantidade": quantidade
                })
            }
        }

        function editQuantidade(el, url, quantidade) {
            if (quantidade >= 0 && quantidade !== el.dataset.quan) {
                swal.fire({
                    title: 'Tem certeza?',
                    text: 'Gostaria realmente de editar a quantidade do produto, do inventário já Finalizado?',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sim, editar',
                    cancelButtonText: 'Cancelar'
                }).then((result) => {
                    if (result.isConfirmed) {
                        axios.post(url, {
                            "quantidade": quantidade
                        }).then(() => {
                            swal.fire('Editado!', 'A quantidade foi atualizada com sucesso.', 'success');
                        }).catch(() => {
                            swal.fire('Erro!', 'Não foi possível atualizar a quantidade.', 'error');
                        });
                    } else {
                        el.value = el.dataset.quan;
                    }
                });
            }
        }

        function buscarProdutoPorQrCode(codigo) {
            const produtosTable = document.getElementById('produtos_inventario').querySelector('tbody');
            const jaExisteNaTabela = produtosTable.querySelector(`tr[data-id="${codigo}"]`) ?? false;
            if (jaExisteNaTabela) {
                return;
            }
            axios.post(`/inventario/item/{{$inventario->id}}`, {
                "codigo": codigo,
                "quantidade": 1.0,
            }).then(function (r) {
                adicionarProdutoNaListagem(r.data);
            });
        }

        function adicionarProdutoNaListagem(produto) {
            const produtosTable = document.getElementById('produtos_inventario').querySelector('tbody');
            const novaLinha =
                `<tr data-id="${produto.id}" data-nome="${produto.nome}" style="background-color: #f4f4f4;">
                        <td class="m-0 px-0" style="background-color: #f4f4f4;">
                            <div class="container">
                                <div class="card card-body rounded-0 border-0" style="background-color: #ffffff;">
                                    <div class="row">
                                        <div class="col-7 d-flex justify-content-start align-items-center">
                                            <button type="button" class="btn btn-outline-secondary btn-sm me-3" onclick="deleteRegistro('/inventario/item/${produto.key}')">
                                                <img src="/images/excluir-verde.png" alt="Excluir">
                                            </button>
                                            <span class="fw-semibold">${produto.nome} <small>#${produto.id}</small></span>
                                        </div>

                                        <div class="col-1 p-0">
                                            <small>Medida</small><br>
                                            <span class="fw-semibold">
                                                ${produto.unidade}
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
                                                   step="0.000001"
                                                   value="1"
                                                   required
                                                   @if ($inventario->status === 'Em contagem')
                onblur="setQuantidade('/inventario/quantidade/${produto.key}', this.value)"
                                                   @else
                onblur="editQuantidade(this, '/inventario/edit/quantidade/${produto.key}', this.value)"
                                                   @endif
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
            produtosTable.insertAdjacentHTML('afterbegin', novaLinha);
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
                            width: 320,
                            height: 320
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

            const selectSearch = new TomSelect('#search', {
                render: {
                    no_results: function (data, escape) {
                        return '<div class="no-results">Nenhum produto encontrado</div>';
                    },
                    option: function (data, escape) {
                        const tbody = document.querySelector("#produtos_inventario tbody");
                        let produtosTable = document.getElementById('produtos_inventario').querySelector('tbody');
                        let jaExisteNaTabela = produtosTable.querySelector(`tr[data-id="${data.codigo}"]`) ? 'disabled' : '';
                        let imag = (jaExisteNaTabela === '') ? '/images/plus.png' : '/images/check-verde.svg';

                        return `<div class="container">
                            <div class="row">
                                <div class="col-10">
                                    <button class="btn me-2 add-product border-0" type="button" ${jaExisteNaTabela}>
                                        <img src="${imag}" alt="+">
                                     </button>
                                    <span class="fw-semibold" style="color: #2EB5C3;" ${jaExisteNaTabela}>${data.descricao}</span>
                                </div>
                                <div class="col-2 fw-medium text-end">
                                    ${data.unidade}
                                </div>
                            </div>
                        </div>`;
                    },
                    item: function (data, escape) {
                        const tbody = document.querySelector("#produtos_inventario tbody");
                        let produtosTable = document.getElementById('produtos_inventario').querySelector('tbody');
                        let jaExisteNaTabela = produtosTable.querySelector(`tr[data-id="${data.codigo}"]`) ? 'disabled' : '';
                        let imag = (jaExisteNaTabela === '') ? '/images/plus.png' : '/images/check-verde.svg';

                        return `<div class="container">
                            <div class="row">
                                <div class="col-10">
                                    <button class="btn me-2 add-product border-0" type="button" ${jaExisteNaTabela}>
                                        <img src="${imag}" alt="+">
                                     </button>
                                    <span class="fw-semibold" style="color: #2EB5C3;" ${jaExisteNaTabela}>${data.descricao}</span>
                                </div>
                                <div class="col-2 fw-medium text-end">
                                    ${data.unidade}
                                </div>
                            </div>
                        </div>`;
                    }
                },
                valueField: 'codigo',
                labelField: 'descricao',
                searchField: 'descricao',
                load: function (query, callback) {
                    fetch(`/transferencia/produtos?q=${encodeURIComponent(query)}`)
                        .then(res => res.json())
                        .then(json => {
                            callback(json.data);
                        }).catch(() => {
                        callback();
                    });
                }
            });

            selectSearch.on("change", function (produtoId) {
                if (produtoId !== undefined && produtoId !== null && produtoId !== '') {
                    buscarProdutoPorQrCode(produtoId)
                    this.clear()
                }
            });
        });
    </script>
@endpush

@push('css')
    <style>
        body {
            background-color: #F4F4F4;
        }

        .search {
            color: #2EB5C3 !important;
            border: none !important;
            border-bottom: 1px solid #c7c7c7 !important;
        }

        .search::placeholder {
            color: #2EB5C3 !important;
        }

        .ts-wrapper .ts-control input {
            color: #2EB5C3 !important;
            border: none !important;
            font-weight: 500 !important;
        }

        .ts-wrapper .ts-control input::placeholder {
            color: #2EB5C3 !important;
            font-weight: 700 !important;
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
