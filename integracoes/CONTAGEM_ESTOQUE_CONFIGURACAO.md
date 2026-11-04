# Plantita — Configurar o botão Salvar Contagem no Google

A página [Contagem de Estoque](https://novaplantita.github.io/dashboard-plantita/contagem-estoque.html?v=20261104-salvar3) já inclui os botões **Salvar contagem**, **Retomar do Google** e **Configurar Google**.

**ATENÇÃO:** o botão só confirma salvamento no Google quando o Apps Script abaixo estiver efetivamente publicado, configurado e testado. Até lá, a contagem continua salva apenas no navegador, com possibilidade de exportar CSV.

## Implantação única (Google)

1. Entre no [Google Apps Script](https://script.google.com/home) com a conta que tem acesso à planilha **Base Central Granel Plantita**.
2. Crie um **projeto novo e separado** do Apps Script do PDV; ele não deve substituir o código dos medicamentos ou do granel.
3. Copie o conteúdo completo de [Plantita_Contagem_Estoque_Apps_Script.gs](./Plantita_Contagem_Estoque_Apps_Script.gs) para o arquivo `Código.gs` do novo projeto.
4. Nas **Configurações do projeto → Propriedades do script**, adicione `COUNT_SYNC_TOKEN` com uma chave aleatória de **24 caracteres ou mais**. Nunca salve essa chave no GitHub e não a envie pelo chat.
5. Selecione **Implantar → Nova implantação → Aplicativo da Web**. Defina **Executar como: Eu** e libere acesso ao link de implantação para permitir que a dashboard estática faça as requisições (o próprio Apps Script exige a chave). Autorize o script a acessar a planilha.
6. Copie o endereço que termina em **/exec**.
7. Abra a página de **Contagem de Estoque → Configurar Google**. Cole o endereço e a chave. Selecione **Salvar conexão e testar**. A confirmação de conexão deve aparecer.
8. Faça uma bipagem de teste e clique em **Salvar contagem**. Verifique se aparece uma **confirmação explícita do Google**. A planilha criará as abas **Contagens_Estoque** e **Contagens_Itens**, sem alterar as DANFEs, o PDV, o estoque oficial ou preços de venda.
9. Para continuar em outro navegador ou aparelho, configure ali o mesmo endereço e chave e clique em **Retomar do Google**. Antes de substituir dados locais, a tela pede confirmação e exporta um CSV.

## Cuidados

- Este fluxo é de **rascunho / inventário físico**. **Não dá baixa nem substitui quantidades oficiais**, nem publica novos preços. Uma etapa futura de conferência e aprovação precisará conciliar os registros com as compras e vendas.
- Cada bipagem conta **1 saco físico fechado**. Lotes de compra como 3 × 2,5 kg não representam 3 sacos em uma bipagem.
- O Google aceita **fotos completas da contagem**, não incrementos, e identifica cada salvamento por um `saveId` para evitar duplicidade.
- Se outro aparelho salvar primeiro, o envio posterior é bloqueado para evitar substituir trabalho mais recente. Use **Retomar do Google** para conferir.
- **Nova contagem** é diferente de **Salvar contagem**: a primeira zera as quantidades e preços propostos locais depois de confirmar e exportar CSV; a segunda preserva o rascunho.
- A chave permanece no armazenamento local do navegador onde foi configurada; proteja os computadores compartilhados.
- Se o Google não confirmar, não considere a gravação concluída. Continue usando o rascunho local e o CSV até normalizar a integração.

## Planilha de destino

A gravação vai para **Base Central Granel Plantita** (ID já configurado no Apps Script). Ela terá apenas novas abas: `Contagens_Estoque` e `Contagens_Itens`. Nenhuma coluna de DANFE é editada neste fluxo.
