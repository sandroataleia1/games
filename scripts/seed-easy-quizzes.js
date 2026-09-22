import { createDatabase, DomainError } from "../packages/database/src/index.js";

const CONTENT = [
  {
    title: "Animais",
    description: "Quiz fácil sobre o reino animal.",
    questions: [
      ["Qual é o maior mamífero do mundo?", ["Baleia-azul", "Elefante-africano", "Girafa", "Rinoceronte-branco"]],
      ["Qual animal é conhecido como o \"rei da selva\"?", ["Leão", "Tigre", "Elefante", "Gorila"]],
      ["Quantas patas tem uma aranha?", ["8", "6", "4", "10"]],
      ["Qual é o animal terrestre mais rápido do mundo?", ["Guepardo", "Leão", "Cavalo", "Avestruz"]],
      ["Qual é a maior ave do mundo, que não voa?", ["Avestruz", "Pinguim", "Ema", "Kiwi"]],
      ["Qual animal muda de cor para se camuflar?", ["Camaleão", "Lagarto", "Sapo", "Cobra"]],
      ["Qual é o único mamífero capaz de voar de verdade?", ["Morcego", "Esquilo-voador", "Falcão", "Coruja"]],
      ["Qual animal é conhecido por guardar comida nas bochechas?", ["Hamster", "Coelho", "Rato", "Esquilo"]],
    ],
  },
  {
    title: "Países",
    description: "Quiz fácil de geografia sobre países do mundo.",
    questions: [
      ["Qual é o maior país do mundo em área territorial?", ["Rússia", "Canadá", "China", "Estados Unidos"]],
      ["Qual país tem o formato de uma bota no mapa?", ["Itália", "Espanha", "Grécia", "Portugal"]],
      ["Em qual país fica a Torre Eiffel?", ["França", "Itália", "Alemanha", "Bélgica"]],
      ["Qual é o menor país do mundo?", ["Vaticano", "Mônaco", "San Marino", "Liechtenstein"]],
      ["Em qual país fica a Grande Muralha?", ["China", "Japão", "Mongólia", "Coreia do Sul"]],
      ["Qual país é famoso por ter cangurus e coalas?", ["Austrália", "Nova Zelândia", "África do Sul", "Indonésia"]],
      ["Em qual país fica Machu Picchu?", ["Peru", "Bolívia", "Chile", "Equador"]],
      ["Qual país é conhecido como \"terra dos pandas\"?", ["China", "Japão", "Vietnã", "Tailândia"]],
    ],
  },
  {
    title: "Cidades",
    description: "Quiz fácil sobre cidades famosas ao redor do mundo.",
    questions: [
      ["Qual é a capital do Brasil?", ["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"]],
      ["Qual cidade é conhecida como \"a cidade que nunca dorme\"?", ["Nova York", "Los Angeles", "Chicago", "Miami"]],
      ["Em qual cidade fica o Coliseu?", ["Roma", "Atenas", "Milão", "Nápoles"]],
      ["Qual é a capital da França?", ["Paris", "Lyon", "Marselha", "Nice"]],
      ["Qual cidade é famosa por seus canais e gôndolas?", ["Veneza", "Amsterdã", "Bruges", "Estocolmo"]],
      ["Qual é a capital do Japão?", ["Tóquio", "Osaka", "Kyoto", "Yokohama"]],
      ["Em qual cidade fica o Cristo Redentor?", ["Rio de Janeiro", "São Paulo", "Salvador", "Recife"]],
      ["Qual é a capital da Inglaterra?", ["Londres", "Manchester", "Liverpool", "Birmingham"]],
    ],
  },
  {
    title: "Frutas",
    description: "Quiz fácil sobre frutas e suas características.",
    questions: [
      ["Qual fruta amarela é rica em potássio?", ["Banana", "Manga", "Abacaxi", "Mamão"]],
      ["Qual fruta tem as sementes do lado de fora da casca?", ["Morango", "Framboesa", "Amora", "Cereja"]],
      ["Qual fruta é tradicionalmente associada à história de Adão e Eva?", ["Maçã", "Pera", "Romã", "Figo"]],
      ["Qual fruta é usada como principal ingrediente do guacamole?", ["Abacate", "Manga", "Kiwi", "Pêssego"]],
      ["Qual fruta cítrica verde é usada para fazer caipirinha?", ["Limão", "Laranja", "Tangerina", "Lima"]],
      ["Qual fruta tem uma coroa de folhas no topo e é rica em bromelina?", ["Abacaxi", "Melancia", "Melão", "Manga"]],
      ["Qual é uma das maiores frutas do mundo, podendo pesar dezenas de quilos?", ["Jaca", "Abóbora", "Melancia", "Abacaxi"]],
      ["Qual fruta vermelha pequena cresce em cachos e é usada para fazer vinho?", ["Uva", "Cereja", "Framboesa", "Amora"]],
    ],
  },
];

function shuffledOptions(texts) {
  const options = texts.map((text, index) => ({ text, isCorrect: index === 0 }));
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

const email = process.env.SEED_ORGANIZER_EMAIL || "conteudo@quizarena.local";
const name = process.env.SEED_ORGANIZER_NAME || "Conteúdo QuizArena";
const password = process.env.SEED_ORGANIZER_PASSWORD;
if (!password) throw new Error("Defina SEED_ORGANIZER_PASSWORD para criar/usar o organizador de conteúdo.");

const database = createDatabase({ databaseUrl: process.env.DATABASE_URL });
try {
  let session;
  try {
    session = await database.organizers.register({ name, email, password });
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "EMAIL_CONFLICT") throw error;
    session = await database.organizers.login({ email, password });
  }
  const ownerId = session.user.id;
  const created = [];
  for (const { title, description, questions } of CONTENT) {
    const existing = (await database.organizers.listQuizzes(ownerId)).find((quiz) => quiz.title === title);
    if (existing) {
      created.push({ title, id: existing.id, status: existing.status, skipped: true });
      continue;
    }
    const quiz = await database.organizers.createQuiz(ownerId, { title, description });
    for (const [prompt, options] of questions) {
      await database.organizers.addQuestion(ownerId, quiz.id, {
        prompt,
        durationSeconds: 20,
        basePoints: 1000,
        explanation: null,
        options: shuffledOptions(options),
      });
    }
    const published = await database.organizers.publish(ownerId, quiz.id);
    created.push({ title, id: published.id, status: published.status, questions: published.questions.length });
  }
  console.log(JSON.stringify({ ownerId, email, quizzes: created }, null, 2));
} finally {
  await database.close();
}
