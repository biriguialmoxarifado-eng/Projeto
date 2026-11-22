# Fase 3 — Motor de notas fiscais isolado

## Contratos auditados

Desktop usa a API central para listar, obter e ler itens de NF, além de pontes diretas AP_NF_direto e AP_NFED_direto. O Desktop também chama ações de divergência e NF Hub. ALMOX CAMPO usa nf.listar, nf.obter, nf.itens, nf.salvar e nfed.itens. A API legada valida sessão e despacha para os motores. O legado grava cabeçalho em ALMOXA_NOTAS e itens em ALMOXA_NF_ITENS, usa LockService e tem recuperação de cabeçalhos órfãos. O caminho de gravação auditado confirma o cabeçalho e trata a auditoria como melhor esforço.

## Implementação e isolamento

O runtime disponibiliza getInvoiceEngine apenas com um provedor de teste explícito e carrega o motor sob demanda. O motor usa autorização de leitura e escrita do Core. O adaptador verifica ID, título ALMOXA_TESTE_CORE e aba NF_CORE_TESTE antes do acesso. A aba guarda eventos completos com cabeçalho, itens, versão, autor e data. Um lote atômico cria os marcadores de operação e versão e acrescenta o evento. O motor relê o evento para confirmar a resposta, inclusive quando recebe erro de transporte. A recuperação restaura uma versão histórica como novo evento.

O motor não expõe rota HTTP e não implementa o envelope dos clientes, a recuperação de órfãos legados, exclusão, divergência, patrimônio, estoque ou arquivos do Drive. A leitura percorre o histórico da aba de teste. Esse formato é uma prova de integração com Google Sheets e não foi homologado como esquema operacional. Arquivos legados continuam no executor atual.

## Evidências de validação

npm test passou com concorrência entre duas instâncias, sessão inválida, perfil leitor, destino incorreto, retentativa, resposta perdida e recuperação. O teste via OAuth na planilha isolada criou a nota sintética NF:536503142-99, releu a mesma operação, aceitou uma das duas edições concorrentes e restaurou a versão inicial como versão 3. O histórico tinha somente as versões 1, 2 e 3 e registrou autoria e data em cada evento. Medições da execução: criação com confirmação 1784 ms, edições concorrentes 1978 ms e restauração com releitura 2971 ms.

## Ativação e retorno

O runtime normal mantém o Apps Script como executor operacional. Para interromper o ensaio, remova a injeção do provedor de teste ou reverta o commit na branch de desenvolvimento. Conserve a aba de teste como evidência. Antes de qualquer ativação, prove paridade dos contratos Desktop/Campo e das abas legadas, cubra recuperação de órfãos, estoque, anexos e permissões operacionais, e ensaie o retorno em cópia. Em eventual retorno após escritas reais, interrompa o novo executor, confira o histórico e reconcilie as operações confirmadas antes de reabrir o legado. Nenhuma escrita deve ser reenviada ao legado sem conciliação.
