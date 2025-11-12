<div class="modal fade" id="produtoModal" tabindex="-1" aria-labelledby="produtoModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-fullscreen">
        <div class="modal-content">
            <div class="modal-header">
                <button type="button" class="btn" data-bs-dismiss="modal" aria-label="Close">
                    <img src="{{asset('images/voltar.png')}}" alt="<-">
                </button>
                <input class="search form-control fw-semibold rounded-0"
                       type="search"
                       placeholder="Digite para buscar..."
                       id="productSearch"
                       autofocus
                       onkeyup="buscarProdutos()"
                />
            </div>
            <div class="modal-body">
                <div class="container">
                    <div class="row">
                        <div class="col">
                            <table class="table table-hover table-borderless" id="tabelaResultados">
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer d-flex justify-content-center align-items-center">
                <div class="container">
                    <div class="row pt-3">
                        <div class="col-12 d-flex justify-content-center align-items-center">
                            <nav>
                                <ul class="pagination" id="paginacao"></ul>
                            </nav>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

@push('css')
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet"/>
    <link rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/select2-bootstrap-5-theme@1.3.0/dist/select2-bootstrap-5-theme.min.css"/>
@endpush

@push('js')
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script>
        async function buscarProdutos(page = 1) {
            const termo = document.getElementById("productSearch").value;
            try {
                const response = await axios.get(`/transferencia/produtos?page=${page}&q=${encodeURIComponent(termo)}`);
                const resultado = response.data;

                // Renderiza tabela
                const tbody = document.querySelector("#tabelaResultados tbody");
                tbody.innerHTML = "";
                resultado.data.forEach(item => {
                    const tr = document.createElement("tr");
                    tr.style.borderBottom = "1px solid #ccc";
                    const tdCodigo = document.createElement("td");
                    let produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');
                    let jaExisteNaTabela = produtosTable.querySelector(`tr[data-id="${item.codigo}"]`) ? 'disabled' : '';
                    let imag = (jaExisteNaTabela === '') ? '/images/plus.png' : '/images/check-verde.svg';

                    tdCodigo.innerHTML = `
                        <div class="container">
                            <div class="row">
                                <div class="col-10">
                                    <button class="btn me-2 add-product border-0" type="button" ${jaExisteNaTabela}>
                                        <img src="${imag}" alt="+">
                                     </button>
                                    <span class="fw-semibold" style="color: #2EB5C3;" ${jaExisteNaTabela}>${item.descricao}</span>
                                </div>
                                <div class="col-2 fw-medium text-end">
                                    ${item.unidade}
                                </div>
                            </div>
                        </div>`;

                    const button = tdCodigo.querySelector("button.add-product");
                    button.addEventListener("click", (event) => {
                        const produto = {
                            id: item.codigo,
                            nome: item.descricao,
                            unidade: item.unidade,
                        }

                        button.disabled = true;

                        let produtosTable = document.getElementById('produtos_transferencia').querySelector('tbody');
                        let jaExisteNaTabela = produtosTable.querySelector(`tr[data-id="${produto.id}"]`) ?? false;
                        if (jaExisteNaTabela) {
                            jaExisteNaTabela.disabled = true;
                            return;
                        }

                        const img = button.querySelector("img");
                        if (img) {
                            img.src = "/images/check-verde.svg";   // nova imagem
                            img.alt = "✔";                   // novo texto alternativo
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
                    });

                    tr.appendChild(tdCodigo);
                    tbody.appendChild(tr);
                });

                // Renderiza paginação Bootstrap
                const paginacaoUl = document.getElementById("paginacao");
                paginacaoUl.innerHTML = "";

                resultado.links.forEach(link => {
                    const li = document.createElement("li");
                    li.classList.add("page-item");
                    if (link.active) li.classList.add("active");
                    if (!link.url) li.classList.add("disabled");

                    const a = document.createElement("a");
                    a.classList.add("page-link");
                    a.innerHTML = link.label;

                    if (link.url) {
                        a.href = "#";
                        a.onclick = (e) => {
                            e.preventDefault();
                            const url = new URL(link.url);
                            const pageParam = url.searchParams.get("page");
                            buscarProdutos(pageParam);
                        };
                    }

                    li.appendChild(a);
                    paginacaoUl.appendChild(li);
                });

            } catch (error) {
                console.error("Erro na busca:", error);
            }
        }

    </script>

@endpush
