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
  // Ветки «┣ ┗ ├» перед номером места в старых итогах бота.
  const TREE = /^[\u2500-\u257F\s]+/;
  const TRAILING_EMOJI = /[\s\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]+$/u;
  const DATE_RANGE = /\d{1,2}\.\d{1,2}\s*(?:по|–|—|-)\s*\d{1,2}\.\d{1,2}/i;
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
      let rest = line.replace(TREE, '');
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
      value = value.replace(TRAILING_EMOJI, '').trim();
      return { place: place || order, ...parsePlayerCell(player), value, score: recordScore(value) };
    }).filter((row) => row.player);
  }

  const MONTHS = ['январ', 'феврал', 'мар', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

  // Последний день периода «13–19 октября» или «28 октября – 3 ноября». Год берётся такой,
  // чтобы дата не оказалась больше чем на неделю в будущем.
  function periodEnd(period, now) {
    const text = String(period || '').toLowerCase();
    // Числовой вид «С 01.02 по 07.02»: берётся последняя дата.
    const numeric = [...text.matchAll(/(\d{1,2})\.(\d{1,2})(?!\d)/g)];
    const parts = [...text.matchAll(/(\d{1,2})\s*([а-яё]+)?/g)];
    if (!parts.length) return '';
    let day = Number(parts[parts.length - 1][1]);
    const word = [...parts].reverse().map((p) => p[2]).find(Boolean);
    let month = word ? MONTHS.findIndex((m) => word.startsWith(m)) : -1;
    if (numeric.length) {
      day = Number(numeric[numeric.length - 1][1]);
      month = Number(numeric[numeric.length - 1][2]) - 1;
    }
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
    // Строка места: номер, ник и очки после стрелки, двоеточия или тире.
    const isRow = (line) => {
      const bare = line.replace(TREE, '').replace(LINK, ' ');
      return /^\d{1,3}\s*[.)]\s*\S/.test(bare) && (RECORD_ARROW.test(bare) || /:\s*\d/.test(bare) || /\s[—–-]\s*\d/.test(bare));
    };
    const rowLines = lines.filter(isRow);
    let event = '';
    const total = src.match(/Итоги[^\n➢➤]*[➢➤]\s*([^\n|]+)/);
    if (total) event = total[1];
    else if (rowLines.length && lines.length && !isRow(lines[0]) && /\||:\s/.test(lines[0])) event = lines[0].replace(LINK, ' ').split(/\s*\|\s*|:\s+|,\s+/)[0];
    const periodLine = lines.map(cleanRecordName).find((line) => /^период/i.test(line) || DATE_RANGE.test(line));
    const period = periodLine ? periodLine.replace(/^период\s*[:➢➤]?\s*/i, '').replace(LINK, '').replace(/^с\s+/i, '').trim() : '';
    return {
      event: cleanRecordName(event),
      period,
      endDate: periodEnd(period, now),
      rows: parseRecordLines(rowLines.length ? rowLines.join('\n') : src),
    };
  }

  // Ивенты бота, по которым ведутся топы. Эмодзи как в списке «Все ивенты» бота;
  // единица показывается рядом с результатом: очки, алмазы или урон.
  const RECORD_UNITS = {
    points: { icon: '🎲', label: 'Очки' },
    diamonds: { icon: '💎', label: 'Алмазы' },
    damage: { icon: '💥', label: 'Урон' },
  };
  const RECORD_EVENTS = [
    { name: 'Аркейн', emoji: '🎏', unit: 'damage' },
    { name: 'Эпоха Низших', emoji: '📗', unit: 'points' },
    { name: 'Рекрут-Фест', emoji: '🥡', unit: 'points' },
    { name: 'Престиж Капитала', emoji: '💎', unit: 'diamonds' },
    { name: 'Дневной вызов', emoji: '📜', unit: 'points' },
    { name: 'Эволюция героя', emoji: '✨', unit: 'points' },
    { name: 'Героический Штурм', emoji: '🩸', unit: 'damage' },
    { name: 'Марафон свершений', emoji: '💊', unit: 'points' },
    { name: 'Битва отрядов', emoji: '🛡️', unit: 'points' },
  ];

  // Сведения об ивенте по названию; у своих ивентов без эмодзи результат в очках.
  function recordEventInfo(title) {
    const key = normName(cleanRecordName(title));
    const known = RECORD_EVENTS.find((ev) => normName(ev.name) === key);
    const base = known || { name: cleanRecordName(title), emoji: '', unit: 'points' };
    return { ...base, unitInfo: RECORD_UNITS[base.unit] || RECORD_UNITS.points, known: !!known };
  }

  // Ивент из списка, упомянутый в тексте итогов. Длинные названия проверяются первыми,
  // чтобы короткое не перехватило совпадение.
  function detectRecordEvent(text) {
    const hay = normName(text);
    const found = [...RECORD_EVENTS].sort((a, b) => b.name.length - a.name.length).find((ev) => hay.includes(normName(ev.name)));
    return found ? found.name : '';
  }

  // Игрок узнаётся по Telegram ID из ссылки бота, а без ссылки по нику — точно, с регистром: «Inslide» и «inslide» — разные люди.
  const recordPlayerKey = (row) => (row.tgId ? `id:${row.tgId}` : `n:${String(row.player || '').trim()}`);
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
      // Одинаковые очки делят место.
      players: [...g.best.values()].sort((a, b) => b.score - a.score)
        .map((p, i, list) => ({ ...p, place: list.findIndex((x) => x.score === p.score) + 1 })),
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
      return rank < 0 ? null : { event: l.title, rank: l.players[rank].place, of: l.players.length, ...l.players[rank] };
    }).filter(Boolean);
    weeks.sort((a, b) => b.date.localeCompare(a.date));
    return { key: playerKey, name, tgId, weeks, best };
  }

  // Свежие события сверху; без даты в конце.
  function sortRecordEvents(events) {
    return [...events].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  // ---------- Игроки: профили по рекордам и конкурсам ----------
  // Ключ игрока как у рекордов: id:<Telegram ID> или n:<ник> (рекорды без ID). Ник с ID и такой же ник без ID — разные игроки.

  const unixIso = (unix) => (unix ? new Date(unix * 1000).toISOString() : '');
  const contestAt = (c) => unixIso(c.endedAt || c.startedAt);

  // Чья легендарка: у новых итогов в записи есть id, у старых — по имени, если в конкурсе ровно один игрок с таким именем.
  function legendOwnerId(players, entry) {
    if (entry && entry.id) return String(entry.id);
    const same = (players || []).filter((p) => normName(p.name) === normName(entry && entry.player));
    return same.length === 1 ? String(same[0].id) : '';
  }

  // Ники в игре из nicks.json (пишет бот, tickets/game-nicks.md) → Map(ID → { nick, past: [{ nick, last }] }).
  // Нет файла — пустая карта. Один текущий ник у двух ID (ошибка разбора) — у обоих ника нет: показывается имя Telegram.
  function gameNickMap(data) {
    const map = new Map();
    const src = (data && data.nicks && typeof data.nicks === 'object') ? data.nicks : {};
    const ok = (x) => x && typeof x.nick === 'string' && x.nick.trim();
    const count = new Map();
    Object.entries(src).forEach(([id, x]) => { if (/^\d+$/.test(id) && ok(x)) count.set(x.nick, (count.get(x.nick) || 0) + 1); });
    Object.entries(src).forEach(([id, x]) => {
      if (!/^\d+$/.test(id) || !ok(x) || count.get(x.nick) > 1) return;
      const past = (Array.isArray(x.past) ? x.past : []).filter((y) => ok(y) && y.nick !== x.nick).slice(0, 10)
        .map((y) => ({ nick: y.nick, last: String(y.last || '') }));
      map.set(id, { nick: x.nick, past });
    });
    return map;
  }

  // ---------- Аватары-заготовки и настройки профиля (tickets/profile-settings.md) ----------
  // Свои эмблемы, рисуются кодом: 12 рисунков, у каждого 3 цвета из 7 (36 вариантов), код «a<рисунок>-<цвет>» (a01-1 … a12-2).
  // F — цвет рисунка, D — тёмный край фона (прорези). Без id внутри SVG: одинаковых аватаров на странице много.
  const AVATAR_FIGS = [
    // 01 Кицунэ
    (F, D) => `<path fill="${F}" d="M13 13 L27 24 H37 L51 13 L49 33 Q47 46 32 53 Q17 46 15 33 Z"/><path fill="${D}" d="M17 19 L24 25 L18 30 Z M47 19 L40 25 L46 30 Z M21 35 Q25 33 29 37 Q25 39 21 35 Z M43 35 Q39 33 35 37 Q39 39 43 35 Z M32 26 Q34.5 29 32 33 Q29.5 29 32 26 Z M26.5 27.5 Q28 29.5 27 31 Q25.5 29.5 26.5 27.5 Z M37.5 27.5 Q36 29.5 37 31 Q38.5 29.5 37.5 27.5 Z"/><circle fill="${D}" cx="32" cy="46" r="2.6"/>`,
    // 02 Кошка
    (F, D) => `<path fill="${F}" d="M14 50 Q11 34 18 26 L16 11 L28 20 Q32 19 36 20 L48 11 L46 26 Q53 34 50 50 Q32 58 14 50 Z"/><path fill="${D}" d="M19 16 L20 24 L25 20 Z M45 16 L44 24 L39 20 Z M29 41 H35 L32 44.5 Z"/><circle fill="${D}" cx="24" cy="35" r="4.4"/><circle fill="${D}" cx="40" cy="35" r="4.4"/><circle fill="${F}" cx="25.6" cy="33.4" r="1.5"/><circle fill="${F}" cx="41.6" cy="33.4" r="1.5"/><path fill="none" stroke="${D}" stroke-width="1.6" stroke-linecap="round" d="M27 46.5 Q32 49.5 37 46.5"/>`,
    // 03 Они
    (F, D) => `<path fill="${F}" d="M19 22 L13 7 L27 18 Q32 16.5 37 18 L51 7 L45 22 Q49 30 47 42 Q44 54 32 56 Q20 54 17 42 Q15 30 19 22 Z"/><path fill="${D}" d="M20 28 L30 32 L28 36 L21 34 Z M44 28 L34 32 L36 36 L43 34 Z M22 42 Q32 39 42 42 L39 49 Q32 51 25 49 Z"/><path fill="${F}" d="M25.5 41.2 L28 46 L30 40.4 Z M38.5 41.2 L36 46 L34 40.4 Z"/>`,
    // 04 Катана
    (F, D) => `<g transform="rotate(45 32 32)"><path fill="${F}" d="M29.6 38 V12 Q30 6 34.6 3 V38 Z"/><path fill="${D}" d="M32.6 36 V9 L33.6 7.6 V36 Z" opacity=".55"/><ellipse fill="${F}" cx="32" cy="40.5" rx="8.5" ry="2.8"/><rect fill="${F}" x="29.3" y="43" width="5.4" height="17" rx="1.6"/><path fill="${D}" d="M32 45 L34 47.5 L32 50 L30 47.5 Z M32 51.5 L34 54 L32 56.5 L30 54 Z"/></g>`,
    // 05 Сакура
    (F, D) => `${[0, 72, 144, 216, 288].map((a) => `<path fill="${F}" transform="rotate(${a} 32 32)" d="M32 31 C23 25 23 13 28.5 9 L32 12.5 L35.5 9 C41 13 41 25 32 31 Z"/>`).join('')}<circle fill="${D}" cx="32" cy="32" r="5"/><circle fill="${F}" cx="32" cy="32" r="2"/>`,
    // 06 Луна
    (F, D) => `<path fill="${F}" d="M26.2 15.2 A19 19 0 1 0 47.3 39 A16 16 0 0 1 26.2 15.2 Z"/><path fill="${F}" d="M44 10 L45.6 14.4 L50 16 L45.6 17.6 L44 22 L42.4 17.6 L38 16 L42.4 14.4 Z"/><circle fill="${F}" cx="52" cy="26" r="1.8"/>`,
    // 07 Кристалл
    (F, D) => `<path fill="${F}" d="M22 10 H42 L52 23 L32 56 L12 23 Z"/><path fill="none" stroke="${D}" stroke-width="2.2" stroke-linejoin="round" d="M12 23 H52 M22 10 L27 23 L32 56 L37 23 L42 10"/>`,
    // 08 Дракон
    (F, D) => `<path fill="${F}" d="M9 55 L13 40 Q15 31 22 27 L9 16 L25 22 L17 7 L31 20 Q40 19 46 24 L57 26 Q59 30 56 33 L45 34 L53 38 Q52 42 47 43 L37 41 Q32 47 29 56 Z"/><path fill="${F}" d="M13 40 L6 39 L13.5 35 L7.5 31 L16 30.5 Z"/><path fill="${D}" d="M33 26 Q38 24 41 27 Q37 30 33 26 Z M51.5 27.6 L54.5 28.4 L53 30.2 Z M45 34 L36 35.5 L45.5 36.5 Z"/><path fill="none" stroke="${D}" stroke-width="1.8" stroke-linecap="round" d="M22 33 Q26 37 23 43 M27 31 Q31 35 29 40"/>`,
    // 09 Пламя
    (F, D) => `<path fill="${F}" d="M33 5 C37 15 49 22 47 38 C46 50 39 57 32 57 C24 57 17 50 17 40 C17 31 23 27 25 18 C29 22 30 27 29.5 31 C34 25 35 15 33 5 Z"/><path fill="${D}" d="M33 32 C37 38 40 43 38 48 C37 51.5 34.5 53 32 53 C28.5 53 26 50.5 26 47 C26 42 31 39 33 32 Z"/>`,
    // 10 Звезда
    (F, D) => `<path fill="${F}" d="M32 8 L38.2 23.8 L55 24.6 L42 35.2 L46.4 51.6 L32 42.4 L17.6 51.6 L22 35.2 L9 24.6 L25.8 23.8 Z"/><path fill="${D}" transform="matrix(.62 0 0 .62 12.2 12.8)" d="M32 21 L35 29 L43.5 29.4 L36.9 34.7 L39.1 43 L32 38.3 L24.9 43 L27.1 34.7 L20.5 29.4 L29 29 Z"/>`,
    // 11 Корона
    (F, D) => `<path fill="${F}" d="M13 44 L10 20 L22 31 L32 13 L42 31 L54 20 L51 44 Z"/><rect fill="${F}" x="13" y="46.5" width="38" height="7" rx="2"/><circle fill="${F}" cx="10" cy="18" r="3"/><circle fill="${F}" cx="32" cy="11" r="3"/><circle fill="${F}" cx="54" cy="18" r="3"/><circle fill="${D}" cx="32" cy="36" r="3.6"/><circle fill="${D}" cx="21" cy="50" r="1.8"/><circle fill="${D}" cx="32" cy="50" r="1.8"/><circle fill="${D}" cx="43" cy="50" r="1.8"/>`,
    // 12 Призрак
    (F, D) => `<path fill="${F}" d="M17 55 V30 C17 17 24 10 32 10 C40 10 47 17 47 30 V55 L42 50.5 L37 55 L32 50.5 L27 55 L22 50.5 Z"/><ellipse fill="${D}" cx="26" cy="29" rx="3.2" ry="4.4"/><ellipse fill="${D}" cx="38" cy="29" rx="3.2" ry="4.4"/><ellipse fill="${D}" cx="32" cy="40" rx="3.4" ry="4"/>`
  ];
  const AVATAR_FIG_NAMES = ['Кицунэ', 'Кошка', 'Они', 'Катана', 'Сакура', 'Луна', 'Кристалл', 'Дракон', 'Пламя', 'Звезда', 'Корона', 'Призрак'];
  // Фон — градиент от светлого к тёмному (края глубокие, чтобы рисунок читался); рисунок — светлый тон в пару к фону
  // (дополнительный цвет или классическая пара: багрянец — шампань, тёмный — золото).
  const AVATAR_COLORS = [
    { name: 'Фуксия', from: '#ff5aa5', to: '#a3125f', fg: '#a8f7de' },
    { name: 'Кобальт', from: '#3d5cf5', to: '#111866', fg: '#a9dcff' },
    { name: 'Изумруд', from: '#2cc08c', to: '#074a37', fg: '#ffc4d8' },
    { name: 'Медь', from: '#d9814f', to: '#7a2c12', fg: '#aeeef0' },
    { name: 'Аметист', from: '#b65cff', to: '#47118a', fg: '#c6ffb0' },
    { name: 'Багрянец', from: '#ef4a5c', to: '#700a22', fg: '#ffe2a6' },
    { name: 'Золото', from: '#3b4058', to: '#11131d', fg: '#f3c66b' },
  ];
  // У каждого рисунка — 3 лучших цвета (номера AVATAR_COLORS), первый — основной. Другие сочетания не принимаются.
  const AVATAR_FIG_COLORS = [
    [1, 3, 6], [1, 3, 6], [1, 3, 6], // кицунэ, кошка, они
    [6, 2, 7], [6, 2, 7], // катана, сакура
    [2, 5, 7], [2, 5, 7], // луна, кристалл
    [4, 3, 6], [4, 3, 6], // дракон, пламя
    [7, 5, 2], [7, 5, 2], [5, 7, 2], // звезда, корона, призрак
  ];

  const avatarCode = (fig, color) => `a${String(fig).padStart(2, '0')}-${color}`;
  // «a07-3» → { fig: 7, color: 3 }; чужое — null.
  function parseAvatarCode(code) {
    const m = String(code || '').match(/^a(\d{2})-(\d)$/);
    if (!m) return null;
    const fig = Number(m[1]);
    const color = Number(m[2]);
    return fig >= 1 && fig <= AVATAR_FIGS.length && AVATAR_FIG_COLORS[fig - 1].includes(color) ? { fig, color } : null;
  }
  // Заготовка по Telegram ID (или по нику у игрока без ID): у одного игрока всегда одна и та же.
  function avatarSeedCode(seed) {
    let h = 0x811c9dc5; // FNV-1a
    const s = String(seed || '');
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const fig = h % AVATAR_FIGS.length;
    const colors = AVATAR_FIG_COLORS[fig];
    return avatarCode(fig + 1, colors[Math.floor(h / AVATAR_FIGS.length) % colors.length]);
  }
  // Рисунок заготовки: фон (для style) и SVG. Неверный код — null.
  function avatarPreset(code) {
    const a = parseAvatarCode(code);
    if (!a) return null;
    const c = AVATAR_COLORS[a.color - 1];
    return {
      background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
      svg: `<svg viewBox="0 0 64 64" aria-hidden="true">${AVATAR_FIGS[a.fig - 1](c.fg, c.to)}</svg>`,
      name: `${AVATAR_FIG_NAMES[a.fig - 1]}, ${c.name.toLowerCase()}`,
    };
  }

  // Настройки профиля из profiles.json (пишет бот): ID → { tg, past, av }. Хранятся только отличия от умолчаний:
  // имя Telegram скрыто (tg 0), прошлые ники видны (past 1), аватар из Telegram (av '').
  const PROFILE_DEFAULTS = { tg: false, past: true, av: '' };
  function profileMap(data) {
    const map = new Map();
    const src = (data && data.profiles && typeof data.profiles === 'object') ? data.profiles : {};
    Object.entries(src).forEach(([id, x]) => {
      if (!/^\d+$/.test(id) || !x || typeof x !== 'object') return;
      map.set(id, { tg: x.tg === 1, past: x.past !== 0, av: parseAvatarCode(x.av) ? x.av : '' });
    });
    return map;
  }
  const profileOf = (profiles, id) => ({ ...PROFILE_DEFAULTS, ...((id && profiles && profiles.get && profiles.get(String(id))) || {}) });

  // Код для бота: «set_tg0_past1_a07-2», аватар из Telegram — «avtg». Не больше 64 символов [A-Za-z0-9_-].
  const profileStartCode = (s) => `set_tg${s.tg ? 1 : 0}_past${s.past ? 1 : 0}_${s.av || 'avtg'}`;
  // Разбор кода из /start: { tg?, past?, av? } — только названные части; неверный код — null.
  function parseProfileCode(code) {
    const s = String(code || '');
    if (s.length > 64 || !/^[A-Za-z0-9_-]+$/.test(s) || !s.startsWith('set_')) return null;
    const parts = s.slice(4).split('_');
    const out = {};
    for (const part of parts) {
      let m;
      if ((m = part.match(/^tg([01])$/))) out.tg = m[1] === '1';
      else if ((m = part.match(/^past([01])$/))) out.past = m[1] === '1';
      else if (part === 'avtg') out.av = '';
      else if (parseAvatarCode(part)) out.av = part;
      else return null;
    }
    return Object.keys(out).length ? out : null;
  }

  // Поиск игрока (без регистра — это удобство): по имени на сайте, имени Telegram и прошлым никам.
  const playerMatches = (p, q) => !q || [p.name, p.tgName, ...((p.past || []).map((x) => x.nick))].some((n) => n && normName(n).includes(q));

  // Старая ссылка #player= со строчным ником (ключи без ID раньше были без регистра): точный ключ — он, иначе ник
  // без регистра, если такой игрок ровно один. Не нашёлся — ключ как есть.
  function resolvePlayerKey(list, key) {
    const k = String(key || '');
    if (!k.startsWith('n:') || (list || []).some((p) => p.key === k)) return k;
    const same = (list || []).filter((p) => p.key.startsWith('n:') && normName(p.key.slice(2)) === normName(k.slice(2)));
    return same.length === 1 ? same[0].key : k;
  }

  // Все игроки: имя (последнее известное), с какого времени, конкурсы, число записей в рекордах, идущий конкурс.
  // pullData — pull-stats.json: игроки только с крутками тоже в списке (имя оттуда — если другого нет), pulls — круток всего.
  // nicks — gameNickMap(nicks.json): у игрока с ID имя — ник в игре, tgName — имя Telegram, past — прошлые ники.
  // profiles — profileMap(profiles.json): передана — имя Telegram только у включивших, прошлые ники — кроме скрывших.
  // cardData — cards.json: владельцы карт тоже в списке, cards — сколько их героев видели.
  function playerDirectory(events, contests, live, pullData, nicks, profiles, cardData) {
    const map = new Map();
    const get = (key, id) => {
      if (!map.has(key)) map.set(key, { key, id: id ? String(id) : '', name: '', nameAt: '', tgName: '', tgAt: '', since: '', last: '', contests: 0, records: 0, pulls: 0, cards: 0, live: null });
      return map.get(key);
    };
    const touch = (p, name, at, fromTelegram) => {
      if (name && at >= p.nameAt) { p.name = name; p.nameAt = at; }
      if (!p.name && name) p.name = name;
      if (fromTelegram && name && (at >= p.tgAt || !p.tgName)) { p.tgName = name; p.tgAt = at; }
      if (at && (!p.since || at < p.since)) p.since = at;
      if (at > p.last) p.last = at;
    };
    (events || []).forEach((ev) => {
      const seen = new Set();
      (ev.rows || []).forEach((row) => {
        const key = recordPlayerKey(row);
        const p = get(key, row.tgId);
        if (!seen.has(key)) { p.records += 1; seen.add(key); }
        touch(p, row.player, String(ev.date || ''));
      });
    });
    const liveContest = live && live.contest;
    (contests || []).forEach((c) => {
      if (liveContest && c.id === liveContest.id) return;
      (c.players || []).forEach((x) => {
        const p = get(`id:${x.id}`, x.id);
        p.contests += 1;
        touch(p, x.name, contestAt(c), true);
      });
    });
    if (liveContest && !(contests || []).some((c) => c.id === liveContest.id)) {
      const at = String(live.savedAt || '') || unixIso(liveContest.startedAt);
      (liveContest.players || []).forEach((x, i) => {
        const p = get(`id:${x.id}`, x.id);
        p.live = { place: x.place || i + 1, points: x.points, pulls: x.pulls, of: liveContest.players.length };
        touch(p, x.name, at, true);
      });
    }
    Object.entries((pullData && pullData.players) || {}).forEach(([id, x]) => {
      if (!/^\d+$/.test(id) || !x) return;
      const p = get(`id:${id}`, id);
      p.pulls = Number(x.pulls) || 0;
      if (!p.name && x.name) p.name = String(x.name);
      if (!p.tgName && x.name) p.tgName = String(x.name);
    });
    Object.keys((cardData && cardData.owners) || {}).forEach((id) => {
      if (!/^\d+$/.test(id)) return;
      const p = get(`id:${id}`, id);
      p.cards = new Set(cardOwned(cardData, id).map((x) => x[0])).size;
      if (!p.name) p.name = (nicks && nicks.get && nicks.get(id) && nicks.get(id).nick) || `ID ${id}`;
    });
    return [...map.values()].map(({ nameAt, tgAt, ...p }) => {
      const nick = p.id && nicks && nicks.get ? nicks.get(p.id) : null;
      if (!nick) return { ...p, tgName: '', past: [] };
      const pr = profiles ? profileOf(profiles, p.id) : null;
      return {
        ...p, name: nick.nick,
        tgName: p.tgName && p.tgName !== nick.nick && (!pr || pr.tg) ? p.tgName : '',
        past: pr && !pr.past ? [] : nick.past || [],
      };
    })
      .sort((a, b) => (b.contests + b.records + (b.live ? 1 : 0)) - (a.contests + a.records + (a.live ? 1 : 0))
        || b.last.localeCompare(a.last) || b.pulls - a.pulls || a.name.localeCompare(b.name, 'ru'));
  }

  // «Зал славы»: все SSS и SS из конкурсов со сводкой (SSS сверху, внутри по времени) и кто выбил больше всех.
  function hallOfFame(contests) {
    const legends = [];
    (contests || []).forEach((c) => {
      if (!c.stats) return;
      [['SSS', c.stats.sss], ['SS', c.stats.ss]].forEach(([rank, list]) => (list || []).forEach((x) => {
        legends.push({ hero: x.hero, rank, player: x.player, id: legendOwnerId(c.players, x), contest: c.name, contestId: c.id, date: x.date || 0 });
      }));
    });
    legends.sort((a, b) => (a.rank === b.rank ? 0 : a.rank === 'SSS' ? -1 : 1) || a.date - b.date);
    const byPlayer = new Map();
    legends.forEach((x) => {
      const key = x.id ? `id:${x.id}` : `n:${normName(x.player)}`;
      const p = byPlayer.get(key) || { key: x.id ? key : '', name: x.player, sss: 0, ss: 0, last: 0 };
      p[x.rank === 'SSS' ? 'sss' : 'ss'] += 1;
      if (x.date >= p.last) { p.last = x.date; p.name = x.player; }
      byPlayer.set(key, p);
    });
    const leaders = [...byPlayer.values()].sort((a, b) => (b.sss + b.ss) - (a.sss + a.ss) || b.sss - a.sss || a.last - b.last).slice(0, 5);
    return { legends, leaders };
  }

  // Профиль игрока: шапка, плитки, идущий конкурс, все конкурсы и рекорды.
  function playerProfile(events, contests, live, key, pullData, nicks, profiles) {
    const info = playerDirectory(events, contests, live, pullData, nicks, profiles).find((p) => p.key === key)
      || { key, id: key.startsWith('id:') ? key.slice(3) : '', name: '', tgName: '', past: [], since: '', last: '', contests: 0, records: 0, pulls: 0, live: null };
    const id = key.startsWith('id:') ? key.slice(3) : '';
    const liveContest = live && live.contest;
    const list = id ? (contests || []).filter((c) => !(liveContest && c.id === liveContest.id)).map((c) => {
      const players = c.players || [];
      const p = players.find((x) => String(x.id) === id);
      if (!p) return null;
      const legends = [...((c.stats && c.stats.sss) || []).map((x) => ({ ...x, rank: 'SSS' })), ...((c.stats && c.stats.ss) || []).map((x) => ({ ...x, rank: 'SS' }))]
        .filter((x) => legendOwnerId(players, x) === id).sort((a, b) => a.date - b.date);
      return {
        id: c.id, name: c.name, startedAt: c.startedAt, endedAt: c.endedAt, limit: c.limit || 100, of: players.length,
        place: p.place, points: p.points, pulls: p.pulls, ranks: p.ranks || {},
        best: legends.length ? legends.map((x) => `${x.hero} (${x.rank})`) : (p.best || []),
      };
    }).filter(Boolean).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)) : [];
    const rec = playerRecords(events || [], key);
    const liveRow = id && liveContest && !(contests || []).some((c) => c.id === liveContest.id)
      ? (liveContest.players || []).map((x, i) => ({ ...x, place: x.place || i + 1 })).find((x) => String(x.id) === id) : null;
    const places = list.map((c) => c.place).filter(Boolean);
    const recPlaces = rec.best.map((b) => b.rank);
    return {
      key, id, name: info.name || rec.name, tgName: info.tgName || '', past: info.past || [], since: info.since,
      tiles: {
        contests: list.length,
        bestPlace: places.length ? Math.min(...places) : null,
        sss: list.reduce((n, c) => n + (c.ranks.SSS || 0), 0),
        ss: list.reduce((n, c) => n + (c.ranks.SS || 0), 0),
        records: rec.weeks.length,
        recordEvents: rec.best.length,
        recordBest: recPlaces.length ? Math.min(...recPlaces) : null,
      },
      live: liveRow ? { name: liveContest.name, endsAt: liveContest.endsAt || 0, limit: liveContest.limit || 100, of: (liveContest.players || []).length, place: liveRow.place, points: liveRow.points, pulls: liveRow.pulls } : null,
      contests: list,
      records: rec,
      empty: !list.length && !rec.weeks.length && !liveRow,
    };
  }

  // ---------- Общая статистика круток (pull-stats.json от бота, tickets/pull-stats.md) ----------

  // Сводка по чату: '' — все чаты. Нет файла или такого чата — null.
  function pullScope(data, chatId) {
    if (!data || !data.all) return null;
    if (!chatId) return data.all;
    return (data.byChat && data.byChat[chatId]) || null;
  }

  // Игрок в сводке по ключу профиля (id:…). Нет — null.
  function pullPlayer(data, key) {
    const id = String(key || '').startsWith('id:') ? String(key).slice(3) : '';
    return (id && data && data.players && data.players[id]) || null;
  }

  // «Удача»: средние очки за крутку игрока ÷ среднее по всем. Меньше 50 круток — «мало данных».
  function pullLuck(player, min = 50) {
    if (!player || player.luck == null || !(player.pulls >= min)) return { value: null, num: '', note: 'мало данных', text: 'мало данных' };
    const value = player.luck;
    const num = `×${value.toFixed(2).replace('.', ',')}`;
    const note = value >= 1.05 ? 'везёт больше среднего' : value <= 0.95 ? 'везёт меньше среднего' : 'как в среднем';
    return { value, num, note, text: `${num} — ${note}` };
  }

  // Выпавшие герои игрока → id героев сайта. Сравнение по имени (normName) и рангу; если таких героев
  // несколько (разные аниме) или ни одного — пропуск.
  function pullHeroIds(data, player, heroes) {
    const byKey = new Map();
    (heroes || []).forEach((h) => {
      const key = `${h.rank}|${normName(h.name)}`;
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(heroId(h));
    });
    const ids = new Set();
    ((player && player.heroes) || []).forEach((i) => {
      const pair = data && data.heroList && data.heroList[i];
      if (!pair) return;
      const found = byKey.get(`${pair[1]}|${normName(pair[0])}`);
      if (found && found.size === 1) ids.add([...found][0]);
    });
    return [...ids];
  }

  // Автоотметка коллекции: только добавляет. done — уже разобранные герои (код → true, если карту добавили крутки).
  // Карта, которая уже была в коллекции, тоже запоминается: снимешь её вручную — сама она не вернётся.
  function pullAutoMark(collection, ids, done, heroes) {
    const codeOf = new Map((heroes || []).map((h) => [heroId(h), heroCode(h)]));
    const next = { ...(done || {}) };
    const add = [];
    ids.forEach((id) => {
      const code = codeOf.get(id);
      if (!code || code in next) return;
      next[code] = !collection[id];
      if (!collection[id]) add.push(id);
    });
    return { add, done: next };
  }

  // ---------- Разделы сайта группами (tickets/site-v2-shell.md, часть 1) ----------
  // Порядок групп в шапке на ПК и в «Ещё» на телефоне. menu — группа с выпадающим списком. Профиль и коллекция — в меню аватара.
  const NAV_GROUPS = [
    { id: 'home', icon: '🏠', label: 'Главная', menu: false, tabs: ['home'] },
    { id: 'heroes', icon: '🏆', label: 'Герои', menu: true, tabs: ['top', 'compare', 'card', 'cards', 'news'] },
    { id: 'contests', icon: '🎲', label: 'Конкурсы', menu: false, tabs: ['contests'] },
    { id: 'players', icon: '👥', label: 'Игроки', menu: true, tabs: ['players', 'ratings', 'records', 'stats'] },
    { id: 'more', icon: '☰', label: 'Ещё', menu: true, tabs: ['antistress', 'heroes', 'seasons', 'add', 'export', 'rules'] },
  ];
  // Группы только с открытыми разделами (shown — какие видны этому посетителю); пустая группа не показывается.
  function navGroups(shown) {
    const open = new Set(shown || []);
    return NAV_GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => open.has(t)) })).filter((g) => g.tabs.length);
  }
  const navGroupOf = (tab) => (NAV_GROUPS.find((g) => g.tabs.includes(tab)) || { id: '' }).id;

  // ---------- Картинки карт и коллекция из карт (cards.json пишет бот, tickets/hero-images.md) ----------

  // Картинки героя по коду: сначала без скина, потом скины по имени. file — имя без .jpg (миниатюра — file + '.s').
  function cardImages(data, code) {
    const x = data && data.images && data.images[code];
    if (!x) return [];
    const list = x.img ? [{ file: String(code), skin: '' }] : [];
    Object.keys(x.skins || {}).sort((a, b) => a.localeCompare(b, 'ru')).forEach((skin) => {
      const file = String(x.skins[skin] || '');
      if (/^[0-9a-z]+(~[A-Za-z0-9]+)?$/.test(file)) list.push({ file, skin });
    });
    return list;
  }

  // Карты игрока из cards.json: [[код, скин или '', уровень]]. Нет — пустой список.
  function cardOwned(data, id) {
    const list = data && data.owners && data.owners[String(id || '')];
    return Array.isArray(list) ? list.filter((x) => Array.isArray(x) && x[0]) : [];
  }

  // Автоотметка из карт — как из круток: только добавляет. done — разобранное (код → true, если добавили карты;
  // «код*» — скин). Есть хоть один скин у игрока — отмечается версия со скином. Снятое вручную само не вернётся.
  function cardAutoMark(collection, owned, done, heroes) {
    const byCode = new Map((heroes || []).map((h) => [heroCode(h), h]));
    const next = { ...(done || {}) };
    const add = [];
    const skins = [];
    const have = (id) => !!collection[id] || add.includes(id);
    (owned || []).forEach(([code, skin]) => {
      const hero = byCode.get(code);
      if (!hero) return;
      const id = heroId(hero);
      if (!(code in next)) {
        next[code] = !collection[id];
        if (!collection[id]) add.push(id);
      }
      const key = `${code}*`;
      if (!skin || !hero.skin || key in next || !have(id)) return;
      const hasSkin = collection[id] ? !!collection[id].skin : false;
      next[key] = !hasSkin;
      if (!hasSkin) skins.push(id);
    });
    return { add, skins, done: next };
  }

  // ---------- Каталог «🃏 Карты» (tickets/site-v2-shell.md, часть 2) ----------
  // Сколько картинок собрано: героев с картинкой без скина (из всех героев сайта) и картинок скинов.
  function cardCounts(heroes, data) {
    const images = (data && data.images) || {};
    const withPic = (heroes || []).filter((h) => images[heroCode(h)] && images[heroCode(h)].img).length;
    const skins = (heroes || []).reduce((n, h) => n + cardImages(data, heroCode(h)).filter((x) => x.skin).length, 0);
    return { heroes: (heroes || []).length, withPic, skins };
  }

  // Плитки каталога: фильтр и порядок — ранг (SSS → F), затем сила (strength: меньше — сильнее, как место в топе),
  // затем имя. f: { q, rank, cls, title, pic: ''|'yes'|'no', skin, mine }; owned(h) — своя карта.
  function cardCatalog(heroes, data, f = {}, { owned = () => false, strength = () => 0 } = {}) {
    const q = normName(f.q || '');
    const list = (heroes || []).map((h) => {
      const pics = cardImages(data, heroCode(h));
      return { h, pic: pics.find((x) => !x.skin) || pics[0] || null, hasImg: pics.some((x) => !x.skin), skinPic: pics.some((x) => x.skin), mine: !!owned(h) };
    }).filter((x) => (!q || normName(x.h.name).includes(q) || normName(x.h.title || '').includes(q))
      && (!f.rank || x.h.rank === f.rank) && (!f.cls || x.h.cls === f.cls) && (!f.title || (x.h.title || NO_TITLE) === f.title)
      && (f.pic !== 'yes' || x.hasImg) && (f.pic !== 'no' || !x.hasImg) && (!f.skin || x.skinPic) && (!f.mine || x.mine));
    const s = new Map(list.map((x) => [x, strength(x.h)]));
    return list.sort((a, b) => RANKS.indexOf(a.h.rank) - RANKS.indexOf(b.h.rank) || s.get(a) - s.get(b)
      || a.h.name.localeCompare(b.h.name, 'ru'));
  }

  // ---------- «📊 Рейтинги» (tickets/site-v2-shell.md, часть 3) ----------
  // Только из файлов сайта. Строка: { key, name, place, value, note }; одинаковый счёт — одно место. Пустая вкладка — [].
  // Вкладки «Помощники» нет (null), пока в cards.json нет поля credits.
  function rankRows(rows, cmp) {
    const sorted = rows.sort((a, b) => cmp(a, b) || String(a.name).localeCompare(String(b.name), 'ru'));
    return sorted.map((r, i) => ({ ...r, place: sorted.findIndex((x) => cmp(x, r) === 0) + 1 }));
  }
  function ratings({ contests, pulls, events, cards, heroes } = {}) {
    const keyOf = (id, name) => (id ? `id:${id}` : `n:${String(name || '').trim()}`);
    const pullPlayers = Object.entries((pulls && pulls.players) || {});
    const nameOf = new Map(pullPlayers.map(([id, p]) => [`id:${id}`, p.name || '']));

    // Конкурсы: побед, затем подиумов, затем лучшее место. Итоги — свежие сверху, имя — из последнего.
    const byContest = new Map();
    (contests || []).forEach((c) => (c.players || []).forEach((p) => {
      const key = keyOf(p.id, p.name);
      const x = byContest.get(key) || { key, name: p.name || '', wins: 0, podiums: 0, best: Infinity };
      if (p.place === 1) x.wins += 1;
      if (p.place >= 1 && p.place <= 3) x.podiums += 1;
      if (p.place >= 1) x.best = Math.min(x.best, p.place);
      byContest.set(key, x);
    }));
    const contestRows = rankRows([...byContest.values()].filter((x) => x.best < Infinity),
      (a, b) => b.wins - a.wins || b.podiums - a.podiums || a.best - b.best)
      .map((x) => ({ key: x.key, name: x.name, place: x.place, value: `🥇 ${x.wins}`, note: `подиумов ${x.podiums} · лучшее место №${x.best}` }));

    // Легендарки: SSS + SS из общей статистики круток; при равенстве важнее SSS.
    const legendRows = rankRows(pullPlayers.map(([id, p]) => ({ key: `id:${id}`, name: p.name || '', sss: p.sss || 0, ss: p.ss || 0 }))
      .filter((x) => x.sss + x.ss > 0), (a, b) => (b.sss + b.ss) - (a.sss + a.ss) || b.sss - a.sss)
      .map((x) => ({ key: x.key, name: x.name, place: x.place, value: String(x.sss + x.ss), note: `SSS ${x.sss} · SS ${x.ss}` }));

    // Удача: как в профиле, от luckMin круток; «мало данных» не показывается.
    const min = (pulls && pulls.luckMin) || 50;
    const luckRows = rankRows(pullPlayers.map(([id, p]) => ({ key: `id:${id}`, name: p.name || '', pulls: p.pulls || 0, luck: pullLuck(p, min) }))
      .filter((x) => x.luck.value != null), (a, b) => b.luck.value - a.luck.value)
      .map((x) => ({ key: x.key, name: x.name, place: x.place, value: x.luck.num, note: `${x.luck.note} · круток ${x.pulls}` }));

    // Рекорды: первых мест по ивентам (лучший результат игрока в ивенте), затем мест в топ-3.
    const byRecord = new Map();
    recordLeaders(events || []).forEach((g) => g.players.filter((p) => p.place <= 3).forEach((p) => {
      const x = byRecord.get(p.key) || { key: p.key, name: p.player, firsts: 0, top3: 0 };
      if (p.place === 1) x.firsts += 1;
      x.top3 += 1;
      byRecord.set(p.key, x);
    }));
    const recordRows = rankRows([...byRecord.values()], (a, b) => b.firsts - a.firsts || b.top3 - a.top3)
      .map((x) => ({ key: x.key, name: x.name, place: x.place, value: `🥇 ${x.firsts}`, note: `в топ-3: ${x.top3}` }));

    // Коллекционеры: разные герои из круток и присланных карт, без повторов.
    const byCode = new Map((heroes || []).map((h) => [heroCode(h), heroId(h)]));
    const owned = new Map();
    const add = (id, heroIdValue) => { if (!owned.has(id)) owned.set(id, new Set()); owned.get(id).add(heroIdValue); };
    pullPlayers.forEach(([id, p]) => pullHeroIds(pulls, p, heroes).forEach((h) => add(id, h)));
    Object.keys((cards && cards.owners) || {}).forEach((id) => cardOwned(cards, id).forEach(([code]) => { if (byCode.has(code)) add(id, byCode.get(code)); }));
    const collectorRows = rankRows([...owned].map(([id, set]) => ({ key: `id:${id}`, name: nameOf.get(`id:${id}`) || '', n: set.size })).filter((x) => x.n > 0),
      (a, b) => b.n - a.n).map((x) => ({ key: x.key, name: x.name, place: x.place, value: String(x.n), note: 'разных героев' }));

    // Помощники: картинки карт и скинов, добавленные благодаря игроку (cards.json, credits — пишет бот).
    const credits = cards && cards.credits && typeof cards.credits === 'object' ? cards.credits : null;
    const helperRows = credits ? rankRows(Object.entries(credits).map(([id, n]) => ({ key: `id:${id}`, name: nameOf.get(`id:${id}`) || '', n: Number(n) || 0 }))
      .filter((x) => x.n > 0), (a, b) => b.n - a.n).map((x) => ({ key: x.key, name: x.name, place: x.place, value: String(x.n), note: 'картинок' })) : null;

    return { contests: contestRows, legends: legendRows, luck: luckRows, records: recordRows, collectors: collectorRows, helpers: helperRows };
  }

  // Разобранные герои для облака Telegram: коды через запятую, «+» — карту добавили крутки.
  const packPullMarks = (done) => Object.keys(done || {}).sort().map((code) => code + (done[code] ? '+' : '')).join(',');
  function unpackPullMarks(text) {
    const done = {};
    String(text || '').split(',').filter(Boolean).forEach((part) => { done[part.replace(/\+$/, '')] = part.endsWith('+'); });
    return done;
  }

  // ---------- Файл базы ----------

  const isText = (v) => typeof v === 'string' && v.trim() !== '';
  const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

  // Настройки расчёта из файла или базы: все три поля целиком, иначе null.
  function cleanCalcSettings(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const { maxMoves, runs, formula } = raw;
    if (!Number.isInteger(maxMoves) || maxMoves < 1 || maxMoves > 30) return null;
    if (!isNumber(runs) || runs <= 0) return null;
    if (!formula || typeof formula !== 'object') return null;
    const clean = {};
    for (const cls of CLASSES) {
      const f = formula[cls];
      if (!f || !isNumber(f.bm) || !isNumber(f.hp)) return null;
      clean[cls] = { bm: f.bm, hp: f.hp };
    }
    return { maxMoves, runs, formula: clean };
  }

  function checkTitleDocs(docs, where) {
    if (!Array.isArray(docs)) return `${where}: нет списка тайтлов.`;
    for (let i = 0; i < docs.length; i += 1) {
      const d = docs[i];
      const label = `${where}, тайтл №${i + 1}`;
      if (!d || typeof d !== 'object' || !isText(d.id)) return `${label}: нет id.`;
      if (typeof d.title !== 'string') return `${label}: нет названия.`;
      if (!Array.isArray(d.heroes)) return `${label} «${d.title}»: нет списка героев.`;
      const bad = d.heroes.findIndex((h) => !h || !isText(h.name) || !RANKS.includes(h.rank) || !CLASSES.includes(h.cls) || !isNumber(h.bm) || !isNumber(h.hp));
      if (bad >= 0) return `${label} «${d.title}»: герой №${bad + 1} записан не так, как в базе.`;
    }
    return '';
  }

  const copyDoc = (d) => ({ id: d.id, title: d.title, heroes: d.heroes.map((h) => ({ ...h })) });

  // Разбор файла для «Восстановить из файла»: выгрузка страницы (animatrix-data.json) или сборка сайта (data.json).
  // Ничего не пишет; при любой ошибке возвращает { error } и база остаётся как есть.
  function parseBackupFile(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { error: 'Файл повреждён или это не JSON. В базу ничего не записано.' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.titles)) {
      return { error: 'Это не файл базы AniMatrix: в нём нет списка тайтлов. В базу ничего не записано.' };
    }
    const fail = (message) => ({ error: `Файл не похож на базу AniMatrix. ${message} В базу ничего не записано.` });
    const titleError = checkTitleDocs(data.titles, 'Тайтлы');
    if (titleError) return fail(titleError);
    if (data.seasons !== undefined && !Array.isArray(data.seasons)) return fail('Сезоны записаны не списком.');
    if (data.records !== undefined && !Array.isArray(data.records)) return fail('Рекорды записаны не списком.');

    const titles = data.titles.map((d) => {
      const doc = copyDoc(d);
      // null — «без даты» на странице, его тоже надо вернуть как есть.
      if ((typeof d.addedAt === 'string' && d.addedAt) || d.addedAt === null) doc.addedAt = d.addedAt;
      if (isNumber(d.position)) doc.position = d.position;
      return doc;
    });

    const seasons = [];
    for (let i = 0; i < (data.seasons || []).length; i += 1) {
      const s = data.seasons[i];
      if (!s || typeof s !== 'object' || !isText(s.id)) return fail(`Сезон №${i + 1}: нет id.`);
      const docsError = checkTitleDocs(s.docs, `Сезон «${s.name || s.id}»`);
      if (docsError) return fail(docsError);
      const { id, docs, ...meta } = s;
      seasons.push({ id, meta, docs: docs.map(copyDoc) });
    }

    const records = [];
    for (let i = 0; i < (data.records || []).length; i += 1) {
      const r = data.records[i];
      if (!r || typeof r !== 'object' || !isText(r.id)) return fail(`Рекорды, список №${i + 1}: нет id.`);
      if (!Array.isArray(r.rows)) return fail(`Рекорды «${r.title || r.id}»: нет строк с игроками.`);
      const { id, ...doc } = r;
      records.push({ id, doc });
    }

    const settings = cleanCalcSettings(data.settings);
    const kind = Array.isArray(data.records) || !data.results ? 'page' : 'site';
    const missing = [];
    if (!Array.isArray(data.seasons)) missing.push('сезоны');
    if (!Array.isArray(data.records)) missing.push('рекорды');
    if (!settings) missing.push('настройки расчёта');
    if (titles.length && !titles.some((t) => 'addedAt' in t || isNumber(t.position))) missing.push('даты и порядок тайтлов');
    return {
      kind,
      savedAt: (typeof data.savedAt === 'string' && data.savedAt) || (typeof data.builtAt === 'string' && data.builtAt) || '',
      titles,
      seasons,
      records,
      settings,
      missing,
      heroCount: titles.reduce((sum, t) => sum + t.heroes.length, 0),
    };
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
    RECORD_EVENTS, RECORD_UNITS, recordEventInfo, detectRecordEvent,
    parseRecordLines, parseEventMessage, parsePlayerCell, periodEnd, recordLeaders, recordScore, recordPlayerKey, recordEventKey, playerRecords, cleanRecordName, sortRecordEvents,
    legendOwnerId, playerDirectory, playerProfile, hallOfFame, gameNickMap, playerMatches, resolvePlayerKey,
    AVATAR_FIG_NAMES, AVATAR_COLORS, AVATAR_FIG_COLORS, avatarCode, parseAvatarCode, avatarSeedCode, avatarPreset, PROFILE_DEFAULTS, profileMap, profileOf, profileStartCode, parseProfileCode,
    pullScope, pullPlayer, pullLuck, pullHeroIds, pullAutoMark, packPullMarks, unpackPullMarks, cardImages, cardOwned, cardAutoMark,
    NAV_GROUPS, navGroups, navGroupOf, cardCounts, cardCatalog, ratings,
    STAT_TIERS, statsFor, statsSections, statsNote, sectionCaption, statsTableHtml, statsHtml, statsText,
    CLASS_ICONS, SKIN_MARK, EVENT_MARK, exportTitle, exportCaption, exportCells, exportMessages, exportHtml, exportArticles, exportNote, limitPlaces,
    CLASSES, RANKS, DEFAULTS, NO_TITLE, SKIN_BONUS, fight, duel, plainFight, formulaScore,
    createPairRates, seededDice, levelFactor, toBase, parseMessages, parseDetailed, catalogCounts,
    normName, sameName, titleDocId, planImport, removeDuplicates, matchSeason, skinVersion, seatOffTop, sharedPlaces,
    sortTitles, planTitleMove, cleanCalcSettings, parseBackupFile,
  };
});
