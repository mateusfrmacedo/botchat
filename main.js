const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

app.setName('BotChat');

let janela, bot, arquivoConfig, reiniciando = false, botAtivo = true, prontoParaMensagensEm = 0;
const iniciadas = new Set();
const pausadas = new Set();
const navegacao = new Map();
const pausasManuais = new Map();
const enviosAutomaticos = new Map();
const TEMPO_PAUSA_MANUAL = 30 * 60 * 1000;
let estado = { conexao: 'Desconectado', detalhe: 'Iniciando...', qrCode: null, eventos: [] };
const padrao = { configuracoes: { mensagemInicialAtiva: true, saudacao: '{saudacao}, {nome}!', avisoGlobal: { ativo: false, texto: '' }, expediente: { ativo: false, inicio: '08:00', fim: '17:00', dias: [1,2,3,4,5] }, atendimentoHumano: { ativo: true }, atendentes: [] }, opcoes: [] };

function emitir() { janela?.webContents.send('status:changed', estado); }
function log(texto) { console.log(`[Bot] ${texto}`); if (/^(Mensagem recebida|Saudação e menu enviados|Resposta |Sub-resposta )/.test(texto)) return; estado.eventos = [`${new Date().toLocaleTimeString('pt-BR')} — ${texto}`, ...estado.eventos].slice(0, 10); emitir(); }
function garantirConfig() { fs.mkdirSync(path.dirname(arquivoConfig), { recursive: true }); if (!fs.existsSync(arquivoConfig)) fs.writeFileSync(arquivoConfig, JSON.stringify(padrao, null, 2)); }
function lerConfig() { try { garantirConfig(); const d = JSON.parse(fs.readFileSync(arquivoConfig, 'utf8')); d.configuracoes ||= JSON.parse(JSON.stringify(padrao.configuracoes)); if (typeof d.configuracoes.mensagemInicialAtiva !== 'boolean') d.configuracoes.mensagemInicialAtiva = true; d.configuracoes.saudacao ||= padrao.configuracoes.saudacao; d.configuracoes.avisoGlobal ||= { ativo:false, texto:'' }; d.configuracoes.expediente ||= JSON.parse(JSON.stringify(padrao.configuracoes.expediente)); d.configuracoes.atendimentoHumano ||= { ativo:true }; d.configuracoes.atendentes ||= []; d.opcoes ||= []; if (!d.configuracoes.respostasPadraoV2Removidas) { d.opcoes = d.opcoes.filter(o => !['matricula', 'transporte-universitario'].includes(o.id)); d.configuracoes.respostasPadraoV2Removidas = true; } if (!d.configuracoes.atendentesPadraoRemovidos) { d.configuracoes.atendentes = d.configuracoes.atendentes.filter(a => !['thais', 'andreia', 'gabriela', 'silvania', 'mateus'].includes(String(a.id || '').toLowerCase())); d.configuracoes.atendentesPadraoRemovidos = true; } salvarConfig(d); d.opcoes.forEach(o => { o.subopcoes ||= []; }); return d; } catch (e) { log(`ERRO config.json: ${e.message}`); throw Error('Não foi possível ler config.json.'); } }
function salvarConfig(d) { const tmp = `${arquivoConfig}.tmp`; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, arquivoConfig); }
function saudacao() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
function noExpediente() { const e = lerConfig().configuracoes.expediente; if (!e.ativo) return true; const agora = new Date(), atual = agora.getHours()*60+agora.getMinutes(), [hi,mi] = e.inicio.split(':').map(Number), [hf,mf] = e.fim.split(':').map(Number); return e.dias.includes(agora.getDay()) && atual >= hi*60+mi && atual <= hf*60+mf; }
function opcoesAtivas() { return lerConfig().opcoes.filter(x => x.ativo).sort((a,b) => Number(a.numero)-Number(b.numero)); }
function montarMenu() { const ops = opcoesAtivas(); const humanoAtivo = lerConfig().configuracoes.atendimentoHumano.ativo; const linhas = ops.map((o,i) => `${i+1}. ${o.titulo}`); if (humanoAtivo) linhas.push(`${ops.length+1}. Falar com um atendente`); return { ops, humanoAtivo, texto: linhas.length ? `\n\n*Escolha uma opção:*\n${linhas.join('\n')}` : '' }; }
function montarSubmenu(itens, titulo) { return `\n\n*${titulo}*\n${itens.map((item, i) => `${i+1}. ${item.titulo || item.nome}`).join('\n')}\n${itens.length+1}. Voltar`; }
async function enviar(jid, texto) {
  // Contatos recentes podem chegar como @lid; não usamos Chat.getChat(), que falha para alguns deles.
  await new Promise(resolve => setTimeout(resolve, 2000));
  enviosAutomaticos.set(jid, Date.now());
  return bot.sendMessage(jid, texto);
}
async function chavesDoContato(msg, jid) { const chaves=new Set([jid]); try { const contato=await msg.getContact(); if(contato.id?._serialized)chaves.add(contato.id._serialized); if(contato.number)chaves.add(`${String(contato.number).replace(/\D/g,'')}@c.us`); } catch (_) {} return [...chaves]; }
async function pausarComunicado(destino) { const ate=Date.now()+TEMPO_PAUSA_MANUAL; pausasManuais.set(destino,ate); try { const contato=await bot.getContactById(destino); if(contato.id?._serialized)pausasManuais.set(contato.id._serialized,ate); if(contato.number)pausasManuais.set(`${String(contato.number).replace(/\D/g,'')}@c.us`,ate); } catch (_) {} }
async function tratarMensagem(msg) {
  if (msg.fromMe || msg.isStatus || !msg.from || msg.from.endsWith('@g.us')) return;
  // O WhatsApp Web pode reenviar mensagens pendentes ao conectar. Só tratamos as
  // que chegaram depois que o bot ficou pronto nesta execução.
  const dataMensagem = Number(msg.timestamp) * 1000;
  if (!prontoParaMensagensEm || (Number.isFinite(dataMensagem) && dataMensagem < prontoParaMensagensEm)) {
    log(`Mensagem anterior à abertura ignorada: ${msg.from}.`);
    return;
  }
  const jid = msg.from;
  try {
    log(`Mensagem recebida de ${jid}: ${(msg.body || '[mídia]').slice(0, 60)}`);
    const chavesContato = await chavesDoContato(msg, jid);
    const pausaAte = chavesContato.map(chave=>pausasManuais.get(chave)||0).find(ate=>ate>Date.now());
    if (pausaAte && pausaAte > Date.now()) {
      // Qualquer nova mensagem do cidadão durante a pausa reinicia os 30 minutos.
      chavesContato.forEach(chave=>pausasManuais.set(chave, Date.now() + TEMPO_PAUSA_MANUAL));
      log(`Bot permanece pausado para ${jid}; contador de 30 minutos reiniciado.`);
      return;
    }
    chavesContato.forEach(chave=>pausasManuais.delete(chave));
    if (pausadas.has(jid)) return;
    if (!noExpediente()) return enviar(jid, 'Nosso atendimento está fora do horário de expediente. Retornaremos assim que possível.');
    const pendente = navegacao.get(jid);
    if (pendente) {
      const escolhaSub = Number((msg.body || '').trim());
      const itens = pendente.tipo === 'atendente'
        ? lerConfig().configuracoes.atendentes.filter(a => a.ativo)
        : (lerConfig().opcoes.find(o => o.id === pendente.paiId)?.subopcoes || []).filter(s => s.ativo);
      if (!Number.isInteger(escolhaSub) || escolhaSub < 1 || escolhaSub > itens.length + 1) return enviar(jid, `Opção inválida.${montarSubmenu(itens, pendente.titulo)}`);
      if (escolhaSub === itens.length + 1) { navegacao.delete(jid); await enviar(jid, `Certo!${montarMenu().texto}`); return; }
      const item = itens[escolhaSub - 1]; navegacao.delete(jid);
      if (pendente.tipo === 'atendente') { pausadas.add(jid); await enviar(jid, `Aguarde um momento, ${item.nome} falará com você em breve.`); log(`Bot pausado para ${jid}, atendimento: ${item.nome}.`); return; }
      await enviar(jid, `${item.resposta}\n\nDigite *voltar* para ver todas as opções novamente.`); log(`Sub-resposta "${item.titulo}" enviada.`); return;
    }
    if (!iniciadas.has(jid)) {
      const cfgInicial = lerConfig();
      if (!cfgInicial.configuracoes.mensagemInicialAtiva) {
        log(`Mensagem inicial desligada; nenhuma resposta automática enviada para ${jid}.`);
        return;
      }
      let nome = '';
      try { const contato = await msg.getContact(); nome = contato.pushname || contato.name || ''; }
      catch (e) { log(`Aviso: não foi possível obter o nome do contato (${e.message || e}).`); }
      const aviso = cfgInicial.configuracoes.avisoGlobal;
      const textoAviso = aviso.ativo && aviso.texto.trim() ? `\n\n📢 *Aviso:* ${aviso.texto.trim()}` : '';
      const modeloSaudacao = String(cfgInicial.configuracoes.saudacao || padrao.configuracoes.saudacao);
      const saudacaoPersonalizada = nome
        ? modeloSaudacao.replaceAll('{saudacao}', saudacao()).replaceAll('{nome}', nome)
        : modeloSaudacao.replaceAll('{saudacao}', saudacao()).replace(/[\s,–—-]*\{nome\}/g, '').replace(/\s+([!?.;,])/g, '$1').trim();
      await enviar(jid, `${saudacaoPersonalizada}${textoAviso}${montarMenu().texto}`);
      iniciadas.add(jid);
      log(`Saudação e menu enviados para ${jid}.`);
      return;
    }
    const escolha = Number((msg.body || '').trim()), menu = montarMenu();
    if ((msg.body || '').trim().toLowerCase() === 'voltar') return enviar(jid, `Certo!${montarMenu().texto}`);
    if (!Number.isInteger(escolha)) return;
    const limite = menu.ops.length + (menu.humanoAtivo ? 1 : 0);
    if (escolha < 1 || escolha > limite) return enviar(jid, `Opção inválida.${menu.texto}`);
    if (menu.humanoAtivo && escolha === menu.ops.length + 1) { const atendentes = lerConfig().configuracoes.atendentes.filter(a => a.ativo); if (!atendentes.length) { pausadas.add(jid); await enviar(jid, 'Aguarde um momento, um de nossos atendentes falará com você em breve'); return; } const tituloAtendimento = 'Escolha o número do atendente que deseja conversar'; navegacao.set(jid, { tipo:'atendente', titulo:tituloAtendimento }); await enviar(jid, montarSubmenu(atendentes, tituloAtendimento)); return; }
    const escolhida = menu.ops[escolha - 1], cfgAtual = lerConfig(), original = cfgAtual.opcoes.find(x => x.id === escolhida.id);
    if (original) { original.cliques = Number(original.cliques || 0) + 1; salvarConfig(cfgAtual); }
    const subopcoes = (escolhida.subopcoes || []).filter(s => s.ativo);
    if (subopcoes.length) { navegacao.set(jid, { tipo:'sub', paiId:escolhida.id, titulo:escolhida.titulo }); if (escolhida.resposta.trim()) await enviar(jid, escolhida.resposta); await enviar(jid, montarSubmenu(subopcoes, escolhida.titulo)); return; }
    await enviar(jid, `${escolhida.resposta}\n\nDigite *voltar* para ver todas as opções novamente.`); log(`Resposta "${escolhida.titulo}" enviada.`);
  } catch (e) { log(`ERRO ao responder: ${e.message || e} ${e.stack ? `| ${e.stack.split('\n')[1] || ''}` : ''}`); }
}
async function tratarComando(msg) { try { if (!msg.fromMe || (msg.body || '').trim().toLowerCase() !== '!encerrar') return; const jid = msg.to; if (!pausadas.delete(jid)) return; navegacao.delete(jid); iniciadas.delete(jid); await enviar(jid, 'Atendimento encerrado. Se precisar de mais alguma informação, envie uma mensagem.'); log(`Atendimento de ${jid} encerrado.`); } catch (e) { log(`ERRO ao encerrar atendimento: ${e.message}`); } }
async function detectarAtendimentoManual(msg) {
  try {
    if (!msg.fromMe || !msg.to) return;
    const texto = (msg.body || '').trim().toLowerCase();
    if (texto === '!encerrar') return;
    const ultimoEnvio = enviosAutomaticos.get(msg.to) || 0;
    // Mensagens emitidas pelo próprio bot também geram message_create; elas não devem pausar o bot.
    if (Date.now() - ultimoEnvio < 15000) return;
    pausasManuais.set(msg.to, Date.now() + TEMPO_PAUSA_MANUAL);
    navegacao.delete(msg.to);
    log(`Atendimento manual detectado para ${msg.to}. Bot pausado por 30 minutos sem interação.`);
  } catch (e) { log(`ERRO ao detectar atendimento manual: ${e.message || e}`); }
}
function sessao() { return path.join(app.getPath('userData'), 'whatsapp-auth'); }
async function iniciarBot() {
  if (bot || !botAtivo) return; prontoParaMensagensEm = 0; estado = { ...estado, conexao:'Iniciando', detalhe:'Abrindo WhatsApp Web...', qrCode:null }; emitir();
  try { bot = new Client({ authStrategy:new LocalAuth({dataPath:sessao()}), puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']} });
    bot.on('qr', async codigo => { try { estado = { ...estado, conexao:'Aguardando QR Code', detalhe:'Escaneie o QR Code pelo WhatsApp.', qrCode:await QRCode.toDataURL(codigo) }; log('QR Code gerado.'); } catch(e) { log(`ERRO ao gerar QR: ${e.message}`); } });
    bot.on('ready', () => { prontoParaMensagensEm = Date.now(); estado = { ...estado, conexao:'Conectado', detalhe:'Bot pronto para responder.', qrCode:null }; log('WhatsApp conectado.'); });
    bot.on('auth_failure', e => reiniciarBot(`Falha de autenticação: ${e}`, true));
    bot.on('disconnected', e => reiniciarBot(`WhatsApp desconectado: ${e}`, true));
    bot.on('message', tratarMensagem); bot.on('message_create', tratarComando); bot.on('message_create', detectarAtendimentoManual);
    await bot.initialize();
  } catch(e) { reiniciarBot(`Falha na inicialização: ${e.message}`, false); }
}
async function reiniciarBot(motivo, limpar) { if (reiniciando || !botAtivo) return; reiniciando=true; prontoParaMensagensEm=0; log(motivo); try { await bot?.destroy(); } catch(_) {} bot=null; if(limpar) try { fs.rmSync(sessao(),{recursive:true,force:true}); } catch(e) { log(`Não foi possível limpar sessão: ${e.message}`); } estado={...estado,conexao:'Reconectando',detalhe:'Recuperando conexão...',qrCode:null}; emitir(); setTimeout(()=>{reiniciando=false;iniciarBot();},5000); }
async function controlarBot(ativar) {
  if (!ativar) {
    botAtivo = false; reiniciando = false; prontoParaMensagensEm = 0;
    try { await bot?.destroy(); } catch (_) {}
    bot = null; estado = { ...estado, conexao:'Parado', detalhe:'Bot parado pelo administrador.', qrCode:null }; log('Bot parado manualmente.'); return estado;
  }
  botAtivo = true; reiniciando = false;
  try { await bot?.destroy(); } catch (_) {}
  bot = null;
  // Um novo QR é intencional: evita sessão antiga travada e dá controle ao administrador.
  try { fs.rmSync(sessao(), { recursive:true, force:true }); } catch(e) { log(`Não foi possível limpar sessão antiga: ${e.message}`); }
  estado = { ...estado, conexao:'Iniciando', detalhe:'Gerando novo QR Code...', qrCode:null }; emit();
  await iniciarBot(); return estado;
}
function criarJanela() { janela = new BrowserWindow({ width:1100,height:780,minWidth:780,minHeight:580,icon:path.join(__dirname,'build','icon.png'),webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false} }); janela.loadFile(path.join(__dirname,'public','index.html')); }
function normalizarNumero(numero) { let n=String(numero||'').replace(/\D/g,''); if(n.length===10||n.length===11)n=`55${n}`; if(n.length<10||n.length>15)throw Error(`Número inválido: ${numero}`); return `${n}@c.us`; }
async function enviarComunicado({ numeros, mensagem, consentimento }) { if(!consentimento)throw Error('Confirme que todos os contatos autorizaram o recebimento.'); if(estado.conexao!=='Conectado'||!bot)throw Error('Conecte o WhatsApp antes de enviar.'); const lista=[...new Set(String(numeros||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))]; if(!lista.length)throw Error('Informe ao menos um número.'); if(lista.length>30)throw Error('Limite de 30 contatos por envio.'); const texto=String(mensagem||'').trim(); if(!texto)throw Error('Digite a mensagem.'); let enviados=0, falhas=[]; for(const numero of lista){try{const destino=normalizarNumero(numero);await bot.sendMessage(destino,texto);await pausarComunicado(destino);enviados++;log(`Comunicado enviado: ${enviados}/${lista.length}.`)}catch(e){const erro=e.message||String(e);falhas.push({numero,erro});log(`Falha ao enviar comunicado para ${numero}: ${erro}`)}if(enviados+falhas.length<lista.length)await new Promise(resolve=>setTimeout(resolve,2000));}return {enviados,falhas}; }
ipcMain.handle('app:get-state', () => ({ dados:lerConfig(), estado, caminho:arquivoConfig }));
ipcMain.handle('config:save', (_, configuracoes) => { const d=lerConfig(); d.configuracoes=configuracoes; salvarConfig(d); return d; });
ipcMain.handle('option:add', (_, o) => { const d=lerConfig(); if(d.opcoes.length>=10) throw Error('Limite de 10 respostas atingido.'); if(!o?.titulo?.trim()||!o?.resposta?.trim()) throw Error('Título e resposta são obrigatórios.'); const proximoNumero = Math.max(0, ...d.opcoes.map(x => Number(x.numero) || 0)) + 1; d.opcoes.push({id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,numero:proximoNumero,titulo:o.titulo.trim(),resposta:o.resposta.trim(),ativo:true,cliques:0}); salvarConfig(d); return d; });
ipcMain.handle('option:update', (_, o) => { const d=lerConfig(), a=d.opcoes.find(x=>x.id===o?.id); if(!a) throw Error('Resposta não encontrada.'); if(!o.titulo?.trim()||!o.resposta?.trim()) throw Error('Título e resposta são obrigatórios.'); Object.assign(a,{numero:Number(o.numero),titulo:o.titulo.trim(),resposta:o.resposta.trim(),ativo:Boolean(o.ativo)}); salvarConfig(d); return d; });
ipcMain.handle('option:delete', (_, id) => { const d=lerConfig(); d.opcoes=d.opcoes.filter(x=>x.id!==id); salvarConfig(d); return d; });
ipcMain.handle('sub:add', (_, paiId, sub) => { const d=lerConfig(), pai=d.opcoes.find(o=>o.id===paiId); if(!pai) throw Error('Resposta principal não encontrada.'); if(!sub?.titulo?.trim()||!sub?.resposta?.trim()) throw Error('Título e resposta são obrigatórios.'); pai.subopcoes ||= []; pai.subopcoes.push({id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,titulo:sub.titulo.trim(),resposta:sub.resposta.trim(),ativo:true}); salvarConfig(d); return d; });
ipcMain.handle('sub:update', (_, paiId, sub) => { const d=lerConfig(), pai=d.opcoes.find(o=>o.id===paiId), alvo=pai?.subopcoes?.find(s=>s.id===sub?.id); if(!alvo) throw Error('Sub-resposta não encontrada.'); Object.assign(alvo,{titulo:sub.titulo.trim(),resposta:sub.resposta.trim(),ativo:Boolean(sub.ativo)}); salvarConfig(d); return d; });
ipcMain.handle('sub:delete', (_, paiId, subId) => { const d=lerConfig(), pai=d.opcoes.find(o=>o.id===paiId); if(!pai) throw Error('Resposta principal não encontrada.'); pai.subopcoes=(pai.subopcoes||[]).filter(s=>s.id!==subId); salvarConfig(d); return d; });
ipcMain.handle('staff:add', (_, nome) => { const d=lerConfig(), n=String(nome||'').trim(); if(!n) throw Error('Informe o nome.'); d.configuracoes.atendentes.push({id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,nome:n,ativo:true}); salvarConfig(d); return d; });
ipcMain.handle('staff:update', (_, item) => { const d=lerConfig(), a=d.configuracoes.atendentes.find(x=>x.id===item?.id); if(!a) throw Error('Atendente não encontrado.'); a.nome=String(item.nome||'').trim()||a.nome; a.ativo=Boolean(item.ativo); salvarConfig(d); return d; });
ipcMain.handle('staff:delete', (_, id) => { const d=lerConfig(); d.configuracoes.atendentes=d.configuracoes.atendentes.filter(x=>x.id!==id); salvarConfig(d); return d; });
ipcMain.handle('bot:reconnect', () => reiniciarBot('Reconexão solicitada.', false));
ipcMain.handle('bot:toggle', (_, ativar) => controlarBot(Boolean(ativar)));
ipcMain.handle('events:clear', () => { estado.eventos = []; emitir(); });
ipcMain.handle('broadcast:send', (_, dados) => enviarComunicado(dados));
app.whenReady().then(()=>{ arquivoConfig=path.join(app.getPath('userData'),'config.json'); app.dock?.setIcon(path.join(__dirname,'build','icon.png')); garantirConfig(); criarJanela(); iniciarBot(); });
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();}); app.on('before-quit',()=>{try{bot?.destroy();}catch(_){}});
