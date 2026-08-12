import { omieRequest, type LojaOmie } from './client'

export interface DfeLinks {
  linkPDF?: string
  linkXML?: string
  linkPortal?: string
}

export async function obterLinksDfe(loja: LojaOmie, nIdNfe: number): Promise<DfeLinks> {
  return omieRequest<DfeLinks>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/dfedocs',
    call: 'ObterNfe',
    data: { nIdNfe },
  })
}
