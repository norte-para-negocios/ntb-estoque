<table>
    <thead>
        <tr>
            <th class="col-especialidade">Conclusão</th>
            <th class="col-especialidade">Cód Produto</th>
            <th class="col-status">Descrição Produto</th>
            <th class="col-servico">Número da OP</th>
            <th class="col-data text-left">Und</th>
            <th class="col-data text-left">Qtd Prevista</th>
        </tr>
    </thead>
    <tbody>
        @foreach ($ordenspro as $ordem)
            <tr>
                <td>
                    {{ optional($ordem->adicionais_d_dt_conclusao) ? \Carbon\Carbon::parse($ordem->adicionais_d_dt_conclusao)->format('d/m/Y') : '' }}
                </td>
                <td>
                    {{ $ordem->identificacao_n_cod_produto ?? '' }}
                </td>
                <td>
                    {{ $ordem->produto_descricao ?? '' }}
                </td>
                <td>
                    {{ $ordem->num_ordem ?? '' }}
                </td>
                <td>
                    {{ $ordem->produto_unidade ?? '' }}
                </td>
                <td>
                    {{ $ordem->identificacao_n_qtde ?? '' }}
                </td>
            </tr>
        @endforeach
    </tbody>
</table>
