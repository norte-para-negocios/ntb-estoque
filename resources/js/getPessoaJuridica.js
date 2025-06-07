function getPessoaJuridica(cnpj, nmObjNome, nmObjFantasia, nmObjCep, nmObjUf, nmObjCidade, nmObjBairro, nmObjLogradouro, nmObjNum) {
    let tCnpj = cnpj.replace(/[^\d]+/g, '');
    if (tCnpj.length > 11) {
        let tUrl = `https://www.receitaws.com.br/v1/cnpj/${tCnpj}`;
        $.ajax({
            url: tUrl,
            jsonp: "callback",
            dataType: "jsonp",
            success: function (response) {
                if (response.status != 'ERROR') {
                    if (response.nome != '') {
                        $(nmObjNome).val(response.nome.toUpperCase());
                    }
                    if (response.fantasia != '') {
                        $(nmObjFantasia).val(response.fantasia.toUpperCase());
                    } else {
                        $(nmObjFantasia).val(response.nome.toUpperCase());
                    }
                    if (response.cep != '') {
                        $(nmObjCep).val(response.cep.replace(/[^\d]+/g, ''));
                    }
                    if (response.uf != '') {
                        $(nmObjUf).val(response.uf.toUpperCase());
                    }
                    if (response.municipio != '') {
                        $(nmObjCidade).val(response.municipio.toUpperCase());
                    }
                    if (response.bairro != '') {
                        $(nmObjBairro).val(response.bairro.toUpperCase());
                    }
                    if (response.logradouro != '') {
                        $(nmObjLogradouro).val(response.logradouro.toUpperCase());
                    }
                    if (response.numero != '') {
                        $(nmObjNum).val(response.numero.toUpperCase());
                    }
                } else {
                    error("O CNPJ não foi localizado, verifique o valor informado!")
                }
            },
            error: function (error) {
                error("Erro ao consultar CNPJ, tente novamente em alguns instantes!");
            }
        });
    }
}
