import type { zh } from './zh'

export const pt = {
  webdavNav: 'WebDAV',
  webdavDesc:
    'Conecte um servidor WebDAV (como Nextcloud ou um NAS Synology) para abrir os arquivos dele aqui. Ao salvar, as alterações voltam para o servidor.',
  webdavNoServers: 'Nenhum servidor conectado ainda.',
  webdavAdd: 'Adicionar servidor',
  webdavFieldName: 'Nome',
  webdavFieldUrl: 'Endereço do servidor',
  webdavFieldUser: 'Nome de usuário',
  webdavFieldPassword: 'Senha ou senha de aplicativo',
  webdavUserHint: 'Deixe o nome de usuário vazio se o servidor não exigir login.',
  webdavInsecureWarn:
    'Esta é uma conexão HTTP sem criptografia. A senha e os arquivos trafegam legíveis pela rede.',
  webdavInsecureConfirm: 'Entendo o risco e quero usar HTTP',
  webdavSave: 'Conectar',
  webdavCancel: 'Cancelar',
  webdavChecking: 'Verificando a conexão…',
  webdavRemove: 'Remover servidor',
  webdavRemoveConfirm:
    'Remover a conexão com este servidor deste PC? Os arquivos no servidor não são apagados.',
  webdavRemoveYes: 'Remover',
  webdavNeedPassword: 'Este PC não conseguiu guardar a senha criptografada. Digite-a novamente.',
  webdavNotPersisted:
    'Este PC não consegue guardar a senha criptografada, então você a digitará de novo depois de fechar o aplicativo.',
  webdavPrivacy:
    'A senha fica somente neste PC, criptografada pelo sistema. Os arquivos trafegam apenas entre este PC e o servidor informado, quando você os abre ou salva.',
  webdavEmptyTitle: 'Nenhum servidor WebDAV conectado',
  webdavEmptyBody:
    'Adicione um servidor em Configurações → Integrações e depois navegue e abra os arquivos dele aqui.',
  webdavOpenSettings: 'Abrir Configurações',
  webdavRoot: 'Raiz',
  webdavFolderEmpty: 'Esta pasta está vazia.',
  webdavLoading: 'Carregando…',
  webdavRefresh: 'Atualizar',
  webdavUnsupported: 'O aplicativo não consegue abrir este formato',
  webdavOpening: 'Abrindo…',
  webdavServer: 'Servidor',
  webdavErrUrl: 'Endereço inválido. Digite o endereço completo começando com https:// ou http://.',
  webdavErrInsecure: 'Marque a confirmação antes de usar uma conexão HTTP sem criptografia.',
  webdavErrAuth:
    'O servidor recusou o login. Verifique o nome de usuário e a senha (muitos serviços exigem uma senha de aplicativo).',
  webdavErrNotFound: 'Essa pasta ou esse arquivo não está no servidor.',
  webdavErrForbidden: 'Esta conta não tem permissão para fazer isso.',
  webdavErrNetwork: 'Não foi possível acessar o servidor. Verifique o endereço e a rede.',
  webdavErrLimit: 'Você pode conectar até 10 servidores.',
  webdavErrTooLarge: 'O arquivo é grande demais para abrir.',
  webdavErrRateLimit: 'O servidor pediu para tentar de novo mais tarde.',
  webdavErrLocked: 'Outra pessoa bloqueou o arquivo.',
  webdavErrDisk: 'Não foi possível salvar o arquivo neste PC.',
} satisfies Record<keyof typeof zh, string>
