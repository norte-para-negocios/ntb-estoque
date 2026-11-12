// Plataforma Norte: para onde o login manda depois de entrar (PURO; node --test).
// Lista fechada: só '/porta' é aceito; qualquer outro valor (URL de fora, caminho qualquer) cai em '/home'.
export function destinoDoLogin(valor: unknown): '/porta' | '/home' {
  return valor === '/porta' ? '/porta' : '/home'
}
