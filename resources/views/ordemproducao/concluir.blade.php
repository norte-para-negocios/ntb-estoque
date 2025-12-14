<div class="modal fade" id="concluirOrdemProducaoModal" tabindex="-1" aria-labelledby="concluirOrdemProducaoModalLabel"
    aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h1 class="modal-title fs-5" id="concluirOrdemProducaoModalLabel">
                    Concluir Ordem de Produção
                </h1>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <form method="POST" action="" id="formConcluirOrdemProducao">
                    @csrf
                    <div class="mb-3">
                        <label for="concluir_data" class="form-label">Data Conclusão*</label>
                        <input type="date" name="data" id="concluir_data" class="form-control" required>
                    </div>

                    <div class="mb-3">
                        <label for="concluir_quantidade" class="form-label">Quantidade Produzida*</label>
                        <input type="number" name="quantidade" id="concluir_quantidade" class="form-control" required>
                    </div>

                    <div class="mb-3">
                        <label for="concluir_obs" class="form-label">Observações</label>
                        <textarea name="observacao" id="concluir_obs" class="form-control"></textarea>
                    </div>

                </form>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="submit" class="btn btn-success" form="formConcluirOrdemProducao">Concluir</button>
            </div>
        </div>
    </div>
</div>

@push('js')
    <script>
        const concluirOrdemProducaoModal = document.getElementById('concluirOrdemProducaoModal')
        if (concluirOrdemProducaoModal) {
            concluirOrdemProducaoModal.addEventListener('show.bs.modal', event => {
                const button = event.relatedTarget
                document.getElementById('formConcluirOrdemProducao').action = button.getAttribute('data-url');
                document.getElementById('concluir_data').value = (new Date());
                document.getElementById('concluir_quantidade').value = button.getAttribute('data-quantidade');
            })
        }
    </script>
@endpush
