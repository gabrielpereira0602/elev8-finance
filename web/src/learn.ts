/** Aprender: principles summarised in our own words, each tied to something the app does. Not investment advice. */
export interface Principle { id: string; title: string; source: string; idea: string; body: string[]; inApp: string; action?: { label: string; href: string } }

export const PRINCIPLES: Principle[] = [
  {
    id: 'pague-se', title: 'Pague-se primeiro', source: 'George S. Clason · O Homem Mais Rico da Babilônia (1926)',
    idea: 'Separe uma parte do que entra antes de gastar o resto.',
    body: [
      'A ideia central do livro: quando o dinheiro entra, a primeira conta a pagar é você mesmo. Clason sugere separar ao menos um décimo de tudo o que se ganha antes de qualquer outro gasto.',
      'Funciona porque o que sobra no fim do mês costuma ser zero. Guardar no começo transforma a poupança em regra, não em sobra.',
    ],
    inApp: 'Ao lançar uma entrada, toque em "Guardei" com 10% do valor. O que você guardou sai do "Pode gastar hoje".',
    action: { label: 'Lançar o que guardei', href: '#/lancar?tipo=saving' },
  },
  {
    id: '503020', title: '50/30/20', source: 'Elizabeth Warren e Amelia Tyagi · All Your Worth (2005)',
    idea: 'Metade para o essencial, 30% para desejos, 20% para guardar ou quitar dívidas.',
    body: [
      'As autoras propõem dividir a renda líquida em três grupos: necessidades (moradia, contas, mercado, transporte, saúde), desejos (o que torna a vida boa, mas dá para cortar) e futuro (poupança e dívidas).',
      'Não é uma regra rígida: é um termômetro. Se o essencial passa muito de 50%, o problema raramente se resolve cortando o cafezinho.',
    ],
    inApp: 'Cada categoria pertence a um grupo. Em Análises › Geral, as barras mostram onde você está em relação a cada meta.',
    action: { label: 'Ver meu 50/30/20', href: '#/analises/geral' },
  },
  {
    id: 'reserva', title: 'Reserva de emergência', source: 'Dave Ramsey · A Transformação Total do Seu Dinheiro (2003)',
    idea: 'Antes de investir, tenha meses de custo guardados.',
    body: [
      'Ramsey organiza a vida financeira em passos. Um dos primeiros é montar um fundo para imprevistos que cubra de três a seis meses de despesas.',
      'Com a reserva, um conserto ou uma demissão não vira dívida no cartão.',
    ],
    inApp: 'Use a média de "Saiu" em Análises › Tendência para calcular quanto seria a sua reserva.',
    action: { label: 'Ver minha média', href: '#/analises/tendencia' },
  },
  {
    id: 'ativos', title: 'Ativos e passivos', source: 'Robert Kiyosaki · Pai Rico, Pai Pobre (1997)',
    idea: 'Ativo coloca dinheiro no seu bolso; passivo tira.',
    body: [
      'Kiyosaki diferencia o que gera renda do que gera custo, mesmo que pareça patrimônio. Um carro, por exemplo, tem parcela, seguro e manutenção.',
      'A pergunta antes de uma compra grande: isso vai pôr ou tirar dinheiro do meu bolso todo mês?',
    ],
    inApp: 'Use a tag "ativo" nas compras que geram renda e veja o que sobra em Análises › Fluxo.',
  },
  {
    id: 'constancia', title: 'Constância vence genialidade', source: 'Morgan Housel · A Psicologia Financeira (2020)',
    idea: 'Tempo e comportamento pesam mais que acertar o investimento.',
    body: [
      'Housel mostra que resultados financeiros dependem mais de comportamento do que de conhecimento técnico. Ficar no jogo por muito tempo, sem decisões desesperadas, é o que faz os juros compostos trabalharem.',
      'Um mês ruim não desfaz um ano bom. O que conta é a sequência.',
    ],
    inApp: 'Em Análises › Tendência, a barra de sobra mostra a sua sequência de meses no positivo.',
    action: { label: 'Ver minha sequência', href: '#/analises/tendencia' },
  },
  {
    id: 'margem', title: 'Margem de segurança', source: 'Benjamin Graham · O Investidor Inteligente (1949)',
    idea: 'Deixe folga para o imprevisto em vez de contar com o melhor cenário.',
    body: [
      'Graham criou a ideia para investimentos: só compre com folga entre o preço e o valor. No orçamento pessoal, a lógica é a mesma: não comprometa a renda inteira.',
      'Parcelas somadas são o lugar onde a margem some sem a gente perceber.',
    ],
    inApp: 'Análises › Futuro mostra quanto de cada mês já está comprometido com parcelas e recorrentes.',
    action: { label: 'Ver meus próximos meses', href: '#/analises/futuro' },
  },
  {
    id: 'sem-culpa', title: 'Gaste sem culpa no que importa', source: 'Ramit Sethi · I Will Teach You to Be Rich (2009)',
    idea: 'Corte sem dó o que não importa e gaste bem no que você ama.',
    body: [
      'Sethi defende o "gasto consciente": decidir com antecedência onde vale gastar e cortar sem culpa o resto, em vez de tentar economizar em tudo.',
      'Assinaturas esquecidas e taxas são os primeiros cortes fáceis.',
    ],
    inApp: 'Veja Assinaturas em Análises › Categorias e cancele as próximas parcelas de algo que não usa mais.',
    action: { label: 'Ver categorias', href: '#/analises/categorias' },
  },
  {
    id: 'habito', title: 'Facilite o hábito', source: 'James Clear · Hábitos Atômicos (2018)',
    idea: 'Torne o bom comportamento óbvio e fácil.',
    body: [
      'Clear mostra que hábitos se mantêm quando são fáceis e imediatos. Se registrar um gasto dá trabalho, o hábito morre em uma semana.',
      'Por isso o Elev8 Finance aceita uma frase ou um áudio, e você confirma em um toque.',
    ],
    inApp: 'Instale o app na tela inicial e crie o atalho da Siri "Lançar gasto".',
    action: { label: 'Instalar e criar atalho', href: '#/ajustes/instalar' },
  },
  {
    id: 'nigro', title: 'Ganhar, gastar bem, investir', source: 'Thiago Nigro · Do Mil ao Milhão (2018)',
    idea: 'Aumentar a renda, gastar com consciência e investir a diferença.',
    body: [
      'O livro organiza a riqueza em três pilares que se alimentam: gastar bem, investir melhor e ganhar mais.',
      'Cortar gastos tem limite; aumentar a renda não tem. Os dois juntos aceleram a sobra.',
    ],
    inApp: 'Lance entradas extras como "Renda extra" e acompanhe a sobra mês a mês em Análises › Tendência.',
  },
  {
    id: 'arcuri', title: 'Conhecer antes de cortar', source: 'Nathalia Arcuri · Me Poupe! (2018)',
    idea: 'Primeiro saiba para onde o dinheiro vai, depois decida.',
    body: [
      'Arcuri propõe começar pelo diagnóstico: registrar tudo por um tempo antes de mudar qualquer coisa.',
      'Os primeiros 30 dias de registro costumam surpreender mais que qualquer planilha de metas.',
    ],
    inApp: 'Análises › Calendário mostra em que dias da semana o seu dinheiro mais sai.',
    action: { label: 'Ver meu calendário', href: '#/analises/calendario' },
  },
  {
    id: 'cerbasi', title: 'Orçamento a dois', source: 'Gustavo Cerbasi · Casais Inteligentes Enriquecem Juntos (2004)',
    idea: 'Dinheiro do casal se planeja junto e às claras.',
    body: [
      'Cerbasi defende que o casal tenha objetivos e um orçamento combinados, com espaço individual para cada um.',
      'Conversar sobre dinheiro com números na mão evita a maior parte das brigas.',
    ],
    inApp: 'Na fase 2, o app terá um espaço compartilhado com convite.',
  },
];
