# BotChat 

Aplicativo desktop local para atendimento automatizado no WhatsApp. O bot e o painel funcionam no mesmo computador, sem servidor externo.

## Recursos

- QR Code e status de conexão do WhatsApp no próprio aplicativo.
- Saudação personalizável com `{saudacao}` e `{nome}`.
- Respostas programadas com ativação, edição e exclusão.
- Submenus: cada resposta pode abrir novas opções, como a lista de escolas.
- Opção automática de atendimento humano, com lista de atendentes ativáveis.
- Comando `!encerrar` para devolver o cidadão ao bot.
- Botão para parar o bot ou ativá-lo novamente gerando QR Code novo.
- Pausa automática de 30 minutos quando um atendente envia mensagem manualmente.
- Menu “Voltar” em todos os submenus.

## Requisitos

- Node.js LTS 20 ou superior (necessário apenas para executar pelo código ou gerar instaladores).
- Uma conta de WhatsApp exclusiva para o bot.
- Internet ativa no computador que executará o aplicativo.

## Baixar o aplicativo

Os instaladores prontos ficam na página de [Releases](https://github.com/mateusfrmacedo/botchat/releases):

- Windows: baixe e execute o arquivo `.exe`.
- macOS Apple Silicon (M1, M2, M3 ou M4): baixe o arquivo `.dmg` com `arm64` no nome, abra-o e arraste o BotChat para a pasta Aplicativos.
- macOS Intel: baixe o arquivo `.dmg` com `x64` no nome, abra-o e arraste o BotChat para a pasta Aplicativos.

Os instaladores são gerados para cada nova versão. Caso o macOS ou o Windows mostre um aviso de segurança, confirme que o arquivo foi baixado desta página oficial antes de prosseguir.

### Primeiro uso no macOS

As versões distribuídas sem assinatura Apple podem ser bloqueadas pelo Gatekeeper com a mensagem “BotChat está danificado”. Isso não indica incompatibilidade com Apple Silicon. Depois de arrastar o aplicativo para Aplicativos, abra o Terminal e execute uma única vez:

```bash
xattr -rd com.apple.quarantine "/Applications/BotChat.app"
```

Em seguida, abra o BotChat normalmente. O comando remove o bloqueio apenas deste aplicativo instalado.

## Executar pelo código — macOS e Windows

1. Baixe ou copie a pasta do projeto para o computador.
2. Abra Terminal (macOS) ou PowerShell / Prompt de Comando (Windows).
3. Entre na pasta do projeto:

   **macOS**

   ```bash
   cd "/caminho/para/WhatsApp Bot"
   ```

   **Windows**

   ```bat
   cd "C:\caminho\para\WhatsApp Bot"
   ```

4. Instale as dependências (somente na primeira execução):

   ```bash
   npm install
   ```

5. Inicie o aplicativo:

   ```bash
   npm run dev
   ```

No macOS, `iniciar.command` também pode ser aberto com dois cliques. No Windows, use `iniciar.bat`.

## Conectar o WhatsApp

1. No aplicativo, clique em **Ativar bot e gerar QR Code** se necessário.
2. No celular: WhatsApp → Configurações/Ajustes → Aparelhos conectados → Conectar aparelho.
3. Escaneie o QR Code exibido.
4. Aguarde o status **Conectado**.

## Usar o painel

### Saudação

Edite o campo de mensagem inicial e mantenha, se desejar:

- `{saudacao}` para Bom dia, Boa tarde ou Boa noite.
- `{nome}` para o nome de perfil do cidadão.

Clique em **Salvar configurações**.

### Respostas programadas

1. Em **Nova resposta programada**, informe título e texto.
2. Clique em **Salvar resposta**. A numeração é automática.
3. Use os botões **Editar**, **Ligar/Desligar** e **Excluir** em cada cartão.

### Submenus

Em uma resposta cadastrada, clique em **+ Sub-resposta**. Cadastre cada opção interna. Exemplo:

- Solicitação de matrícula
  - Escola Joaquim
  - Escola Osvaldo
  - Creche Municipal

O cidadão verá essas opções depois de escolher “Solicitação de matrícula”. Todo submenu mostra **Voltar** para retornar ao menu principal.

### Atendimento humano

Ligue/desligue **Atendimento humano ligado** na seção Atendentes. Quando ligado, o menu exibe “Falar com um atendente”; cadastre os nomes desejados e use o indicador ao lado de cada nome para ativá-lo ou desativá-lo.

Quando o cidadão escolhe um atendente, o bot pausa aquela conversa. Para devolver o cidadão ao bot, envie `!encerrar` no chat do WhatsApp.

## Gerar instaladores

Instale as dependências primeiro. Os arquivos são criados na pasta `dist`.

### macOS (.dmg)

Execute em um Mac:

```bash
npm run dist:mac
```

Abra o `.dmg` criado em `dist/` e arraste o BotChat para Aplicativos. Na primeira abertura, o macOS pode pedir confirmação em Ajustes do Sistema → Privacidade e Segurança.

### Windows (.exe)

Execute em um computador Windows:

```bat
npm run dist:win
```

Execute o instalador `.exe` criado em `dist/`. Se o Windows SmartScreen exibir um aviso por se tratar de aplicativo não assinado, escolha **Mais informações** → **Executar assim mesmo**, somente após confirmar que o arquivo é o instalador gerado por você.

## Dados e segurança

O arquivo `config.json` e a sessão do WhatsApp ficam na pasta de dados do usuário do sistema operacional, não dentro da pasta do aplicativo. Faça backup dessa pasta se precisar preservar configurações e sessão. Não compartilhe essa sessão nem o QR Code com terceiros.
