# Injeção EVA (Sobral)

App do piso de injeção EVA, feito para o celular. O turno lança a produção e as perdas. O líder acompanha o mês no dashboard.

[injecao-eva.vercel.app](https://injecao-eva.vercel.app)

Na porta não há senha. Os botões são **1º turno**, **2º turno**, **3º turno** e **Dashboard geral**.

## No turno

Cada máquina é SIE01 a SIE06, com estações 1 a 8 e lado esquerdo ou direito. Se A/B estiver ligado, a máquina pede o lado antes de entrar. SIE06 já abre assim. No dashboard, **Configurar** liga ou desliga A/B de qualquer máquina.

Em cada máquina há dois caminhos:

- **Produção.** Pares por numeração da matriz. Não depende do horário de apontamento.
- **Perdas.** Um toque é uma sola. Na primeira vez do dia, naquela máquina e turno, o app pergunta se a grade de matrizes mudou.

A perda leva estação, lado, número, referência, cor e, quando houver, a troca. Os problemas são os da ficha:

1. Escape de gás preso — sola
2. Escape de gás preso — gáspea
3. Contaminação
4. Tamanho menor
5. Excesso de carga
6. Falta de carga
7. Peça rasgada
8. Sujeira pós manutenção
9. Contra pé
10. Pezinho preso
11. Escape de gás aberto

A ficha baixa em imagem. Só a faixa muda: 1º turno preto, 2º azul, 3º vermelho. O corpo fica branco.

## Como o par fecha

Não existe meio par. Solas da mesma chave — dia, turno, máquina, estação, lado, problema e troca — sobem para o par inteiro. Uma sola vale 1 par. Três solas da mesma chave valem 2.

## Horário

O relógio é o de Fortaleza. Apagar ou lançar perda só vale na janela do turno, no dia operacional:

| Turno | Janela |
|---|---|
| 1º | 06:30 às 15:00 |
| 2º | 15:30 às 23:45 |
| 3º | 23:00 às 06:15 |

O 3º turno atravessa a meia-noite. Até 06:15 ainda é o dia em que ele começou. A produção não usa essa janela.

## Dashboard

Quatro blocos: resumo, produção e perdas, ranking e gráficos. O mês é o período padrão do resumo, da produção e dos gráficos. O ranking abre no dia. O ano só é buscado quando alguém escolhe **Ano**.

Dá para filtrar por máquina, estação, número, referência, lado e problema.

A tela abre na hora. Enquanto o mês não chegou, o indicador mostra “Carregando o mês…”. Zero e “sem apontamento” só aparecem depois que a consulta termina. Se a nuvem falhar, fica “Sem nuvem.”, sem tratar um pedaço local como se fosse o mês fechado.

No ranking, a porcentagem é a parte de cada número dentro da própria máquina. Um número sozinho é 100%. Até 5% é verde, acima de 5% e abaixo de 10% é amarelo, 10% ou mais é vermelho.

## O que os celulares compartilham

Os aparelhos leem e gravam o mesmo banco. O dia do turno sincroniza cerca de uma vez por minuto. Cada sola é um lançamento. Quando a planilha está configurada, o apontamento também segue para ela.

O guia de uso no celular está em [como-usar-injecao-eva.pdf](https://injecao-eva.vercel.app/como-usar-injecao-eva.pdf).
