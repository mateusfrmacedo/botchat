const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
const PORTA = Number(process.env.PORT || 3000);
// No Electron, BOT_DATA_DIR é app.getPath('userData'); no modo Node usamos a pasta do projeto.
const PASTA_DADOS = process.env.BOT_DATA_DIR || path.join(__dirname, 'data');
const ARQUIVO_DADOS = path.join(PASTA_DADOS, 'respostas.json');
const MODELO_DADOS = path.join(__dirname, 'respostas.json');
let estado = { conexao: 'Desconectado', qrCode: null, detalhe: '', eventos: [] };
let servidor;
let cliente;
const pausados = new Set();
const conversas = new Set();

function registrarEvento(texto) {
  const horario = new Date().toLocaleTimeString('pt-BR');
  estado.eventos = [`${horario} — ${texto}`, ...(estado.eventos || [])].slice(0, 12);
  console.log(`[Bot] ${texto}`);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function prepararDados() {
  fs.mkdirSync(PASTA_DADOS, { recursive: true });
  if (!fs.existsSync(ARQUIVO_DADOS)) fs.copyFileSync(MODELO_DADOS, ARQUIVO_DADOS);
}
function lerDados() {
  prepararDados();
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8'));
    dados.configuracoes ||= {};
    dados.configuracoes.avisoGlobal ||= '';
    dados.configuracoes.expediente ||= { ativo: true, inicio: '08:00', fim: '17:00', dias: [1,2,3,4,5] };
    dados.opcoes ||= [];
    return dados;
  } catch (erro) { throw new Error(`Não foi possível ler respostas.json: ${erro.message}`); }
}
function salvarDados(dados) { fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(dados, null, 2), 'utf8'); }
function opcoesAtivas() { return lerDados().opcoes.filter(opcao => opcao.ativo); }
function saudacao() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
function menu() {
  const opcoes = opcoesAtivas();
  if (!opcoes.length) return '';
  return `\n\n${opcoes.map((o, i) => `${i + 1}. ${o.titulo_menu}`).join('\n')}\n${opcoes.length + 1}. Falar com um atendente`;
}
function dentroExpediente() {
  const e = lerDados().configuracoes.expediente;
  if (!e.ativo) return true;
  const agora = new Date();
  if (!e.dias.includes(agora.getDay())) return false;
  const atual = agora.getHours() * 60 + agora.getMinutes();
  const minutos = hora => { const [h, m] = hora.split(':').map(Number); return h * 60 + m; };
  return atual >= minutos(e.inicio) && atual <= minutos(e.fim);
}
async function enviarDigitando(chat, texto) {
  await chat.sendStateTyping();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await chat.clearState();
  return chat.sendMessage(texto);
}
async function transferir(chat, id) {
  if (!dentroExpediente()) return enviarDigitando(chat, 'Nosso atendimento está fora do horário de expediente. Retornaremos assim que possível.');
  pausados.add(id);
  return enviarDigitando(chat, 'Aguarde um momento, um de nossos atendentes falará com você em breve.');
}
async function tratarMensagem(msg) {
  if (msg.fromMe || msg.isStatus || !msg.from || msg.from.endsWith('@g.us')) return;
  const id = msg.from;
  const texto = (msg.body || '').trim();
  registrarEvento(`Mensagem recebida de ${id}: ${texto.slice(0, 80) || '[mídia]'}`);
  try {
  const chat = await msg.getChat();
  if (texto.toLowerCase() === '!encerrar' || texto.toLowerCase() === '!voltar') {
    if (pausados.delete(id)) { conversas.delete(id); await enviarDigitando(chat, 'Atendimento encerrado. Como posso ajudar?'); }
    return;
  }
  if (pausados.has(id)) return;
  const dados = lerDados();
  const ativas = dados.opcoes.filter(o => o.ativo);
  if (!conversas.has(id)) {
    conversas.add(id);
    const contato = await msg.getContact();
    const nome = contato.pushname || contato.name || 'tudo bem';
    const aviso = dados.configuracoes.avisoGlobal ? `\n\n📢 *Aviso:* ${dados.configuracoes.avisoGlobal}` : '';
    const cabecalho = `${saudacao()}, ${nome}!\nA Secretaria Municipal de Educação Básica de Orindiúva agradece seu contato 😁👋 Como podemos ajudar?`;
    if (!ativas.length) { await enviarDigitando(chat, `${cabecalho}${aviso}`); return transferir(chat, id); }
    await enviarDigitando(chat, `${cabecalho}${aviso}${menu()}`);
    registrarEvento(`Menu enviado para ${id}.`);
    return;
  }
  const escolha = Number(texto);
  if (!Number.isInteger(escolha)) return enviarDigitando(chat, `Por favor, escolha uma opção pelo número.${menu()}`);
  if (escolha === ativas.length + 1) return transferir(chat, id);
  const opcao = ativas[escolha - 1];
  if (!opcao) return enviarDigitando(chat, `Opção inválida. Escolha uma das opções abaixo:${menu()}`);
  const atual = lerDados();
  const original = atual.opcoes.find(o => o.id === opcao.id);
  if (original) { original.cliques = Number(original.cliques || 0) + 1; salvarDados(atual); }
  await enviarDigitando(chat, opcao.texto_resposta);
  if (opcao.anexo && fs.existsSync(opcao.anexo)) await chat.sendMessage(MessageMedia.fromFilePath(opcao.anexo));
  registrarEvento(`Resposta "${opcao.titulo_menu}" enviada para ${id}.`);
  } catch (erro) {
    registrarEvento(`ERRO ao responder ${id}: ${erro.message}`);
  }
}
async function tratarComandoAtendente(msg) {
  if (!msg.fromMe || !['!encerrar', '!voltar'].includes((msg.body || '').trim().toLowerCase())) return;
  // Em mensagens enviadas pelo próprio atendente, o destinatário é o contato pausado.
  const id = msg.to;
  if (!pausados.delete(id)) return;
  conversas.delete(id);
  const chat = await msg.getChat();
  await enviarDigitando(chat, 'Atendimento encerrado. Como posso ajudar?');
}
function iniciarWhatsApp() {
  if (cliente) return;
  estado = { conexao: 'Aguardando QR Code', qrCode: null, detalhe: '', eventos: estado.eventos || [] };
  cliente = new Client({ authStrategy: new LocalAuth({ dataPath: path.join(PASTA_DADOS, 'whatsapp-auth') }), puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } });
  cliente.on('qr', async qr => { estado = { ...estado, conexao: 'Aguardando QR Code', qrCode: await QRCode.toDataURL(qr), detalhe: 'Escaneie o QR Code pelo WhatsApp.' }; registrarEvento('QR Code gerado.'); });
  cliente.on('ready', () => { estado = { ...estado, conexao: 'Conectado', qrCode: null, detalhe: 'Bot pronto para responder.' }; registrarEvento('WhatsApp conectado e pronto.'); });
  cliente.on('authenticated', () => { estado.conexao = 'Autenticado'; });
  cliente.on('auth_failure', e => { estado = { ...estado, conexao: 'Desconectado', qrCode: null, detalhe: `Falha na autenticação: ${e}` }; registrarEvento(`Falha de autenticação: ${e}`); });
  cliente.on('disconnected', motivo => { estado = { ...estado, conexao: 'Desconectado', qrCode: null, detalhe: `Celular desconectado: ${motivo}` }; registrarEvento(`WhatsApp desconectado: ${motivo}`); cliente = null; setTimeout(iniciarWhatsApp, 5000); });
  cliente.on('loading_screen', (percentual, mensagem) => { estado.detalhe = `Carregando WhatsApp: ${percentual}% ${mensagem || ''}`; });
  cliente.on('message', tratarMensagem);
  cliente.on('message_create', tratarComandoAtendente);
  cliente.initialize().catch(e => { estado = { conexao: 'Desconectado', qrCode: null, detalhe: e.message }; cliente = null; });
}

app.get('/api/status', (_, res) => res.json(estado));
app.get('/api/dados', (_, res) => res.json(lerDados()));
app.put('/api/configuracoes', (req, res) => { const dados = lerDados(); dados.configuracoes = req.body; salvarDados(dados); res.json(dados.configuracoes); });
app.post('/api/opcoes', (req, res) => {
  const dados = lerDados(); if (dados.opcoes.length >= 10) return res.status(400).json({ erro: 'O limite é de 10 opções.' });
  const { titulo_menu, texto_resposta, anexo = '', ativo = true } = req.body;
  if (!titulo_menu?.trim() || !texto_resposta?.trim()) return res.status(400).json({ erro: 'Título e resposta são obrigatórios.' });
  const opcao = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, titulo_menu: titulo_menu.trim(), texto_resposta: texto_resposta.trim(), anexo: anexo.trim(), ativo: Boolean(ativo), cliques: 0 };
  dados.opcoes.push(opcao); salvarDados(dados); res.status(201).json(opcao);
});
app.put('/api/opcoes/:id', (req, res) => { const dados = lerDados(); const o = dados.opcoes.find(x => x.id === req.params.id); if (!o) return res.status(404).json({ erro: 'Opção não encontrada.' }); Object.assign(o, req.body, { id: o.id, cliques: o.cliques || 0 }); salvarDados(dados); res.json(o); });
app.delete('/api/opcoes/:id', (req, res) => { const dados = lerDados(); const n = dados.opcoes.length; dados.opcoes = dados.opcoes.filter(x => x.id !== req.params.id); if (n === dados.opcoes.length) return res.status(404).json({ erro: 'Opção não encontrada.' }); salvarDados(dados); res.status(204).end(); });
app.post('/api/reconectar', async (_, res) => { if (cliente) { try { await cliente.destroy(); } catch (_) {} cliente = null; } iniciarWhatsApp(); res.json({ ok: true }); });
function iniciarServidor() { prepararDados(); iniciarWhatsApp(); return new Promise(resolve => { if (servidor) return resolve(servidor); servidor = app.listen(PORTA, '127.0.0.1', () => { console.log(`Painel aberto em http://127.0.0.1:${PORTA}`); resolve(servidor); }); }); }
if (require.main === module) iniciarServidor();
module.exports = { iniciarServidor };
