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
                            <table class="table table-hover table-borderless" id="tabelaResultadosTransfers">
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

@push('js')
    <script>
        async function buscarProdutos(page = 1) {
            const termo = document.getElementById("productSearch").value;
            try {
                const response = await axios.get(`/transferencia/produtos?page=${page}&q=${encodeURIComponent(termo)}`);
                const resultado = response.data;

                // Renderiza tabela
                const tbody = document.querySelector("#tabelaResultadosTransfers tbody");
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

                        buscarProdutoPorQrCode(produto.id);
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
