<div class="modal fade" id="createInventarioModal" tabindex="-1" aria-labelledby="createInventarioModalLabel"
    aria-hidden="true">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h1 class="modal-title fs-5" id="createInventarioModalLabel">
                    Nova Transferência:
                    <small>{{ auth()->user()->loja->nome_fantasia }}</small>
                </h1>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <form method="POST" action="{{ route('transfers.store') }}" id="formInventario">
                    @csrf
                    <div class="mb-3">
                        <label for="data" class="form-label">Data</label>
                        <input type="date" name="data" id="data" class="form-control"
                            value="{{ \Carbon\Carbon::now()->format('Y-m-d') }}" required>
                    </div>

                    <div class="mb-3">
                        <label for="codigo_local_origem" class="form-label">Estoque de Origem</label>
                        <select name="codigo_local_origem" id="codigo_local_origem" class="form-select" required>
                            @foreach ($locaisEstoque as $local)
                                <option value="{{ $local->codigo_local_estoque }}">
                                    <small>{{ $local->codigo }}</small> -
                                    {{ $local->descricao }}
                                </option>
                            @endforeach
                        </select>
                    </div>

                    <div class="mb-3">
                        <label for="codigo_local_destino" class="form-label">Estoque de Destino</label>
                        <select name="codigo_local_destino" id="codigo_local_destino" class="form-select" required>
                            @foreach ($locaisEstoque as $local)
                                <option value="{{ $local->codigo_local_estoque }}">
                                    <small>{{ $local->codigo }}</small> -
                                    {{ $local->descricao }}
                                </option>
                            @endforeach
                        </select>
                    </div>

                    <div class="mb-3">
                        <label for="motivo" class="form-label">Motivo</label>
                        <select name="motivo" id="motivo" class="form-select" required>
                            <option value="">Selecione o motivo</option>
                            @foreach (\App\Helpers\Constants::TIPO_MOVIMENTO_TRANSFERENCIA as $key => $value)
                                <option value="{{ $key }}">{{ $value }}</option>
                            @endforeach
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="submit" class="btn btn-primary" form="formInventario">Salvar</button>
            </div>
        </div>
    </div>
</div>
