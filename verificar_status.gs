/**
 * Verificação de status dos estabelecimentos do guia Veja Rio Comer & Beber
 *
 * Lê a lista de estabelecimentos de uma planilha, consulta o status de cada um
 * na Google Places API (aberto, fechado temporariamente, fechado permanentemente)
 * e grava o resultado em uma nova aba para revisão editorial.
 *
 * Configuração:
 *   1. Em Projeto > Configurações do projeto > Propriedades do script,
 *      crie a propriedade GOOGLE_MAPS_API_KEY com a sua chave.
 *   2. Na planilha vinculada, crie uma aba "Estabelecimentos" com os nomes
 *      na coluna A, a partir da linha 2.
 *
 * A chave nunca fica no código: ela é lida das propriedades do script.
 */

const CONFIG = {
  ABA_ENTRADA: 'Estabelecimentos',
  CIDADE: 'Rio de Janeiro',
  PAUSA_MS: 100, // intervalo entre requisições, para respeitar o limite da API
};

const STATUS = {
  OPERATIONAL: 'ABERTO',
  CLOSED_TEMPORARILY: 'FECHADO TEMPORARIAMENTE',
  CLOSED_PERMANENTLY: 'FECHADO PERMANENTEMENTE',
};

function verificarEstabelecimentos() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    throw new Error('Defina GOOGLE_MAPS_API_KEY nas propriedades do script.');
  }

  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const nomes = lerEstabelecimentos(planilha);
  Logger.log(`Verificando ${nomes.length} estabelecimentos...`);

  const resultados = nomes.map((nome, i) => {
    if ((i + 1) % 50 === 0) Logger.log(`Processados: ${i + 1}/${nomes.length}`);
    const resultado = consultarStatus(nome, apiKey);
    Utilities.sleep(CONFIG.PAUSA_MS);
    return resultado;
  });

  gravarResultados(planilha, resultados);
  registrarResumo(resultados);
}

/** Lê os nomes da coluna A da aba de entrada, ignorando linhas vazias. */
function lerEstabelecimentos(planilha) {
  const aba = planilha.getSheetByName(CONFIG.ABA_ENTRADA);
  if (!aba) throw new Error(`Aba "${CONFIG.ABA_ENTRADA}" não encontrada.`);

  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return [];

  return aba.getRange(2, 1, ultimaLinha - 1, 1)
    .getValues()
    .map(linha => String(linha[0]).trim())
    .filter(nome => nome !== '');
}

/**
 * Busca o estabelecimento pelo nome e retorna o status de funcionamento.
 * Usa duas chamadas: Text Search (encontra o place_id) e Place Details (status).
 */
function consultarStatus(nome, apiKey) {
  try {
    const busca = buscarJson(
      'https://maps.googleapis.com/maps/api/place/textsearch/json' +
      `?query=${encodeURIComponent(`${nome} ${CONFIG.CIDADE}`)}&key=${apiKey}`
    );
    if (!busca.results || busca.results.length === 0) {
      return { nome, status: 'NÃO ENCONTRADO', nomeNoMaps: '' };
    }

    const placeId = busca.results[0].place_id;
    const detalhes = buscarJson(
      'https://maps.googleapis.com/maps/api/place/details/json' +
      `?place_id=${placeId}&fields=name,business_status&key=${apiKey}`
    );
    if (!detalhes.result) {
      return { nome, status: 'NÃO ENCONTRADO', nomeNoMaps: '' };
    }

    return {
      nome,
      status: STATUS[detalhes.result.business_status] || 'SEM STATUS',
      nomeNoMaps: detalhes.result.name || '',
    };
  } catch (erro) {
    Logger.log(`Erro em "${nome}": ${erro.message}`);
    return { nome, status: 'ERRO', nomeNoMaps: '' };
  }
}

function buscarJson(url) {
  const resposta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return JSON.parse(resposta.getContentText());
}

/**
 * Grava os resultados em uma aba nova, em uma única operação.
 * A coluna "Nome no Google Maps" ajuda a revisão a detectar correspondências erradas
 * (quando a busca encontra outro lugar com nome parecido).
 */
function gravarResultados(planilha, resultados) {
  const nomeAba = `Resultado ${Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm')}`;
  const aba = planilha.insertSheet(nomeAba);

  const ordem = ['FECHADO PERMANENTEMENTE', 'FECHADO TEMPORARIAMENTE', 'NÃO ENCONTRADO', 'ERRO', 'SEM STATUS', 'ABERTO'];
  const ordenados = [...resultados].sort((a, b) => ordem.indexOf(a.status) - ordem.indexOf(b.status));

  const linhas = [['Status', 'Estabelecimento (guia)', 'Nome no Google Maps']]
    .concat(ordenados.map(r => [r.status, r.nome, r.nomeNoMaps]));

  aba.getRange(1, 1, linhas.length, 3).setValues(linhas);
  aba.setFrozenRows(1);
  aba.autoResizeColumns(1, 3);
}

function registrarResumo(resultados) {
  const contagem = resultados.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  Logger.log('Resumo:');
  Object.keys(contagem).forEach(status => Logger.log(`  ${status}: ${contagem[status]}`));
  Logger.log(`  TOTAL: ${resultados.length}`);
}
