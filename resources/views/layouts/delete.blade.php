<div class="modal fade" id="deleteModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
    aria-labelledby="deleteModalLabel" aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title fs-5 text-danger" id="deleteModalLabel">CONFIRMAÇÃO DE EXCLUSÃO</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <div class="container-fluid">
                    <form action="" id="deleteForm" method="post">
                        @csrf
                        @method('DELETE')
                        <h5 class="text-center mb-4">
                            Gostaria realmente de excluir este registro?<br>
                            <span class="font-weight-bold">Todos os registros</span> associados a este também serão
                            excluídos!
                        </h5>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <button type="submit" class="btn btn-danger me-auto" form="deleteForm">Sim, excluir registro</button>
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            </div>
        </div>
    </div>
</div>

<script type="text/javascript">
    function deleteRegistro(url) {
        let deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'), {
            keyboard: false
        })
        document.getElementById("deleteForm").reset()
        document.getElementById("deleteForm").action = url
        deleteModal.show()
    }
</script>
