// Движок боя AniMatrix. Правила взяты из описания классов и логов боя.
// Работает и в браузере (window.AniEngine), и в Node (тесты).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AniEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CLASSES = ['Дамагер', 'Танк', 'Саппорт', 'Гибрид'];
  const RANKS = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];

  // Настройки по умолчанию: множители из таблицы игрока, лимит 10 ходов на двоих со слов игрока.
  const DEFAULTS = {
    maxMoves: 10,
    runs: 400,
    formula: {
      'Дамагер': { bm: 3, hp: 1 },
      'Танк': { bm: 5, hp: 1 },
      'Саппорт': { bm: 5, hp: 1.15 },
      'Гибрид': { bm: 4, hp: 1 },
    },
  };

  const DODGE = {
    'Дамагер': [0.08, 0.12],
    'Танк': [0.05, 0.10],
    'Саппорт': [0.10, 0.20],
    'Гибрид': [0.10, 0.10],
  };

  const randomDice = {
    chance: (_tag, p) => Math.random() < p,
    between: (_tag, a, b) => a + Math.random() * (b - a),
  };

  function makeFighter(hero) {
    return {
      name: hero.name,
      cls: hero.cls,
      bm: hero.bm,
      hp: hero.hp,
      maxHp: hero.hp,
      moves: 0,
      healFactor: 1,   // снижается, когда танк поглощает удар этого бойца
      blockNext: false, // 10% БМ заблокировано на следующий удар
    };
  }

  function heal(f, percent) {
    f.hp = Math.min(f.maxHp, f.hp + f.maxHp * percent * f.healFactor);
  }

  // Поглощение цели. Срабатывает и на отражённый урон: в логе Рюк поглотил часть отражения.
  function absorb(target, attacker, dmg, dice) {
    if (target.cls === 'Танк' && dice.chance('absorb', 0.40)) {
      attacker.healFactor = 0.7;
      return dmg * 0.7;
    }
    if (target.cls === 'Гибрид' && dice.chance('absorb', 0.30)) return dmg * 0.65;
    return dmg;
  }

  // Один удар: уклонение, поглощение, урон и реакция цели.
  // reactions = false для контрудара, чтобы ответы не шли по кругу.
  function strike(attacker, target, raw, dice, reactions) {
    const dodge = dice.between('dodgeValue', DODGE[target.cls][0], DODGE[target.cls][1]);
    if (dice.chance('dodge', dodge)) return false;

    target.hp -= absorb(target, attacker, raw, dice);
    if (target.hp <= 0 || !reactions) return true;

    if (target.cls === 'Гибрид' && dice.chance('reflect', 0.20)) {
      // Отражается 30% от урона до поглощения: 29к от удара 95.6к в логе Арахабаки.
      attacker.hp -= absorb(attacker, target, raw * 0.3, dice);
    } else if (target.cls === 'Танк' && dice.chance('counter', 0.35)) {
      strike(target, attacker, target.bm * 0.8, dice, false);
    } else if (target.cls === 'Саппорт' && dice.chance('supportHit', 0.25)) {
      heal(target, 0.08);
      attacker.blockNext = true;
    }
    return true;
  }

  function takeMove(a, d, dice) {
    a.moves += 1;

    // Лечение идёт перед ударом каждый второй свой ход: в логе Карл Фрица ход 3.
    if (a.cls === 'Саппорт' && a.moves % 2 === 0) {
      heal(a, dice.between('heal', 0.08, 0.12));
    }

    let raw = a.bm;
    if (a.blockNext) { raw *= 0.9; a.blockNext = false; }
    if (a.cls === 'Дамагер' && dice.chance('crit', 0.35)) raw *= 2;
    if (a.cls === 'Гибрид' && dice.chance('power', 0.20)) raw *= dice.between('powerValue', 1.6, 1.9);

    const hit = strike(a, d, raw, dice, true);

    // Повторный удар всегда от базовых 50% БМ, без крита: 1.3к при БМ 2.6к в логе Ифрита.
    if (hit && a.hp > 0 && d.hp > 0 && a.cls === 'Дамагер' && dice.chance('repeat', 0.20)) {
      strike(a, d, a.bm * 0.5, dice, true);
    }
  }

  // Возвращает 1, если победил первый герой, 0 — второй, 0.5 — ничья.
  // Первый герой — нападающий. onMove нужен тестам, чтобы сверять ЖВ после каждого хода.
  function fight(heroA, heroB, opts) {
    const o = opts || {};
    const dice = o.dice || randomDice;
    const maxMoves = o.maxMoves || DEFAULTS.maxMoves;
    const a = makeFighter(heroA);
    const b = makeFighter(heroB);

    for (let move = 1; move <= maxMoves; move++) {
      const attacking = move % 2 === 1 ? a : b;
      const defending = move % 2 === 1 ? b : a;
      takeMove(attacking, defending, dice);
      if (o.onMove) o.onMove(move, a.hp, b.hp);
      if (a.hp <= 0 || b.hp <= 0) break;
    }

    if (a.hp <= 0 && b.hp <= 0) return 0.5;
    if (b.hp <= 0) return 1;
    if (a.hp <= 0) return 0;
    if (a.hp === b.hp) return 0.5;
    return a.hp > b.hp ? 1 : 0;
  }

  // Бой без навыков: нет уклонений и срабатываний по шансу. Остаётся только лечение
  // саппорта каждый второй ход, оно гарантировано и берётся по среднему значению 10%.
  const plainDice = {
    chance: () => false,
    between: (tag, a, b) => (tag === 'heal' ? (a + b) / 2 : a),
  };

  function plainFight(heroA, heroB, maxMoves) {
    let hpA = heroA.hp;
    let hpB = heroB.hp;
    let moves = 0;
    const result = fight(heroA, heroB, {
      dice: plainDice,
      maxMoves,
      onMove(move, a, b) { moves = move; hpA = a; hpB = b; },
    });
    return { result, moves, hpA: Math.max(0, hpA), hpB: Math.max(0, hpB) };
  }

  // Шанс победы A над B при нападении A.
  function duel(heroA, heroB, runs, opts) {
    let wins = 0;
    for (let i = 0; i < runs; i++) wins += fight(heroA, heroB, opts);
    return wins / runs;
  }

  function hashString(text) {
    let hash = 5381;
    for (const ch of text) hash = ((hash * 33) ^ ch.codePointAt(0)) >>> 0;
    return hash;
  }

  // Кубики с зерном (mulberry32): одно зерно всегда даёт одну и ту же серию бросков.
  function seededDice(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      chance: (_tag, p) => next() < p,
      between: (_tag, a, b) => a + next() * (b - a),
    };
  }

  // Результат пары зависит только от её статов. Так у героев с теми же статами шанс не
  // меняется от сезона к сезону, и места сдвигаются из-за новых героев, а не из-за случайности.
  function createPairRates() {
    const cache = new Map();
    return (heroA, heroB, runs, maxMoves) => {
      const key = `${heroA.cls}:${heroA.bm}:${heroA.hp}|${heroB.cls}:${heroB.bm}:${heroB.hp}|${runs}|${maxMoves}`;
      if (!cache.has(key)) {
        cache.set(key, duel(heroA, heroB, runs, { maxMoves, dice: seededDice(hashString(key)) }));
      }
      return cache.get(key);
    };
  }

  // Очки быстрой оценки. Сравнение «N×БМ₁ − ЖВ₂ против N×БМ₂ − ЖВ₁» равно сравнению N×БМ + ЖВ.
  function formulaScore(hero, formula) {
    const f = (formula || DEFAULTS.formula)[hero.cls];
    return f.bm * hero.bm + f.hp * hero.hp;
  }

  // Рост характеристик из логов: +30% от базы за уровень, скин (🎭) даёт +15%.
  function levelFactor(level, hasSkin) {
    return (1 + 0.3 * (level - 1)) * (hasSkin ? 1.15 : 1);
  }

  // Прирост за уровень округляется вниз, поэтому у слабых рангов база ищется подбором:
  // Сайпер 3505 на 45 ур. — это база 249 и прирост 74 за уровень.
  function toBase(value, level, hasSkin) {
    const estimate = Math.round(value / levelFactor(level, hasSkin));
    if (hasSkin || level <= 1) return estimate;
    for (const shift of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const base = estimate + shift;
      if (base + (level - 1) * Math.floor((base * 3) / 10) === value) return base;
    }
    return estimate;
  }

  const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10);

  function normalizeClass(text) {
    return CLASSES.find((c) => text.includes(c)) || null;
  }

  const CATALOG_RANK = /РАНГ\s+([A-ZА-Я]+)\s*\((\d+)\)/iu;
  const CATALOG_HERO = /^(?:\d+[.)]\s*)?(.+?):?\s*[^\p{L}\d)]*БМ\s*(\d[\d,.\s]*\d|\d)\D.*?ЖВ\s*(\d[\d,.\s]*\d|\d)\D.*?(Дамагер|Танк|Саппорт|Гибрид)/u;
  const BATTLE_LINE = /атакует|Нанёс|Промах|Победа|Отражение|поглотил|восстановил/;
  // Списки ивент-тайтлов: ранг в скобках у каждого героя, а тайтл строкой выше списка.
  // «1. Адам Смэшер (S): 💥 15,850, ❤️ 43,100, 🔥 Дамагер»
  const LISTED_HERO = /^(?:\d+[.)]\s*)?(.+?)\s*\(([A-ZА-Я]{1,3})\)\s*:?\s*[^\p{L}\d]*(?:БМ\s*)?(\d[\d,.\s]*\d|\d)\D.*?(\d[\d,.\s]*\d|\d)\D.*?(Дамагер|Танк|Саппорт|Гибрид)/u;

  // Ранг могут набрать похожими русскими буквами: «В» и «С» вместо B и C.
  const latinRank = (rank) => rank.toUpperCase().replace(/[АВСЕ]/g, (c) => ({ А: 'A', В: 'B', С: 'C', Е: 'E' }[c]));

  // Строка списка с рангом в скобках. Скобки с другим текстом относятся к имени героя.
  function matchListed(line) {
    const m = line.match(LISTED_HERO);
    return m && RANKS.includes(latinRank(m[2])) ? m : null;
  }

  // Сколько героев каталог объявляет на каждом ранге: «РАНГ SSS(8)» → {SSS: 8}.
  function catalogCounts(text) {
    const counts = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(CATALOG_RANK);
      if (m) counts[latinRank(m[1])] = parseInt(m[2], 10);
    }
    return counts;
  }

  // Чего не хватает в строке, похожей на героя.
  function lineProblem(line) {
    const missing = [];
    if (!/БМ\s*\d/.test(line)) missing.push('БМ');
    if (!/ЖВ\s*\d/.test(line)) missing.push('ЖВ');
    if (!normalizeClass(line)) missing.push('класс');
    return missing.length ? `Нет: ${missing.join(', ')}` : 'Строка написана не так, как в каталоге';
  }

  // Разбирает сообщения бота построчно: каталог, карты обоих видов и блоки героев из логов боя.
  // Для каждой строки возвращает статус: ok, dup, bad, header, part (часть карты) или empty.
  // Тайтл из поля формы подставляется героям, у которых своего тайтла в тексте нет.
  function parseDetailed(text, defaultTitle) {
    const heroes = [];
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const marks = lines.map(() => ({ status: 'empty' }));
    const gaps = [];
    const seen = new Map();
    const hasCards = lines.some((l) => /🧩/.test(l));
    const add = (hero, index) => {
      if (!hero.title && defaultTitle) hero.title = defaultTitle;
      const key = `${hero.name}|${hero.rank}|${hero.bm}|${hero.hp}`;
      if (seen.has(key)) {
        marks[index] = { status: 'dup', reason: `Повтор строки ${seen.get(key) + 1}, герой уже учтён` };
        return;
      }
      seen.set(key, index);
      heroes.push(hero);
      marks[index] = { status: 'ok', hero };
    };
    let catalogRank = '';
    let lastNumber = 0;
    let listTitle = '';
    let listedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (marks[i].status === 'part' || !lines[i] || /^[—–\-_=\s]+$/.test(lines[i])) continue;

      const listed = matchListed(lines[i]);
      if (listed) {
        listedCount += 1;
        add({
          name: listed[1].trim(), bm: num(listed[3]), hp: num(listed[4]), rank: latinRank(listed[2]), cls: listed[5], title: listTitle,
        }, i);
        continue;
      }

      const nextLine = lines.slice(i + 1).find((l) => l && !/^[—–\-_=\s]+$/.test(l));
      if (nextLine && matchListed(nextLine) && !/🧩/.test(lines[i])) {
        listTitle = lines[i].replace(/^[^\p{L}\d]+/u, '').trim();
        marks[i] = { status: 'title', reason: `Тайтл ${listTitle}` };
        continue;
      }

      const rankHeader = lines[i].match(CATALOG_RANK);
      if (rankHeader) {
        catalogRank = latinRank(rankHeader[1]);
        lastNumber = 0;
        marks[i] = { status: 'header', reason: `Ранг ${catalogRank}` };
        continue;
      }

      const numbered = lines[i].match(/^(\d+)[.)]/);
      if (numbered && catalogRank) {
        const number = parseInt(numbered[1], 10);
        if (number > lastNumber + 1) gaps.push({ rank: catalogRank, from: lastNumber + 1, to: number - 1 });
        lastNumber = number;
      }

      const row = lines[i].match(CATALOG_HERO);
      if (row && catalogRank) {
        add({ name: row[1].trim(), bm: num(row[2]), hp: num(row[3]), rank: catalogRank, cls: row[4], title: '' }, i);
        continue;
      }
      if (row) {
        marks[i] = { status: 'bad', reason: 'Выше нет строки с рангом, например «РАНГ SSS(8)»' };
        continue;
      }

      const nameMatch = lines[i].match(/🧩\s*(.+)$/);
      if (!nameMatch) {
        const looksLikeHero = /БМ|ЖВ|💥|❤/.test(lines[i]) || (numbered && !hasCards);
        if (looksLikeHero && !hasCards && !BATTLE_LINE.test(lines[i])) {
          marks[i] = { status: 'bad', reason: lineProblem(lines[i]) };
        }
        continue;
      }

      const hero = { name: nameMatch[1].trim(), bm: 0, hp: 0, rank: '', cls: '', title: '' };
      let level = 1;
      let hasSkin = false;

      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const line = lines[j];
        if (/🧩|Схватка|История|👑|💢|атакует|НОВЫЙ/.test(line) || CATALOG_RANK.test(line) || CATALOG_HERO.test(line)) break;
        marks[j] = { status: 'part' };
        if (/🎭/.test(line)) hasSkin = true;
        const inline = line.match(/💥\s*([\d,\s]+?)\s*×\s*❤️?\s*([\d,\s]+)/);
        if (inline) { hero.bm = num(inline[1]); hero.hp = num(inline[2]); continue; }
        const bm = line.match(/💥\s*([\d,]+)/);
        if (bm) hero.bm = num(bm[1]);
        const hp = line.match(/❤️?\s*([\d,]+)/);
        if (hp) hero.hp = num(hp[1]);
        const rank = line.match(/📯\s*([A-Z]+)-Ранг/);
        if (rank) hero.rank = rank[1];
        const lvl = line.match(/🧬\s*(\d+)\s*ур/);
        if (lvl) level = parseInt(lvl[1], 10);
        const cls = normalizeClass(line);
        if (cls) hero.cls = cls;
        const title = line.match(/🥡\s*(.+)$/);
        if (title) hero.title = title[1].trim();
        // Во втором виде карт тайтл идёт отдельной строкой после класса, с символом ┗/└.
        if (!title && hero.cls && !cls && /^[└┗]/.test(line) && !hero.title) {
          hero.title = line.replace(/^[└┗]\s*/, '').replace(/^\S*🥡\S*\s*/, '').trim();
        }
      }

      if (!hero.bm || !hero.hp || !hero.rank || !hero.cls) {
        const missing = [];
        if (!hero.bm) missing.push('БМ');
        if (!hero.hp) missing.push('ЖВ');
        if (!hero.rank) missing.push('ранг');
        if (!hero.cls) missing.push('класс');
        marks[i] = { status: 'bad', reason: `В карте нет: ${missing.join(', ')}` };
        continue;
      }
      if (level > 1 || hasSkin) {
        hero.bm = toBase(hero.bm, level, hasSkin);
        hero.hp = toBase(hero.hp, level, hasSkin);
      }
      if (hasSkin) hero.skin = true;
      add(hero, i);
    }
    return { heroes, lines: marks, gaps, listedCount };
  }

  const parseMessages = (text, defaultTitle) => parseDetailed(text, defaultTitle).heroes;

  const NO_TITLE = 'Без тайтла';
  const SKIN_BONUS = 1.15;

  const normName = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  // Обрезанное имя из таблицы («Имир Фриц Тита…») считается тем же героем, что и полное.
  function sameName(a, b) {
    const x = normName(a);
    const y = normName(b);
    if (x === y) return true;
    if (x.endsWith('…')) return y.startsWith(x.slice(0, -1));
    if (y.endsWith('…')) return x.startsWith(y.slice(0, -1));
    return false;
  }

  function titleDocId(title) {
    return 't-' + hashString(title).toString(36);
  }

  // Места без пропусков: равные делят место, следующий получает номер на единицу больше (1, 1, 2, 3, 3, 4).
  function sharedPlaces(order, isSame) {
    const places = new Map();
    let place = 0;
    order.forEach((hero, i) => {
      if (i === 0 || !isSame(order[i - 1], hero)) place += 1;
      places.set(hero.key, place);
    });
    return places;
  }

  // Находит героев в прошлом сезоне. Сначала ищет в том же тайтле: в разных аниме бывают тёзки
  // одного ранга. Если там нет, герой мог переехать, поэтому подходит ещё не занятый тёзка.
  function matchSeason(current, old) {
    const byRank = new Map();
    old.forEach((o) => byRank.set(o.rank, [...(byRank.get(o.rank) || []), o]));
    const free = new Set(old);
    const found = new Map();
    const take = (hero, fits) => {
      const match = (byRank.get(hero.rank) || []).find((o) => free.has(o) && sameName(o.name, hero.name) && fits(o));
      if (!match) return;
      free.delete(match);
      found.set(hero, match);
    };
    current.forEach((hero) => take(hero, (o) => normName(o.title) === normName(hero.title)));
    current.forEach((hero) => { if (!found.has(hero)) take(hero, () => true); });
    return found;
  }

  // Версия героя со скином: отдельная строка топа с +15%, места других героев она не занимает.
  function skinVersion(hero) {
    // Поправка нужна для половин: 52250 × 1.15 в дробных числах даёт 60087.49999, а должно округлиться до 60088.
    const boost = (value) => Math.round(value * SKIN_BONUS + 1e-6);
    return {
      ...hero,
      bm: boost(hero.bm),
      hp: boost(hero.hp),
      isSkin: true,
      baseKey: hero.key,
      key: `${hero.key}~skin`,
    };
  }

  // Вставляет строки вне нумерации в порядок топа. extras идут от сильных к слабым, slotOf даёт
  // номер обычного героя, перед которым строка встаёт по силе. Скин даёт всем одинаковые +15%,
  // поэтому версии со скином идут в порядке своих базовых героев: те же строки таблицы,
  // но кто на какой стоит, решает топ без скинов.
  function seatOffTop(order, extras, slotOf) {
    const baseIndex = new Map(order.map((h, i) => [h.key, i]));
    const hasBase = (h) => baseIndex.has(h.baseKey);
    const byBase = extras.filter(hasBase).sort((a, b) => baseIndex.get(a.baseKey) - baseIndex.get(b.baseKey));
    const slots = byBase.map(slotOf).sort((a, b) => a - b);
    const seat = new Map(byBase.map((h, i) => [h.key, slots[i]]));
    let next = 0;
    const lineup = extras.map((h) => (hasBase(h) ? byBase[next++] : h));
    const slotFor = (h) => (seat.has(h.key) ? seat.get(h.key) : slotOf(h));
    const merged = [];
    for (let i = 0; i <= order.length; i++) {
      merged.push(...lineup.filter((h) => slotFor(h) === i));
      if (i < order.length) merged.push(order[i]);
    }
    return merged;
  }

  // Порядок тайтлов: по алфавиту, числу героев или дате. По дате dir = 1 ставит сверху новые,
  // dir = -1 старые. Тайтлы без даты всегда в конце, а внутри одной даты порядок задаёт
  // position, который меняется перетаскиванием.
  function sortTitles(docs, mode, dir) {
    const sign = dir === -1 ? -1 : 1;
    const alpha = (a, b) => String(a.title).localeCompare(String(b.title), 'ru');
    const count = (d) => (d.heroes || []).length;
    const position = (d) => (typeof d.position === 'number' ? d.position : Infinity);
    return [...docs].sort((a, b) => {
      if (mode === 'count') return ((count(b) - count(a)) * sign) || alpha(a, b);
      if (mode === 'date') {
        const dateA = String(a.addedAt || '');
        const dateB = String(b.addedAt || '');
        if (dateA !== dateB) {
          if (!dateA) return 1;
          if (!dateB) return -1;
          return dateB.localeCompare(dateA) * sign;
        }
        const pa = position(a);
        const pb = position(b);
        return (pa === pb ? 0 : pa - pb) || alpha(a, b);
      }
      return alpha(a, b) * sign;
    });
  }

  // Что поменять, чтобы тайтл встал на новое место в списке по дате. Дата меняется, только если
  // иначе тайтл не удержится между соседями, а position пересчитывается внутри его даты.
  function planTitleMove(sorted, id, toIndex, dir) {
    const moved = sorted.find((d) => d.id === id);
    const list = sorted.filter((d) => d.id !== id);
    const index = Math.max(0, Math.min(toIndex, list.length));
    const prev = list[index - 1];
    const next = list[index];
    const dateOf = (d) => (d && d.addedAt) || '';
    // Может ли дата first стоять в списке раньше даты second или рядом с ней.
    const inOrder = (first, second) => {
      if (first === second || !second) return true;
      if (!first) return false;
      return dir === -1 ? first < second : first > second;
    };
    let date = dateOf(moved);
    const fits = (!prev || inOrder(dateOf(prev), date)) && (!next || inOrder(date, dateOf(next)));
    if (!fits) date = prev ? dateOf(prev) : dateOf(next);
    list.splice(index, 0, moved);

    const changes = [];
    let position = 0;
    list.forEach((doc) => {
      const isMoved = doc.id === id;
      if ((isMoved ? date : dateOf(doc)) !== date) return;
      const fields = {};
      if (doc.position !== position) fields.position = position;
      if (isMoved && date !== dateOf(moved)) fields.addedAt = date || null;
      if (Object.keys(fields).length) changes.push({ id: doc.id, fields });
      position += 1;
    });
    return changes;
  }

  const cloneDocs = (titles) => titles.map((t) => ({ ...t, heroes: (t.heroes || []).map((h) => ({ ...h })) }));

  // Что станет с базой после добавления героев. Точная копия не добавляется нигде,
  // даже если список вставили под другим тайтлом. Статы обновляются только внутри
  // своего тайтла: герой с тем же именем из другого аниме считается отдельным.
  function planImport(titles, parsed) {
    const docs = cloneDocs(titles);
    const changed = new Set();
    const counts = { added: 0, updated: 0, skipped: 0, moved: 0 };
    const used = new Set();

    const docFor = (title) => {
      let doc = docs.find((d) => normName(d.title) === normName(title));
      if (!doc) { doc = { id: titleDocId(title), title, heroes: [] }; docs.push(doc); }
      return doc;
    };
    const moveTo = (from, hero, title) => {
      from.heroes.splice(from.heroes.indexOf(hero), 1);
      const target = docFor(title);
      target.heroes.push(hero);
      changed.add(from);
      changed.add(target);
    };

    parsed.forEach((p) => {
      const title = p.title || NO_TITLE;
      const candidates = [];
      docs.forEach((doc) => doc.heroes.forEach((hero) => {
        if (!used.has(hero) && hero.rank === p.rank && sameName(hero.name, p.name)) candidates.push({ doc, hero });
      }));
      const isExact = (c) => c.hero.bm === p.bm && c.hero.hp === p.hp;
      const inSameTitle = (c) => normName(c.doc.title) === normName(title) || c.doc.title === NO_TITLE || title === NO_TITLE;
      const exact = candidates.find(isExact);
      const match = exact || candidates.find(inSameTitle);

      if (!match) {
        const doc = docFor(title);
        const fresh = { name: p.name, bm: p.bm, hp: p.hp, rank: p.rank, cls: p.cls };
        if (p.skin) fresh.skin = true;
        if (p.event) fresh.event = true;
        doc.heroes.push(fresh);
        used.add(fresh);
        changed.add(doc);
        counts.added += 1;
        return;
      }

      const { doc, hero } = match;
      used.add(hero);
      if (normName(hero.name).endsWith('…') && !normName(p.name).endsWith('…')) { hero.name = p.name; changed.add(doc); }
      if (p.skin && !hero.skin) { hero.skin = true; changed.add(doc); }
      if (p.event && !hero.event) { hero.event = true; changed.add(doc); }

      if (exact) counts.skipped += 1;
      else {
        hero.bm = p.bm;
        hero.hp = p.hp;
        hero.cls = p.cls;
        changed.add(doc);
        counts.updated += 1;
      }
      if (doc.title === NO_TITLE && title !== NO_TITLE) {
        moveTo(doc, hero, title);
        counts.moved += 1;
      }
    });

    const list = [...changed];
    return {
      ...counts,
      writes: list.filter((d) => d.heroes.length),
      deletes: list.filter((d) => !d.heroes.length),
    };
  }

  // Убирает точные копии: то же имя, ранг и статы. Остаётся копия с тайтлом и полным именем,
  // скин и место из таблицы переходят к ней.
  function removeDuplicates(titles) {
    const docs = cloneDocs(titles);
    const changed = new Set();
    let removed = 0;
    const score = (e) => (e.doc.title === NO_TITLE ? 0 : 2) + (normName(e.hero.name).endsWith('…') ? 0 : 1);
    const entries = [];
    docs.forEach((doc) => doc.heroes.forEach((hero) => entries.push({ doc, hero })));
    entries.sort((a, b) => score(b) - score(a));

    const buckets = new Map();
    entries.forEach((e) => {
      const key = `${e.hero.rank}|${e.hero.bm}|${e.hero.hp}`;
      if (!buckets.has(key)) buckets.set(key, []);
      const bucket = buckets.get(key);
      const keeper = bucket.find((k) => sameName(k.hero.name, e.hero.name));
      if (!keeper) { bucket.push(e); return; }
      if (e.hero.skin) keeper.hero.skin = true;
      if (e.hero.event) keeper.hero.event = true;
      if (e.hero.myPlace && !keeper.hero.myPlace) keeper.hero.myPlace = e.hero.myPlace;
      changed.add(keeper.doc);
      e.doc.heroes.splice(e.doc.heroes.indexOf(e.hero), 1);
      changed.add(e.doc);
      removed += 1;
    });

    const list = [...changed];
    return { removed, writes: list.filter((d) => d.heroes.length), deletes: list.filter((d) => !d.heroes.length) };
  }

  // ---------- Выгрузка топа для Telegram ----------

  const CLASS_ICONS = { 'Дамагер': '🔥', 'Танк': '🛡', 'Саппорт': '☘️', 'Гибрид': '☯️' };
  const CLASS_GENITIVE = { 'Дамагер': 'Дамагеров', 'Танк': 'Танков', 'Саппорт': 'Саппортов', 'Гибрид': 'Гибридов' };
  const CLASS_PLURAL = { 'Дамагер': 'Дамагеры', 'Танк': 'Танки', 'Саппорт': 'Саппорты', 'Гибрид': 'Гибриды' };
  const SKIN_MARK = '🎭';
  const EVENT_MARK = '🎎';
  // В сообщении Telegram до 4096 знаков, запас оставлен на правки перед отправкой.
  const MESSAGE_LIMIT = 4000;
  const ARTICLE_LIMIT = 30000;

  const groupNumber = (n) => Math.round(n).toLocaleString('en-US');

  // Заголовок как в статьях игрока: «Топ 🔥Дамагеров SSS-Ранга.» или «Топ 🔥Дамагеров F-S рангов».
  function exportTitle(cls, ranks) {
    const head = `Топ ${CLASS_ICONS[cls]}${CLASS_GENITIVE[cls]}`;
    if (ranks.length === 1) return `${head} ${ranks[0]}-Ранга.`;
    const ordered = RANKS.filter((r) => ranks.includes(r));
    const first = RANKS.indexOf(ordered[0]);
    const solid = ordered.every((r, i) => RANKS.indexOf(r) === first + i);
    const list = solid ? `${ordered[ordered.length - 1]}-${ordered[0]}` : [...ordered].reverse().join(', ');
    return `${head} ${list} рангов`;
  }

  const exportCaption = (cls, rank) => `Лучшие ${rank}-Ранг ${CLASS_ICONS[cls]} ${CLASS_PLURAL[cls]}.`;

  const winsText = (row) => (row.wins === null || row.wins === undefined ? '🏆 —' : `🏆 ${(row.wins * 100).toFixed(1)}%`);

  // Ячейки одной строки: место со сдвигом или значок, герой, БМ, ЖВ, доля побед, тайтл.
  function exportCells(row) {
    const place = row.shift ? `${row.place} ${row.shift}` : String(row.place);
    return [place, row.name, `💥 БМ ${groupNumber(row.bm)}`, `❤️ ЖВ ${groupNumber(row.hp)}`, winsText(row), row.title || ''];
  }

  function exportLine(row) {
    const [, name, bm, hp, wins, title] = exportCells(row);
    const mark = typeof row.place === 'number' ? `${row.place}.` : row.place;
    return `${mark}${row.shift ? ` ${row.shift}` : ''} ${name} — ${bm} ${hp} ${wins}${title ? ` — ${title}` : ''}`;
  }

  // Оставляет первые count мест. Герои с общим местом не разделяются, а строки без номера
  // остаются, только если стоят выше последнего выбранного места.
  function limitPlaces(rows, count) {
    if (!count) return rows;
    let last = -1;
    let cut = false;
    rows.forEach((row, i) => {
      if (typeof row.place !== 'number') return;
      if (row.place <= count) last = i;
      else cut = true;
    });
    return cut ? rows.slice(0, last + 1) : rows;
  }

  // Строка над таблицей. Значки объясняются, только если они есть в выгрузке.
  function exportNote(sections, info) {
    const rows = sections.flatMap((s) => s.rows);
    const parts = [];
    parts.push(info.seasonName ? `Сезон «${info.seasonName}», сохранён ${info.date}.` : `Обновлено ${info.date}.`);
    parts.push(`Статы на 1 уровне, ${info.plain ? 'навыки не учтены' : 'учтены навыки'}.`);
    if (rows.some((r) => r.wins !== null && r.wins !== undefined)) {
      parts.push('🏆 доля побед против героев этого ранга и класса.');
      if (info.plain) parts.push('Без навыков она считается по одному точному бою за каждую сторону: часто исход решает первый удар, а не большой перевес в силе.');
    }
    // Близких героев порядок ставит формула, поэтому сосед ниже может иметь чуть больший процент.
    const inverted = sections.some((s) => {
      const places = s.rows.filter((r) => typeof r.place === 'number');
      return places.some((r, i) => i > 0 && r.wins > places[i - 1].wins);
    });
    if (inverted) parts.push(info.plain ? 'Места идут по очкам формулы, поэтому проценты могут идти не по убыванию.' : 'При почти равных процентах порядок решают очки формулы.');
    if (rows.some((r) => r.shift)) parts.push(`▲▼ сдвиг места относительно сезона «${info.compareName}», 🆕 новый герой.`);
    const marks = [];
    if (rows.some((r) => r.place === SKIN_MARK)) marks.push(`${SKIN_MARK} скин (+15%)`);
    if (rows.some((r) => r.place === EVENT_MARK)) marks.push(`${EVENT_MARK} ивент-карта`);
    if (marks.length) parts.push(`${marks.join(', ')}: стоят по силе, но без номера места.`);
    const skinsInverted = sections.some((s) => {
      const skins = s.rows.filter((r) => r.place === SKIN_MARK);
      return skins.some((r, i) => i > 0 && r.wins > skins[i - 1].wins);
    });
    if (skinsInverted) parts.push(`${SKIN_MARK} идут в порядке тех же героев без скина, а их 🏆 посчитан против героев без скина, поэтому проценты могут идти не по убыванию.`);
    return parts.join(' ');
  }

  // Текст для обычных сообщений: длинный топ делится на части по целым строкам.
  function exportMessages(cls, sections, options) {
    const { limit, note } = options || {};
    const max = limit || MESSAGE_LIMIT;
    const title = exportTitle(cls, sections.map((s) => s.rank));
    const parts = [];
    let current = note ? `${title}\n${note}` : title;
    const add = (chunk, caption) => {
      if (current.length + chunk.length > max) {
        parts.push(current);
        current = `${title} (продолжение)${caption ? `\n\n${caption}` : ''}`;
      }
      current += chunk;
    };
    sections.forEach((section) => {
      const caption = exportCaption(cls, section.rank);
      section.rows.forEach((row, i) => {
        // Подпись ранга идёт вместе с первым героем, чтобы не остаться в конце сообщения одна.
        if (i === 0) add(`\n\n${caption}\n${exportLine(row)}`, '');
        else add(`\n${exportLine(row)}`, caption);
      });
    });
    parts.push(current);
    return parts;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Разметка для вставки в статью Telegram: заголовок, подпись и таблица на каждый ранг.
  // Редактор убирает классы и стили, поэтому здесь только простые теги.
  function exportHtml(cls, sections, note, collapsible) {
    const tables = sections.map((section) => {
      const rows = section.rows.map((row) => `<tr>${exportCells(row).map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
      const body = `<table><caption>${escapeHtml(exportCaption(cls, section.rank))}</caption><tbody>${rows}</tbody></table>`;
      const label = `${section.rank}-ранг`;
      return collapsible ? `<details><summary>${label}</summary>${body}</details>` : `<h2>${label}</h2>${body}`;
    });
    const intro = note ? `<p>${escapeHtml(note)}</p>` : '';
    return `<h1>${escapeHtml(exportTitle(cls, sections.map((s) => s.rank)))}</h1>${intro}${tables.join('')}`;
  }

  // Делит топ на статьи целыми рангами: в одном сообщении Telegram до 32 768 знаков.
  function exportArticles(cls, sections, limit) {
    const max = limit || ARTICLE_LIMIT;
    const parts = [];
    let current = [];
    let used = 0;
    sections.forEach((section) => {
      const size = exportMessages(cls, [section], { limit: Infinity })[0].length;
      if (current.length && used + size > max) {
        parts.push(current);
        current = [];
        used = 0;
      }
      current.push(section);
      used += size;
    });
    parts.push(current);
    return parts;
  }

  // ---------- Расчёт группы: общий для страницы и сборки сайта ----------

  function deriveHeroes(docs) {
    return docs.flatMap((t) => (t.heroes || []).map((h) => ({
      ...h,
      title: t.title,
      titleId: t.id,
      baseBm: h.bm,
      baseHp: h.hp,
      key: `${t.id}~${h.name}|${h.rank}|${h.bm}|${h.hp}`,
    })));
  }

  // Номера мест получают только обычные герои. Ивент-карты и версии со скином идут вне нумерации.
  const numberedHeroes = (group) => group.filter((h) => !h.event);
  const offTopHeroes = (group) => [...group.filter((h) => h.event), ...group.filter((h) => h.skin).map(skinVersion)];

  function groupCacheKey(group, maxMoves, mode, runs) {
    return [mode, runs, maxMoves,
      group.map((h) => `${h.key}:${h.bm}:${h.hp}:${h.skin ? 1 : 0}:${h.event ? 1 : 0}`).sort().join('^')].join('#');
  }

  // Маленькие группы считаются точнее: при 500 боях близких героев путает случайность.
  // Бюджет ограничивает время: до 5 млн боёв на топ и до 20 млн на спор при равных очках.
  const RUN_TIERS = [20000, 10000, 5000, 2000, 1000];
  function runsForGroup(size, mode, minRuns) {
    const budget = mode === 'tiebreak' ? 20000000 : 5000000;
    const fits = RUN_TIERS.find((runs) => runs * size * (size - 1) <= budget) || 0;
    return Math.max(minRuns, fits);
  }

  // Есть ли герои с разными статами и равными очками: без навыков их не различить.
  function hasEqualScores(group, formula) {
    const seen = new Map();
    return group.some((h) => {
      const p = Math.round(formulaScore(h, formula) * 1e3);
      const other = seen.get(p);
      if (other && (other.bm !== h.bm || other.hp !== h.hp)) return true;
      seen.set(p, h);
      return false;
    });
  }

  // Строка вне нумерации бьётся с обычными героями, кроме своей версии без скина.
  // В расчёт других героев она не входит, поэтому их места от неё не меняются.
  function offTopRow(version, pool, rate) {
    const rivals = pool.filter((h) => h.key !== version.baseKey);
    if (!rivals.length) return null;
    let atk = 0;
    let def = 0;
    rivals.forEach((rival) => {
      atk += rate(version, rival);
      def += 1 - rate(rival, version);
    });
    return { atk: atk / rivals.length, def: def / rivals.length, overall: (atk + def) / (2 * rivals.length) };
  }

  function collectGroupRows(group, atk, def) {
    const n = group.length;
    const rows = new Map();
    if (n < 2) return rows;
    group.forEach((h, k) => rows.set(h.key, {
      atk: atk[k] / (n - 1), def: def[k] / (n - 1), overall: (atk[k] + def[k]) / (2 * (n - 1)),
    }));
    return rows;
  }

  const groupError = (n, runs) => (n > 1 ? 0.5 / Math.sqrt(2 * (n - 1) * runs) : 0);

  // Сайт для игроков получает результаты готовыми: по числу на нападение и защиту,
  // порядок строк задан составом группы, поэтому ключи героев в файл не попадают.
  function packGroupResult(group, result) {
    const row = (h) => {
      const s = result.rows.get(h.key);
      return s ? [Number(s.atk.toFixed(7)), Number(s.def.toFixed(7))] : 0;
    };
    return { se: result.se, runs: result.runs, rows: [...numberedHeroes(group), ...offTopHeroes(group)].map(row) };
  }

  function unpackGroupResult(group, packed) {
    const rows = new Map();
    [...numberedHeroes(group), ...offTopHeroes(group)].forEach((h, i) => {
      const s = packed.rows[i];
      if (s) rows.set(h.key, { atk: s[0], def: s[1], overall: (s[0] + s[1]) / 2 });
    });
    return { rows, se: packed.se, runs: packed.runs };
  }

  const cacheHash = (key) => hashString(key).toString(36);

  // ---------- Карточка, коллекция и новости ----------

  // Постоянный адрес героя: статы могут меняться от сезона к сезону, а этот адрес нет.
  const heroId = (h) => `${h.rank}|${normName(h.title || NO_TITLE)}|${normName(h.name)}`;

  // Короткий код героя для ссылок Telegram и облака: там допустимы только латиница и цифры.
  const heroCode = (h) => hashString(heroId(h)).toString(36);

  // Коллекция для облака Telegram: коды через запятую, звёздочка после кода значит скин.
  function packCollection(collection, heroes) {
    const codes = new Set();
    heroes.forEach((h) => {
      const entry = collection[heroId(h)];
      if (entry) codes.add(heroCode(h) + (entry.skin ? '*' : ''));
    });
    return [...codes].sort().join(',');
  }

  // Код героя, которого больше нет в базе, пропускается.
  function unpackCollection(text, heroes) {
    const byCode = new Map(heroes.map((h) => [heroCode(h), heroId(h)]));
    const collection = {};
    String(text || '').split(',').filter(Boolean).forEach((part) => {
      const skin = part.endsWith('*');
      const id = byCode.get(skin ? part.slice(0, -1) : part);
      if (id) collection[id] = { skin };
    });
    return collection;
  }

  // Одно значение в облаке Telegram вмещает до 4096 знаков, поэтому длинный текст делится на части.
  function chunkText(text, size) {
    const parts = [];
    for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
    return parts;
  }

  // Сколько обычных ударов нужно, чтобы убить соперника.
  const hitsToKill = (attacker, target) => Math.ceil(target.hp / attacker.bm);

  // Что изменилось между сезонами. Новые тайтлы идут от самых сильных карт.
  function seasonNews(current, previous) {
    const matches = matchSeason(current, previous);
    const fresh = current.filter((h) => !matches.has(h));
    const skins = current.filter((h) => matches.has(h) && h.skin && !matches.get(h).skin);
    const changed = current.filter((h) => {
      const o = matches.get(h);
      return o && (o.bm !== h.bm || o.hp !== h.hp);
    }).map((hero) => ({ hero, before: matches.get(hero) }));
    const known = new Set(previous.map((h) => normName(h.title || NO_TITLE)));
    const rankIndex = (h) => RANKS.indexOf(h.rank);
    const titleMap = new Map();
    current.forEach((h) => {
      const name = h.title || NO_TITLE;
      if (known.has(normName(name))) return;
      titleMap.set(name, [...(titleMap.get(name) || []), h]);
    });
    const titles = [...titleMap].map(([title, list]) => ({
      title,
      count: list.length,
      bestRank: RANKS[Math.min(...list.map(rankIndex))],
    })).sort((a, b) => (RANKS.indexOf(a.bestRank) - RANKS.indexOf(b.bestRank)) || (b.count - a.count));
    return { matches, fresh, skins, changed, titles };
  }

  // ---------- Рекорды игроков ----------

  const MEDALS = { '🥇': 1, '🥈': 2, '🥉': 3 };

  // Число очков из результата: «14,567,529,636» и «8 700 урона» дают 14567529636 и 8700.
  function recordScore(value) {
    const lead = String(value || '').match(/^[\d\s., ]*\d/);
    if (!lead) return null;
    const digits = lead[0].replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }

  // Аватарки в сообщении бота при копировании превращаются в эмодзи перед ником, их убираем.
  const cleanRecordName = (name) => String(name || '').replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}️‍⃣\s]+/u, '').trim();

  const RECORD_ARROW = /[➢➤→]|\s->\s/;
  const LINK = /\(\s*https?:\/\/[^)]*\)/g;

  // Ник со ссылкой бота: «Ник (https://t.me/AniMatrixGame_bot?start=user_1706393853)».
  // Из ссылки берётся Telegram ID игрока, сама ссылка из ника убирается.
  function parsePlayerCell(text) {
    const id = String(text || '').match(/start=user_(\d+)/);
    const player = cleanRecordName(String(text || '').replace(LINK, ' ').replace(/[➢➤→]\s*$/, '').replace(/\s+/g, ' '));
    return { player, tgId: id ? id[1] : null };
  }

  // Строки результатов: «1. Ник ➤ 14,567», «1. Ник — 12 345», «🥇 Ник: 900», «Ник 500».
  // Без номера место берётся по порядку строк, одинаковый номер значит общее место.
  function parseRecordLines(text) {
    let order = 0;
    return String(text || '').split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean).map((line) => {
      order += 1;
      let rest = line;
      let place = null;
      const medal = Object.keys(MEDALS).find((m) => rest.startsWith(m));
      if (medal) { place = MEDALS[medal]; rest = rest.slice(medal.length).trim(); }
      const numbered = rest.match(/^#?(\d{1,4})\s*[.)\]:-]?\s+(.+)$/);
      if (numbered) { place = place || Number(numbered[1]); rest = numbered[2]; }
      let player = rest;
      let value = '';
      // Ссылки в нике убираются до деления строки: в них есть двоеточие.
      const links = [];
      const masked = rest.replace(LINK, (m) => { links.push(m); return `\u0000${links.length - 1}\u0000`; });
      const unmask = (part) => part.replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)]);
      const split = masked.split(/\s*[➢➤→]\s*|\s->\s|\t|\s+[—–-]\s+|\s*\|\s*|:\s+/);
      if (split.length > 1) {
        player = unmask(split[0]);
        value = unmask(split.slice(1).join(' — '));
      } else {
        const tail = masked.match(/^(.+?)\s+(\d[\d\s.,]*(?:\s*\S+)?)$/);
        if (tail) { player = unmask(tail[1]); value = unmask(tail[2]); }
      }
      value = value.trim();
      return { place: place || order, ...parsePlayerCell(player), value, score: recordScore(value) };
    }).filter((row) => row.player);
  }

  const MONTHS = ['январ', 'феврал', 'мар', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

  // Последний день периода «13–19 октября» или «28 октября – 3 ноября». Год берётся такой,
  // чтобы дата не оказалась больше чем на неделю в будущем.
  function periodEnd(period, now) {
    const parts = [...String(period || '').toLowerCase().matchAll(/(\d{1,2})\s*([а-яё]+)?/g)];
    if (!parts.length) return '';
    const day = Number(parts[parts.length - 1][1]);
    const word = [...parts].reverse().map((p) => p[2]).find(Boolean);
    const month = word ? MONTHS.findIndex((m) => word.startsWith(m)) : -1;
    if (month < 0 || day < 1 || day > 31) return '';
    const today = now || new Date();
    let year = today.getFullYear();
    if (new Date(year, month, day) - today > 7 * 86400000) year -= 1;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Сообщение бота с местами ивента. Название берётся из «Итоги прошлого события ➢ Аркейн»
  // или из первой строки «Аркейн | …», период из строки «Период». Номер группы не нужен:
  // группы каждую неделю собираются заново.
  function parseEventMessage(text, now) {
    const src = String(text || '');
    const lines = src.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rowLines = lines.filter((line) => /^\d{1,3}\s*\.\s*\S/.test(line) && RECORD_ARROW.test(line));
    let event = '';
    const total = src.match(/Итоги[^\n➢➤]*[➢➤]\s*([^\n|]+)/);
    if (total) event = total[1];
    else if (rowLines.length && lines.length) event = lines[0].replace(LINK, ' ').split(/\s*\|\s*|:\s+|,\s+/)[0];
    const periodLine = lines.map(cleanRecordName).find((line) => /^период/i.test(line));
    const period = periodLine ? periodLine.replace(/^период\s*[:➢➤]?\s*/i, '').replace(LINK, '').trim() : '';
    return {
      event: cleanRecordName(event),
      period,
      endDate: periodEnd(period, now),
      rows: parseRecordLines(rowLines.length ? rowLines.join('\n') : src),
    };
  }

  // Игрок узнаётся по Telegram ID из ссылки бота, а без ссылки по нику.
  const recordPlayerKey = (row) => (row.tgId ? `id:${row.tgId}` : `n:${normName(row.player)}`);
  const recordEventKey = (title) => normName(cleanRecordName(title));

  // Рекорды за всё время: по каждому ивенту лучший результат каждого игрока, сильнейшие сверху.
  function recordLeaders(events) {
    const groups = new Map();
    events.forEach((ev) => {
      const key = recordEventKey(ev.title);
      if (!key) return;
      const group = groups.get(key) || { key, title: cleanRecordName(ev.title), weeks: 0, lastDate: '', best: new Map() };
      group.weeks += 1;
      if (String(ev.date || '') >= group.lastDate) { group.lastDate = String(ev.date || ''); group.title = cleanRecordName(ev.title); }
      (ev.rows || []).forEach((row) => {
        const score = row.score === null || row.score === undefined ? recordScore(row.value) : row.score;
        if (score === null) return;
        const who = recordPlayerKey(row);
        const current = group.best.get(who);
        if (!current || score > current.score) {
          group.best.set(who, { key: who, player: row.player, tgId: row.tgId || null, score, value: row.value, date: ev.date || '' });
        }
      });
      groups.set(key, group);
    });
    return [...groups.values()].map((g) => ({
      key: g.key,
      title: g.title,
      weeks: g.weeks,
      lastDate: g.lastDate,
      players: [...g.best.values()].sort((a, b) => b.score - a.score),
    })).sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.title.localeCompare(b.title, 'ru'));
  }

  // Профиль игрока: все его недели и лучший результат в каждом ивенте с местом за всё время.
  function playerRecords(events, playerKey) {
    const weeks = [];
    let name = '';
    let tgId = null;
    let lastDate = '';
    events.forEach((ev) => (ev.rows || []).forEach((row) => {
      if (recordPlayerKey(row) !== playerKey) return;
      weeks.push({ event: cleanRecordName(ev.title), eventId: ev.id, date: ev.date || '', place: row.place, value: row.value });
      if (String(ev.date || '') >= lastDate) { lastDate = String(ev.date || ''); name = row.player; }
      tgId = tgId || row.tgId || null;
    }));
    const best = recordLeaders(events).map((l) => {
      const rank = l.players.findIndex((p) => p.key === playerKey);
      return rank < 0 ? null : { event: l.title, rank: rank + 1, of: l.players.length, ...l.players[rank] };
    }).filter(Boolean);
    weeks.sort((a, b) => b.date.localeCompare(a.date));
    return { key: playerKey, name, tgId, weeks, best };
  }

  // Свежие события сверху; без даты в конце.
  function sortRecordEvents(events) {
    return [...events].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  // ---------- Статистика ----------

  // Девять рангов в одной полосе не различить по цвету, поэтому ранги сведены в пять ступеней.
  const STAT_TIERS = [
    { label: 'SS–SSS', ranks: ['SSS', 'SS'] },
    { label: 'S', ranks: ['S'] },
    { label: 'B–A', ranks: ['A', 'B'] },
    { label: 'D–C', ranks: ['C', 'D'] },
    { label: 'F–E', ranks: ['E', 'F'] },
  ];
  const ELITE_RANKS = ['SSS', 'SS', 'S'];
  // У тайтла из пары карт доля сильных рангов ничего не значит, поэтому такие идут отдельно.
  const STAT_MIN_TITLE = 20;

  const percentText = (share) => `${(share * 100).toFixed(1)}%`;

  // График не фильтруется по своему же признаку: иначе у выбранного ранга был бы один столбец на 100%.
  function statsFor(heroes, filter) {
    const { rank = '', cls = '', title = '', events = true } = filter || {};
    const titleOf = (h) => h.title || NO_TITLE;
    const pool = events ? heroes : heroes.filter((h) => !h.event);
    const pick = (...skip) => pool.filter((h) => (skip.includes('rank') || !rank || h.rank === rank)
      && (skip.includes('cls') || !cls || h.cls === cls)
      && (skip.includes('title') || !title || titleOf(h) === title));
    const tally = (list, keyOf, keys) => {
      const counts = new Map((keys || []).map((k) => [k, 0]));
      list.forEach((h) => counts.set(keyOf(h), (counts.get(keyOf(h)) || 0) + 1));
      return [...counts].map(([key, count]) => ({ key, count, share: list.length ? count / list.length : 0 }));
    };
    const byCount = (a, b) => (b.count - a.count) || String(a.key).localeCompare(String(b.key), 'ru');
    const chosen = pick();

    const inTitle = pick('rank', 'cls');
    const grid = RANKS.map((r) => {
      const inRank = inTitle.filter((h) => h.rank === r);
      return { rank: r, total: inRank.length, cells: tally(inRank, (h) => h.cls, CLASSES).map((c) => ({ cls: c.key, count: c.count, share: c.share })) };
    });

    const inClass = pick('rank', 'title');
    const tiers = [...new Set(inClass.map(titleOf))].map((name) => {
      const own = inClass.filter((h) => titleOf(h) === name);
      const eliteCount = own.filter((h) => ELITE_RANKS.includes(h.rank)).length;
      return {
        title: name,
        total: own.length,
        counts: STAT_TIERS.map((tier) => own.filter((h) => tier.ranks.includes(h.rank)).length),
        eliteCount,
        elite: eliteCount / own.length,
        small: own.length < STAT_MIN_TITLE,
      };
    }).sort((a, b) => (a.small - b.small) || (a.small ? 0 : b.elite - a.elite) || (b.total - a.total) || a.title.localeCompare(b.title, 'ru'));

    const topOf = (list, field) => {
      const value = Math.max(...list.map((h) => h[field]));
      return { value, names: [...new Set(list.filter((h) => h[field] === value).map((h) => h.name))] };
    };
    const records = RANKS.map((r) => {
      const inRank = chosen.filter((h) => h.rank === r);
      return inRank.length ? { rank: r, bm: topOf(inRank, 'bm'), hp: topOf(inRank, 'hp') } : null;
    }).filter(Boolean);

    const scopeOf = (...parts) => parts.filter(Boolean).join(' · ') || 'Все карты';
    const rankLabel = rank ? `${rank}-ранг` : '';
    const scopes = {
      ranks: scopeOf(cls, title),
      classes: scopeOf(rankLabel, title),
      titles: scopeOf(rankLabel, cls),
      grid: scopeOf(title),
      tiers: scopeOf(cls),
      records: scopeOf(rankLabel, cls, title),
      skins: scopeOf(rankLabel, cls, title),
      events: scopeOf(rankLabel, cls, title),
    };

    return {
      filter: { rank, cls, title, events },
      scopes,
      total: chosen.length,
      titleCount: new Set(chosen.map(titleOf)).size,
      skins: chosen.filter((h) => h.skin).length,
      events: chosen.filter((h) => h.event).length,
      ranks: tally(pick('rank'), (h) => h.rank, RANKS),
      classes: tally(pick('cls'), (h) => h.cls, CLASSES),
      titles: tally(pick('title'), titleOf).sort(byCount),
      grid,
      gridMax: Math.max(0, ...grid.flatMap((row) => row.cells.map((c) => c.share))),
      tiers,
      best: tiers.find((t) => !t.small && t.eliteCount > 0) || null,
      records,
      skinTitles: tally(chosen.filter((h) => h.skin), titleOf).sort(byCount),
      eventTitles: tally(chosen.filter((h) => h.event), titleOf).sort(byCount),
    };
  }

  const firstName = (names) => (names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]);

  // Те же данные таблицами: для статьи Telegram и для просмотра значений без наведения.
  function statsSections(stats) {
    const shareRows = (list, name) => list.map((r) => [name ? name(r.key) : r.key, groupNumber(r.count), percentText(r.share)]);
    const iconName = (c) => `${CLASS_ICONS[c]} ${c}`;
    const sections = [
      { id: 'ranks', title: 'Карты по рангам', head: ['Ранг', 'Карт', 'Доля'], rows: shareRows(stats.ranks) },
      { id: 'classes', title: 'Карты по классам', head: ['Класс', 'Карт', 'Доля'], rows: shareRows(stats.classes, iconName) },
      {
        id: 'grid',
        title: 'Классы внутри рангов',
        head: ['Ранг', ...CLASSES.map(iconName), 'Всего'],
        rows: stats.grid.map((row) => [row.rank, ...row.cells.map((c) => `${groupNumber(c.count)} (${percentText(c.share)})`), groupNumber(row.total)]),
      },
      { id: 'titles', title: 'Карты по аниме', head: ['Аниме', 'Карт', 'Доля'], rows: shareRows(stats.titles) },
      {
        id: 'tiers',
        title: 'Ранги внутри аниме',
        head: ['Аниме', ...STAT_TIERS.map((t) => t.label), 'S и выше'],
        rows: stats.tiers.map((t) => [t.title, ...t.counts.map(groupNumber), percentText(t.elite)]),
      },
      {
        id: 'records',
        title: 'Рекорды рангов',
        head: ['Ранг', 'Макс. БМ', 'Герой', 'Макс. ЖВ', 'Герой'],
        rows: stats.records.map((r) => [r.rank, groupNumber(r.bm.value), firstName(r.bm.names), groupNumber(r.hp.value), firstName(r.hp.names)]),
      },
      { id: 'skins', title: 'Скины по аниме', head: ['Аниме', 'Скинов', 'Доля'], rows: shareRows(stats.skinTitles) },
      { id: 'events', title: 'Ивент-карты по аниме', head: ['Аниме', 'Карт', 'Доля'], rows: shareRows(stats.eventTitles) },
    ];
    return sections.filter((s) => s.rows.length).map((s) => ({ ...s, scope: stats.scopes[s.id] }));
  }

  function statsNote(stats, date) {
    const events = stats.filter.events ? 'Ивент-карты учтены' : 'Без ивент-карт';
    return `Карт: ${groupNumber(stats.total)}, обновлено ${date}. ${events}, скин не считается отдельной картой. Элитность аниме: доля карт S-ранга и выше среди аниме от ${STAT_MIN_TITLE} карт.`;
  }

  const STATS_TITLE = 'Статистика карт AniMatrix';
  const sectionCaption = (section) => (!section.scope || section.scope === 'Все карты' ? section.title : `${section.title} · ${section.scope}`);

  function statsTableHtml(section) {
    const row = (cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
    return `<table><caption>${escapeHtml(sectionCaption(section))}</caption><tbody>${[section.head, ...section.rows].map(row).join('')}</tbody></table>`;
  }

  // Разметка статьи такая же, как у топов: редактор Telegram убирает классы и стили.
  function statsHtml(sections, note, collapsible, title) {
    const tables = sections.map((section) => (collapsible
      ? `<details><summary>${escapeHtml(section.title)}</summary>${statsTableHtml(section)}</details>`
      : `<h2>${escapeHtml(section.title)}</h2>${statsTableHtml(section)}`));
    return `<h1>${escapeHtml(title || STATS_TITLE)}</h1>${note ? `<p>${escapeHtml(note)}</p>` : ''}${tables.join('')}`;
  }

  function statsText(sections, note, title) {
    const blocks = sections.map((section) => [sectionCaption(section), section.head.join(' | '), ...section.rows.map((r) => r.join(' | '))].join('\n'));
    return [title || STATS_TITLE, ...(note ? [note] : []), ...blocks].join('\n\n');
  }

  return {
    deriveHeroes, numberedHeroes, offTopHeroes, groupCacheKey, runsForGroup, hasEqualScores, offTopRow, collectGroupRows, groupError,
    packGroupResult, unpackGroupResult, cacheHash, heroId, heroCode, packCollection, unpackCollection, chunkText, hitsToKill, seasonNews,
    parseRecordLines, parseEventMessage, parsePlayerCell, periodEnd, recordLeaders, recordScore, recordPlayerKey, recordEventKey, playerRecords, cleanRecordName, sortRecordEvents,
    STAT_TIERS, statsFor, statsSections, statsNote, sectionCaption, statsTableHtml, statsHtml, statsText,
    CLASS_ICONS, SKIN_MARK, EVENT_MARK, exportTitle, exportCaption, exportCells, exportMessages, exportHtml, exportArticles, exportNote, limitPlaces,
    CLASSES, RANKS, DEFAULTS, NO_TITLE, SKIN_BONUS, fight, duel, plainFight, formulaScore,
    createPairRates, seededDice, levelFactor, toBase, parseMessages, parseDetailed, catalogCounts,
    normName, sameName, titleDocId, planImport, removeDuplicates, matchSeason, skinVersion, seatOffTop, sharedPlaces,
    sortTitles, planTitleMove,
  };
});
