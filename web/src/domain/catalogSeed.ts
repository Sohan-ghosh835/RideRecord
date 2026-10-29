import type { CatalogEntry, Category, Cooling, DriveType, FuelType, ModelStatus, SpecValue } from './types';

/**
 * BUILT-IN SEED CATALOG: identification data only.
 *
 * Every record here is marked `seed-unverified`. It lets a rider find and identify a model
 * (manufacturer, model, generation, production years, category, fuel type) but deliberately
 * carries NO power, torque, weight, tank or service-interval figures, because none of them
 * have been verified against a manufacturer source in this build. Production years are
 * approximate market-level ranges. Verified, sourced records are added through the catalog
 * importer (Admin) or the backend ingestion service, and override seed records by id.
 */

const SEED_DATE = '2026-10-17';
const seedSource = { kind: 'seed' as const, label: 'Built-in identification seed (unverified; confirm against the owner\'s manual)' };

interface Opts {
  family?: string; aliases?: string[]; generation?: string; variants?: string[];
  to?: number | null; cc?: number; drive?: DriveType; cooling?: Cooling; status?: ModelStatus;
  fuel?: FuelType; market?: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function e(manufacturer: string, model: string, category: Category, from: number, o: Opts = {}): CatalogEntry {
  const fuel: FuelType = o.fuel ?? (category.startsWith('electric') ? 'electric' : 'petrol');
  const to = o.to === undefined ? null : o.to;
  const specs: CatalogEntry['specs'] = {};
  if (o.cc) {
    const v: SpecValue = { value: o.cc, unit: 'cc', verification: 'seed-unverified', sourceIndex: 0 };
    specs.displacement = v;
  }
  return {
    id: slug(`${manufacturer}-${model}-${o.generation ?? ''}`),
    manufacturer, model, family: o.family, aliases: o.aliases ?? [], generation: o.generation,
    variants: o.variants, yearFrom: from, yearTo: to, market: o.market ?? 'IN',
    category, fuelType: fuel,
    drive: o.drive ?? (fuel === 'electric' ? 'electric' : category === 'scooter' ? 'belt' : 'chain'),
    cooling: o.cooling ?? 'unknown',
    status: o.status ?? (to === null ? 'current' : 'discontinued'),
    specs, verification: 'seed-unverified', sources: [seedSource], updatedAt: SEED_DATE,
  };
}

export const BRAND_ALIASES: Record<string, string[]> = {
  'Royal Enfield': ['re', 'enfield', 'royalenfield'],
  'Harley-Davidson': ['harley', 'hd', 'harleydavidson'],
  'BMW Motorrad': ['bmw'],
  'Ola Electric': ['ola'],
  Honda: ['hmsi'],
  Hero: ['hero motocorp', 'heromotocorp'],
  Bajaj: ['bajaj auto'],
  'TVS': ['tvs motor'],
  Yamaha: ['ymi'],
  Suzuki: ['suzuki motorcycle'],
  CFMoto: ['cf moto', 'cf-moto'],
  Ather: ['ather energy'],
};

export const SEED_CATALOG: CatalogEntry[] = [
  // Royal Enfield
  e('Royal Enfield', 'Hunter 350', 'naked', 2022, { cc: 349, variants: ['Retro Factory', 'Metro Dapper', 'Metro Rebel'], aliases: ['hunter350'] }),
  e('Royal Enfield', 'Classic 350', 'cruiser', 2021, { cc: 349, generation: 'J-series', variants: ['Redditch', 'Halcyon', 'Signals', 'Dark', 'Chrome'], aliases: ['classic350'] }),
  e('Royal Enfield', 'Classic 350', 'cruiser', 2009, { cc: 346, to: 2021, generation: 'UCE (pre-2021)', aliases: ['classic350', 'classic 350 old'] }),
  e('Royal Enfield', 'Bullet 350', 'cruiser', 2023, { cc: 349, generation: 'J-series', aliases: ['bullet350'] }),
  e('Royal Enfield', 'Meteor 350', 'cruiser', 2020, { cc: 349, aliases: ['meteor350'] }),
  e('Royal Enfield', 'Himalayan 411', 'adventure', 2016, { cc: 411, to: 2023, generation: '411', aliases: ['himalayan', 'himalayan411'] }),
  e('Royal Enfield', 'Himalayan 450', 'adventure', 2023, { cc: 452, generation: '450', cooling: 'liquid', aliases: ['himalayan', 'himalayan450'] }),
  e('Royal Enfield', 'Interceptor 650', 'naked', 2018, { cc: 648, aliases: ['int 650', 'interceptor'] }),
  e('Royal Enfield', 'Continental GT 650', 'naked', 2018, { cc: 648, aliases: ['gt 650', 'continental gt'] }),
  e('Royal Enfield', 'Scram 411', 'dual-sport', 2022, { cc: 411, aliases: ['scram'] }),
  e('Royal Enfield', 'Super Meteor 650', 'cruiser', 2023, { cc: 648, aliases: ['super meteor'] }),
  // Honda
  e('Honda', 'Activa 6G', 'scooter', 2020, { variants: ['Standard', 'Deluxe'], aliases: ['activa6g', 'activa 110', 'activa'] }),
  e('Honda', 'Activa 125', 'scooter', 2018, { aliases: ['activa125', 'activa'] }),
  e('Honda', 'Dio', 'scooter', 2012, { aliases: ['dio 110'] }),
  e('Honda', 'Shine 125', 'commuter', 2020, { aliases: ['shine', 'cb shine'] }),
  e('Honda', 'SP 125', 'commuter', 2019, { aliases: ['sp125'] }),
  e('Honda', 'Unicorn', 'commuter', 2004, { aliases: ['cb unicorn'] }),
  e('Honda', 'CB350 H\'ness', 'cruiser', 2020, { aliases: ['hness', 'highness', 'cb350', 'h ness'] }),
  e('Honda', 'Hornet 2.0', 'naked', 2020, { aliases: ['cb hornet 2.0', 'hornet'] }),
  // Hero
  e('Hero', 'Splendor Plus', 'commuter', 2011, { aliases: ['splendor', 'splender'], cooling: 'air' }),
  e('Hero', 'HF Deluxe', 'commuter', 2013, { aliases: ['hf deluxe', 'hero hf'], cooling: 'air' }),
  e('Hero', 'Glamour', 'commuter', 2005, { aliases: ['glamour 125'] }),
  e('Hero', 'Xtreme 160R', 'naked', 2020, { aliases: ['xtreme', 'xtreme160r'] }),
  e('Hero', 'Destini 125', 'scooter', 2018, { aliases: ['destini'] }),
  e('Hero', 'Pleasure Plus', 'scooter', 2016, { aliases: ['pleasure+', 'pleasure'] }),
  e('Hero', 'Vida V1', 'electric-scooter', 2022, { aliases: ['vida', 'vida v1 pro'] }),
  // Bajaj
  e('Bajaj', 'Pulsar 150', 'naked', 2001, { aliases: ['pulsar', 'pulser'], cooling: 'air' }),
  e('Bajaj', 'Pulsar NS200', 'naked', 2012, { aliases: ['ns200', 'ns 200', 'pulsar ns 200'], cc: 199 }),
  e('Bajaj', 'Pulsar 220F', 'sport', 2007, { aliases: ['220f', 'pulsar 220'] }),
  e('Bajaj', 'Platina 100', 'commuter', 2006, { aliases: ['platina'] }),
  e('Bajaj', 'Avenger', 'cruiser', 2005, { aliases: ['avenger street 160', 'avenger cruise 220'] }),
  e('Bajaj', 'Dominar 400', 'touring', 2016, { cc: 373, aliases: ['dominar'] }),
  e('Bajaj', 'Chetak', 'electric-scooter', 2020, { aliases: ['chetak electric', 'bajaj chetak ev'] }),
  // TVS
  e('TVS', 'Apache RTR 160 4V', 'naked', 2018, { aliases: ['apache 160', 'rtr 160', 'apache rtr160'], cooling: 'oil' }),
  e('TVS', 'Apache RR 310', 'sport', 2017, { aliases: ['rr310', 'rr 310', 'apache 310'], cooling: 'liquid' }),
  e('TVS', 'Jupiter', 'scooter', 2013, { aliases: ['jupiter 110', 'jupiter 125'] }),
  e('TVS', 'Ntorq 125', 'scooter', 2018, { aliases: ['ntorq', 'n torq'] }),
  e('TVS', 'Raider 125', 'commuter', 2021, { aliases: ['raider'] }),
  e('TVS', 'Radeon', 'commuter', 2018, { aliases: ['tvs radeon'] }),
  e('TVS', 'iQube', 'electric-scooter', 2020, { aliases: ['iqube electric', 'tvs electric scooter', 'i qube'] }),
  // Yamaha
  e('Yamaha', 'R15 V3', 'sport', 2018, { cc: 155, to: 2022, generation: 'V3', aliases: ['r15 v3', 'r15v3', 'yzf r15 v3'], cooling: 'liquid' }),
  e('Yamaha', 'R15 V4', 'sport', 2021, { cc: 155, generation: 'V4', aliases: ['r15 v4', 'r15v4', 'yzf r15 v4'], cooling: 'liquid' }),
  e('Yamaha', 'MT-15', 'naked', 2019, { cc: 155, aliases: ['mt15', 'mt 15'], cooling: 'liquid' }),
  e('Yamaha', 'FZ-S Fi', 'naked', 2019, { aliases: ['fzs', 'fz s', 'fz-s'], cooling: 'air' }),
  e('Yamaha', 'Fascino 125', 'scooter', 2015, { aliases: ['fascino'] }),
  e('Yamaha', 'RayZR 125', 'scooter', 2016, { aliases: ['ray zr', 'rayzr'] }),
  // Suzuki
  e('Suzuki', 'Access 125', 'scooter', 2007, { aliases: ['access', 'suzuki access'] }),
  e('Suzuki', 'Gixxer SF', 'sport', 2015, { aliases: ['gixxer sf 250', 'gixxer'] }),
  e('Suzuki', 'Burgman Street', 'scooter', 2018, { aliases: ['burgman', 'burgman street 125'] }),
  e('Suzuki', 'V-Strom SX', 'adventure', 2022, { aliases: ['vstrom sx', 'v strom sx', 'vstrom'] }),
  e('Suzuki', 'Hayabusa', 'sport', 2013, { aliases: ['busa', 'hayabusa gen 3'] }),
  // KTM
  e('KTM', 'Duke 200', 'naked', 2012, { cc: 199, aliases: ['duke200'], cooling: 'liquid' }),
  e('KTM', 'Duke 250', 'naked', 2017, { cc: 248, aliases: ['duke250'], cooling: 'liquid' }),
  e('KTM', 'Duke 390', 'naked', 2013, { cc: 373, to: 2016, generation: 'Gen 1 (2013-2016)', aliases: ['duke390', 'duke 390'], cooling: 'liquid' }),
  e('KTM', 'Duke 390', 'naked', 2017, { cc: 373, to: 2023, generation: 'Gen 2 (2017-2023)', aliases: ['duke390', 'duke 390'], cooling: 'liquid' }),
  e('KTM', 'Duke 390', 'naked', 2024, { cc: 399, generation: 'Gen 3 (2024-)', aliases: ['duke390', 'duke 390'], cooling: 'liquid' }),
  e('KTM', 'RC 390', 'sport', 2014, { cc: 373, aliases: ['rc390', 'rc 390'], cooling: 'liquid' }),
  e('KTM', '390 Adventure', 'adventure', 2020, { cc: 373, aliases: ['390 adv', 'adventure 390', '390adv'], cooling: 'liquid' }),
  // Kawasaki
  e('Kawasaki', 'Ninja 300', 'sport', 2013, { cc: 296, aliases: ['ninja300', 'ex300'], cooling: 'liquid' }),
  e('Kawasaki', 'Ninja 650', 'sport', 2017, { cc: 649, aliases: ['ninja650'], cooling: 'liquid' }),
  e('Kawasaki', 'Z900', 'naked', 2017, { aliases: ['z 900'], cooling: 'liquid' }),
  e('Kawasaki', 'Versys 650', 'adventure', 2015, { cc: 649, aliases: ['versys', 'versys650'], cooling: 'liquid' }),
  // BMW Motorrad
  e('BMW Motorrad', 'G 310 R', 'naked', 2018, { cc: 313, aliases: ['g310r', 'g 310r'], cooling: 'liquid' }),
  e('BMW Motorrad', 'G 310 GS', 'adventure', 2018, { cc: 313, aliases: ['g310gs', 'g 310gs'], cooling: 'liquid' }),
  e('BMW Motorrad', 'R 1250 GS', 'adventure', 2019, { cc: 1254, drive: 'shaft', aliases: ['r1250gs', 'gs 1250', '1250 gs'] }),
  // Triumph
  e('Triumph', 'Speed 400', 'naked', 2023, { cc: 398, aliases: ['speed400'], cooling: 'liquid' }),
  e('Triumph', 'Scrambler 400 X', 'dual-sport', 2023, { cc: 398, aliases: ['scrambler 400x', 'scrambler400x', 'scrambler 400'], cooling: 'liquid' }),
  e('Triumph', 'Street Triple', 'naked', 2008, { aliases: ['street triple r', 'street triple rs'], cooling: 'liquid' }),
  // Harley-Davidson
  e('Harley-Davidson', 'Street 750', 'cruiser', 2014, { cc: 749, to: 2020, drive: 'belt', aliases: ['street750'], cooling: 'liquid' }),
  e('Harley-Davidson', 'X440', 'cruiser', 2023, { cc: 440, aliases: ['x 440', 'hd x440'] }),
  e('Harley-Davidson', 'Iron 883', 'cruiser', 2009, { cc: 883, to: 2020, drive: 'belt', aliases: ['iron883', 'sportster iron'] }),
  // Ducati
  e('Ducati', 'Monster', 'naked', 1993, { aliases: ['monster 821', 'monster 937', 'monster 797'], market: 'GLOBAL', cooling: 'unknown' }),
  e('Ducati', 'Scrambler Icon', 'naked', 2015, { aliases: ['scrambler', 'icon'], market: 'GLOBAL' }),
  // Aprilia
  e('Aprilia', 'SR 160', 'scooter', 2020, { aliases: ['sr160', 'aprilia sr'] }),
  e('Aprilia', 'RS 457', 'sport', 2024, { cc: 457, aliases: ['rs457'], cooling: 'liquid' }),
  // Benelli
  e('Benelli', 'Imperiale 400', 'cruiser', 2019, { cc: 374, aliases: ['imperiale'] }),
  e('Benelli', 'TRK 502', 'adventure', 2018, { cc: 500, aliases: ['trk502', 'trk 502x'], cooling: 'liquid' }),
  // Jawa / Yezdi
  e('Jawa', '42', 'cruiser', 2018, { aliases: ['jawa 42', 'jawa42'] }),
  e('Jawa', 'Perak', 'cruiser', 2019, { aliases: ['jawa perak'] }),
  e('Yezdi', 'Roadster', 'cruiser', 2022, { aliases: ['yezdi road'] }),
  e('Yezdi', 'Adventure', 'adventure', 2022, { aliases: ['yezdi adv'] }),
  // CFMoto
  e('CFMoto', '300 SR', 'sport', 2022, { aliases: ['300sr', 'cf moto 300sr'], cooling: 'liquid' }),
  e('CFMoto', '650 MT', 'adventure', 2022, { aliases: ['650mt'], cooling: 'liquid' }),
  // Electric
  e('Ather', '450X', 'electric-scooter', 2020, { aliases: ['450x', 'ather 450'] }),
  e('Ola Electric', 'S1 Pro', 'electric-scooter', 2021, { aliases: ['s1pro', 'ola s1', 'ola s1 pro'] }),
  e('Ola Electric', 'S1 Air', 'electric-scooter', 2022, { aliases: ['s1air', 'ola s1 air'] }),
];
