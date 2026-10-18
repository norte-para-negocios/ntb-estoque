// Fixture: 3 itens reais da NF 131055 (CRBS S/A → loja), valores conferidos com o Omie e o kardex (itens 0, 6 e 7 do
// recebimento capturado em ~/Projects/omie-rea/telas/COM/etapas-pedidos-compra/nf-000131055). CNPJ e IE do emitente
// MASCARADOS (99111222000149 / 123456789): a chave foi refeita com esse CNPJ e o DV certo. Destinatário = ODARA.
// Transporte e assinatura são de mentira (a assinatura serve só para "presente"; não confere).

export const CNPJ_CRBS = '99111222000149'
export const CHAVE_CRBS = '29260999111222000149550220001310551123456781'

const ICMS60 = '<ICMS><ICMS60><orig>0</orig><CST>60</CST></ICMS60></ICMS>'

export const XML_CRBS_131055 = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE_CRBS}" versao="4.00">` +
  `<ide><cUF>29</cUF><natOp>VENDA DE PRODUTOS</natOp><mod>55</mod><serie>22</serie><nNF>131055</nNF><dhEmi>2026-09-28T20:44:41-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb><finNFe>1</finNFe></ide>` +
  `<emit><CNPJ>${CNPJ_CRBS}</CNPJ><xNome>CRBS S/A</xNome><xFant>CDL AS CAMACARI</xFant><IE>123456789</IE><CRT>3</CRT></emit>` +
  `<dest><CNPJ>66764497000122</CNPJ><xNome>ODARA BEACH</xNome></dest>` +
  `<det nItem="1"><prod><cProd>0023552</cProd><cEAN>7896445412927</cEAN><xProd>INDAIA AGUA MINERAL S/GAS GFA PET 500ML PACK C/12</xProd><NCM>22011000</NCM><CFOP>5405</CFOP><uCom>cx</uCom><qCom>10.0000</qCom><vUnCom>16.2995160000</vUnCom><vProd>163.00</vProd><vOutro>13.41</vOutro><indTot>1</indTot></prod>` +
  `<imposto>${ICMS60}<IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI><PIS><PISNT><CST>06</CST></PISNT></PIS><COFINS><COFINSNT><CST>06</CST></COFINSNT></COFINS></imposto></det>` +
  `<det nItem="2"><prod><cProd>0018836</cProd><cEAN>7891149108732</cEAN><xProd>CORONA EXTRA N LONG NECK 330ML CX C/24 NPAL</xProd><NCM>22030000</NCM><CFOP>5405</CFOP><uCom>cx</uCom><qCom>4.0000</qCom><vUnCom>158.1491010000</vUnCom><vProd>632.60</vProd><vOutro>53.71</vOutro><indTot>1</indTot></prod>` +
  `<imposto>${ICMS60}<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>686.31</vBC><pIPI>2.92</pIPI><vIPI>20.04</vIPI></IPITrib></IPI><PIS><PISAliq><CST>02</CST><vBC>573.51</vBC><pPIS>1.86</pPIS><vPIS>10.67</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>02</CST><vBC>573.51</vBC><pCOFINS>8.54</pCOFINS><vCOFINS>48.98</vCOFINS></COFINSAliq></COFINS></imposto></det>` +
  `<det nItem="3"><prod><cProd>0009092</cProd><cEAN>7891991002509</cEAN><xProd>TONICA ANTARCTICA DIET LATA 350ML SH C/12 NPAL</xProd><NCM>22021000</NCM><CFOP>5405</CFOP><uCom>cx</uCom><qCom>1.0000</qCom><vUnCom>36.0755500000</vUnCom><vProd>36.08</vProd><vOutro>3.03</vOutro><indTot>1</indTot></prod>` +
  `<imposto>${ICMS60}<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>39.11</vBC><pIPI>1.95</pIPI><vIPI>0.76</vIPI></IPITrib></IPI><PIS><PISAliq><CST>02</CST><vBC>33.22</vBC><pPIS>1.86</pPIS><vPIS>0.62</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>02</CST><vBC>33.22</vBC><pCOFINS>8.54</pCOFINS><vCOFINS>2.84</vCOFINS></COFINSAliq></COFINS></imposto></det>` +
  `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vProd>831.68</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vIPI>20.80</vIPI><vPIS>11.29</vPIS><vCOFINS>51.82</vCOFINS><vOutro>70.15</vOutro><vNF>922.63</vNF></ICMSTot></total>` +
  `<transp><modFrete>0</modFrete><transporta><CNPJ>${CNPJ_CRBS}</CNPJ><xNome>CRBS S/A</xNome><IE>123456789</IE><UF>BA</UF></transporta><veicTransp><placa>ABC1D23</placa><UF>BA</UF><RNTC>123456</RNTC></veicTransp><vol><qVol>77</qVol><esp>CX</esp><marca>AMBEV</marca><nVol>1-77</nVol><pesoL>820.5</pesoL><pesoB>860.2</pesoB><lacres><nLacre>L001</nLacre></lacres></vol></transp>` +
  `</infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#NFe${CHAVE_CRBS}"><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue></Reference></SignedInfo><SignatureValue>QUJDRA==</SignatureValue><KeyInfo><X509Data><X509Certificate>TUlJ</X509Certificate></X509Data></KeyInfo></Signature></NFe>` +
  `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${CHAVE_CRBS}</chNFe><nProt>129260000000001</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`
