/**
 * Marcação em lote de estabelecimentos fechados no WordPress da Veja Rio
 *
 * Segunda etapa do processo: recebe os nomes que a verificação de status
 * (verificar_status.gs) apontou como fechados e marca o campo
 * "estabelecimento_fechado" no cadastro de cada um.
 *
 * Por que pelo formulário do painel e não pela API REST:
 * a API REST do site permite leitura, mas a escrita exigia uma autenticação
 * que não estava disponível. A solução foi reproduzir o envio do formulário
 * de edição do próprio painel, usando a sessão do editor já logado.
 * Como o formulário é reenviado com todos os campos que já existiam,
 * nenhum outro dado do cadastro é alterado.
 *
 * Como usar:
 *   1. Faça login no painel do WordPress (wp-admin).
 *   2. Cole a lista de fechados em FECHADOS (vinda da planilha de resultados).
 *   3. Abra o console do navegador (F12), cole este script e pressione Enter.
 */

(async () => {
  const LOTE = 2;          // estabelecimentos processados em paralelo
  const PAUSA_MS = 1500;   // intervalo entre lotes, para não sobrecarregar o servidor

  // Nomes exatamente como aparecem na planilha de resultados (status FECHADO).
  const FECHADOS = [
    // 'Nome do estabelecimento 1',
    // 'Nome do estabelecimento 2',
  ];

  const resultado = { marcados: [], naoEncontrados: [], erros: [] };
  console.log(`Marcando ${FECHADOS.length} estabelecimentos como fechados...`);

  for (let i = 0; i < FECHADOS.length; i += LOTE) {
    const lote = FECHADOS.slice(i, i + LOTE);
    await Promise.all(lote.map(nome => marcarComoFechado(nome, resultado)));

    const feitos = Math.min(i + LOTE, FECHADOS.length);
    console.log(`Progresso: ${feitos}/${FECHADOS.length}`);

    if (feitos < FECHADOS.length) {
      await new Promise(r => setTimeout(r, PAUSA_MS));
    }
  }

  console.log('\nResumo');
  console.log(`  Marcados:        ${resultado.marcados.length}`);
  console.log(`  Não encontrados: ${resultado.naoEncontrados.length}`);
  console.log(`  Erros:           ${resultado.erros.length}`);
  console.table(resultado.erros);

  window.resultadoMarcacao = resultado; // disponível no console para conferência
})();

/** Encontra o estabelecimento pelo nome e marca o campo de fechado. */
async function marcarComoFechado(nome, resultado) {
  try {
    const id = await buscarId(nome);
    if (!id) {
      resultado.naoEncontrados.push(nome);
      return;
    }

    const dados = await lerFormularioDeEdicao(id);
    dados.set('estabelecimento_fechado', 'sim');

    const resposta = await fetch('/wp-admin/post.php', {
      method: 'POST',
      body: dados,
      credentials: 'include',
      redirect: 'manual',
    });

    // O WordPress responde ao salvamento com um redirecionamento.
    const salvou = resposta.type === 'opaqueredirect' || resposta.ok || resposta.status === 302;
    if (!salvou) throw new Error(`HTTP ${resposta.status}`);

    resultado.marcados.push({ nome, id });
  } catch (erro) {
    resultado.erros.push({ nome, erro: erro.message });
  }
}

/** Busca o ID do estabelecimento pela API REST (somente leitura). */
async function buscarId(nome) {
  const url = `/wp-json/wp/v2/estabelecimento?search=${encodeURIComponent(nome)}&per_page=1`;
  const lista = await (await fetch(url)).json();
  return lista && lista.length > 0 ? lista[0].id : null;
}

/** Abre a página de edição e copia todos os campos preenchidos do formulário. */
async function lerFormularioDeEdicao(id) {
  const html = await (await fetch(`/wp-admin/post.php?post=${id}&action=edit`, { credentials: 'include' })).text();
  const form = new DOMParser().parseFromString(html, 'text/html').getElementById('post');
  if (!form) throw new Error('Formulário de edição não encontrado');

  const dados = new FormData();
  for (const campo of form.querySelectorAll('input, textarea, select')) {
    if (!campo.name || campo.type === 'submit') continue;
    if ((campo.type === 'radio' || campo.type === 'checkbox') && !campo.checked) continue;
    dados.append(campo.name, campo.value);
  }
  return dados;
}
