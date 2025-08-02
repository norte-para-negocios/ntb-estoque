<table>
    <thead>
        <tr>
            <th>Loja</th>
            <th>Ordem de Produção</th>
            <th>Data</th>
            <th>Produto</th>
        </tr>
    </thead>
    <tbody>
        @foreach ($ordenspro as $ordem)
            <tr>
                <td>
                    {{ $loja->nome }}
                </td>
                <td>
                    {{ $loja->num_ordem }}
                </td>
                <td>
                    {{ $loja->adicionais_d_dt_conclucao??'' }}
                </td>
                <td>
                    {{ $loja->produto_descricao }}
                </td>
            </tr>
        @endforeach
    </tbody>
</table>
