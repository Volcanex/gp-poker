/* Realistic handles for the bot population: the names a person actually
   types when a site asks them to pick one, rather than the CamelCase
   two-word names guests and the old bot roster use. First names or poker
   handles, numbers and underscores, initials, mixed case, country-flavoured
   pools drawn from a weighted distribution modelled on where online poker
   players actually come from.

   Deliberately a different shape from `generateName`: no two dictionary
   words glued together, because that is exactly the CamelCase pattern this
   generator exists to not look like. Every character is one `NAME_RE`
   already accepts (`server/src/auth.ts`): letters, digits, underscore,
   3-20 characters, so a bot's name is one a human claiming an account here
   could have typed themselves. */

// Matches the `Rng` in ./index.ts exactly; defined again here rather than
// imported so this module has no dependency on the file that re-exports it.
export type Rng = () => number;

export interface RealisticIdentity {
  name: string;
  country: string; // lowercase ISO 3166-1 alpha-2
}

interface CountryPool {
  code: string;
  weight: number;
  names: string[];
}

/* Weighted roughly by where online poker traffic actually comes from: the US
   the largest single share, then the UK, Canada, Germany, Brazil, Russia,
   Australia, Netherlands, Sweden, Poland, France, Spain, Italy, Ukraine,
   Hungary, Finland, Norway, Austria, Argentina, Mexico, India, Japan,
   Ireland, Portugal, Romania, Czechia, then a long tail of smaller pools.
   Every name is plain ASCII so it survives `NAME_RE` unchanged: accents are
   dropped rather than transliterated oddly (Joao, not João). */
const COUNTRY_POOLS: CountryPool[] = [
  {
    code: 'us',
    weight: 22,
    names: [
      'James', 'Michael', 'Chris', 'Ashley', 'Brittany', 'Tyler', 'Cody', 'Amanda',
      'Josh', 'Brandon', 'Megan', 'Kayla', 'Justin', 'Taylor', 'Derek', 'Whitney',
      'Austin', 'Courtney', 'Jordan', 'Heather',
    ],
  },
  {
    code: 'gb',
    weight: 11,
    names: [
      'Oliver', 'Harry', 'Jack', 'Charlotte', 'Emily', 'Callum', 'Liam', 'Freya',
      'George', 'Poppy', 'Archie', 'Ella', 'Jamie', 'Louis', 'Millie', 'Ryan',
    ],
  },
  {
    code: 'ca',
    weight: 7,
    names: [
      'Etienne', 'Marie', 'Jacob', 'Emma', 'Logan', 'Chloe', 'Mathieu', 'Sarah',
      'Cole', 'Danielle', 'Noah', 'Olivia', 'Liam', 'Zoe', 'Tristan', 'Camille',
    ],
  },
  {
    code: 'de',
    weight: 6.5,
    names: [
      'Lukas', 'Finn', 'Jonas', 'Leon', 'Mia', 'Hannah', 'Sven', 'Katrin',
      'Max', 'Lena', 'Niklas', 'Julia', 'Tobias', 'Anja', 'Felix', 'Sabine',
    ],
  },
  {
    code: 'br',
    weight: 6,
    names: [
      'Joao', 'Pedro', 'Lucas', 'Gabriel', 'Mateus', 'Ana', 'Beatriz', 'Camila',
      'Rafael', 'Larissa', 'Thiago', 'Juliana', 'Bruno', 'Fernanda', 'Diego', 'Patricia',
    ],
  },
  {
    code: 'ru',
    weight: 5.5,
    names: [
      'Dmitri', 'Ivan', 'Sergei', 'Andrei', 'Olga', 'Natasha', 'Vlad', 'Yuri',
      'Mikhail', 'Elena', 'Pavel', 'Katya', 'Igor', 'Anastasia', 'Nikolai', 'Svetlana',
    ],
  },
  {
    code: 'au',
    weight: 5,
    names: [
      'Jack', 'Charlie', 'Mitch', 'Zoe', 'Lachlan', 'Isla', 'Cooper', 'Ruby',
      'Riley', 'Chloe', 'Hayden', 'Georgia', 'Bailey', 'Matilda', 'Jayden', 'Ebony',
    ],
  },
  {
    code: 'nl',
    weight: 4,
    names: [
      'Daan', 'Sem', 'Bram', 'Lars', 'Fenna', 'Sanne', 'Thijs', 'Eva',
      'Bas', 'Anouk', 'Wouter', 'Femke', 'Jeroen', 'Iris', 'Kees', 'Marieke',
    ],
  },
  {
    code: 'se',
    weight: 3.5,
    names: [
      'Erik', 'Oskar', 'Lukas', 'Astrid', 'Elin', 'Sven', 'Nils', 'Ingrid',
      'Anders', 'Karin', 'Filip', 'Hanna', 'Gustav', 'Signe', 'Bjorn', 'Alva',
    ],
  },
  {
    code: 'pl',
    weight: 3.2,
    names: [
      'Piotr', 'Krzysztof', 'Tomasz', 'Agnieszka', 'Kasia', 'Marek', 'Wojciech', 'Magda',
      'Pawel', 'Ola', 'Grzegorz', 'Ewa', 'Bartek', 'Justyna', 'Rafal', 'Iwona',
    ],
  },
  {
    code: 'fr',
    weight: 3,
    names: [
      'Antoine', 'Julien', 'Mathieu', 'Camille', 'Lea', 'Nicolas', 'Pierre', 'Manon',
      'Thomas', 'Chloe', 'Hugo', 'Emilie', 'Maxime', 'Aurelie', 'Romain', 'Celine',
    ],
  },
  {
    code: 'es',
    weight: 2.8,
    names: [
      'Javier', 'Alejandro', 'Diego', 'Carlos', 'Sofia', 'Lucia', 'Pablo', 'Marta',
      'Sergio', 'Elena', 'Ivan', 'Cristina', 'Raul', 'Laura', 'Adrian', 'Nuria',
    ],
  },
  {
    code: 'it',
    weight: 2.6,
    names: [
      'Matteo', 'Luca', 'Marco', 'Giulia', 'Chiara', 'Alessandro', 'Davide', 'Francesca',
      'Simone', 'Valentina', 'Andrea', 'Federica', 'Riccardo', 'Martina', 'Stefano', 'Elisa',
    ],
  },
  {
    code: 'ua',
    weight: 2.4,
    names: [
      'Oleksandr', 'Dmytro', 'Andriy', 'Olena', 'Iryna', 'Bohdan', 'Kateryna', 'Taras',
      'Yulia', 'Mykola', 'Nadia', 'Roman', 'Sofiya', 'Vitaliy', 'Halyna', 'Ihor',
    ],
  },
  {
    code: 'hu',
    weight: 1.8,
    names: [
      'Bence', 'Zoltan', 'Gabor', 'Eszter', 'Zsofia', 'Peter', 'Aniko', 'Laszlo',
      'Timea', 'Andras', 'Reka', 'Balazs', 'Nikolett', 'Tamas', 'Orsolya', 'Csaba',
    ],
  },
  {
    code: 'fi',
    weight: 1.6,
    names: [
      'Mikko', 'Juha', 'Ville', 'Anni', 'Laura', 'Sami', 'Elina', 'Antti',
      'Noora', 'Jussi', 'Riikka', 'Timo', 'Sanna', 'Aleksi', 'Paivi', 'Janne',
    ],
  },
  {
    code: 'no',
    weight: 1.5,
    names: [
      'Henrik', 'Magnus', 'Ida', 'Emma', 'Kristian', 'Silje', 'Anders', 'Marte',
      'Fredrik', 'Ingrid', 'Sondre', 'Thea', 'Bjorn', 'Live', 'Andreas', 'Maren',
    ],
  },
  {
    code: 'at',
    weight: 1.4,
    names: [
      'Florian', 'Sebastian', 'Anna', 'Julia', 'Bernhard', 'Katharina', 'Christoph', 'Laura',
      'Stefan', 'Verena', 'Matthias', 'Nina', 'Thomas', 'Sarah', 'Michael', 'Petra',
    ],
  },
  {
    code: 'ar',
    weight: 1.3,
    names: [
      'Federico', 'Nicolas', 'Martina', 'Valentina', 'Santiago', 'Camila', 'Ignacio', 'Rocio',
      'Facundo', 'Agustina', 'Tomas', 'Sol', 'Franco', 'Julieta', 'Gonzalo', 'Milagros',
    ],
  },
  {
    code: 'mx',
    weight: 1.2,
    names: [
      'Alejandro', 'Miguel', 'Fernanda', 'Ximena', 'Carlos', 'Daniela', 'Jorge', 'Andrea',
      'Ricardo', 'Paola', 'Eduardo', 'Monica', 'Luis', 'Gabriela', 'Victor', 'Karla',
    ],
  },
  {
    code: 'in',
    weight: 1.1,
    names: [
      'Rohan', 'Arjun', 'Priya', 'Ananya', 'Vikram', 'Neha', 'Karthik', 'Divya',
      'Rahul', 'Pooja', 'Aditya', 'Sneha', 'Amit', 'Kavya', 'Nikhil', 'Meera',
    ],
  },
  {
    code: 'jp',
    weight: 1.0,
    names: [
      'Haruto', 'Sota', 'Yui', 'Sakura', 'Ren', 'Hina', 'Kaito', 'Rin',
      'Yuto', 'Aoi', 'Riku', 'Mei', 'Sho', 'Yuna', 'Daiki', 'Nanami',
    ],
  },
  {
    code: 'ie',
    weight: 1.0,
    names: [
      'Sean', 'Conor', 'Aoife', 'Niamh', 'Cian', 'Saoirse', 'Cathal', 'Roisin',
      'Eoin', 'Ciara', 'Darragh', 'Aisling', 'Ronan', 'Orla', 'Fionn', 'Grainne',
    ],
  },
  {
    code: 'pt',
    weight: 0.9,
    names: [
      'Joao', 'Rui', 'Beatriz', 'Ines', 'Tiago', 'Sofia', 'Miguel', 'Catarina',
      'Andre', 'Mariana', 'Bruno', 'Rita', 'Nuno', 'Carolina', 'Diogo', 'Filipa',
    ],
  },
  {
    code: 'ro',
    weight: 0.9,
    names: [
      'Andrei', 'Mihai', 'Ana', 'Ioana', 'Alexandru', 'Elena', 'Cristian', 'Diana',
      'Bogdan', 'Alina', 'Florin', 'Raluca', 'Stefan', 'Georgiana', 'Marius', 'Simona',
    ],
  },
  {
    code: 'cz',
    weight: 0.8,
    names: [
      'Jakub', 'Tomas', 'Tereza', 'Petra', 'Jan', 'Eliska', 'Martin', 'Katerina',
      'Lukas', 'Barbora', 'Ondrej', 'Adela', 'Vojtech', 'Nikola', 'David', 'Klara',
    ],
  },
  // A long tail of smaller pools, each a modest slice on its own.
  { code: 'be', weight: 0.4, names: ['Thibault', 'Margaux', 'Wout', 'Fien', 'Arthur', 'Charlotte', 'Bram', 'Louise'] },
  { code: 'ch', weight: 0.4, names: ['Luca', 'Elias', 'Noemi', 'Livia', 'Reto', 'Corinne', 'Stefan', 'Melanie'] },
  { code: 'dk', weight: 0.4, names: ['Mads', 'Freja', 'Anders', 'Signe', 'Emil', 'Sofie', 'Frederik', 'Line'] },
  { code: 'tr', weight: 0.4, names: ['Emre', 'Zeynep', 'Mehmet', 'Elif', 'Baris', 'Ayse', 'Kerem', 'Selin'] },
  { code: 'cn', weight: 0.4, names: ['Wei', 'Jing', 'Hao', 'Ying', 'Lei', 'Fang', 'Chen', 'Ling'] },
  { code: 'kr', weight: 0.4, names: ['Minjun', 'Jiwoo', 'Seojun', 'Hana', 'Dojoon', 'Yerin', 'Jihoon', 'Soyeon'] },
  { code: 'ph', weight: 0.4, names: ['Miguel', 'Angel', 'Kim', 'Bea', 'Jomar', 'Trisha', 'Paolo', 'Nicole'] },
  { code: 'id', weight: 0.4, names: ['Budi', 'Sari', 'Agus', 'Dewi', 'Rizky', 'Putri', 'Andi', 'Wulan'] },
  { code: 'il', weight: 0.4, names: ['Noam', 'Maya', 'Itai', 'Tamar', 'Omer', 'Shira', 'Eitan', 'Yael'] },
  { code: 'gr', weight: 0.4, names: ['Nikos', 'Eleni', 'Yiannis', 'Katerina', 'Dimitris', 'Sofia', 'Kostas', 'Maria'] },
  { code: 'za', weight: 0.4, names: ['Sipho', 'Thandiwe', 'Pieter', 'Amahle', 'Kagiso', 'Lerato', 'Johan', 'Nomvula'] },
  { code: 'nz', weight: 0.4, names: ['Jack', 'Charlotte', 'Tama', 'Aroha', 'Liam', 'Grace', 'Manaia', 'Isla'] },
  { code: 'cl', weight: 0.4, names: ['Matias', 'Javiera', 'Cristobal', 'Antonia', 'Vicente', 'Florencia', 'Benjamin', 'Constanza'] },
  { code: 'co', weight: 0.4, names: ['Santiago', 'Valentina', 'Juan', 'Camila', 'Andres', 'Isabella', 'Sebastian', 'Mariana'] },
];

// Locale-neutral poker-handle words: what a nickname-style handle draws from
// when it is not somebody's first name. Ordinary, a little cocky, never a
// jab at anyone.
const HANDLE_WORDS = [
  'allin', 'riverrat', 'shortstack', 'nitgrind', 'chiptrick', 'bluffcity',
  'gutshot', 'coldcall', 'rakeback', 'flushking', 'pairsplit', 'stackedup',
  'bankroll', 'tilted', 'grinder', 'checkraise', 'cardshark', 'foldkid',
  'openpush', 'sidepot', 'hotseat', 'deepstack', 'valuebet', 'potodds',
  'runitonce', 'felted', 'backdoor', 'floptown', 'turnking', 'riverghost',
  'chiplead', 'holdemfan',
];

function pick<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

function pickWeightedCountry(rng: Rng): CountryPool {
  const total = COUNTRY_POOLS.reduce((sum, pool) => sum + pool.weight, 0);
  let r = rng() * total;
  for (const pool of COUNTRY_POOLS) {
    r -= pool.weight;
    if (r <= 0) return pool;
  }
  return COUNTRY_POOLS[COUNTRY_POOLS.length - 1];
}

// 10-99 most of the time (an age, a lucky number), sometimes a birth year,
// sometimes a bare single digit: the spread a real signup form sees.
function numberSuffix(rng: Rng): string {
  const r = rng();
  if (r < 0.45) return String(10 + Math.floor(rng() * 90));
  if (r < 0.8) return String(1970 + Math.floor(rng() * 40));
  return String(1 + Math.floor(rng() * 9));
}

// How a name is cased: mostly lowercase or Capitalised, occasionally shouted.
// Nobody's SHOUTING is common, so it stays rare.
function cased(rng: Rng, word: string): string {
  const r = rng();
  if (r < 0.45) return word.toLowerCase();
  if (r < 0.92) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return word.toUpperCase();
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function clampToNameLength(name: string): string {
  // NAME_RE (server/src/auth.ts) is 3-20 characters. Every style here starts
  // well inside that, but a long first name plus a four-digit year can just
  // clear it, so the name itself gives way rather than the number.
  return name.length > 20 ? name.slice(0, 20) : name;
}

type Style = (rng: Rng, firstName: string) => string;

const STYLES: [number, Style][] = [
  // firstName + number, no separator: "kevin47", "Marcus1988"
  [30, (rng, first) => cased(rng, first) + numberSuffix(rng)],
  // firstName_number: "anna_88"
  [15, (rng, first) => cased(rng, first) + '_' + numberSuffix(rng)],
  // firstName + last initial + number: "MikeT84"
  [
    10,
    (rng, first) =>
      first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() + pick(rng, LETTERS.toUpperCase().split('')) + numberSuffix(rng),
  ],
  // a poker handle word + number: "riverrat23", "Grinder7"
  [15, (rng) => cased(rng, pick(rng, HANDLE_WORDS)) + numberSuffix(rng)],
  // handle_word + number, underscored: "chip_lead_91"
  [10, (rng) => cased(rng, pick(rng, HANDLE_WORDS)) + '_' + numberSuffix(rng)],
  // plain first name, nothing else: "thomas", "Freya"
  [10, (rng, first) => cased(rng, first)],
  // bare initials + number: "jrw77"
  [
    10,
    (rng) =>
      Array.from({ length: 3 }, () => pick(rng, LETTERS.split(''))).join('') + numberSuffix(rng),
  ],
];

function pickStyle(rng: Rng): Style {
  const total = STYLES.reduce((sum, [w]) => sum + w, 0);
  let r = rng() * total;
  for (const [weight, style] of STYLES) {
    r -= weight;
    if (r <= 0) return style;
  }
  return STYLES[STYLES.length - 1][1];
}

/* One realistic identity: a name in the shape a person would actually type
   when signing up, and the country it is flavoured for. Pure and seeded: the
   same rng sequence always yields the same identity, which is what lets the
   population roster regenerate byte-identical on every boot. */
export function generateRealisticIdentity(rng: Rng): RealisticIdentity {
  const pool = pickWeightedCountry(rng);
  const firstName = pick(rng, pool.names);
  const style = pickStyle(rng);
  const name = clampToNameLength(style(rng, firstName));
  return { name, country: pool.code };
}

// The character set every style above produces: letters, digits and
// underscore only, 3-20 characters, so a generated name is always one
// `NAME_RE` (server/src/auth.ts) already accepts. Exported for tests and for
// anything that wants to sanity-check a name without importing the server.
export const REALISTIC_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

export function looksRealistic(name: string): boolean {
  return REALISTIC_NAME_RE.test(name);
}
