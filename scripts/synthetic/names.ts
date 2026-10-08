// Invented names for synthetic members. Given names are common across many cultures; surnames
// are INVENTED by joining morphemes from unrelated traditions (e.g. "Hokuthorne", "Vasalund"),
// so full names are fictional. Any resemblance to a real person is coincidental.
import type { Gender } from "../../packages/sim/src/persona.ts";
import type { Rng } from "../../packages/core/src/index.ts";

const WOMEN = [
  "Adaeze", "Aiko", "Alma", "Amara", "Anahi", "Anika", "Ayesha", "Beatriz", "Bao", "Camila", "Chiara", "Dalia",
  "Esi", "Farida", "Freya", "Gulnara", "Hana", "Ingrid", "Isabela", "Jamila", "Kalani", "Keiko", "Leilani",
  "Lucia", "Mariam", "Mei", "Nadia", "Nalani", "Niamh", "Noor", "Oksana", "Paloma", "Priya", "Rania", "Rosa",
  "Saoirse", "Selin", "Sunita", "Tamar", "Thandiwe", "Valentina", "Wanjiru", "Ximena", "Yaretzi", "Yuna", "Zainab",
  "Zofia", "Marisol", "Ines", "Ama", "Lior", "Dagny", "Odessa", "Imani", "Nayeli", "Soraya", "Ha-eun", "Kiri",
];
const MEN = [
  "Abebe", "Ahmed", "Alejandro", "Amir", "Anders", "Arjun", "Bashir", "Bongani", "Caetano", "Chidi", "Dariusz",
  "Diego", "Emeka", "Farhan", "Gustavo", "Hamza", "Haruto", "Idris", "Ivan", "Jae-won", "Javier", "Kenji", "Kofi",
  "Kwame", "Luca", "Malik", "Mateo", "Minh", "Nikhil", "Obinna", "Omar", "Oren", "Pavel", "Rafael", "Rohan",
  "Santiago", "Sefa", "Sione", "Tariq", "Tenzin", "Tomasz", "Viktor", "Wei", "Yusuf", "Zeke", "Ezra", "Leif",
  "Mauricio", "Desmond", "Kai", "Bilal", "Teodoro", "Anselm", "Hiroshi", "Cyrus", "Dmitri", "Thabo", "Rangi",
];
const NEUTRAL = [
  "Ari", "Avery", "Rowan", "Sage", "Quinn", "Remy", "Robin", "Sasha", "Noa", "Kit", "Ash", "Jules", "Emery",
  "Marlowe", "Indigo", "Wren", "Ellis", "Shay", "Dakota", "Haven", "Lumen", "Kiran", "Tal", "Yael",
];
const SUR_A = [
  "Ade", "Ash", "Bano", "Bel", "Chi", "Cor", "Dal", "Dun", "Eko", "Ev", "Fara", "Fen", "Gal", "Gui", "Har", "Hoku",
  "Ilo", "Ish", "Jas", "Juno", "Kaze", "Kel", "Lio", "Lun", "Mada", "Mar", "Nko", "Nov", "Oda", "Ost", "Pell",
  "Pera", "Quin", "Rin", "Ros", "Sav", "Sol", "Tav", "Tem", "Ul", "Uzo", "Vasa", "Ven", "Wen", "Wyn", "Xio",
  "Yar", "Yuki", "Zan", "Zel",
];
const SUR_B = [
  "brook", "croft", "dell", "ford", "mere", "wick", "vale", "thorne", "lund", "stad", "ani", "ora", "enko",
  "ovic", "arez", "ini", "oto", "ward", "bury", "sen", "quist", "adi", "ola", "uki", "emi", "ero", "ell",
  "anza", "iku", "oye", "amba", "eiro", "ski", "hollow", "garde", "ulu", "esco", "aki", "ond", "ith",
];

export function inventName(r: Rng, gender: Gender, used: Set<string>): string {
  const pool = gender === "woman" ? WOMEN : gender === "man" ? MEN : NEUTRAL;
  for (let k = 0; k < 200; k++) {
    const first = r.bool(0.1) ? r.pick(NEUTRAL) : r.pick(pool);
    const sur = r.pick(SUR_A) + r.pick(SUR_B);
    const name = `${first} ${sur}`;
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  }
  throw new Error("name space exhausted");
}
